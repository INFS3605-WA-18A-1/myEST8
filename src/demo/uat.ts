// UAT only, to be reverted once acceptance testing ends. Each tester signs up
// with one email of their own, so their Agency starts with the demo's people,
// Properties and ten days of maintenance work already in it (src/demo/stories.ts),
// instead of waiting days for Tradies and Owners who aren't there.
//
// The stories play on a second app built on the same database, with the demo's
// mock APIs, a messenger that sends nothing and a clock wound back ten days. Its
// background tasks wait under a status of their own, so the live worker can't
// run one early on the real clock; reminders still to come are handed over at
// the end. The seeded people's addresses are made up, so the live messenger
// never sends to them (`isMadeUpAddress`).

import { randomUUID } from 'node:crypto';
import { createGooglePlaces } from '../adapters/google-places.ts';
import { createImageMatcher } from '../adapters/image-matcher.ts';
import { createJevClassifier } from '../adapters/jev.ts';
import { createJevJobFitJudge } from '../adapters/jev-job-fit.ts';
import { createJevRequestJudge } from '../adapters/jev-request-judge.ts';
import { createJevTradeSuggester } from '../adapters/jev-trades.ts';
import { createNominatimGeocoder } from '../adapters/nominatim.ts';
import { createPhotonAddressSuggester } from '../adapters/photon.ts';
import { createQuoteReader } from '../adapters/quote-reader.ts';
import { createStreetView } from '../adapters/street-view.ts';
import { createApp } from '../app.ts';
import type { Db } from '../db.ts';
import type { BlobStore, ChannelType } from '../ports.ts';
import { normalizeAddress } from '../shared.ts';
import { OffsetClock } from './clock.ts';
import { mockApis, mockComposer, mockExtractor, mockSummariser } from './mock-apis.ts';
import { DEMO_TIME_ZONE, seedDemo } from './seed.ts';
import { SimulatedMessenger } from './simulated-messenger.ts';
import { describeStories, seedStories, storiesStart } from './stories.ts';

const MOCK = 'http://mock.local';

/**
 * The Agency's SMS number while seeded: 02 5550 xxxx, a range ACMA keeps for
 * fiction, so it is no one's. It stays connected afterwards, so the seeded
 * people with only a mobile can still be messaged (and the message dropped).
 * The tester isn't asked to connect SMS.
 */
const smsNumberFor = (agencyId: number) => `+6125550${String(agencyId % 10_000).padStart(4, '0')}`;

/**
 * Whether no message should ever go to (or from) this address: an email on a
 * reserved example domain (RFC 2606), the seeded people's mobiles
 * (+61 400 000 0xx to 2xx), or a seeded Agency's 02 5550 number.
 */
export function isMadeUpAddress(address: string): boolean {
  const a = normalizeAddress(address);
  if (a.includes('@')) return /@(.+\.)?(example(\.(com|net|org))?|invalid|test)$/.test(a);
  return /^\+61400000[0-2]\d\d$/.test(a) || /^\+6125550\d{4}$/.test(a);
}

/**
 * Seeds an Agency that just signed up with the demo's people, Properties and
 * stories, its first Property Manager taking Alice's place. Takes about as long
 * as `npm run demo` takes to start (some 35,000 queries). Throws if a story fails; what was seeded by
 * then stays.
 */
export async function seedSignedUpAgency(input: { db: Db; blobs: BlobStore | null; baseUrl: string; agencyId: number; propertyManagerId: number }) {
  const { db, agencyId } = input;
  const end = new Date();
  const clock = new OffsetClock(storiesStart(end));
  const mock = mockApis();
  const mockFetch: typeof fetch = async (url, init) => mock.request(url, init);
  const at = (path: string) => ({ baseUrl: `${MOCK}/${path}`, fetch: mockFetch });
  const messenger = new SimulatedMessenger(clock);
  const held = `uat-seed-${randomUUID()}`;
  const app = createApp({
    db,
    clock,
    messenger,
    classifier: createJevClassifier({ ...at('jev'), apiKey: 'demo' }),
    summariser: mockSummariser,
    composer: mockComposer,
    emailComposer: null,
    detailExtractor: mockExtractor,
    imageMatcher: createImageMatcher({ ...at('vision'), apiKey: 'demo' }),
    quoteReader: createQuoteReader({ ...at('quotes'), apiKey: 'demo', clock, timeZone: DEMO_TIME_ZONE }),
    places: createGooglePlaces({ apiKey: 'demo', fetch: mockFetch, placesBaseUrl: `${MOCK}/google/places` }),
    // The demo's mock Street View, as the runtime uses with no GOOGLE_MAPS_API_KEY.
    propertyPhotos: createStreetView({ ...at('google/streetview'), apiKey: 'demo' }),
    geocoder: createNominatimGeocoder({ ...at('nominatim'), userAgent: 'myEST8 UAT seed', wait: async () => {} }),
    addressSuggester: createPhotonAddressSuggester({ ...at('photon'), userAgent: 'myEST8 UAT seed' }),
    tradeSuggester: createJevTradeSuggester({ ...at('jev'), apiKey: 'demo' }),
    jobFitJudge: createJevJobFitJudge({ ...at('jev'), apiKey: 'demo' }),
    requestJudge: createJevRequestJudge({ ...at('jev'), apiKey: 'demo' }),
    fetchMedia: async () => {
      throw new Error('The UAT seed sends attachments directly');
    },
    settings: { baseUrl: input.baseUrl },
    blobs: input.blobs,
    heldTasks: held,
  });

  // The Agency's own inbound email address, the one Setup shows, so the tester sees the same one during and after
  // the seed, and the made-up SMS number (see smsNumberFor). Both stay connected.
  const { address: email } = await (await app.asPropertyManager(input.propertyManagerId)).ensureInboundEmail();
  const channels: Partial<Record<ChannelType, string>> = { sms: smsNumberFor(agencyId), email };
  try {
    // Real Google doesn't know the demo's listings, so the Tradies are added as not on Google.
    const seed = await seedDemo(app, {
      googleListings: false,
      into: { agencyId, propertyManagerId: input.propertyManagerId, colleagueEmail: `bob.baker+${agencyId}@harbour.example`, channels },
    });
    const outbox = async () => messenger.messages();
    const summary = await seedStories({
      app,
      seed,
      clock,
      end,
      simulator: {
        outbox,
        async sendAs(_propertyManagerId, from, channel, text, attachments = []) {
          await app.receiveInbound({
            providerMessageId: `uat-seed-${randomUUID()}`,
            agencyChannel: channels[channel]!,
            channelType: channel,
            from,
            text,
            attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content })),
            receivedAt: clock.now(),
          });
          await app.runWorker();
        },
      },
    });
    return describeStories(summary);
  } finally {
    await app.releaseHeldTasks();
  }
}
