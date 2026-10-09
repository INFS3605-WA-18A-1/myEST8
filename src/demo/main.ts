// `npm run demo`: serves the whole app with dummy external APIs, a simulated
// messenger and seeded data, with the demo stories already played so there is
// work in flight (DEMO_DATA=empty for just the Agency). Everything is in
// memory and resets on restart.

import { serve } from '@hono/node-server';
import { createDemo } from './runtime.ts';
import { describeStories } from './stories.ts';

const port = Number(process.env.PORT ?? 3000);
const wantStories = process.env.DEMO_DATA !== 'empty';
// The stories send a few hundred messages while seeding; print only the ones after start-up.
let started = false;
const { web, seed, stories, baseUrl, apis, startWorkerLoop } = await createDemo({
  stories: wantStories,
  onOutbound: (m) => {
    if (started) console.log(`[${m.channel} → ${m.to}] ${m.text.split('\n')[0]}`);
  },
});
started = true;
const stopWorker = startWorkerLoop(2_000);
const storiesLine = stories
  ? `${describeStories(stories)}. DEMO_DATA=empty starts without them.`
  : wantStories
    ? 'Demo stories skipped: they need the mock classifier and quote reader.'
    : 'Demo stories off (DEMO_DATA=empty): just the Agency, nothing in flight.';

const server = serve({ fetch: web.fetch, port }, () => {
  const real = Object.entries(apis).filter(([, choice]) => choice === 'real').map(([name]) => name);
  console.log(`
myEST8 demo running at ${baseUrl}
Sign in as:
${seed.logins.map((l) => `  ${l.name.padEnd(13)} ${l.email.padEnd(22)} password ${l.password}`).join('\n')}
The phone simulator is at ${baseUrl}/demo
External APIs: ${real.length ? `real ${real.join(', ')}; the rest mocked` : 'all mocked'}
${storiesLine}
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
