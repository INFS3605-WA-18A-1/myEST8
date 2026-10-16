// Production on this machine: `npm run prod:local`. Serves api/index.ts's own `fetch`
// (what Vercel runs) over a local Postgres, with the migrations applied the way
// production gets them (scripts/db.ts migrate, never the app), mocked providers
// allowed, every external API blanked, and a timer calling the cron route as
// .github/workflows/worker-ping.yml does. No demo Agency, no stories: sign up.
// See docs/testing.md, "Run it like production".
//
//   SUPABASE_DB_URL   a Postgres on this machine (default: the Docker one, `npm run db:start`)
//   DATABASE_SCHEMA   default `public`, as in production
//   PORT              default 3000
//   PROD_LOCAL_CRON_SECONDS   worker ping interval, default 30 (production: 300)

import { execFileSync } from 'node:child_process';
import { serve } from '@hono/node-server';
import { isLocalUrl, LOCAL_DATABASE_URL } from '../src/db.ts';
import { MOCKED_APIS } from '../test/e2e/support/server.ts';
import { redact } from './local-postgres.ts';

const port = Number(process.env.PORT) || 3000;
const databaseUrl = process.env.SUPABASE_DB_URL || LOCAL_DATABASE_URL;
const schema = process.env.DATABASE_SCHEMA || 'public';
const pingSeconds = Number(process.env.PROD_LOCAL_CRON_SECONDS) || 30;
const cronSecret = process.env.CRON_SECRET || 'prod-local-cron-secret';

if (!isLocalUrl(databaseUrl)) {
  console.error(`${redact(databaseUrl)} isn't a local database. prod:local never connects to a hosted one.`);
  process.exit(1);
}

// Migrate as the pipeline does (`supabase db push` there, scripts/db.ts here): once, before the app starts.
// db.ts starts the Docker Postgres when nothing answers at the default address.
const dbEnv = { ...process.env, SUPABASE_DB_URL: databaseUrl, DATABASE_SCHEMA: schema };
execFileSync(process.execPath, ['--import', 'tsx', 'scripts/db.ts', 'migrate'], { env: dbEnv, stdio: 'inherit' });

// What Vercel would hold as environment variables. Everything that reaches a real service is
// blanked (MOCKED_APIS, plus storage and Gmail), whatever this shell has set.
Object.assign(process.env, MOCKED_APIS, {
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  TOKEN_ENCRYPTION_KEY: '',
  RESEND_WEBHOOK_SECRET: '',
  RESEND_INBOUND_DOMAIN: '',
  SENDGRID_INBOUND_PUBLIC_KEY: '',
  VERCEL_ENV: '',
  VERCEL_URL: '',
  VERCEL_PROJECT_PRODUCTION_URL: '',
  SUPABASE_DB_URL: databaseUrl,
  DATABASE_SCHEMA: schema,
  PUBLIC_URL: `http://localhost:${port}`,
  LOCAL_PROD: '1',
  ALLOW_MOCKS: '1',
  CRON_SECRET: cronSecret,
  FILE_LINK_SECRET: process.env.FILE_LINK_SECRET || 'prod-local-file-link-secret-0123456789',
});

// Imported only now: api/index.ts reads its environment when the first request builds the app.
const { default: handler } = await import('../api/index.ts');

const server = serve({ fetch: (request) => handler.fetch(request), port, hostname: 'localhost' });
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});

// Build the app now (it is built lazily on Vercel), so a bad setting stops this run rather than the first page.
try {
  const warm = await fetch(`http://localhost:${port}/login`);
  if (!warm.ok) throw new Error(`GET /login answered ${warm.status}`);
} catch (error) {
  console.error('The app did not start:', error);
  process.exit(1);
}

// Vercel Cron and the GitHub ping call the worker route; here a timer does, every PROD_LOCAL_CRON_SECONDS.
let pinging = false;
const ping = setInterval(async () => {
  if (pinging) return;
  pinging = true;
  try {
    const response = await fetch(`http://localhost:${port}/api/cron/worker`, { headers: { authorization: `Bearer ${cronSecret}` } });
    if (!response.ok) console.error(`[prod-local] worker ping answered ${response.status}`);
  } catch (error) {
    console.error('[prod-local] worker ping failed:', error);
  } finally {
    pinging = false;
  }
}, pingSeconds * 1000);

console.log(`myEST8 prod-local running at http://localhost:${port} (api/index.ts as Vercel runs it)`);
console.log(`  database ${redact(databaseUrl)}, schema ${schema}; providers mocked (ALLOW_MOCKS=1), external APIs blanked`);
console.log(`  worker pinged at /api/cron/worker every ${pingSeconds} s (production: every 5 min); CRON_SECRET=${cronSecret}`);
console.log('  no demo data: sign up at /signup');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(ping);
    server.close();
    process.exit(0);
  });
}
