import type {
  AddressSuggestion,
  AddressSuggester,
  BlobStore,
  ChannelType,
  Classifier,
  Summariser,
  ClassifierAnswer,
  Clock,
  Composer,
  Geocoder,
  ImageMatcher,
  ImageMatchResult,
  ListingDetails,
  Messenger,
  OutboundMessage,
  PlacesLookup,
  QuoteReader,
  TradeSuggester,
} from '../../src/ports.ts';
import type { Trade } from '../../src/shared.ts';

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
  subject: string;
  cc: string[];
  channel: ChannelType;
  template: string;
  data: Record<string, unknown>;
  attachments: string[];
  text: string;
  /** Only email carries an HTML body. */
  html?: string;
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
      subject: message.subject,
      cc: message.cc,
      channel: message.channelType,
      template: message.template,
      data: message.data as Record<string, unknown>,
      attachments: message.attachments.map((a) => a.filename),
      text: message.text,
      ...(message.html === undefined ? {} : { html: message.html }),
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

/** Summarises as "Summary: <description>" unless `next` is set (a summary to return, or an Error to throw). */
export class FakeSummariser implements Summariser {
  next: string | Error | null = null;
  calls: Parameters<Summariser['summarise']>[0][] = [];
  async summarise(input: Parameters<Summariser['summarise']>[0]) {
    this.calls.push(input);
    if (this.next instanceof Error) throw this.next;
    return { summary: this.next ?? `Summary: ${input.description}` };
  }
}

/** Composes "Composed: <draft>" unless `next` is set (a text to return, or an Error to throw). */
export class FakeComposer implements Composer {
  next: string | Error | null = null;
  calls: Parameters<Composer['compose']>[0][] = [];
  async compose(input: Parameters<Composer['compose']>[0]) {
    this.calls.push(input);
    if (this.next instanceof Error) throw this.next;
    return { text: this.next ?? `Composed: ${input.draft}` };
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

/** Suggests the Trades in `next` for any listing, or throws it when it is an Error. */
export class FakeTradeSuggester implements TradeSuggester {
  next: Trade[] | Error = [];
  calls: ListingDetails[] = [];
  async suggestTrades(listing: ListingDetails) {
    this.calls.push(listing);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

/** Finds an address's point in `locations`, null when it isn't there. */
export class FakeGeocoder implements Geocoder {
  locations = new Map<string, { lat: number; lng: number }>();
  async geocode(address: string) {
    return this.locations.get(address) ?? null;
  }
}

/** Suggests `suggestions`, or throws when that is an Error. */
export class FakeAddressSuggester implements AddressSuggester {
  suggestions: AddressSuggestion[] | Error = [];
  queries: string[] = [];
  async suggest(query: string) {
    this.queries.push(query);
    if (this.suggestions instanceof Error) throw this.suggestions;
    return this.suggestions;
  }
}

export class FakePlaces implements PlacesLookup {
  /** A listing's name, address and rating; `listingDetails` adds what it has beyond them (nothing, unless set here). */
  listings = new Map<
    string,
    { name: string; address: string; rating: number | null; reviewCount: number } & Partial<Pick<ListingDetails, 'phone' | 'website' | 'types' | 'primaryType' | 'summary'>>
  >();
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
  async listingDetails(placeId: string) {
    const listing = this.listings.get(placeId);
    if (!listing) throw new Error(`FakePlaces: unknown place ${placeId}`);
    return { placeId, phone: null, website: null, types: [], primaryType: null, summary: null, ...listing };
  }
}

/** Object storage in memory. A browser's PUT to a slot URL is `put(path, bytes, type)`. */
export class FakeBlobStore implements BlobStore {
  objects = new Map<string, { content: Uint8Array; contentType: string }>();
  async put(path: string, content: Uint8Array, contentType: string) {
    this.objects.set(path, { content, contentType });
  }
  async get(path: string) {
    const object = this.objects.get(path);
    if (!object) throw new Error(`no object at ${path}`);
    return object.content;
  }
  async remove(path: string) {
    this.objects.delete(path);
  }
  async uploadUrl(path: string) {
    return `https://storage.test/upload/${path}`;
  }
}
