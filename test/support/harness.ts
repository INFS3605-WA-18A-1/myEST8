import { createApp, type PropertyManagerActions } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import type { ChannelType, InboundAttachment } from '../../src/ports.ts';
import { FakeClassifier, FakeClock, FakeImageMatcher, FakeMessenger, FakePlaces, FakeQuoteReader } from './fakes.ts';

/** Thursday 8 October 2026, 9:00 am in Sydney. */
export const START = new Date('2026-10-08T09:00:00+11:00');
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const AGENCY_NUMBER = '+61290000000';
export const AGENCY_INBOX = 'inbox@harbour.example';

export type Harness = Awaited<ReturnType<typeof createHarness>>;

/** Drives the app through its boundary: inbound messages, uploads, Property Manager actions and the clock. */
export async function createHarness() {
  const clock = new FakeClock(START);
  const messenger = new FakeMessenger();
  const classifier = new FakeClassifier();
  const imageMatcher = new FakeImageMatcher();
  const quoteReader = new FakeQuoteReader();
  const places = new FakePlaces();
  const app = createApp({
    db: openDb(':memory:'),
    clock,
    messenger,
    classifier,
    imageMatcher,
    quoteReader,
    places,
    fetchMedia: async (url) => {
      throw new Error(`no media at ${url}`);
    },
    settings: { baseUrl: 'https://myest8.test' },
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
    app.receiveInbound({
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

  return {
    app,
    clock,
    messenger,
    classifier,
    imageMatcher,
    quoteReader,
    places,
    drain,
    receive,

    /** Replies to a question the agent asked, scripting the classifier to read it as `answer` to that question. */
    async answer(from: string, text: string, answer = 'answer', options: { channel?: ChannelType } = {}) {
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
    },

    async upload(link: string, files: { filename: string; contentType: string; content: Uint8Array }[]) {
      await app.upload(tokenOf(link), files);
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
      const actions = app.asPropertyManager(propertyManagerId);
      return new Proxy(actions, {
        get(target, key) {
          const action = target[key as keyof PropertyManagerActions] as (...args: unknown[]) => unknown;
          return async (...args: unknown[]) => {
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
