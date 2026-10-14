import type { GmailMessagePayload } from './fake-gmail-types.ts';

const b64 = (value: string | Uint8Array) => Buffer.from(value).toString('base64url');
const jwt = (claims: object) => ['{"alg":"RS256"}', JSON.stringify(claims), 'sig'].map((p) => Buffer.from(p).toString('base64url')).join('.');
const SCOPE =
  'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';

interface Mailbox {
  historyId: number;
  messages: Map<string, GmailMessagePayload>;
  /** history records: the history id at which a message was added. */
  history: { id: number; messageId: string }[];
  failHistory: boolean;
  revoked: boolean;
  sent: string[];
}

/**
 * A stand-in for Google's OAuth and Gmail APIs with any number of mailboxes. Sign in
 * with the code `code-for-<email>`; tokens are `1//<email>` (refresh) and `ya29.<email>`.
 * Pass `gmail.fetch` as the app's Gmail fetch.
 */
export class FakeGmail {
  /** Every code exchange Google was asked to do. */
  exchanges: { code: string; redirectUri: string; codeVerifier: string }[] = [];
  #boxes = new Map<string, Mailbox>();
  #count = 0;

  mailbox(email: string): Mailbox {
    let box = this.#boxes.get(email);
    if (!box) {
      box = { historyId: 5000, messages: new Map(), history: [], failHistory: false, revoked: false, sent: [] };
      this.#boxes.set(email, box);
    }
    return box;
  }

  /** Puts a new email in the mailbox's inbox. Returns its Gmail message id. */
  deliver(email: string, from: string, subject: string, body: string, labelIds = ['INBOX', 'UNREAD']): string {
    const box = this.mailbox(email);
    const id = `m${++this.#count}`;
    box.historyId += 1;
    box.messages.set(id, {
      id,
      threadId: `t-${id}`,
      labelIds,
      internalDate: String(Date.parse('2026-10-08T09:00:00+11:00') + this.#count * 1000),
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: from },
          { name: 'To', value: email },
          { name: 'Subject', value: subject },
        ],
        body: { data: b64(body) },
      },
    });
    box.history.push({ id: box.historyId, messageId: id });
    return id;
  }

  readonly fetch: typeof globalThis.fetch = async (input, init) => this.#handle(new Request(input, init));

  #json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  async #handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.host === 'oauth2.googleapis.com') return this.#token(new URLSearchParams(await request.text()));
    const token = /^Bearer ya29\.(.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return this.#json({ error: { code: 401 } }, 401);
    const box = this.mailbox(token);
    const path = url.pathname.replace('/gmail/v1/users/me/', '');
    if (path === 'profile') return this.#json({ emailAddress: token, historyId: String(box.historyId) });
    if (path === 'history') {
      if (box.failHistory) return this.#json({ error: { code: 500, message: 'backend error' } }, 500);
      const start = Number(url.searchParams.get('startHistoryId'));
      const records = box.history.filter((h) => h.id > start).map((h) => ({ id: String(h.id), messagesAdded: [{ message: { id: h.messageId, labelIds: ['INBOX'] } }] }));
      return this.#json({ ...(records.length ? { history: records } : {}), historyId: String(box.historyId) });
    }
    if (path === 'messages/send') {
      const { raw } = (await request.json()) as { raw: string };
      box.sent.push(Buffer.from(raw, 'base64url').toString('utf8'));
      return this.#json({ id: `sent${box.sent.length}`, labelIds: ['SENT'] });
    }
    const message = /^messages\/(.+)$/.exec(path)?.[1];
    const found = message ? box.messages.get(message) : undefined;
    return found ? this.#json(found) : this.#json({ error: { code: 404 } }, 404);
  }

  #token(params: URLSearchParams): Response {
    if (params.get('grant_type') === 'authorization_code') {
      this.exchanges.push({ code: params.get('code') ?? '', redirectUri: params.get('redirect_uri') ?? '', codeVerifier: params.get('code_verifier') ?? '' });
      const email = /^code-for-(.+)$/.exec(params.get('code') ?? '')?.[1];
      if (!email) return this.#json({ error: 'invalid_grant' }, 400);
      return this.#json({
        access_token: `ya29.${email}`,
        expires_in: 3599,
        refresh_token: `1//${email}`,
        scope: SCOPE,
        id_token: jwt({ email, email_verified: true }),
      });
    }
    const email = /^1\/\/(.+)$/.exec(params.get('refresh_token') ?? '')?.[1];
    if (!email || this.mailbox(email).revoked) return this.#json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
    return this.#json({ access_token: `ya29.${email}`, expires_in: 3599, scope: SCOPE });
  }
}
