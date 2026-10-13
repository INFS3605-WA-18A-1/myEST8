// `npm start`: myEST8 for real use on one server (ADR 0004), such as a home
// server behind a Cloudflare Tunnel. It runs the same composition as the demo
// (src/demo/runtime.ts) with no demo Agency: Agencies sign up, their data is kept
// in a named Postgres schema, and each channel uses its real provider when its
// environment variables are set (Gmail for email, Meta's WhatsApp Cloud API).
// SMS stays on the phone simulator until an SMS provider is configured.
//
// It refuses to start without an https PUBLIC_URL, because webhooks, OAuth
// redirects and Tenant links all depend on it, and with any mocked API unless
// ALLOW_MOCKS=1 says that is intended.

import { serve } from '@hono/node-server';
import { createDemo } from './demo/runtime.ts';

function refuse(problem: string): never {
  console.error(`myEST8 won't start: ${problem}`);
  process.exit(2);
}

const env = { ...process.env };
const publicUrl = env.PUBLIC_URL?.trim();
if (!publicUrl?.startsWith('https://')) refuse('set PUBLIC_URL to the https address people and providers reach this server on (your tunnel hostname).');
// Data is always kept: a named schema survives restarts.
env.DATABASE_SCHEMA ||= 'myest8';
// The demo only really sends to an allowlist, because its seeded people are made
// up. Here everyone is real, so everyone can be messaged unless the list is set.
env.DEMO_SEND_TO ||= '*';

const port = Number(env.PORT ?? 3000);
const { web, apis, database, startWorkerLoop, close } = await createDemo({ env, seedAgency: false });

const mocked = Object.entries(apis).filter(([, choice]) => choice === 'mock').map(([name]) => name);
if (mocked.length && env.ALLOW_MOCKS !== '1') {
  await close();
  refuse(`these run on in-process mocks: ${mocked.join(', ')}. Set their keys (see .env.example), or ALLOW_MOCKS=1 to start anyway.`);
}

const stopWorker = startWorkerLoop(2_000);
const server = serve({ fetch: web.fetch, port }, () => {
  console.log(`myEST8 listening on port ${port}, public at ${publicUrl}`);
  console.log(`Data in Postgres schema ${database.schema}${database.reused ? ` (since ${database.seededAt})` : ' (new)'}.`);
  console.log(`Real: ${Object.entries(apis).filter(([, c]) => c === 'real').map(([n]) => n).join(', ') || 'nothing'}. Mocked: ${mocked.join(', ') || 'nothing'}.`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  stopWorker();
  if (error.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Set PORT to another.`);
  else console.error(error);
  void close().finally(() => process.exit(1));
});

function shutdown() {
  stopWorker();
  server.close(() => void close().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
