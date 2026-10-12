// The local Postgres every environment but staging and production uses: a
// `postgres:17` container in Docker (`npm run db:start`), or any Postgres you
// point TEST_DATABASE_URL / SUPABASE_DB_URL at (CI uses a service container on
// the same port). Shared by scripts/db.ts, the vitest global setup and the
// Playwright config.

import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { ident, isLocalUrl, LOCAL_DATABASE_URL } from '../src/db.ts';

export const CONTAINER = 'myest8-postgres';
export const IMAGE = 'postgres:17-alpine';
export const VOLUME = 'myest8-pgdata';
const LOCAL_PORT = new URL(LOCAL_DATABASE_URL).port;

/**
 * The Postgres server tests create their throwaway databases on. Its database
 * part is only used to connect; every run creates and drops its own.
 */
export function testServerUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.TEST_DATABASE_URL || withDatabase(LOCAL_DATABASE_URL, 'postgres');
  // Tests create and drop databases: never on a hosted server.
  if (!isLocalUrl(url)) throw new Error(`TEST_DATABASE_URL must be a Postgres on this machine (localhost), not ${redact(url)}`);
  return url;
}

/** The same server and credentials, another database. */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

function admin(url: string) {
  return postgres(withDatabase(url, 'postgres'), { max: 1, onnotice: () => {}, connect_timeout: 5, idle_timeout: 1 });
}

/** Whether a Postgres server answers at `url`. */
export async function reachable(url: string): Promise<boolean> {
  const sql = admin(url);
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Whether `url` is the local container's address (so we may start it). */
function isContainerUrl(url: string) {
  return isLocalUrl(url) && new URL(url).port === LOCAL_PORT;
}

/**
 * Makes sure a Postgres answers at `url`. When it's the local container's
 * address and nothing answers, starts the container (creating it the first
 * time), and waits for it.
 */
export async function ensurePostgres(url: string, log: (line: string) => void = () => {}): Promise<void> {
  if (await reachable(url)) return;
  if (!isContainerUrl(url)) throw new Error(`No Postgres answers at ${redact(url)}. Start it, or unset the variable to use the local Docker one.`);
  let exists = true;
  try {
    docker(['inspect', CONTAINER]);
  } catch {
    exists = false;
  }
  try {
    if (exists) {
      log(`Starting the ${CONTAINER} container...`);
      docker(['start', CONTAINER]);
    } else {
      log(`Creating the ${CONTAINER} container (${IMAGE}, port ${LOCAL_PORT}, data in the ${VOLUME} volume)...`);
      docker([
        'run', '--detach', '--name', CONTAINER,
        '--publish', `127.0.0.1:${LOCAL_PORT}:5432`,
        '--env', 'POSTGRES_PASSWORD=postgres',
        // Text sorts by code point, as it did in SQLite, whatever the host's locale.
        '--env', 'POSTGRES_INITDB_ARGS=--locale-provider=builtin --locale=C.UTF-8',
        '--volume', `${VOLUME}:/var/lib/postgresql/data`,
        IMAGE,
        '-c', 'max_connections=300',
        // A development database: faster commits, at the risk of losing the last moment of data if the machine crashes.
        '-c', 'synchronous_commit=off',
      ]);
    }
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr?.trim() || String(error);
    throw new Error(`Couldn't start Postgres in Docker (${detail}). Is Docker running? Or set TEST_DATABASE_URL / SUPABASE_DB_URL to a Postgres you run yourself.`);
  }
  const deadline = Date.now() + 60_000;
  while (!(await reachable(url))) {
    if (Date.now() > deadline) throw new Error(`Postgres didn't start within 60 s; see \`docker logs ${CONTAINER}\``);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function stopContainer(): Promise<void> {
  try {
    docker(['stop', CONTAINER]);
  } catch {
    // Not running, or never created.
  }
}

/** Creates `name` on the server at `url` unless it exists. */
export async function createDatabase(url: string, name: string): Promise<void> {
  const sql = admin(url);
  try {
    const [found] = await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (!found) await sql.unsafe(`CREATE DATABASE ${ident(name)}`);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/** Drops `name` on the server at `url`, closing anything still connected to it. */
export async function dropDatabase(url: string, name: string): Promise<void> {
  const sql = admin(url);
  try {
    await sql.unsafe(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/** A connection string with its password hidden, for messages. */
export function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(not a URL)';
  }
}
