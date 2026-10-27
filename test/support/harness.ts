import { createApp, type PropertyManagerActions } from '../../src/app.ts';
import type { Db } from '../../src/db.ts';
import type { BlobStore, ChannelType, Clock, ExtractedDetails, InboundAttachment, Messenger } from '../../src/ports.ts';
import type { Availability } from '../../src/shared.ts';
import type { SmsNumbers } from '../../src/sms-numbers.ts';
import { AVAILABILITY_LABELS } from '../../src/templates.ts';
import { testDb } from './db.ts';
import { FakeClassifier, FakeClock, FakeComposer, FakeDetailExtractor, FakeAddressSuggester, FakeGeocoder, FakeImageMatcher, FakeJobFitJudge, FakeMessenger, FakePlaces, FakeQuoteReader, FakeSummariser, FakeTradeSuggester } from './fakes.ts';

/** Thursday 8 October 2026, 9:00 am in Sydney. */
export const START = new Date('2026-10-08T09:00:00+11:00');
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const AGENCY_NUMBER = '+61290000000';
export const AGENCY_INBOX = 'inbox@harbour.example';

export type Harness = Awaited<ReturnType<typeof createHarness>>;

/** Drives the app through its boundary: inbound messages, uploads, Property Manager actions and the clock. */
export async function createHarness(
  options: { blobs?: BlobStore; smsNumbers?: (db: Db, clock: Clock) => SmsNumbers; composer?: null; detailExtractor?: null; messenger?: Messenger } = {},
) {
  const clock = new FakeClock(START);
  const recorded = new FakeMessenger();
  const provider = options.messenger;
  // A test can send through a real provider (textbee) and still read what went out.
  const messenger: Messenger = provider
    ? {
        async send(message) {
          await provider.send(message);
          await recorded.send(message);
        },
      }
    : recorded;
  const classifier = new FakeClassifier();
  const imageMatcher = new FakeImageMatcher();
  const quoteReader = new FakeQuoteReader();
  const summariser = new FakeSummariser();
  const composer = new FakeComposer();
  const detailExtractor = new FakeDetailExtractor();
  const places = new FakePlaces();
  const geocoder = new FakeGeocoder();
  const addressSuggester = new FakeAddressSuggester();
  const tradeSuggester = new FakeTradeSuggester();
  const jobFitJudge = new FakeJobFitJudge();
  const db = await testDb();
  const smsNumbers = options.smsNumbers?.(db, clock) ?? null;
  const app = createApp({
    db,
    clock,
    messenger,
    classifier,
    imageMatcher,
    quoteReader,
    summariser,
    composer: options.composer === null ? null : composer,
    detailExtractor: options.detailExtractor === null ? null : detailExtractor,
    places,
    geocoder,
    addressSuggester,
    tradeSuggester,
    jobFitJudge,
    fetchMedia: async (url) => {
      throw new Error(`no media at ${url}`);
    },
    settings: { baseUrl: 'https://myest8.test' },
    blobs: options.blobs ?? null,
    smsNumbers,
  });

  async function drain() {
    const failures = await app.runWorker();
    if (failures.length) throw failures[0];
  }

  let messageCount = 0;

  async function receive(
    from: string,
    text: string,
    options: { channel?: ChannelType; attachments?: InboundAttachment[] } = {},
  ) {
    const channelType = options.channel ?? (from.includes('@') ? 'email' : 'sms');
    await app.receiveInbound({
      providerMessageId: `msg-${++messageCount}`,
      agencyChannel: channelType === 'email' ? AGENCY_INBOX : AGENCY_NUMBER,
      channelType,
      from,
      text,
      attachments: options.attachments ?? [],
      receivedAt: clock.now(),
    });
    await drain();
  }

  /** Replies to a question the agent asked, scripting the classifier to read it as `answer` to that question. */
  async function answer(from: string, text: string, answer = 'answer', options: { channel?: ChannelType } = {}) {
    const kind = /^[1-5]$/.test(answer) ? 'fix_rating' : answer === 'confirm' || answer === 'reschedule' ? 'visit' : 'guided';
    classifier.when(text, {
      messageClass: 'update',
      updateType: 'general',
      'answer:guided': 'not_an_answer',
      'answer:visit': 'not_an_answer',
      'answer:fix_rating': 'not_an_answer',
      [`answer:${kind}`]: answer,
    });
    await receive(from, text, options);
  }

  return {
    app,
    db,
    smsNumbers,
    clock,
    messenger: recorded,
    classifier,
    imageMatcher,
    quoteReader,
    summariser,
    composer,
    detailExtractor,
    places,
    geocoder,
    addressSuggester,
    tradeSuggester,
    jobFitJudge,
    drain,
    receive,

    answer,

    /** Replies with all four answers in one message, as a Tenant answers a message that asks for them all. */
    async answerAll(
      from: string,
      details: { location: string; started: string; worsening: 'yes' | 'no'; availability: Availability },
      options: { channel?: ChannelType } = {},
    ) {
      const text = [details.location, details.started, details.worsening === 'yes' ? 'Getting worse' : 'Not getting worse', `Home ${AVAILABILITY_LABELS[details.availability]}`].join('. ');
      detailExtractor.when(text, details);
      await answer(from, text, 'answer', options);
    },

    /**
     * Replies to the agent's questions with `text`, scripting the classifier to read it as an answer
     * and the extractor to find `details` in it. The extractor still returns only the details asked for.
     */
    async answerDetails(from: string, text: string, details: ExtractedDetails, options: { channel?: ChannelType } = {}) {
      detailExtractor.when(text, details);
      await answer(from, text, 'answer', options);
    },

    async upload(link: string, files: { filename: string; contentType: string; content: Uint8Array }[], options: { amountCents?: number } = {}) {
      await app.upload(tokenOf(link), files, options);
      await drain();
    },

    tracker(link: string) {
      return app.tracker(tokenOf(link));
    },

    async advance(ms: number) {
      clock.advance(ms);
      await drain();
    },

    /** A Property Manager's actions; each one also lets the background worker catch up. */
    as(propertyManagerId: number): PropertyManagerActions {
      // Each action signs in afresh (app.asPropertyManager), as each web request does.
      return new Proxy({} as PropertyManagerActions, {
        get(_, key) {
          return async (...args: unknown[]) => {
            const actions = await app.asPropertyManager(propertyManagerId);
            const action = actions[key as keyof PropertyManagerActions] as (...args: unknown[]) => unknown;
            const result = await action(...args);
            await drain();
            return result;
          };
        },
      });
    },
  };
}

function tokenOf(link: string) {
  return new URL(link).pathname.split('/').at(-1)!;
}
