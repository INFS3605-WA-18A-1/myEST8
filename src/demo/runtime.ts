// The whole app wired for a demo: a database (a throwaway Postgres schema, or
// the schema named by DATABASE_SCHEMA so it survives restarts), the in-process mock APIs (or real
// ones, from env vars), a simulated messenger (that also sends for real through
// Twilio, textbee and SendGrid when their env vars are set), a movable clock, and the
// seeded Agency.

import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createClaudeClassifier } from '../adapters/claude-classifier.ts';
import { createFallbackClassifier } from '../fallback-classifier.ts';
import { createClaudeComposer } from '../adapters/claude-composer.ts';
import { createClaudeExtractor } from '../adapters/claude-extractor.ts';
import { createClaudeSummariser } from '../adapters/claude-summariser.ts';
import { createGooglePlaces } from '../adapters/google-places.ts';
import { createImageMatcher } from '../adapters/image-matcher.ts';
import { createJevClassifier } from '../adapters/jev.ts';
import { createJevJobFitJudge } from '../adapters/jev-job-fit.ts';
import { createJevTradeSuggester } from '../adapters/jev-trades.ts';
import { messengersFromEnv } from '../adapters/messenger.ts';
import { metaFetchMedia } from '../adapters/meta-whatsapp.ts';
import { createNominatimGeocoder, PUBLIC_NOMINATIM_URL } from '../adapters/nominatim.ts';
import { createPhotonAddressSuggester, PUBLIC_PHOTON_URL } from '../adapters/photon.ts';
import { createQuoteReader } from '../adapters/quote-reader.ts';
import { createSupabaseStorage } from '../adapters/supabase-storage.ts';
import { resendInboundConfig } from '../adapters/resend.ts';
import { twilioFetchMedia } from '../adapters/twilio.ts';
import { createApp } from '../app.ts';
import { all, ident, LOCAL_DATABASE_URL, one, openDb, requireDatabaseUrl, run, type Db } from '../db.ts';
import { createGmailMailboxes } from '../mailboxes.ts';
import type { FileLinks } from '../file-links.ts';
import { migrate } from '../migrate.ts';
import { UndeliverableError, type ChannelType, type Clock, type Messenger } from '../ports.ts';
import { ActionError, normalizeAddress } from '../shared.ts';
import { createSmsNumbers, type SmsNumbers } from '../sms-numbers.ts';
import { createSessions } from '../web/auth.ts';
import { createWebApp } from '../web/server.ts';
import { OffsetClock } from './clock.ts';
import type { DemoContact, DemoControls, DemoInboundMessage, DemoOutboundMessage } from './controls.ts';
import { mockApis, mockComposer, mockExtractor, mockSummariser } from './mock-apis.ts';
import { seedDemo, type DemoSeed } from './seed.ts';
import { SimulatedMessenger } from './simulated-messenger.ts';
import { seedStories, storiesStart } from './stories.ts';

const HOUR_MS = 3_600_000;
const MOCK = 'http://mock.local';

export type Env = Record<string, string | undefined>;

/** Which external APIs are real (set by env vars) and which are the in-process mocks. */
export type ApiChoice = Record<'classifier' | 'tradeSuggester' | 'jobFitJudge' | 'imageMatcher' | 'quoteReader' | 'places' | 'geocoder' | 'addressSuggester' | 'messenger', 'mock' | 'real'>;

/** The name a startup log uses. The classifier says which model answers when both are configured. */
export function providerLogName(name: string, env: Env): string {
  if (name === 'classifier') {
    const jev = !!env.JEV_API_URL?.trim();
    const claude = !!env.ANTHROPIC_API_KEY?.trim();
    if (jev && claude) return 'classifier (Jev, Claude fallback)';
    if (jev) return 'classifier (Jev)';
    return 'classifier';
  }
  if (name === 'tradeSuggester') return 'Trade suggester';
  if (name === 'jobFitJudge') return 'job-fit judge';
  return name;
}

/** One thing the hosted app needs: the settings it reads, and which are unset. `required` ones stop a hosted start. */
export type HostedProvider = { provider: string; required: boolean; missing: string[] };

/**
 * What the hosted app needs from its environment, by the fallback that fills the
 * gap when a setting is absent: a mock (classifier, Trade suggester, job-fit judge, Google Places, photo matcher,
 * quote reader), a made-up value (the `mail.example.test` inbound domain), or a
 * feature left off (file storage in the database, Resend inbound, signed file
 * links, the cron route). The photo matcher and quote reader are listed but not
 * required: they only have a mock until their services exist. The geocoder and address
 * suggestions are listed with nothing to miss: Nominatim and Photon need no key
 * and default to their public servers.
 */
function hostedProviders(env: Env): HostedProvider[] {
  const set = (name: string) => !!env[name]?.trim();
  const unset = (...names: string[]) => names.filter((name) => !set(name));
  return [
    // Jev classifies when JEV_API_URL is set, with Claude as the fallback when that key is set too.
    // With no Jev URL, Claude classifies, and with neither the mock does. Only a missing pair is a mock.
    { provider: providerLogName('classifier', env), required: true, missing: set('ANTHROPIC_API_KEY') || set('JEV_API_URL') ? [] : ['ANTHROPIC_API_KEY'] },
    // The Trade suggester asks Jev. Without JEV_API_URL it runs on the mock.
    { provider: providerLogName('tradeSuggester', env), required: false, missing: unset('JEV_API_URL') },
    // So does the job-fit judge that ranks recommended Tradies (ADR 0016).
    { provider: providerLogName('jobFitJudge', env), required: false, missing: unset('JEV_API_URL') },
    { provider: 'places', required: true, missing: unset('GOOGLE_MAPS_API_KEY') },
    { provider: 'geocoder', required: false, missing: [] },
    { provider: 'address suggestions', required: false, missing: [] },
    { provider: 'file storage', required: true, missing: unset('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY') },
    { provider: 'email', required: true, missing: unset('RESEND_API_KEY') },
    { provider: 'inbound email', required: true, missing: unset('RESEND_WEBHOOK_SECRET', 'RESEND_INBOUND_DOMAIN') },
    { provider: 'file links', required: true, missing: unset('FILE_LINK_SECRET') },
    { provider: 'worker cron', required: true, missing: unset('CRON_SECRET') },
    { provider: 'imageMatcher', required: false, missing: unset('VISION_API_URL') },
    { provider: 'quoteReader', required: false, missing: unset('QUOTES_API_URL') },
  ];
}

/**
 * Throws when hosted mode lacks a setting, naming every one that is missing. A real
 * service URL with no key would be called with the made-up key 'demo', so that is
 * always refused; ALLOW_MOCKS=1 only lets the missing providers run on mocks.
 */
function checkHosted(env: Env, log: (line: string) => void) {
  const providers = hostedProviders(env);
  const set = (name: string) => !!env[name]?.trim();
  const missing = providers.filter((p) => p.required).flatMap((p) => p.missing);
  const noKey = [
    ...(set('JEV_API_URL') && !set('JEV_API_KEY') ? ['JEV_API_KEY'] : []),
    ...(set('VISION_API_URL') && !set('VISION_API_KEY') ? ['VISION_API_KEY'] : []),
    ...(set('QUOTES_API_URL') && !set('QUOTES_API_KEY') ? ['QUOTES_API_KEY'] : []),
  ];
  const allowMocks = env.ALLOW_MOCKS === '1';
  const refused = [...(allowMocks ? [] : missing), ...noKey];
  if (refused.length) {
    throw new Error(
      `Hosted mode is missing required settings: ${refused.join(', ')}.` +
        (allowMocks ? '' : ' Set them, or set ALLOW_MOCKS=1 to run the providers they configure on mocks.'),
    );
  }
  const real = providers.filter((p) => p.missing.length === 0).map((p) => p.provider);
  const off = providers.filter((p) => p.missing.length > 0).map((p) => p.provider);
  log(`[hosted] Real: ${real.join(', ') || 'nothing'}. Mocked or off: ${off.join(', ') || 'nothing'}${allowMocks && off.length ? ' (ALLOW_MOCKS=1)' : ''}.`);
}

/**
 * Which Postgres schema the demo runs on, whether it's kept when the demo stops
 * (DATABASE_SCHEMA named it) or thrown away (a fresh one per start), and
 * whether it reopened one seeded by an earlier start.
 */
export type DemoDatabase =
  | { schema: string; kept: boolean; reused: false }
  | { schema: string; kept: true; reused: true; seededAt: string; storiesPlayed: boolean };

/** What the demo keeps about itself so a database can be reopened. */
type SavedDemo = { seed: DemoSeed | null; seededAt: string; storiesPlayed: boolean };

/**
 * The demo's own records, kept beside the app's tables: what the seed created,
 * how far the clock has been moved, and the phone simulator's history.
 */
function demoStore(db: Db) {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const row = await one<{ value: string }>(db, 'SELECT value FROM demo_state WHERE key = ?', key);
      return row ? (JSON.parse(row.value) as T) : undefined;
    },
    async set(key: string, value: unknown) {
      await run(db, 'INSERT INTO demo_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
    },
    async addMessage(direction: 'in' | 'out', message: DemoInboundMessage | DemoOutboundMessage) {
      await run(db, 'INSERT INTO demo_messages (direction, message) VALUES (?, ?)', direction, JSON.stringify(message));
    },
    async messages<T>(direction: 'in' | 'out'): Promise<T[]> {
      return (await all<{ message: string }>(db, 'SELECT message FROM demo_messages WHERE direction = ? ORDER BY id', direction)).map((r) => JSON.parse(r.message) as T);
    },
  };
}

/**
 * Opens the demo's database: the Postgres at SUPABASE_DB_URL (default: the local
 * one, LOCAL_DATABASE_URL), in the schema DATABASE_SCHEMA names (kept across
 * restarts) or in a fresh schema thrown away on close. Applies the migrations,
 * so it only works on a local Postgres (src/migrate.ts refuses any other).
 *
 * Hosted (Vercel + Supabase): SUPABASE_DB_URL is required, the schema defaults to
 * `public`, the pool is small (every function instance keeps its own), and the
 * migrations are not applied here: `supabase db push` owns them (docs/vercel.md).
 */
async function openDemoDb(env: Env, hosted: boolean) {
  if (hosted) {
    const schema = env.DATABASE_SCHEMA || 'public';
    const db = openDb(requireDatabaseUrl(env), { schema, max: Number(env.DB_POOL_MAX) || 2 });
    return { db, store: demoStore(db), saved: undefined, schema, kept: true };
  }
  const url = env.SUPABASE_DB_URL || LOCAL_DATABASE_URL;
  const kept = !!env.DATABASE_SCHEMA;
  const schema = env.DATABASE_SCHEMA || `demo_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const db = openDb(url, { schema });
  try {
    await migrate(db);
  } catch (error) {
    await db.close();
    const refused = (error as { code?: string }).code === 'ECONNREFUSED';
    throw refused ? new Error(`No Postgres answers at ${new URL(url).host}. Start the local one with \`npm run db:start\` (needs Docker), or set SUPABASE_DB_URL.`) : error;
  }
  const store = demoStore(db);
  const hasData = (await one(db, 'SELECT 1 AS found FROM agencies LIMIT 1')) !== undefined;
  const saved = await store.get<SavedDemo>('saved');
  if (hasData && !saved) {
    await db.close();
    throw new Error(
      `Schema ${schema} has data that wasn't seeded by the demo, or a start-up that stopped part-way. Run \`npm run db:reset\` to start afresh, or set DATABASE_SCHEMA to another schema.`,
    );
  }
  return { db, store, saved, schema, kept };
}

/**
 * Jev when `JEV_API_URL` is set, and Claude as well when that key is set: Claude
 * is asked only if Jev throws. With no Jev URL, Claude classifies as before, and
 * with neither the in-process mock does.
 */
function classifierFromEnv(env: Env, anthropicKey: string | undefined, mockJev: { baseUrl: string; fetch: typeof fetch }, fetchImpl: typeof fetch) {
  const claude = anthropicKey ? createClaudeClassifier({ apiKey: anthropicKey, fetch: fetchImpl }) : null;
  const jevUrl = env.JEV_API_URL?.trim();
  if (jevUrl) {
    const primary = createJevClassifier({ baseUrl: jevUrl, apiKey: env.JEV_API_KEY ?? 'demo', fetch: fetchImpl });
    const key = env.JEV_API_KEY?.trim();
    return claude ? createFallbackClassifier(primary, claude, key ? { redact: key } : {}) : primary;
  }
  return claude ?? createJevClassifier({ ...mockJev, apiKey: env.JEV_API_KEY ?? 'demo' });
}

/**
 * Builds the demo: app, web app, simulator controls and seeded data. Nothing
 * listens on a port; `main.ts` serves `web` and starts the worker loop.
 */
export async function createDemo<Seeded extends boolean = true>(
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
     * default; skipped when the classifier or quote reader is real, and when
     * DATABASE_SCHEMA reopens a schema seeded by an earlier start.
     */
    stories?: boolean;
    /**
     * Adds the demo Agency (Harbour Realty, with sign-ins whose passwords are
     * public). Defaults to true; `npm start` passes false, so an Agency signs up
     * instead and the landing page shows no demo sign-ins.
     */
    seedAgency?: Seeded;
    /**
     * Runs as the hosted app (src/hosted.ts): no migrations, no demo seed, simulator
     * or clock offset, no worker run at start-up, and a channel with no provider
     * is undeliverable instead of landing in the phone simulator.
     */
    hosted?: boolean;
    /**
     * Runs for real use: hosted, or `npm start` (src/main.ts). Geocoding goes to the
     * public Nominatim, and address suggestions to the public Photon, unless their
     * URLs say otherwise, never to the mock.
     */
    live?: boolean;
    /** Where the hosted start-up report (which providers are real, which mocked) goes. Defaults to console.log. */
    log?: (line: string) => void;
  } = {},
) {
  const env = options.env ?? process.env;
  const hosted = options.hosted === true;
  // Hosted never starts on a silent mock: it names every missing setting first.
  if (hosted) checkHosted(env, options.log ?? ((line) => console.log(line)));
  const resend = resendInboundConfig(env);
  const logError = options.logError ?? ((error: Error) => console.error('[worker]', error));
  // DATABASE_SCHEMA unset: a fresh schema, dropped on close. Set: a schema that is
  // seeded on the first start and reopened as it was on every start after.
  const { db, store, saved, schema, kept } = await openDemoDb(env, hosted);
  const seedAgency = !hosted && options.seedAgency !== false;
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  // Stories need the mock classifier. An Anthropic key or a Jev URL means the real one.
  const storiesEnd = !saved && seedAgency && options.stories && !anthropicKey && !env.JEV_API_URL && !env.QUOTES_API_URL ? (options.now ?? new Date()) : null;
  // A reopened database carries on from where its clock was moved to; the stories start ten days back.
  const savedOffsetMs = hosted ? 0 : ((await store.get<number>('clockOffsetMs')) ?? 0);
  const clock = new OffsetClock(saved ? new Date(Date.now() + savedOffsetMs) : storiesEnd ? storiesStart(storiesEnd) : options.now);
  const saveClock = () => store.set('clockOffsetMs', clock.now().getTime() - Date.now());
  const timeZone = 'Australia/Sydney';
  const port = Number(env.PORT ?? 3000);
  const baseUrl = (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, '');

  const mock = mockApis();
  const mockFetch: typeof fetch = async (input, init) => mock.request(input, init);
  const pick = (url: string | undefined, mockUrl: string) => (url ? { baseUrl: url, fetch } : { baseUrl: mockUrl, fetch: mockFetch });
  const jev = pick(env.JEV_API_URL, `${MOCK}/jev`);
  const vision = pick(env.VISION_API_URL, `${MOCK}/vision`);
  const quotes = pick(env.QUOTES_API_URL, `${MOCK}/quotes`);
  const nominatimUrl = env.NOMINATIM_URL?.trim() || (hosted || options.live ? PUBLIC_NOMINATIM_URL : undefined);
  const nominatim = pick(nominatimUrl, `${MOCK}/nominatim`);
  const photonUrl = env.PHOTON_URL?.trim() || (hosted || options.live ? PUBLIC_PHOTON_URL : undefined);
  const photon = pick(photonUrl, `${MOCK}/photon`);
  const google = env.GOOGLE_MAPS_API_KEY ? { apiKey: env.GOOGLE_MAPS_API_KEY, fetch } : { apiKey: 'demo', fetch: mockFetch, placesBaseUrl: `${MOCK}/google/places` };
  const apis: ApiChoice = {
    classifier: anthropicKey || env.JEV_API_URL ? 'real' : 'mock',
    tradeSuggester: env.JEV_API_URL?.trim() ? 'real' : 'mock',
    jobFitJudge: env.JEV_API_URL?.trim() ? 'real' : 'mock',
    imageMatcher: env.VISION_API_URL ? 'real' : 'mock',
    quoteReader: env.QUOTES_API_URL ? 'real' : 'mock',
    places: env.GOOGLE_MAPS_API_KEY ? 'real' : 'mock',
    geocoder: nominatimUrl ? 'real' : 'mock',
    addressSuggester: photonUrl ? 'real' : 'mock',
    messenger: env.TWILIO_ACCOUNT_SID || env.SENDGRID_API_KEY || env.RESEND_API_KEY || env.GOOGLE_CLIENT_ID || env.META_WHATSAPP_PHONE_NUMBER_ID || env.TEXTBEE_API_KEY ? 'real' : 'mock',
  };

  const messenger = new SimulatedMessenger(clock, async (message) => {
    await store.addMessage('out', message);
    options.onOutbound?.(message);
  });
  // Channels whose provider is configured (TWILIO_*, TEXTBEE_*, SENDGRID_*) really send, but
  // only to the addresses in DEMO_SEND_TO ("*" for anyone): the seeded people's
  // numbers are made up and could belong to someone. The simulator records every
  // message once it's sent. File links run on real time, as Twilio fetches them in
  // real time however far the demo clock has moved.
  const encryptionKey = tokenEncryptionKey(env);
  const providers = messengersFromEnv(env, {
    clock: { now: () => new Date() },
    strict: hosted,
    // With TOKEN_ENCRYPTION_KEY, Agencies set up their own SMS numbers (ADR 0005): the shared number becomes optional.
    agencyNumbers: encryptionKey !== null,
    ...(options.log ? { log: options.log } : {}),
  });
  // textbee is the one SMS phone for the server (ADR 0013), so the Twilio number-per-Agency panel is not built.
  const smsNumbers = encryptionKey && !providers.textbee ? smsNumbersFromEnv(env, { db, baseUrl, fileLinks: providers.fileLinks, encryptionKey }) : null;
  // Gmail (ADR 0004): each Agency connects its own mailbox by OAuth, so its
  // Messenger and reader need the database, not just env vars.
  const mailboxes = gmailFromEnv(env, db, baseUrl);
  if (mailboxes) providers.channels.email = mailboxes.messenger;
  const sendTo = new Set((env.DEMO_SEND_TO ?? '').split(',').map((a) => a.trim()).filter(Boolean).map((a) => (a === '*' ? a : normalizeAddress(a))));
  const reallySends = (to: string) => hosted || sendTo.has('*') || sendTo.has(normalizeAddress(to));
  const outbound: Messenger = {
    async send(message) {
      // An Agency's own number sends through the Twilio account that owns it; any other SMS through the shared number.
      const own = message.channelType === 'sms' && smsNumbers && (await smsNumbers.owns(message.from));
      const provider = own ? smsNumbers.messenger : providers.channels[message.channelType];
      if (provider && reallySends(message.to)) await provider.send({ ...message, cc: message.cc.filter(reallySends) });
      // Hosted, nothing records into the phone simulator: no provider means it can't be sent.
      else if (hosted) throw new UndeliverableError(message.channelType, message.to, `no ${message.channelType} provider is configured`, `${message.channelType === 'sms' ? 'SMS' : message.channelType === 'whatsapp' ? 'WhatsApp' : 'email'} isn't set up on this server yet`);
      if (!hosted) await messenger.send(message);
    },
  };
  const twilioAuthToken = env.TWILIO_AUTH_TOKEN?.trim();
  const haiku = anthropicKey ? createClaudeComposer({ apiKey: anthropicKey, fetch }) : null;
  const app = createApp({
    db,
    clock,
    messenger: outbound,
    classifier: classifierFromEnv(env, anthropicKey, jev, fetch),
    summariser: anthropicKey ? createClaudeSummariser({ apiKey: anthropicKey, fetch }) : mockSummariser,
    // Hosted with no key has no model at all, so a follow-up keeps the notes as written; the demo's mock shows the draft flow.
    composer: haiku ?? (hosted ? null : mockComposer),
    // Only Haiku writes outbound emails: with no key every email is its template's text (ADR 0011).
    emailComposer: haiku,
    // Hosted with no key reads nothing from a first message, so intake asks all four questions in one message.
    detailExtractor: anthropicKey ? createClaudeExtractor({ apiKey: anthropicKey, fetch }) : hosted ? null : mockExtractor,
    imageMatcher: createImageMatcher({ ...vision, apiKey: env.VISION_API_KEY ?? 'demo' }),
    quoteReader: createQuoteReader({ ...quotes, apiKey: env.QUOTES_API_KEY ?? 'demo', clock, timeZone }),
    places: createGooglePlaces(google),
    // The mock needs no pacing, but a real Nominatim gets at most a request a second.
    geocoder: createNominatimGeocoder({ ...nominatim, userAgent: `myEST8 (${baseUrl})`, ...(nominatimUrl ? {} : { wait: async () => {} }) }),
    addressSuggester: createPhotonAddressSuggester({ ...photon, userAgent: `myEST8 (${baseUrl})` }),
    tradeSuggester: createJevTradeSuggester({ ...jev, apiKey: env.JEV_API_KEY ?? 'demo' }),
    jobFitJudge: createJevJobFitJudge({ ...jev, apiKey: env.JEV_API_KEY ?? 'demo' }),
    fetchMedia: mediaFetcher(env, smsNumbers),
    settings: { baseUrl },
    blobs: storageFromEnv(env),
    smsNumbers,
  });

  // Worker runs never overlap: each call waits for the one before.
  let tail: Promise<void> = Promise.resolve();
  let lastMailPoll = 0;
  let queued = 0;
  /** Runs every task that is due, after any run already in progress. Errors are logged, never thrown. */
  function runWorker(options?: { budgetMs?: number }): Promise<void> {
    queued++;
    const next = tail.then(async () => {
      try {
        // New Gmail mail is read at most every 30 seconds, on real time.
        if (mailboxes && Date.now() - lastMailPoll >= MAIL_POLL_MS) {
          lastMailPoll = Date.now();
          for (const error of await mailboxes.poll(async (message) => void (await app.receiveInbound(message)))) logError(error);
        }
        for (const error of await app.runWorker(options)) logError(error);
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

  const seed = (saved ? saved.seed : seedAgency ? await seedDemo(app, { googleListings: apis.places === 'mock' }) : null) as Seeded extends false ? null : DemoSeed;
  if (!hosted) await runWorker();

  // The simulator is limited to the Agency of the Property Manager using it, so
  // each Agency that signs up to the demo sees only its own people and messages.
  const channelsOf = async (propertyManagerId: number) => (await app.asPropertyManager(propertyManagerId)).channels();
  /** Whether a message on `channel` from or to `address` went through one of the Agency's channels. */
  const throughAgency = async (propertyManagerId: number) => {
    const channels = await channelsOf(propertyManagerId);
    return (channel: ChannelType, address: string) => channels.some((c) => c.type === channel && c.address === normalizeAddress(address));
  };
  const demo: DemoControls = {
    async contacts(propertyManagerId): Promise<DemoContact[]> {
      const people = await (await app.asPropertyManager(propertyManagerId)).people();
      return people.map((p) => ({ personId: p.id, name: p.name, role: p.role, mobile: p.mobile, email: p.email }));
    },
    async outbox(propertyManagerId) {
      const ours = await throughAgency(propertyManagerId);
      return (await store.messages<DemoOutboundMessage>('out')).filter((m) => ours(m.channel, m.from));
    },
    async inbound(propertyManagerId) {
      const ours = await throughAgency(propertyManagerId);
      return (await store.messages<DemoInboundMessage>('in')).filter((m) => ours(m.channel, m.to));
    },
    async sendAs(propertyManagerId, from, channel, text, attachments = []) {
      const to = (await channelsOf(propertyManagerId)).find((c) => c.type === channel)?.address;
      if (!to) {
        const [name, what] = channel === 'email' ? ['email', 'inbox address'] : [channel === 'sms' ? 'SMS' : 'WhatsApp', 'number'];
        throw new ActionError('invalid', `Connect ${name} in Setup first: the Agency has no ${name} ${what} for this message to go to.`);
      }
      const receivedAt = clock.now();
      await store.addMessage('in', { at: receivedAt.toISOString(), from, to, channel, text, attachments: attachments.map((a) => a.filename) });
      await app.receiveInbound({
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
      await saveClock();
      await runWorker();
    },
    now: () => clock.now(),
  };

  // The stories play the clock forward to `options.now`, or to the real time.
  const stories = storiesEnd && seed ? await seedStories({ app, simulator: demo, seed, clock, ...(options.now ? { end: options.now } : {}) }) : null;
  if (!hosted) await saveClock();
  // Saved last, so a start-up stopped part-way is caught on the next start rather than half-reused.
  if (!saved && !hosted) await store.set('saved', { seed, seededAt: clock.now().toISOString(), storiesPlayed: stories !== null } satisfies SavedDemo);
  const database: DemoDatabase = saved
    ? { schema, kept: true, reused: true, seededAt: saved.seededAt, storiesPlayed: saved.storiesPlayed }
    : { schema, kept, reused: false };

  /** Waits for any worker run in progress, then closes the database, dropping a throwaway schema. Stop the worker loop first. */
  async function close() {
    await tail;
    try {
      if (!kept) await db.sql.unsafe(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`);
    } finally {
      await db.close();
    }
  }

  // Sessions run on real time, so moving the demo clock forward never signs anyone out.
  const sessions = createSessions(db, { now: () => new Date() } satisfies Clock);
  const web = createWebApp({
    app,
    sessions,
    clock,
    publicUrl: baseUrl,
    // Hosted with no Twilio token: /webhooks/twilio is off (404), never checked against 'demo'.
    twilioAuthToken: twilioAuthToken || (hosted ? null : 'demo'),
    smsNumbers,
    sendgridPublicKey:
      env.SENDGRID_INBOUND_PUBLIC_KEY?.trim() ||
      generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    fileLinks: providers.fileLinks,
    ...(hosted ? {} : { demo }),
    demoSignIns: seed !== null,
    whatsapp: env.META_APP_SECRET?.trim() && env.META_WEBHOOK_VERIFY_TOKEN?.trim() ? { appSecret: env.META_APP_SECRET.trim(), verifyToken: env.META_WEBHOOK_VERIFY_TOKEN.trim() } : null,
    resend,
    textbee: providers.textbee,
    connectors: {
      gmail: mailboxes?.connector ?? null,
      smsInbound: hosted ? 'none' : 'simulator',
      // The phone's number is read in textbeeFromEnv. The pages only see it here.
      smsPhone: providers.textbee?.number ?? null,
      unavailable: [
        // The demo simulates SMS; a hosted server needs a real provider, or a code can only fail.
        ...(hosted && !providers.channels.sms && !smsNumbers ? (['sms'] as const) : []),
        // Hosted email arrives through Resend inbound (or an Agency's own Gmail).
        ...(hosted && (!resend || !env.RESEND_INBOUND_DOMAIN?.trim()) && !mailboxes ? (['email'] as const) : []),
      ],
    },
  });

  return { app, web, demo, sessions, clock, messenger, seed, stories, database, baseUrl, apis, textbee: providers.textbee, runWorker, startWorkerLoop, close };
}

const MAIL_POLL_MS = 30_000;

/**
 * Files in Supabase Storage (private bucket `files`) when SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are set; otherwise they stay in the database.
 */
function storageFromEnv(env: Env) {
  const url = env.SUPABASE_URL?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url && !serviceKey) return null;
  if (!url || !serviceKey) throw new Error('Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or neither');
  return createSupabaseStorage({ url, serviceKey });
}

/**
 * Gmail as the email channel, when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are
 * set: also needs TOKEN_ENCRYPTION_KEY (base64 of 32 bytes) for the stored
 * refresh tokens. Google redirects back to PUBLIC_URL/oauth/google/callback.
 */
function gmailFromEnv(env: Env, db: Db, baseUrl: string) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) throw new Error('Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither');
  const encryptionKey = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!encryptionKey || Buffer.from(encryptionKey, 'base64').length !== 32) {
    throw new Error('Gmail stores refresh tokens encrypted: set TOKEN_ENCRYPTION_KEY to 32 random bytes in base64 (`openssl rand -base64 32`)');
  }
  return createGmailMailboxes({ db, clock: { now: () => new Date() }, clientId, clientSecret, redirectUri: `${baseUrl}/oauth/google/callback`, encryptionKey });
}

/** TOKEN_ENCRYPTION_KEY when it is set (base64 of 32 bytes), null when it isn't. A key of the wrong size is refused. */
function tokenEncryptionKey(env: Env): string | null {
  const key = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!key) return null;
  if (Buffer.from(key, 'base64').length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 random bytes in base64 (`openssl rand -base64 32`)');
  return key;
}

/**
 * Agencies' own Twilio SMS numbers (ADR 0005), when TOKEN_ENCRYPTION_KEY is set, because a registered
 * Agency's auth token is stored encrypted. Creating a number also needs the server's Twilio account
 * (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) and TWILIO_BUNDLE_SID and TWILIO_ADDRESS_SID; without them
 * "Create a new number" is shown disabled, and registering a number the Agency already has still works.
 * TWILIO_API_BASE_URL points Twilio's REST API at a local fake.
 */
function smsNumbersFromEnv(env: Env, o: { db: Db; baseUrl: string; fileLinks: FileLinks | null; encryptionKey: string }): SmsNumbers {
  const set = (name: string) => env[name]?.trim() || undefined;
  const accountSid = set('TWILIO_ACCOUNT_SID');
  const authToken = set('TWILIO_AUTH_TOKEN');
  return createSmsNumbers({
    db: o.db,
    clock: { now: () => new Date() },
    encryptionKey: o.encryptionKey,
    server: accountSid && authToken ? { accountSid, authToken } : null,
    bundleSid: set('TWILIO_BUNDLE_SID'),
    addressSid: set('TWILIO_ADDRESS_SID'),
    publicUrl: o.baseUrl,
    ...(set('TWILIO_API_BASE_URL') ? { apiBaseUrl: set('TWILIO_API_BASE_URL')! } : {}),
    fileLinks: o.fileLinks,
  });
}

/**
 * Fetches an inbound attachment by its URL: Meta media ids (`meta-media:<id>`)
 * through the WhatsApp Cloud API, Twilio's own media URLs with the credentials of
 * the account they belong to (the server's, or an Agency's own). Twilio's credentials
 * go nowhere else: an Agency can sign a webhook with its own token, so the address in
 * one is not trusted. The simulator sends attachments directly, so it never needs this.
 */
function mediaFetcher(env: Env, smsNumbers: SmsNumbers | null): (url: string) => Promise<Uint8Array> {
  const metaToken = env.META_WHATSAPP_ACCESS_TOKEN?.trim();
  const twilioSid = env.TWILIO_ACCOUNT_SID?.trim();
  const twilioToken = env.TWILIO_AUTH_TOKEN?.trim();
  const twilioApi = (env.TWILIO_API_BASE_URL?.trim() || 'https://api.twilio.com').replace(/\/$/, '');
  const meta = metaToken ? metaFetchMedia({ accessToken: metaToken }) : null;
  return async (url) => {
    if (url.startsWith('meta-media:') && meta) return meta(url);
    if (url.startsWith(`${twilioApi}/`)) {
      const accountSid = /\/Accounts\/(AC[0-9a-f]{32})\//i.exec(url)?.[1];
      const token = !accountSid ? null : accountSid === twilioSid ? (twilioToken ?? null) : ((await smsNumbers?.authTokenForAccount(accountSid)) ?? null);
      if (accountSid && token) return twilioFetchMedia(accountSid, token)(url);
    }
    throw new Error(`No provider is configured to fetch the attachment at ${url}`);
  };
}

export type Demo = Awaited<ReturnType<typeof createDemo<true>>>;
