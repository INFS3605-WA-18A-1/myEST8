// Gmail as an Agency's email channel (ADR 0004): Google OAuth, reading new inbox
// mail through the history API, and sending RFC 2822 messages. A thin client over
// an injectable `fetch`; storing tokens and mapping mail to messages is src/mailboxes.ts.

import type { OutboundAttachment } from '../ports.ts';
import { htmlToText, withoutQuotedReply } from './email-text.ts';

export { withoutQuotedReply };

const GMAIL_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Google refused the stored refresh token (revoked, or expired in Testing mode): the Agency must connect again. */
export class GmailAuthError extends Error {
  constructor(message = 'Google refused the stored token (invalid_grant)') {
    super(message);
    this.name = 'GmailAuthError';
  }
}

/** The history id is too old for Gmail to list from; start again from the current one. */
export class GmailHistoryExpiredError extends Error {
  constructor() {
    super('Gmail history id expired');
    this.name = 'GmailHistoryExpiredError';
  }
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
}

export interface TokenSet {
  accessToken: string;
  /** Present on the code exchange only. */
  refreshToken?: string;
}

export interface GmailClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: typeof fetch;
}

export function createGmailClient(config: GmailClientConfig) {
  const doFetch = config.fetch ?? fetch;

  async function token(params: Record<string, string>): Promise<TokenSet> {
    const response = await doFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }),
    });
    const body = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
    if (!response.ok || !body.access_token) {
      if (body.error === 'invalid_grant') throw new GmailAuthError();
      throw new Error(`Google token request failed (${response.status}): ${body.error_description ?? body.error ?? 'no detail'}`);
    }
    return { accessToken: body.access_token, refreshToken: body.refresh_token };
  }

  async function api<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
    const response = await doFetch(`${API}/${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });
    if (response.status === 401) throw new GmailAuthError('Gmail rejected the access token');
    if (!response.ok) throw new Error(`Gmail ${path.split('?')[0]} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    return (await response.json()) as T;
  }

  return {
    authUrl(state: string) {
      const url = new URL(AUTH_URL);
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: GMAIL_SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state,
      }).toString();
      return url.toString();
    },

    exchangeCode: (code: string) => token({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri }),

    async refresh(refreshToken: string): Promise<string> {
      return (await token({ grant_type: 'refresh_token', refresh_token: refreshToken })).accessToken;
    },

    profile: (accessToken: string) => api<{ emailAddress: string; historyId: string }>(accessToken, 'profile'),

    /** The ids of messages added to the inbox after `startHistoryId`, and the newest history id. Throws GmailHistoryExpiredError on a 404. */
    async history(accessToken: string, startHistoryId: string): Promise<{ messageIds: string[]; historyId: string }> {
      const ids = new Set<string>();
      let historyId = startHistoryId;
      let pageToken: string | undefined;
      do {
        const query = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', labelId: 'INBOX' });
        if (pageToken) query.set('pageToken', pageToken);
        let page: { history?: { messagesAdded?: { message: { id: string } }[] }[]; nextPageToken?: string; historyId?: string };
        try {
          page = await api(accessToken, `history?${query}`);
        } catch (error) {
          if (error instanceof Error && / failed \(404\)/.test(error.message)) throw new GmailHistoryExpiredError();
          throw error;
        }
        for (const entry of page.history ?? []) for (const added of entry.messagesAdded ?? []) ids.add(added.message.id);
        historyId = page.historyId ?? historyId;
        pageToken = page.nextPageToken;
      } while (pageToken);
      return { messageIds: [...ids], historyId };
    },

    message: (accessToken: string, id: string) => api<GmailMessage>(accessToken, `messages/${encodeURIComponent(id)}?format=full`),

    async attachment(accessToken: string, messageId: string, attachmentId: string): Promise<Uint8Array> {
      const body = await api<{ data: string }>(accessToken, `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
      return fromBase64Url(body.data);
    },

    async send(accessToken: string, raw: string): Promise<void> {
      await api(accessToken, 'messages/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
    },
  };
}

export type GmailClient = ReturnType<typeof createGmailClient>;

// Encoding

export const toBase64Url = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64url');
export const fromBase64Url = (data: string) => new Uint8Array(Buffer.from(data, 'base64url'));

const wrap76 = (base64: string) => base64.replace(/(.{76})/g, '$1\r\n');
const encodeHeader = (value: string) => `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
const safeHeader = (value: string) => value.replace(/[\r\n]+/g, ' ');

/** The base64url RFC 2822 message Gmail's send takes. */
export function buildRawMessage(m: { from: string; to: string; cc: string[]; subject: string; text: string; attachments: OutboundAttachment[] }): string {
  const headers = [`From: ${safeHeader(m.from)}`, `To: ${safeHeader(m.to)}`];
  if (m.cc.length) headers.push(`Cc: ${m.cc.map(safeHeader).join(', ')}`);
  headers.push(`Subject: ${encodeHeader(m.subject)}`, 'MIME-Version: 1.0');
  const textPart = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(m.text, 'utf8').toString('base64'))];

  if (!m.attachments.length) return toBase64Url([...headers, ...textPart].join('\r\n'));

  const boundary = `myest8-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const parts = [textPart.join('\r\n')];
  for (const file of m.attachments) {
    const name = safeHeader(file.filename).replace(/"/g, "'");
    parts.push(
      [
        `Content-Type: ${safeHeader(file.contentType)}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        'Content-Transfer-Encoding: base64',
        '',
        wrap76(Buffer.from(file.content).toString('base64')),
      ].join('\r\n'),
    );
  }
  const body = parts.map((part) => `--${boundary}\r\n${part}\r\n`).join('') + `--${boundary}--\r\n`;
  return toBase64Url([...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', body].join('\r\n'));
}

// Reading

export const header = (part: GmailPart | undefined, name: string) =>
  part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

function find(part: GmailPart, mimeType: string): GmailPart | undefined {
  if (part.mimeType === mimeType && !part.filename && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = find(child, mimeType);
    if (found) return found;
  }
  return undefined;
}

/** The message's readable text: text/plain if there is one, otherwise the HTML with tags removed; quoted replies removed. */
export function messageText(payload: GmailPart): string {
  const plain = find(payload, 'text/plain');
  const htmlPart = find(payload, 'text/html');
  const raw = plain
    ? Buffer.from(plain.body!.data!, 'base64url').toString('utf8')
    : htmlPart
      ? htmlToText(Buffer.from(htmlPart.body!.data!, 'base64url').toString('utf8'))
      : '';
  return withoutQuotedReply(raw.replace(/\r\n/g, '\n'));
}

/** The files attached to a message (parts with a filename), by Gmail attachment id or inline data. */
export function attachmentParts(payload: GmailPart): { filename: string; contentType: string; attachmentId?: string; data?: string }[] {
  const out: { filename: string; contentType: string; attachmentId?: string; data?: string }[] = [];
  const walk = (part: GmailPart) => {
    if (part.filename && (part.body?.attachmentId || part.body?.data)) {
      out.push({
        filename: part.filename,
        contentType: part.mimeType || 'application/octet-stream',
        attachmentId: part.body.attachmentId,
        data: part.body.data,
      });
    }
    part.parts?.forEach(walk);
  };
  walk(payload);
  return out;
}
