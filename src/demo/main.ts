// `npm run demo`: serves the whole app with dummy external APIs, a simulated
// messenger and seeded data. Everything is in memory and resets on restart.

import { serve } from '@hono/node-server';
import { createDemo } from './runtime.ts';

const port = Number(process.env.PORT ?? 3000);
const { web, seed, baseUrl, apis, startWorkerLoop } = await createDemo({
  onOutbound: (m) => console.log(`[${m.channel} → ${m.to}] ${m.text.split('\n')[0]}`),
});
const stopWorker = startWorkerLoop(2_000);

const server = serve({ fetch: web.fetch, port }, () => {
  const real = Object.entries(apis).filter(([, choice]) => choice === 'real').map(([name]) => name);
  console.log(`
myEST8 demo running at ${baseUrl}
Sign in as:
${seed.logins.map((l) => `  ${l.name.padEnd(13)} ${l.email.padEnd(22)} password ${l.password}`).join('\n')}
The phone simulator is at ${baseUrl}/demo
External APIs: ${real.length ? `real ${real.join(', ')}; the rest mocked` : 'all mocked'}
Data is in memory and resets when you stop the demo. Ctrl+C to stop.
`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  stopWorker();
  if (error.code !== 'EADDRINUSE') throw error;
  console.error(`Port ${port} is already in use. Try another: PORT=${port + 1} npm run demo`);
  process.exit(1);
});

function shutdown() {
  stopWorker();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
