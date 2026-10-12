// Ports: interfaces owned by the app for every external service, so a provider
// can be swapped and tests can use fakes.

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
  constructor(channelType: ChannelType, to: string, reason: string) {
    super(`Undeliverable ${channelType} message to ${to}: ${reason}`);
    this.name = 'UndeliverableError';
    this.channelType = channelType;
    this.to = to;
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

export interface PlacesLookup {
  findListings(query: string): Promise<{ placeId: string; name: string; address: string }[]>;
  getRating(placeId: string): Promise<{ rating: number | null; reviewCount: number }>;
  /**
   * The latitude and longitude of a street address: a Property's, or a Tradie's
   * business address for the Dispatch map. Null when the address can't be found
   * (or is blank); throws when the lookup itself fails, so the caller's task retries.
   */
  geocode(address: string): Promise<{ lat: number; lng: number } | null>;
}

export interface Clock {
  now(): Date;
}

/** Downloads an attachment that a provider delivered by URL (Twilio media). */
export type FetchMedia = (url: string) => Promise<Uint8Array>;
