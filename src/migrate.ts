// Applies supabase/migrations/*.sql to a local database: the dev database, each
// test's schema, the demo's and CI's. Hosted databases (staging, production)
// get the same files from the Supabase CLI (`supabase db push`), never from
// here: this refuses any server that isn't on this machine.
//
// Files are named as the Supabase CLI names them, `<timestamp>_<name>.sql`, and
// run in that order, together in one transaction. Each is recorded in the
// schema's `schema_migrations` table, so it is applied once.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ident, type Db } from './db.ts';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

const FILE_NAME = /^(\d{14})_([a-z0-9_]+)\.sql$/;

type Migration = { version: string; name: string; sql: string };

let cached: Migration[] | undefined;

/** Every migration, oldest first. Read once per process. */
export function migrations(dir = MIGRATIONS_DIR): Migration[] {
  if (dir === MIGRATIONS_DIR && cached) return cached;
  const found = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => {
      const match = FILE_NAME.exec(file);
      if (!match) throw new Error(`${file}: migrations are named <14-digit timestamp>_<name>.sql, as \`supabase migration new\` names them`);
      return { version: match[1]!, name: match[2]!, sql: readFileSync(`${dir}/${file}`, 'utf8') };
    });
  if (dir === MIGRATIONS_DIR) cached = found;
  return found;
}

/**
 * Creates `db`'s schema if it's missing and applies every migration it hasn't
 * had. Returns the versions applied. Two processes migrating the same schema
 * at once take turns.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  if (!db.local) {
    throw new Error('Migrations are only applied here to a local Postgres. Apply them to a hosted database with the Supabase CLI: supabase db push --db-url "$SUPABASE_DB_URL"');
  }
  const schema = ident(db.schema);
  const applied: string[] = [];
  await db.sql.begin(async (sql) => {
    await sql.unsafe(`SELECT pg_advisory_xact_lock(hashtext('myest8.migrate.' || $1))`, [db.schema]);
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set((await sql.unsafe<{ version: string }[]>(`SELECT version FROM ${schema}.schema_migrations`)).map((r) => r.version));
    // A database the Supabase CLI set up (`supabase start`) records its migrations there instead.
    if (db.schema === 'public') {
      const [cli] = await sql.unsafe<{ found: string | null }[]>(`SELECT to_regclass('supabase_migrations.schema_migrations')::text AS found`);
      if (cli?.found) for (const r of await sql.unsafe<{ version: string }[]>('SELECT version FROM supabase_migrations.schema_migrations')) done.add(r.version);
    }
    for (const migration of migrations(dir)) {
      if (done.has(migration.version)) continue;
      await sql.savepoint(async (step) => {
        await step.unsafe(`SET LOCAL search_path TO ${schema}`);
        await step.unsafe(migration.sql);
        await step.unsafe(`INSERT INTO ${schema}.schema_migrations (version, name) VALUES ($1, $2)`, [migration.version, migration.name]);
      });
      applied.push(migration.version);
    }
  });
  return applied;
}
