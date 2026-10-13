// WhatsApp through Meta's Cloud API: outbound messages, the inbound webhook, its
// X-Hub-Signature-256 signature, and downloading media by id.
//   POST {base}/{version}/{phoneNumberId}/messages  { messaging_product, to, type, ... }
//   POST {base}/{version}/{phoneNumberId}/media     multipart: file, type, messaging_product
//   GET  {base}/{version}/{mediaId} -> { url }, then GET url with the bearer token
// Errors come back as { error: { code, message, error_data: { details } } }.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { UndeliverableError, type InboundMessage, type Messenger, type OutboundMessage } from '../ports.ts';

const BASE = 'https://graph.facebook.com';
const TIMEOUT_MS = 15_000;
/** 131026 can't deliver to this number, 131030 recipient not in the allowed list. */
const UNDELIVERABLE_CODES: ReadonlySet<number> = new Set([131026, 131030]);

interface GraphOptions {
  accessToken: string;
  fetch?: typeof fetch;
  graphVersion?: string;
}

export function createMetaWhatsApp(o: { phoneNumberId: string } & GraphOptions): Messenger {
  const { phoneNumberId, accessToken, fetch: fetchImpl = fetch, graphVersion = 'v21.0' } = o;
  const root = `${BASE}/${graphVersion}/${encodeURIComponent(phoneNumberId)}`;
  const authorization = `Bearer ${accessToken}`;

  async function call(message: OutboundMessage, path: string, init: { body: string | FormData; contentType?: string }) {
    const response = await fetchImpl(`${root}/${path}`, {
      method: 'POST',
      headers: { authorization, ...(init.contentType ? { 'content-type': init.contentType } : {}), accept: 'application/json' },
      body: init.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    if (response.ok) return text;
    const error = parseError(text);
    const detail = error ? `${error.code ?? 'no code'} ${error.message}`.trim() : text.slice(0, 200);
    if (isUndeliverable(response.status, error)) {
      throw new UndeliverableError(message.channelType, message.to, `Meta ${detail}`);
    }
    throw new Error(`Meta returned ${response.status}: ${detail}`);
  }

  const sendJson = (message: OutboundMessage, payload: object) =>
    call(message, 'messages', {
      body: JSON.stringify({ messaging_product: 'whatsapp', to: message.to.replace(/^\+/, ''), ...payload }),
      contentType: 'application/json',
    });

  return {
    async send(message) {
      if (message.channelType !== 'whatsapp') throw new Error(`Meta WhatsApp can't send ${message.channelType} messages`);
      if (message.text !== '' || message.attachments.length === 0) {
        await sendJson(message, { type: 'text', text: { body: message.text } });
      }
      for (const attachment of message.attachments) {
        const form = new FormData();
        form.set('messaging_product', 'whatsapp');
        form.set('type', attachment.contentType);
        form.set('file', new Blob([attachment.content as Uint8Array<ArrayBuffer>], { type: attachment.contentType }), attachment.filename);
        const uploaded = JSON.parse(await call(message, 'media', { body: form })) as { id?: string };
        if (!uploaded.id) throw new Error('Meta media upload returned no id');
        if (attachment.contentType.startsWith('image/')) {
          await sendJson(message, { type: 'image', image: { id: uploaded.id } });
        } else {
          await sendJson(message, { type: 'document', document: { id: uploaded.id, filename: attachment.filename } });
        }
      }
    },
  };
}

interface GraphError {
  code?: number;
  message: string;
  details: string;
}

function parseError(text: string): GraphError | null {
  try {
    const error = (JSON.parse(text) as { error?: Record<string, unknown> }).error;
    if (typeof error !== 'object' || error === null) return null;
    const data = error.error_data as { details?: unknown } | undefined;
    return {
      ...(typeof error.code === 'number' ? { code: error.code } : {}),
      message: typeof error.message === 'string' ? error.message : '',
      details: typeof data?.details === 'string' ? data.details : '',
    };
  } catch {
    return null;
  }
}

function isUndeliverable(status: number, error: GraphError | null) {
  if (!error) return false;
  if (error.code !== undefined && UNDELIVERABLE_CODES.has(error.code)) return true;
  const mentionsRecipient = /recipient|phone number|\bto\b.*(invalid|not valid)/i.test(`${error.message} ${error.details}`);
  return mentionsRecipient && (error.code === 100 || status === 400);
}

/** Checks X-Hub-Signature-256: "sha256=" and the hex HMAC-SHA256 of the raw body, keyed by the app secret. */
export function verifyMetaSignature(appSecret: string, rawBody: Uint8Array, header: string): boolean {
  const expected = Buffer.from('sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex'));
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

function* changeValues(body: unknown): Generator<Obj> {
  if (!isObj(body)) return;
  for (const entry of arr(body.entry)) {
    for (const change of arr(entry.changes)) {
      if (change.field === 'messages' && isObj(change.value)) yield change.value;
    }
  }
}

/** Converts a Cloud API webhook body into inbound messages; delivery statuses are ignored here. */
export function metaToInbound(body: unknown, now: Date): InboundMessage[] {
  const result: InboundMessage[] = [];
  for (const value of changeValues(body)) {
    const display = String(value.metadata?.display_phone_number ?? '').replace(/[\s-]/g, '').replace(/^\+/, '');
    for (const m of arr(value.messages)) {
      const type = String(m.type ?? '');
      const media: Obj | undefined = ['image', 'document', 'audio', 'video'].includes(type) ? m[type] : undefined;
      let text = '';
      if (type === 'text') text = String(m.text?.body ?? '');
      else if (media) text = type === 'image' || type === 'document' ? String(media.caption ?? '') : '';
      else if (type === 'button') text = String(m.button?.text ?? '');
      else if (type === 'interactive') {
        text = String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '');
      }
      const seconds = Number(m.timestamp);
      result.push({
        providerMessageId: `wa-${m.id}`,
        agencyChannel: '+' + display,
        channelType: 'whatsapp',
        from: '+' + String(m.from ?? ''),
        text,
        attachments: media
          ? [{ filename: String(media.filename ?? `${type}-${media.id}`), contentType: String(media.mime_type ?? 'application/octet-stream'), url: `meta-media:${media.id}` }]
          : [],
        receivedAt: Number.isFinite(seconds) && m.timestamp !== undefined ? new Date(seconds * 1000) : now,
      });
    }
  }
  return result;
}

/** Failed delivery statuses, e.g. 131047 for a message sent outside the 24-hour window. */
export function metaStatusFailures(body: unknown): { to: string; code: number; title: string }[] {
  const failures: { to: string; code: number; title: string }[] = [];
  for (const value of changeValues(body)) {
    for (const status of arr(value.statuses)) {
      if (status.status !== 'failed') continue;
      for (const error of arr(status.errors)) {
        failures.push({
          to: '+' + String(status.recipient_id ?? ''),
          code: Number(error.code),
          title: String(error.title ?? error.message ?? ''),
        });
      }
    }
  }
  return failures;
}

/** Downloads media by "meta-media:<id>": the id resolves to a short-lived URL, fetched with the token. */
export function metaFetchMedia(o: GraphOptions): (url: string) => Promise<Uint8Array> {
  const { accessToken, fetch: fetchImpl = fetch, graphVersion = 'v21.0' } = o;
  const headers = { authorization: `Bearer ${accessToken}` };
  return async (url) => {
    const match = /^meta-media:(.+)$/.exec(url);
    if (!match) throw new Error(`Not a Meta media reference: ${url}`);
    const info = await fetchImpl(`${BASE}/${graphVersion}/${encodeURIComponent(match[1]!)}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!info.ok) throw new Error(`Meta media lookup failed: ${info.status} ${url}`);
    const { url: downloadUrl } = (await info.json()) as { url?: string };
    if (!downloadUrl) throw new Error(`Meta media lookup returned no url: ${url}`);
    const file = await fetchImpl(downloadUrl, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!file.ok) throw new Error(`Meta media download failed: ${file.status} ${url}`);
    return new Uint8Array(await file.arrayBuffer());
  };
}
