import { describe, expect, test } from 'vitest';
import {
  buildRawMessage,
  createGmailClient,
  fromBase64Url,
  GmailAuthError,
  GmailHistoryExpiredError,
  messageText,
  toBase64Url,
  withoutQuotedReply,
} from '../../src/adapters/gmail.ts';
import { json, stubFetch } from './stub-fetch.ts';

const client = (respond: (r: Request) => Response) => {
  const stub = stubFetch(respond);
  return { stub, gmail: createGmailClient({ clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://x.test/oauth/google/callback', fetch: stub.fetch }) };
};

describe('Google OAuth', () => {
  test('the consent URL asks for offline access, consent and the Gmail scopes, and carries state', () => {
    const { gmail } = client(() => json({}));
    const url = new URL(gmail.authUrl('abc.setup'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('abc.setup');
    expect(url.searchParams.get('client_id')).toBe('cid');
  });

  test('exchanges a code and refreshes a token; invalid_grant is a GmailAuthError', async () => {
    const { gmail, stub } = client((r) =>
      r.url.endsWith('/token') ? json({ access_token: 'at', refresh_token: 'rt' }) : json({}),
    );
    expect(await gmail.exchangeCode('the-code')).toEqual({ accessToken: 'at', refreshToken: 'rt' });
    const form = new URLSearchParams(await stub.requests[0]!.text());
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('the-code');

    const refused = client(() => json({ error: 'invalid_grant' }, 400));
    await expect(refused.gmail.refresh('rt')).rejects.toBeInstanceOf(GmailAuthError);
  });
});

describe('history', () => {
  test('pages through nextPageToken and returns the newest history id', async () => {
    const { gmail, stub } = client((r) => {
      const url = new URL(r.url);
      return url.searchParams.get('pageToken')
        ? json({ history: [{ messagesAdded: [{ message: { id: 'm2' } }, { message: { id: 'm1' } }] }], historyId: '30' })
        : json({ history: [{ messagesAdded: [{ message: { id: 'm1' } }] }], nextPageToken: 'p2', historyId: '20' });
    });
    expect(await gmail.history('at', '10')).toEqual({ messageIds: ['m1', 'm2'], historyId: '30' });
    const first = new URL(stub.requests[0]!.url);
    expect(first.searchParams.get('historyTypes')).toBe('messageAdded');
    expect(first.searchParams.get('labelId')).toBe('INBOX');
    expect(first.searchParams.get('startHistoryId')).toBe('10');
    expect(stub.requests[0]!.headers.get('authorization')).toBe('Bearer at');
  });

  test('a 404 means the history id is too old', async () => {
    const { gmail } = client(() => new Response('not found', { status: 404 }));
    await expect(gmail.history('at', '1')).rejects.toBeInstanceOf(GmailHistoryExpiredError);
  });
});

describe('reading mail', () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64url');

  test('prefers text/plain and removes the quoted reply', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: b64('<p>html version</p>') } },
        { mimeType: 'text/plain', body: { data: b64('YES\r\n\r\nOn Tue, 6 Oct 2026 at 9:00 am, Kev <k@x.test> wrote:\r\n> earlier text\r\n') } },
      ],
    };
    expect(messageText(payload)).toBe('YES');
  });

  test('falls back to HTML with the tags stripped', () => {
    expect(messageText({ mimeType: 'text/html', body: { data: b64('<div>Tap is <b>leaking</b><br>&amp; dripping</div>') } })).toBe('Tap is leaking\n& dripping');
  });

  test('drops lines starting with >', () => {
    expect(withoutQuotedReply('hello\n> quoted\nbye')).toBe('hello\nbye');
  });

  test('fetches an attachment', async () => {
    const { gmail, stub } = client(() => json({ data: toBase64Url(new Uint8Array([1, 2, 255])) }));
    expect([...(await gmail.attachment('at', 'm1', 'a1'))]).toEqual([1, 2, 255]);
    expect(new URL(stub.requests[0]!.url).pathname).toMatch(/messages\/m1\/attachments\/a1$/);
  });
});

describe('sending', () => {
  const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');

  test('a plain message has an encoded UTF-8 subject and a base64 text/plain body', () => {
    const mime = decode(buildRawMessage({ from: 'a@x.test', to: 'b@x.test', cc: ['c@x.test'], subject: 'Café tap', text: 'Hello ☺', attachments: [] }));
    expect(mime).toContain('From: a@x.test');
    expect(mime).toContain('Cc: c@x.test');
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from('Café tap').toString('base64')}?=`);
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(mime).not.toContain('multipart');
    expect(Buffer.from(mime.split('\r\n\r\n')[1]!.replace(/\r\n/g, ''), 'base64').toString()).toBe('Hello ☺');
  });

  test('attachments make it multipart/mixed', () => {
    const mime = decode(
      buildRawMessage({
        from: 'a@x.test',
        to: 'b@x.test',
        cc: [],
        subject: 'Photo',
        text: 'See attached',
        attachments: [{ filename: 'tap.jpg', contentType: 'image/jpeg', content: new Uint8Array([9, 8, 7]) }],
      }),
    );
    expect(mime).toContain('Content-Type: multipart/mixed; boundary=');
    expect(mime).toContain('Content-Disposition: attachment; filename="tap.jpg"');
    expect(mime).toContain(Buffer.from([9, 8, 7]).toString('base64'));
    expect(fromBase64Url(toBase64Url('x'))).toEqual(new Uint8Array([120]));
  });
});
