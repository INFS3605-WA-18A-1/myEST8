// Reading new mail from an Agency's Gmail (docs/adr/0004). No push endpoint: the
// worker polls the mailbox's history from a stored cursor and turns each new
// message into the common inbound message.

import type { InboundAttachment, InboundMessage } from '../ports.ts';
import { emailAddress, htmlToText, withoutQuotedReply } from './email-text.ts';
import { isObject, malformed } from './json-api.ts';

const SERVICE = 'Gmail';
const TIMEOUT_MS = 30_000;
const DEFAULT_BASE_URL = 'https://gmail.googleapis.com';
const SKIPPED_LABELS = ['SENT', 'DRAFT'];

export interface GmailPoll {
  messages: InboundMessage[];
  /** Save this and pass it to the next poll. */
  cursor: string;
  /** Gmail no longer kept history back to the cursor: polling starts again from now, and mail in between is lost. */
  reset: boolean;
}

type Part = { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string }; parts?: Part[] };

/**
 * The first poll (cursor null) only records where the mailbox is up to, so old mail
 * is never ingested. After that, every message added to the inbox since the cursor
 * comes back oldest first, except the Agency's own sent mail and drafts. Any failure
 * but an expired cursor throws, so the cursor isn't moved and nothing is lost.
 */
export async function pollGmailInbox(o: { accessToken: string; address: string; cursor: string | null; fetch?: typeof fetch; apiBaseUrl?: string }): Promise<GmailPoll> {
  const fetchImpl = o.fetch ?? fetch;
  const address = o.address.toLowerCase();

  async function get(path: string, params: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
    const url = new URL(`${o.apiBaseUrl ?? DEFAULT_BASE_URL}/gmail/v1/users/me/${path}`);
    url.search = new URLSearchParams(params).toString();
    const response = await fetchImpl(url, { headers: { authorization: `Bearer ${o.accessToken}`, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status === 404) return { status: 404, body: {} };
    const text = await response.text();
    if (!response.ok) throw new Error(`${SERVICE} returned ${response.status}: ${text.slice(0, 200)}`);
    const body: unknown = JSON.parse(text);
    return { status: response.status, body: isObject(body) ? body : malformed(SERVICE, 'not an object', body) };
  }

  const historyIdNow = async () => {
    const { body } = await get('profile');
    return typeof body.historyId === 'string' ? body.historyId : malformed(SERVICE, 'no historyId', body);
  };

  if (o.cursor === null) return { messages: [], cursor: await historyIdNow(), reset: false };

  const ids: string[] = [];
  let cursor = o.cursor;
  let pageToken: string | undefined;
  do {
    const page = await get('history', { startHistoryId: o.cursor, historyTypes: 'messageAdded', labelId: 'INBOX', ...(pageToken ? { pageToken } : {}) });
    if (page.status === 404) return { messages: [], cursor: await historyIdNow(), reset: true };
    for (const record of Array.isArray(page.body.history) ? page.body.history : []) {
      for (const added of isObject(record) && Array.isArray(record.messagesAdded) ? record.messagesAdded : []) {
        const message = isObject(added) && isObject(added.message) ? added.message : null;
        if (typeof message?.id === 'string' && !ids.includes(message.id)) ids.push(message.id);
      }
    }
    if (typeof page.body.historyId === 'string') cursor = page.body.historyId;
    pageToken = typeof page.body.nextPageToken === 'string' ? page.body.nextPageToken : undefined;
  } while (pageToken);

  const messages: InboundMessage[] = [];
  for (const id of ids) {
    const { status, body } = await get(`messages/${encodeURIComponent(id)}`, { format: 'full' });
    if (status === 404) continue; // deleted before it could be read
    const message = await toInbound(body, address, get);
    if (message) messages.push(message);
  }
  return { messages: messages.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()), cursor, reset: false };
}

async function toInbound(
  message: Record<string, unknown>,
  address: string,
  get: (path: string) => Promise<{ status: number; body: Record<string, unknown> }>,
): Promise<InboundMessage | null> {
  const labels = Array.isArray(message.labelIds) ? message.labelIds : [];
  const payload = isObject(message.payload) ? (message.payload as Part & { headers?: { name?: string; value?: string }[] }) : null;
  if (typeof message.id !== 'string' || !payload) return malformed(SERVICE, 'a message without id and payload', message);
  if (labels.some((l) => SKIPPED_LABELS.includes(String(l)))) return null;
  const header = (name: string) => payload.headers?.find((h) => h.name?.toLowerCase() === name)?.value ?? '';
  const from = emailAddress(header('from'));
  if (from === address) return null;

  let plain: string | undefined;
  let html: string | undefined;
  const attachments: InboundAttachment[] = [];
  const walk = async (part: Part): Promise<void> => {
    if (part.filename) {
      const data = part.body?.attachmentId ? (await get(`messages/${encodeURIComponent(message.id as string)}/attachments/${encodeURIComponent(part.body.attachmentId)}`)).body.data : part.body?.data;
      if (typeof data === 'string') attachments.push({ filename: part.filename, contentType: part.mimeType ?? 'application/octet-stream', content: new Uint8Array(Buffer.from(data, 'base64url')) });
    } else if (part.mimeType === 'text/plain' && part.body?.data !== undefined) {
      plain ??= Buffer.from(part.body.data, 'base64url').toString('utf8');
    } else if (part.mimeType === 'text/html' && part.body?.data !== undefined) {
      html ??= Buffer.from(part.body.data, 'base64url').toString('utf8');
    }
    for (const child of part.parts ?? []) await walk(child);
  };
  await walk(payload);

  const subject = header('subject').trim();
  const body = withoutQuotedReply((plain ?? htmlToText(html ?? '')).replace(/\r\n/g, '\n'));
  const isReply = /^(re|fwd?):/i.test(subject);
  return {
    providerMessageId: `gmail:${address}:${message.id}`,
    agencyChannel: address,
    channelType: 'email',
    from,
    text: subject && !isReply ? `${subject}\n\n${body}` : body,
    attachments,
    receivedAt: new Date(Number(message.internalDate)),
  };
}
