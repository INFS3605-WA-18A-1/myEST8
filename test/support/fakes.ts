import type {
  ChannelType,
  Classifier,
  ClassifierAnswer,
  Clock,
  ImageMatcher,
  ImageMatchResult,
  Messenger,
  OutboundMessage,
  PlacesLookup,
  QuoteReader,
} from '../../src/ports.ts';

export class FakeClock implements Clock {
  #now: Date;
  constructor(start: Date) {
    this.#now = start;
  }
  now() {
    return new Date(this.#now);
  }
  advance(ms: number) {
    this.#now = new Date(this.#now.getTime() + ms);
  }
}

export interface SentMessage {
  to: string;
  cc: string[];
  channel: ChannelType;
  template: string;
  data: Record<string, unknown>;
  attachments: string[];
  text: string;
}

export class FakeMessenger implements Messenger {
  sent: SentMessage[] = [];
  /** How many of the next sends fail, as when the provider is down. */
  failures = 0;
  async send(message: OutboundMessage) {
    if (this.failures > 0) {
      this.failures--;
      throw new Error('FakeMessenger: provider unavailable');
    }
    this.sent.push({
      to: message.to,
      cc: message.cc,
      channel: message.channelType,
      template: message.template,
      data: message.data as Record<string, unknown>,
      attachments: message.attachments.map((a) => a.filename),
      text: message.text,
    });
  }
  to(address: string) {
    return this.sent.filter((m) => m.to === address);
  }
  last(address: string) {
    return this.to(address).at(-1);
  }
  templatesTo(address: string) {
    return this.to(address).map((m) => m.template);
  }
  clear() {
    this.sent = [];
  }
}

export type ScriptedAnswers = Record<string, string | [answer: string, confidence: number]>;

/**
 * Returns scripted answers for each text it is asked to classify. A question the
 * script doesn't mention gets its first option, confidently.
 */
export class FakeClassifier implements Classifier {
  #rules = new Map<string, ScriptedAnswers>();
  when(text: string, answers: ScriptedAnswers) {
    this.#rules.set(text, answers);
  }
  async classify(input: Parameters<Classifier['classify']>[0]) {
    const script = this.#rules.get(input.text);
    if (!script) throw new Error(`FakeClassifier: no script for ${JSON.stringify(input.text)}`);
    const result: Record<string, ClassifierAnswer> = {};
    for (const q of input.questions) {
      const scripted = script[q.id];
      const [answer, confidence] =
        scripted === undefined ? [q.options[0]!, 0.95] : typeof scripted === 'string' ? [scripted, 0.95] : scripted;
      if (!q.options.includes(answer)) {
        throw new Error(`FakeClassifier: ${answer} is not an option for ${q.id} (${q.options.join(', ')})`);
      }
      result[q.id] = { answer, confidence };
    }
    return result;
  }
}

export class FakeImageMatcher implements ImageMatcher {
  next: { result: ImageMatchResult; reason: string } | Error = { result: 'matches', reason: 'Photos show the reported issue' };
  async match() {
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

export class FakeQuoteReader implements QuoteReader {
  #rules = new Map<string, { priceCents?: number; proposedTime?: Date }>();
  when(text: string, quote: { priceCents?: number; proposedTime?: Date }) {
    this.#rules.set(text, quote);
  }
  async read(input: { text: string }) {
    return this.#rules.get(input.text) ?? {};
  }
}

export class FakePlaces implements PlacesLookup {
  locations = new Map<string, { lat: number; lng: number }>();
  listings = new Map<string, { name: string; address: string; rating: number | null; reviewCount: number }>();
  async findListings(query: string) {
    return [...this.listings]
      .filter(([, l]) => l.name.toLowerCase().includes(query.toLowerCase()))
      .map(([placeId, l]) => ({ placeId, name: l.name, address: l.address }));
  }
  async getRating(placeId: string) {
    const listing = this.listings.get(placeId);
    if (!listing) throw new Error(`FakePlaces: unknown place ${placeId}`);
    return { rating: listing.rating, reviewCount: listing.reviewCount };
  }
  async geocode(address: string) {
    return this.locations.get(address) ?? null;
  }
}
