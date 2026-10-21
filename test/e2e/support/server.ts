// Starting the demo as a real server process for the browser tests. Every run
// gets its own Postgres database (never the dev one), every server its own
// schema in it, and every external API is mocked whatever this machine's env
// vars say.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** Env vars that would switch the demo to a real external API: blanked so tests never call one. */
export const MOCKED_APIS = {
  JEV_API_URL: '',
  ANTHROPIC_API_KEY: '',
  VISION_API_URL: '',
  QUOTES_API_URL: '',
  GOOGLE_MAPS_API_KEY: '',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  META_WHATSAPP_PHONE_NUMBER_ID: '',
  META_WHATSAPP_ACCESS_TOKEN: '',
  META_WHATSAPP_NUMBER: '',
  META_APP_SECRET: '',
  META_WEBHOOK_VERIFY_TOKEN: '',
  TWILIO_ACCOUNT_SID: '',
  TWILIO_AUTH_TOKEN: '',
  TWILIO_SMS_FROM: '',
  TWILIO_WHATSAPP_FROM: '',
  SENDGRID_API_KEY: '',
  RESEND_API_KEY: '',
};

/** The command that serves the demo; tsx runs the TypeScript directly. */
export const DEMO_COMMAND = [process.execPath, '--import', 'tsx', 'src/demo/main.ts'] as const;

/** A port nothing is listening on right now, found synchronously (the Playwright config can't await). */
export function freePort(): number {
  const script = "const s = require('node:net').createServer().listen(0, () => { process.stdout.write(String(s.address().port)); s.close(); })";
  return Number(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }).trim());
}

/**
 * Makes this run's database on the test Postgres (starting the local Docker one
 * if nothing answers) and returns its connection string. Synchronous, as the
 * Playwright config can't await.
 */
export function testDatabase(): string {
  const name = `myest8_e2e_${Date.now().toString(36)}_${process.pid}`;
  return execFileSync(process.execPath, ['--import', 'tsx', 'scripts/db.ts', 'test-database', name], { encoding: 'utf8' }).trim();
}

/** A schema name no other server in this run uses. */
export function uniqueSchema(): string {
  return `e2e_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

export type DemoServer = { url: string; stop(): Promise<void> };

/**
 * Starts the demo on `port` with its data kept in `schema` of this run's
 * database, and resolves once it is serving. `stories` plays the demo stories
 * (the dashboard then has visits); otherwise the Agency is empty. `stop()` sends
 * SIGTERM, as Ctrl+C would, so the database is closed cleanly before the process exits.
 */
export async function startDemo({ port, schema, stories = false }: { port: number; schema: string; stories?: boolean }): Promise<DemoServer> {
  const url = `http://localhost:${port}`;
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) throw new Error('E2E_DATABASE_URL is not set: run the browser tests with `npm run test:e2e`');
  const child = spawn(DEMO_COMMAND[0], DEMO_COMMAND.slice(1), {
    env: { ...process.env, ...MOCKED_APIS, PORT: String(port), PUBLIC_URL: url, SUPABASE_DB_URL: databaseUrl, DATABASE_SCHEMA: schema, DEMO_DATA: stories ? 'stories' : 'empty' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout!.on('data', (chunk) => (output += chunk));
  child.stderr!.on('data', (chunk) => (output += chunk));
  const startMs = stories ? 180_000 : 30_000;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The demo didn't start within ${startMs / 1000}s:\n${output}`)), startMs);
    child.stdout!.on('data', () => {
      if (output.includes('myEST8 demo running at')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`The demo exited with code ${code} before it started:\n${output}`));
    });
  });
  return { url, stop: () => stop(child) };
}

function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}
