// Ports: interfaces owned by the app for every external service, so a provider
// can be swapped and tests can use fakes.

import type { Trade } from './shared.ts';

export type ChannelType = 'sms' | 'whatsapp' | 'email';

export type InboundAttachment = { filename: string; contentType: string } & (
  | { content: Uint8Array }
  | { url: string }
);

/** One inbound message, whichever provider and channel it arrived on. */
export interface InboundMessage {
  providerMessageId: string;
  /** The Agency's own address the message arrived on (phone number or inbox address). */
  agencyChannel: string;
  channelType: ChannelType;
  /** The sender's phone number (E.164) or email address. */
  from: string;
  text: string;
  attachments: InboundAttachment[];
  receivedAt: Date;
}

export interface OutboundAttachment {
  /**
   * The stored file's id (`src/files.ts`), when the attachment is a stored file.
   * Providers that take media by URL (Twilio) link to it with a signed file link.
   */
  id?: number;
  filename: string;
  contentType: string;
  content: Uint8Array;
}

export interface OutboundMessage {
  channelType: ChannelType;
  /** The Agency channel address to send from. Email replies come back to it. */
  from: string;
  to: string;
  cc: string[];
  subject: string;
  text: string;
  /** The template and its data. Production WhatsApp senders need both. */
  template: string;
  data: object;
  attachments: OutboundAttachment[];
  /**
   * Stable id for this send, when the caller has one. Providers that support
   * idempotency (Resend) send it so a retry does not deliver the message twice.
   */
  id?: string;
}

export interface Messenger {
  /**
   * Sends one message. Throws when it can't be sent, so the worker retries the
   * task; throws an `UndeliverableError` when it never can be.
   */
  send(message: OutboundMessage): Promise<void>;
}

/**
 * A message that can never be delivered as addressed: the provider refused the
 * recipient (not a phone number, not a mobile, opted out, not a valid email). The
 * worker marks a task that fails with it as failed straight away instead of
 * retrying (`permanent`).
 */
export class UndeliverableError extends Error {
  readonly permanent = true;
  readonly channelType: ChannelType;
  readonly to: string;
  /** A short phrase a person can read ("that doesn't look like a valid phone number"); `message` stays technical for logs. */
  readonly userReason: string;
  constructor(channelType: ChannelType, to: string, reason: string, userReason?: string) {
    super(`Undeliverable ${channelType} message to ${to}: ${reason}`);
    this.name = 'UndeliverableError';
    this.channelType = channelType;
    this.to = to;
    this.userReason =
      userReason ?? (channelType === 'email' ? "that email address couldn't be used" : "that number couldn't be used");
  }
}

/**
 * A provider's known, explainable refusal that is not about the recipient being
 * wrong forever (a trial account, a rate limit, WhatsApp's 24-hour window). Unlike
 * UndeliverableError it is not permanent: the worker still retries it. `userReason`
 * is a short phrase for the person who triggered the send.
 */
export class ProviderRefusedError extends Error {
  readonly userReason: string;
  constructor(message: string, userReason: string) {
    super(message);
    this.name = 'ProviderRefusedError';
    this.userReason = userReason;
  }
}

export interface ClassifierQuestion {
  id: string;
  options: readonly string[];
}

export interface ClassifierAnswer {
  answer: string;
  confidence: number;
}

export interface Classifier {
  /** Answers every question in one pass. `text` is what is being classified; `state` is its context. */
  classify(input: {
    text: string;
    state: object;
    questions: ClassifierQuestion[];
  }): Promise<Record<string, ClassifierAnswer>>;
}

export type ImageMatchResult = 'matches' | 'does_not_match' | 'unclear';

export interface ImageMatcher {
  match(input: {
    description: string;
    photos: { contentType: string; content: Uint8Array }[];
  }): Promise<{ result: ImageMatchResult; reason: string }>;
}

export interface QuoteReader {
  read(input: { text: string; pdf?: Uint8Array }): Promise<{ priceCents?: number; proposedTime?: Date }>;
}

/**
 * Writes a Maintenance Request's Summary from the Tenant's words and answers.
 * The one place a model writes prose (ADR 0008). Throws on failure, so the
 * worker task retries; the request stays confirmable without a Summary.
 */
export interface Summariser {
  /** One line, at most 160 characters, plain English, only facts in the input. */
  summarise(input: {
    description: string;
    answers: { location: string | null; started: string | null; worsening: string | null };
    trade: Trade;
    photoCount: number;
  }): Promise<{ summary: string }>;
}

/** A business's Google listing, as much of it as myEST8 uses to fill in a Tradie. */
export interface ListingDetails {
  placeId: string;
  name: string;
  address: string;
  /** The international number when Google has one, otherwise the national one, as Google writes it. */
  phone: string | null;
  website: string | null;
  /** Google's place types ("plumber"). */
  types: string[];
  /** Google's name for the main type ("Plumber"). */
  primaryType: string | null;
  /** Google's one-line description of the business. */
  summary: string | null;
  rating: number | null;
  reviewCount: number;
}

export interface PlacesLookup {
  findListings(query: string): Promise<{ placeId: string; name: string; address: string }[]>;
  getRating(placeId: string): Promise<{ rating: number | null; reviewCount: number }>;
  /** A listing's details. Throws when the lookup fails or the place isn't there. */
  listingDetails(placeId: string): Promise<ListingDetails>;
}

export interface Geocoder {
  /**
   * The latitude and longitude of a street address: a Property's, or a Tradie's
   * business address for the Dispatch map. Null when the address can't be found
   * (or is blank); throws when the lookup itself fails, so the caller's task retries.
   */
  geocode(address: string): Promise<{ lat: number; lng: number } | null>;
}

export interface TradeSuggester {
  /**
   * The Trades a business does, judged from its Google listing: none when nothing in
   * it points to one. A suggestion for the Property Manager to check. Throws when the
   * lookup fails.
   */
  suggestTrades(listing: ListingDetails): Promise<Trade[]>;
}

export interface Clock {
  now(): Date;
}

/** Downloads an attachment that a provider delivered by URL (Twilio media). */
export type FetchMedia = (url: string) => Promise<Uint8Array>;

/**
 * Where file bytes live when they are not in the database (Supabase Storage, in a
 * private bucket). Paths are chosen by the app, never from a filename.
 */
export interface BlobStore {
  put(path: string, content: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
  /** A URL a browser can PUT one object to, without any other credential. */
  uploadUrl(path: string): Promise<string>;
}
