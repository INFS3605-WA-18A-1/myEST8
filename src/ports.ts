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
  send(message: OutboundMessage): Promise<void>;
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
  geocode(address: string): Promise<{ lat: number; lng: number } | null>;
}

export interface Clock {
  now(): Date;
}

/** Downloads an attachment that a provider delivered by URL (Twilio media). */
export type FetchMedia = (url: string) => Promise<Uint8Array>;
