// Tries the QA pieces end to end on this machine with every API mocked: no Gmail, no
// Resend, no secrets. `npm run qa:dry-run`. See docs/qa.md and ADR 0011.
//
// It makes a throwaway database on the local Postgres, starts the app as QA runs it
// (src/main.ts, on mocks) in the schema `qa_dry`, runs scripts/qa-seed.ts, then runs
// scripts/qa-email-journey.ts --dry-run against it, which plays the Tenant through the
// app's phone simulator. It proves the script and the app's side of the journey. It
// proves nothing about Gmail, Resend, Claude or the tunnel: only the real run can.
//
// Exits with the journey's status (0 passed, 1 failed, 2 refused).

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { LOCAL_DATABASE_URL } from '../src/db.ts';
import { MOCKED_APIS } from '../test/e2e/support/server.ts';
import { createDatabase, dropDatabase, ensurePostgres, testServerUrl, withDatabase } from './local-postgres.ts';

const node = [process.execPath, '--import', 'tsx'] as const;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/** Runs a script to the end, passing its output through. */
function runScript(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(node[0], [...node.slice(1), ...args], { env, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

/** Starts the app and resolves once it listens. */
function startApp(env: NodeJS.ProcessEnv): Promise<ChildProcess> {
  const child = spawn(node[0], [...node.slice(1), 'src/main.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The app didn't start within 60s:\n${output}`)), 60_000);
    const take = (chunk: Buffer) => {
      output += chunk;
      if (output.includes('listening on port')) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout!.on('data', take);
    child.stderr!.on('data', take);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`The app exited with code ${code} before it started:\n${output}`));
    });
  });
}

const stop = (child: ChildProcess) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });

const server = testServerUrl();
const database = `myest8_qa_dry_${Date.now().toString(36)}`;
await ensurePostgres(server);
await createDatabase(server, database);

let app: ChildProcess | undefined;
let code = 1;
try {
  const port = await freePort();
  const qa = {
    QA_PM_EMAIL: 'qa-pm@example.test',
    QA_PM_PASSWORD: 'qa-dry-run-password',
    QA_GMAIL_ADDRESS: 'qa-tenant@example.test',
    QA_INBOUND_ADDRESS: 'qa@qa-mail.example.test',
  };
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...MOCKED_APIS,
    ...qa,
    PORT: String(port),
    // What the app tells Tenants its address is (src/main.ts wants https). The journey reaches it on loopback.
    PUBLIC_URL: 'https://qa.dry-run.test',
    ALLOW_MOCKS: '1',
    SUPABASE_DB_URL: withDatabase(server, database),
    DATABASE_SCHEMA: 'qa_dry',
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    RESEND_WEBHOOK_SECRET: '',
    QA_LOG_DIR: process.env.QA_LOG_DIR ?? 'qa-journey-logs',
  };
  console.log(`Starting the QA app on mocks at 127.0.0.1:${port}, schema qa_dry in database ${database} (not ${new URL(LOCAL_DATABASE_URL).pathname.slice(1)})`);
  app = await startApp(env);

  // Twice, as the nightly run does it: the second seed finds the Agency there, and the second journey finds the first one's clean-up done.
  const journeyEnv = { ...env, PUBLIC_URL: `http://127.0.0.1:${port}` };
  for (const round of [1, 2]) {
    console.log(`\n=== Round ${round}: seed, then journey`);
    const seeded = await runScript(['scripts/qa-seed.ts'], env);
    if (seeded !== 0) throw new Error(`The seed exited with ${seeded}`);
    code = await runScript(['scripts/qa-email-journey.ts', '--dry-run'], journeyEnv);
    if (code !== 0) break;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  if (app) await stop(app);
  await dropDatabase(server, database);
}
process.exit(code);
