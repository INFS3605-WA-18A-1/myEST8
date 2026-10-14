// Inbound email through Resend. The email.received webhook is metadata only and
// is signed with Svix (svix-id, svix-timestamp, svix-signature, whsec_ secret).
// The body and attachment bytes are fetched afterwards.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { InboundAttachment, InboundMessage } from '../ports.ts';
import { emailAddress, htmlToText, withoutQuotedReply } from './email-text.ts';
import { isObject, malformed } from './json-api.ts';

const API = 'https://api.resend.com';
const TIMEOUT_MS = 15_000;

/** Svix's default replay window: five minutes either side of the timestamp. */
const TOLERANCE_SECONDS = 5 * 60;
const SECRET_PREFIX = 'whsec_';

function signingKey(secret: string): Buffer | null {
  const trimmed = secret.trim();
  const encoded = trimmed.startsWith(SECRET_PREFIX) ? trimmed.slice(SECRET_PREFIX.length) : trimmed;
  if (!encoded) return null;
  const key = Buffer.from(encoded, 'base64');
  return key.length === 0 ? null : key;
}

/** True when one v1 signature matches. Length mismatches are skipped; equal lengths compare in constant time. */
function signaturesMatch(expected: string, header: string): boolean {
  const expectedBuf = Buffer.from(expected);
  for (const part of header.split(' ')) {
    const comma = part.indexOf(',');
    if (comma === -1) continue;
    if (part.slice(0, comma) !== 'v1') continue;
    const given = Buffer.from(part.slice(comma + 1));
    if (given.length === expectedBuf.length && timingSafeEqual(given, expectedBuf)) return true;
  }
  return false;
}

/**
 * Checks a Resend webhook: HMAC-SHA256 of `${id}.${timestamp}.${raw body}`, keyed
 * by the base64 secret after `whsec_`. The timestamp must sit within five minutes
 * of `now`, so a captured request can't be replayed later.
 */
export function verifyResendSignature(
  secret: string,
  rawBody: Uint8Array,
  headers: { id: string; timestamp: string; signature: string },
  now: Date,
): boolean {
  const key = signingKey(secret);
  if (!key || !headers.id || !headers.timestamp || !headers.signature) return false;
  const timestamp = Number(headers.timestamp);
  if (!Number.isInteger(timestamp)) return false;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (nowSeconds - timestamp > TOLERANCE_SECONDS || timestamp > nowSeconds + TOLERANCE_SECONDS) return false;
  // Hash the raw body bytes. Decoding them first would change an invalid byte and break the signature.
  const signed = Buffer.concat([Buffer.from(`${headers.id}.${headers.timestamp}.`), rawBody]);
  const expected = createHmac('sha256', key).update(signed).digest('base64');
  return signaturesMatch(expected, headers.signature);
}

/** Both Resend inbound settings, or null when neither is set. One without the other is a broken setup. */
export function resendInboundConfig(env: Record<string, string | undefined>): { webhookSecret: string; apiKey: string } | null {
  const webhookSecret = env.RESEND_WEBHOOK_SECRET?.trim() ?? '';
  const apiKey = env.RESEND_API_KEY?.trim() ?? '';
  if (!webhookSecret && !apiKey) return null;
  if (!webhookSecret || !apiKey) throw new Error('Set both RESEND_WEBHOOK_SECRET and RESEND_API_KEY, or neither');
  return { webhookSecret, apiKey };
}

async function getJson(fetchImpl: typeof fetch, url: string, apiKey: string): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  // The body is left out of the error: a provider message must not be able to echo the key back at us.
  if (!response.ok) throw new Error(`Resend returned ${response.status}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Resend returned a body that is not JSON');
  }
}

function addresses(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function messageText(email: Record<string, unknown>): string {
  const text = typeof email.text === 'string' && email.text.trim() ? email.text : null;
  const html = typeof email.html === 'string' ? email.html : '';
  return withoutQuotedReply((text ?? htmlToText(html)).replace(/\r\n/g, '\n'));
}

async function downloadAttachments(id: string, listed: unknown, apiKey: string, fetchImpl: typeof fetch): Promise<InboundAttachment[]> {
  if (!Array.isArray(listed) || listed.length === 0) return [];
  const body = await getJson(fetchImpl, `${API}/emails/receiving/${encodeURIComponent(id)}/attachments`, apiKey);
  if (!isObject(body) || !Array.isArray(body.data)) malformed('Resend', 'attachment list has no data array', body);
  if (body.has_more === true) throw new Error('Resend attachment list was truncated');
  const attachments: InboundAttachment[] = [];
  for (const item of body.data) {
    if (!isObject(item) || typeof item.download_url !== 'string') malformed('Resend', 'attachment is missing download_url', item);
    const response = await fetchImpl(item.download_url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Resend attachment download returned ${response.status}`);
    attachments.push({
      filename: typeof item.filename === 'string' && item.filename ? item.filename : 'attachment',
      contentType: typeof item.content_type === 'string' && item.content_type ? item.content_type : 'application/octet-stream',
      content: new Uint8Array(await response.arrayBuffer()),
    });
  }
  return attachments;
}

/**
 * Turns an `email.received` webhook into an inbound message. The webhook has no
 * body, so this GETs the received email and, when that lists attachments, each
 * file. Text is the plain part, or HTML with the tags removed, with the quoted
 * reply stripped. Any other event is ignored.
 */
export async function resendToInbound(
  event: unknown,
  { apiKey, fetch: fetchImpl, receivedAt }: { apiKey: string; fetch: typeof fetch; receivedAt: Date },
): Promise<InboundMessage | null> {
  if (!isObject(event) || event.type !== 'email.received') return null;
  if (!isObject(event.data) || typeof event.data.email_id !== 'string' || !event.data.email_id) {
    malformed('Resend', 'email.received is missing email_id', event);
  }
  const id = event.data.email_id;
  const email = await getJson(fetchImpl, `${API}/emails/receiving/${encodeURIComponent(id)}`, apiKey);
  if (!isObject(email)) malformed('Resend', 'received email is not an object', email);
  return {
    providerMessageId: `re-${id}`,
    agencyChannel: emailAddress(addresses(email.to)[0] ?? ''),
    channelType: 'email',
    from: emailAddress(typeof email.from === 'string' ? email.from : ''),
    text: messageText(email),
    attachments: await downloadAttachments(id, email.attachments, apiKey, fetchImpl),
    receivedAt,
  };
}
