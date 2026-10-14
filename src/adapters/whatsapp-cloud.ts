// WhatsApp through Meta's Cloud API (docs/adr/0004): sending text and files, the
// webhook (verification handshake, signature, inbound messages) and media download.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { UndeliverableError, type InboundAttachment, type InboundMessage, type Messenger, type OutboundMessage } from '../ports.ts';
import { normalizeAddress } from '../shared.ts';
import { isObject, malformed } from './json-api.ts';

const SERVICE = 'WhatsApp';
const TIMEOUT_MS = 30_000;
const DEFAULT_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_VERSION = 'v23.0';

/** Errors Meta gives for a recipient it will never deliver to: not on WhatsApp, not allowed on a test number, outside the 24-hour window, opted out. */
const UNDELIVERABLE_CODES = new Set([131026, 131030, 131047, 131050]);

/**
 * The onboarding test message goes out as Meta's sample template, which every WhatsApp account has
 * approved: it is business-initiated, and WhatsApp silently drops free-form text to anyone who hasn't
 * messaged the number in the last 24 hours.
 */
const TEST_TEMPLATE = { name: 'hello_world', language: { code: 'en_US' } };

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/** Checks X-Hub-Signature-256: `sha256=` and the hex HMAC-SHA256 of the raw body, keyed with the app secret. */
export function verifyWhatsAppSignature(appSecret: string, rawBody: Uint8Array, header: string | undefined): boolean {
  if (!appSecret || !header) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header);
  if (!match) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(match[1]!, 'hex'));
}

/** The GET handshake when the webhook is set up: the challenge to answer with, or null to refuse. */
export function whatsappChallenge(verifyToken: string, query: { mode?: string | undefined; token?: string | undefined; challenge?: string | undefined }): string | null {
  if (!verifyToken || query.mode !== 'subscribe' || !query.challenge || query.token === undefined) return null;
  return timingSafeEqual(sha256(verifyToken), sha256(query.token)) ? query.challenge : null;
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
};
const MEDIA_TYPES = new Set(['image', 'document', 'audio', 'video']);
const digits = (value: string) => value.replace(/\D/g, '');

export type MediaDownloader = (mediaId: string) => Promise<{ content: Uint8Array; contentType: string }>;

/**
 * Turns a webhook POST into inbound messages. Photos and files are downloaded now,
 * because Meta's media links expire within minutes. Delivery receipts, reactions
 * and message types myEST8 doesn't read are dropped.
 */
export async function whatsappToInbound(payload: unknown, download: MediaDownloader): Promise<InboundMessage[]> {
  if (!isObject(payload) || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
    return malformed(SERVICE, 'not a WhatsApp Business Account webhook', payload);
  }
  const inbound: InboundMessage[] = [];
  for (const entry of payload.entry) {
    for (const change of isObject(entry) && Array.isArray(entry.changes) ? entry.changes : []) {
      if (!isObject(change) || change.field !== 'messages' || !isObject(change.value)) continue;
      const { metadata, messages } = change.value;
      if (!isObject(metadata) || typeof metadata.display_phone_number !== 'string') return malformed(SERVICE, 'no display_phone_number', change.value);
      const agencyChannel = `+${digits(metadata.display_phone_number)}`;
      for (const message of Array.isArray(messages) ? messages : []) {
        if (!isObject(message) || typeof message.id !== 'string' || typeof message.from !== 'string' || typeof message.type !== 'string') {
          return malformed(SERVICE, 'a message without id, from and type', message);
        }
        const common = {
          providerMessageId: message.id,
          agencyChannel,
          channelType: 'whatsapp' as const,
          from: `+${digits(message.from)}`,
          receivedAt: new Date(Number(message.timestamp) * 1000),
        };
        if (message.type === 'text' && isObject(message.text) && typeof message.text.body === 'string') {
          inbound.push({ ...common, text: message.text.body, attachments: [] });
        } else if (MEDIA_TYPES.has(message.type) && isObject(message[message.type])) {
          const media = message[message.type] as Record<string, unknown>;
          if (typeof media.id !== 'string') return malformed(SERVICE, `a ${message.type} without an id`, media);
          const file = await download(media.id);
          const filename = typeof media.filename === 'string' ? media.filename : `${message.type}-${media.id}.${EXTENSIONS[file.contentType] ?? 'bin'}`;
          const attachment: InboundAttachment = { filename, contentType: file.contentType, content: file.content };
          inbound.push({ ...common, text: typeof media.caption === 'string' ? media.caption : '', attachments: [attachment] });
        }
      }
    }
  }
  return inbound;
}

/**
 * Messages Meta accepted but then failed to deliver, from a webhook's `statuses`. Meta answers a send
 * with 200 before delivery, so this is the only place a test number's or template's refusal shows.
 */
export function whatsappFailures(payload: unknown): { to: string; reason: string }[] {
  if (!isObject(payload) || !Array.isArray(payload.entry)) return [];
  const failures: { to: string; reason: string }[] = [];
  for (const entry of payload.entry) {
    for (const change of isObject(entry) && Array.isArray(entry.changes) ? entry.changes : []) {
      const statuses = isObject(change) && isObject(change.value) ? change.value.statuses : undefined;
      for (const status of Array.isArray(statuses) ? statuses : []) {
        if (!isObject(status) || status.status !== 'failed') continue;
        const errors = Array.isArray(status.errors) ? status.errors.filter(isObject) : [];
        const reason = errors.map((e) => [e.code, e.title, isObject(e.error_data) ? e.error_data.details : undefined].filter(Boolean).join(' ')).join('; ');
        failures.push({ to: `+${digits(String(status.recipient_id ?? ''))}`, reason: reason || 'no reason given' });
      }
    }
  }
  return failures;
}

interface ApiConfig {
  token: string;
  fetch?: typeof fetch;
  apiBaseUrl?: string;
  apiVersion?: string;
}

/** Downloads a received file: the media id gives a short-lived URL, which needs the token too. */
export function createWhatsAppMediaFetcher(config: ApiConfig): MediaDownloader {
  const fetchImpl = config.fetch ?? fetch;
  const base = `${config.apiBaseUrl ?? DEFAULT_BASE_URL}/${config.apiVersion ?? DEFAULT_VERSION}`;
  const headers = { authorization: `Bearer ${config.token}` };
  return async (mediaId) => {
    const lookup = await fetchImpl(`${base}/${encodeURIComponent(mediaId)}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!lookup.ok) throw new Error(`${SERVICE} returned ${lookup.status} looking up media`);
    const meta: unknown = await lookup.json().catch(() => null);
    if (!isObject(meta) || typeof meta.url !== 'string') return malformed(SERVICE, 'a media lookup without a url', meta);
    const download = await fetchImpl(meta.url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!download.ok) throw new Error(`${SERVICE} returned ${download.status} downloading media`);
    const contentType = typeof meta.mime_type === 'string' ? meta.mime_type : (download.headers.get('content-type') ?? 'application/octet-stream');
    return { content: new Uint8Array(await download.arrayBuffer()), contentType };
  };
}

/** Sends text, then each attachment as a message of its own (WhatsApp takes one file per message). */
export function createWhatsAppMessenger(config: ApiConfig & { phoneNumberId: string }): Messenger {
  const fetchImpl = config.fetch ?? fetch;
  const base = `${config.apiBaseUrl ?? DEFAULT_BASE_URL}/${config.apiVersion ?? DEFAULT_VERSION}/${config.phoneNumberId}`;

  async function call(path: string, body: string | FormData, message: OutboundMessage, contentType?: string): Promise<unknown> {
    const response = await fetchImpl(`${base}/${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, accept: 'application/json', ...(contentType ? { 'content-type': contentType } : {}) },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    if (response.ok) return text ? (JSON.parse(text) as unknown) : {};
    let code: unknown;
    let reason = text.slice(0, 200);
    try {
      const parsed: unknown = JSON.parse(text);
      const error = isObject(parsed) && isObject(parsed.error) ? parsed.error : null;
      code = error?.code;
      if (typeof error?.message === 'string') reason = error.message;
    } catch {
      // not JSON: keep the excerpt
    }
    if (typeof code === 'number' && UNDELIVERABLE_CODES.has(code)) throw new UndeliverableError('whatsapp', message.to, reason);
    throw new Error(`${SERVICE} returned ${response.status}: ${reason}`);
  }

  return {
    async send(message) {
      // A typed number may have spaces or start with 0 ("0432 855 883"); Meta wants E.164.
      const normalized = normalizeAddress(message.to);
      const to = normalized.startsWith('+') ? normalized : `+${normalized}`;
      const post = (body: object) => call('messages', JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...body }), message, 'application/json');
      if (message.template === 'onboarding.test_message') await post({ type: 'template', template: TEST_TEMPLATE });
      else if (message.text) await post({ type: 'text', text: { body: message.text, preview_url: false } });
      for (const attachment of message.attachments) {
        const form = new FormData();
        form.set('messaging_product', 'whatsapp');
        form.set('type', attachment.contentType);
        form.set('file', new File([attachment.content], attachment.filename, { type: attachment.contentType }));
        const uploaded = await call('media', form, message);
        if (!isObject(uploaded) || typeof uploaded.id !== 'string') return malformed(SERVICE, 'an upload without an id', uploaded);
        const kind = attachment.contentType.startsWith('image/') ? 'image' : attachment.contentType.startsWith('video/') ? 'video' : 'document';
        await post({ type: kind, [kind]: kind === 'document' ? { id: uploaded.id, filename: attachment.filename } : { id: uploaded.id } });
      }
    },
  };
}
