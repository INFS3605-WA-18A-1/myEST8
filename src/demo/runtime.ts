// The whole app wired for a demo: an in-memory database, the in-process mock
// APIs (or real ones, from env vars), a simulated messenger, a movable clock,
// and the seeded Agency.

import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createGooglePlaces } from '../adapters/google-places.ts';
import { createImageMatcher } from '../adapters/image-matcher.ts';
import { createJevClassifier } from '../adapters/jev.ts';
import { createQuoteReader } from '../adapters/quote-reader.ts';
import { createApp } from '../app.ts';
import { openDb } from '../db.ts';
import type { ChannelType, Clock } from '../ports.ts';
import { ActionError, normalizeAddress } from '../shared.ts';
import { createSessions } from '../web/auth.ts';
import { createWebApp } from '../web/server.ts';
import { OffsetClock } from './clock.ts';
import type { DemoContact, DemoControls, DemoInboundMessage, DemoOutboundMessage } from './controls.ts';
import { mockApis } from './mock-apis.ts';
import { seedDemo } from './seed.ts';
import { SimulatedMessenger } from './simulated-messenger.ts';
import { seedStories, storiesStart } from './stories.ts';

const HOUR_MS = 3_600_000;
const MOCK = 'http://mock.local';

export type Env = Record<string, string | undefined>;

/** Which external APIs are real (set by env vars) and which are the in-process mocks. */
export type ApiChoice = Record<'classifier' | 'imageMatcher' | 'quoteReader' | 'places', 'mock' | 'real'>;

/**
 * Builds the demo: app, web app, simulator controls and seeded data. Nothing
 * listens on a port; `main.ts` serves `web` and starts the worker loop.
 */
export async function createDemo(
  options: {
    /** Where the demo clock starts. Defaults to the real time. */
    now?: Date;
    /** Defaults to process.env. Tests pass {} so they never call a real API. */
    env?: Env;
    /** Called for every message myEST8 sends. */
    onOutbound?: (message: DemoOutboundMessage) => void;
    /** Where task errors go. Defaults to console.error. */
    logError?: (error: Error) => void;
    /**
     * Plays the demo stories (src/demo/stories.ts) so the Agency starts with
     * work in flight: the clock starts ten days back and ends at `now`. Off by
     * default; skipped when the classifier or quote reader is real.
     */
    stories?: boolean;
  } = {},
) {
  const env = options.env ?? process.env;
  const logError = options.logError ?? ((error: Error) => console.error('[worker]', error));
  const storiesEnd = options.stories && !env.JEV_API_URL && !env.QUOTES_API_URL ? (options.now ?? new Date()) : null;
  const clock = new OffsetClock(storiesEnd ? storiesStart(storiesEnd) : options.now);
  const timeZone = 'Australia/Sydney';
  const port = Number(env.PORT ?? 3000);
  const baseUrl = (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, '');

  const mock = mockApis();
  const mockFetch: typeof fetch = async (input, init) => mock.request(input, init);
  const pick = (url: string | undefined, mockUrl: string) => (url ? { baseUrl: url, fetch } : { baseUrl: mockUrl, fetch: mockFetch });
  const jev = pick(env.JEV_API_URL, `${MOCK}/jev`);
  const vision = pick(env.VISION_API_URL, `${MOCK}/vision`);
  const quotes = pick(env.QUOTES_API_URL, `${MOCK}/quotes`);
  const google = env.GOOGLE_MAPS_API_KEY
    ? { apiKey: env.GOOGLE_MAPS_API_KEY, fetch }
    : { apiKey: 'demo', fetch: mockFetch, placesBaseUrl: `${MOCK}/google/places`, geocodeBaseUrl: `${MOCK}/google` }; // the adapter adds /maps/api/geocode/json
  const apis: ApiChoice = {
    classifier: env.JEV_API_URL ? 'real' : 'mock',
    imageMatcher: env.VISION_API_URL ? 'real' : 'mock',
    quoteReader: env.QUOTES_API_URL ? 'real' : 'mock',
    places: env.GOOGLE_MAPS_API_KEY ? 'real' : 'mock',
  };

  const messenger = new SimulatedMessenger(clock, options.onOutbound);
  const db = openDb(':memory:');
  const app = createApp({
    db,
    clock,
    messenger,
    classifier: createJevClassifier({ ...jev, apiKey: env.JEV_API_KEY ?? 'demo' }),
    imageMatcher: createImageMatcher({ ...vision, apiKey: env.VISION_API_KEY ?? 'demo' }),
    quoteReader: createQuoteReader({ ...quotes, apiKey: env.QUOTES_API_KEY ?? 'demo', clock, timeZone }),
    places: createGooglePlaces(google),
    fetchMedia: async (url) => {
      throw new Error(`The demo has no media to fetch at ${url}: the simulator sends attachments directly`);
    },
    settings: { baseUrl },
  });

  // Worker runs never overlap: each call waits for the one before.
  let tail: Promise<void> = Promise.resolve();
  let queued = 0;
  /** Runs every task that is due, after any run already in progress. Errors are logged, never thrown. */
  function runWorker(): Promise<void> {
    queued++;
    const next = tail.then(async () => {
      try {
        for (const error of await app.runWorker()) logError(error);
      } catch (e) {
        logError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        queued--;
      }
    });
    tail = next;
    return next;
  }

  /** Runs the worker every `intervalMs`, skipping a tick while a run is still going. Returns a function that stops it. */
  function startWorkerLoop(intervalMs = 2_000): () => void {
    const timer = setInterval(() => {
      if (queued === 0) void runWorker();
    }, intervalMs);
    return () => clearInterval(timer);
  }

  const seed = await seedDemo(app, { googleListings: apis.places === 'mock' });
  await runWorker();

  // The simulator is limited to the Agency of the Property Manager using it, so
  // each Agency that signs up to the demo sees only its own people and messages.
  const inbound: DemoInboundMessage[] = [];
  const channelsOf = (propertyManagerId: number) => app.asPropertyManager(propertyManagerId).channels();
  /** Whether a message on `channel` from or to `address` went through one of the Agency's channels. */
  const throughAgency = (propertyManagerId: number) => {
    const channels = channelsOf(propertyManagerId);
    return (channel: ChannelType, address: string) => channels.some((c) => c.type === channel && c.address === normalizeAddress(address));
  };
  const demo: DemoControls = {
    contacts(propertyManagerId): DemoContact[] {
      return app
        .asPropertyManager(propertyManagerId)
        .people()
        .map((p) => ({ personId: p.id, name: p.name, role: p.role, mobile: p.mobile, email: p.email }));
    },
    outbox(propertyManagerId) {
      const ours = throughAgency(propertyManagerId);
      return messenger.messages().filter((m) => ours(m.channel, m.from));
    },
    inbound(propertyManagerId) {
      const ours = throughAgency(propertyManagerId);
      return inbound.filter((m) => ours(m.channel, m.to));
    },
    async sendAs(propertyManagerId, from, channel, text, attachments = []) {
      const to = channelsOf(propertyManagerId).find((c) => c.type === channel)?.address;
      if (!to) {
        const [name, what] = channel === 'email' ? ['email', 'inbox address'] : [channel === 'sms' ? 'SMS' : 'WhatsApp', 'number'];
        throw new ActionError('invalid', `Connect ${name} in Setup first: the Agency has no ${name} ${what} for this message to go to.`);
      }
      const receivedAt = clock.now();
      inbound.push({ at: receivedAt.toISOString(), from, to, channel, text, attachments: attachments.map((a) => a.filename) });
      app.receiveInbound({
        providerMessageId: `demo-${randomUUID()}`,
        agencyChannel: to,
        channelType: channel,
        from,
        text,
        attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content })),
        receivedAt,
      });
      await runWorker();
    },
    async advance(hours) {
      clock.advance(hours * HOUR_MS);
      await runWorker();
    },
    now: () => clock.now(),
  };

  // The stories play the clock forward to `options.now`, or to the real time.
  const stories = storiesEnd ? await seedStories({ app, simulator: demo, seed, clock, ...(options.now ? { end: options.now } : {}) }) : null;

  // Sessions run on real time, so moving the demo clock forward never signs anyone out.
  const sessions = createSessions(db, { now: () => new Date() } satisfies Clock);
  const web = createWebApp({
    app,
    sessions,
    clock,
    publicUrl: baseUrl,
    twilioAuthToken: 'demo',
    sendgridPublicKey: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    demo,
  });

  return { app, web, demo, sessions, clock, messenger, seed, stories, baseUrl, apis, runWorker, startWorkerLoop };
}

export type Demo = Awaited<ReturnType<typeof createDemo>>;
