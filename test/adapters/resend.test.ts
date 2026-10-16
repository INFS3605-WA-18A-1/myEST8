import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { resendInboundConfig, resendToInbound, verifyResendSignature } from '../../src/adapters/resend.ts';
import { createDemo } from '../../src/demo/runtime.ts';
import { json, stubFetch } from './stub-fetch.ts';

// Svix's published manual-verification example. A documentation vector, not a credential.
const VECTOR = {
  secret: 'whsec_plJ3nmyCDGBKInavdOK15jsl',
  body: new TextEncoder().encode('{"event_type":"ping","data":{"success":true}}'),
  id: 'msg_loFOjxBNrRLzqYUf',
  timestamp: '1731705121',
  signature: 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=',
};
const vectorNow = new Date(Number(VECTOR.timestamp) * 1000);

const secretBytes = randomBytes(24);
const SECRET = `whsec_${secretBytes.toString('base64')}`;

function sign(id: string, timestamp: string, body: Uint8Array, key: Uint8Array = secretBytes) {
  const signed = `${id}.${timestamp}.${new TextDecoder().decode(body)}`;
  return `v1,${createHmac('sha256', key).update(signed).digest('base64')}`;
}

const headers = (signature: string, timestamp = '1700000000', id = 'msg_test') => ({ id, timestamp, signature });

describe('Resend webhook signatures', () => {
  test('accepts the Svix manual example inside the five-minute window', () => {
    expect(verifyResendSignature(VECTOR.secret, VECTOR.body, { id: VECTOR.id, timestamp: VECTOR.timestamp, signature: VECTOR.signature }, vectorNow)).toBe(true);
  });

  test('accepts a locally signed body, including one matching signature among several', () => {
    const body = new TextEncoder().encode('{"type":"email.received"}');
    const good = sign('msg_test', '1700000000', body);
    const now = new Date(1_700_000_000 * 1000);
    expect(verifyResendSignature(SECRET, body, headers(good), now)).toBe(true);
    expect(verifyResendSignature(SECRET, body, headers(`v1,${'a'.repeat(8)} ${good} v2,bm90LXRoaXM=`), now)).toBe(true);
    expect(verifyResendSignature(secretBytes.toString('base64'), body, headers(good), now)).toBe(true);
  });

  test('rejects a wrong, missing, other-secret, or different-length signature', () => {
    const body = new TextEncoder().encode('{"type":"email.received"}');
    const good = sign('msg_test', '1700000000', body);
    const now = new Date(1_700_000_000 * 1000);
    expect(verifyResendSignature(SECRET, body, headers(`${good.slice(0, -1)}A`), now)).toBe(false);
    expect(verifyResendSignature(SECRET, body, headers(''), now)).toBe(false);
    expect(verifyResendSignature(`whsec_${randomBytes(24).toString('base64')}`, body, headers(good), now)).toBe(false);
    expect(verifyResendSignature(SECRET, body, headers('v1,short'), now)).toBe(false);
    expect(verifyResendSignature(SECRET, body, headers('v2,' + good.slice(3)), now)).toBe(false);
    expect(verifyResendSignature(SECRET, new TextEncoder().encode('{"type":"email.received"} '), headers(good), now)).toBe(false);
  });

  test('rejects a timestamp more than five minutes off, and a timestamp that is not a number', () => {
    const body = new TextEncoder().encode('{}');
    const timestamp = '1700000000';
    const signature = sign('msg_test', timestamp, body);
    const at = (seconds: number) => new Date(seconds * 1000);
    expect(verifyResendSignature(SECRET, body, headers(signature, timestamp), at(1_700_000_000 + 300))).toBe(true);
    expect(verifyResendSignature(SECRET, body, headers(signature, timestamp), at(1_700_000_000 - 300))).toBe(true);
    expect(verifyResendSignature(SECRET, body, headers(signature, timestamp), at(1_700_000_000 + 301))).toBe(false);
    expect(verifyResendSignature(SECRET, body, headers(signature, timestamp), at(1_700_000_000 - 301))).toBe(false);
    expect(verifyResendSignature(SECRET, body, headers(signature, 'yesterday'), at(1_700_000_000))).toBe(false);
  });
});

const EMAIL_ID = '4ef9a417-02e9-4d39-ad75-9611e0fcc33c';
const API_KEY = 're_test_not_a_real_key';
const receivedAt = new Date('2026-10-08T09:00:00+11:00');

function receivedEvent(data: Record<string, unknown> = {}) {
  return {
    type: 'email.received',
    created_at: '2026-10-08T09:00:00.000Z',
    data: {
      email_id: EMAIL_ID,
      from: 'onboarding@resend.dev',
      to: ['delivered@resend.dev'],
      subject: 'Shower drain',
      attachments: [],
      ...data,
    },
  };
}

describe('Resend received email', () => {
  test('fetches the received email and maps it to an inbound message', async () => {
    const stub = stubFetch((request) => {
      expect(request.url).toBe(`https://api.resend.com/emails/receiving/${EMAIL_ID}`);
      expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
      return json({
        id: EMAIL_ID,
        from: 'Bella Bui <Bella@Example.com>',
        to: ['Harbour Realty <Inbox@Harbour.example>', 'other@harbour.example'],
        subject: 'Shower drain',
        text: 'The shower drain is blocked',
        html: '<p>ignored because text is set</p>',
        attachments: [],
      });
    });

    const message = await resendToInbound(receivedEvent(), { apiKey: API_KEY, fetch: stub.fetch, receivedAt });

    expect(message).toEqual({
      providerMessageId: `re-${EMAIL_ID}`,
      agencyChannel: 'inbox@harbour.example',
      channelType: 'email',
      from: 'bella@example.com',
      text: 'The shower drain is blocked',
      attachments: [],
      receivedAt,
    });
    expect(stub.requests).toHaveLength(1);
  });

  test('uses HTML when there is no text part, and drops the quoted reply', async () => {
    const stub = stubFetch(() =>
      json({
        id: EMAIL_ID,
        from: 'quotes@quickpipes.example',
        to: ['inbox@harbour.example'],
        subject: 'Re: Quote request',
        text: null,
        html: '<div>YES</div><p>On Tue, 6 Oct 2026 at 9:00,<br>Name &lt;a@b&gt; wrote:</p><p>&gt; earlier text</p>',
        attachments: [],
      }),
    );

    const message = await resendToInbound(receivedEvent(), { apiKey: API_KEY, fetch: stub.fetch, receivedAt });

    expect(message?.text).toBe('YES');
  });

  test('strips a plain-text reply that Gmail wrapped over two lines', async () => {
    const stub = stubFetch(() =>
      json({
        id: EMAIL_ID,
        from: 'bella@example.com',
        to: ['inbox@harbour.example'],
        text: 'YES\r\n\r\nOn Tue, 6 Oct 2026 at 9:00,\r\nName <a@b> wrote:\r\n> earlier text\r\n',
        attachments: [],
      }),
    );

    const message = await resendToInbound(receivedEvent(), { apiKey: API_KEY, fetch: stub.fetch, receivedAt });

    expect(message?.text).toBe('YES');
  });

  test('downloads attachment bytes from the attachments API', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const stub = stubFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === `/emails/receiving/${EMAIL_ID}`) {
        return json({
          id: EMAIL_ID,
          from: 'bella@example.com',
          to: ['inbox@harbour.example'],
          text: 'See attached',
          attachments: [{ id: 'att-1', filename: 'quote.pdf', content_type: 'application/pdf' }],
        });
      }
      if (url.pathname === `/emails/receiving/${EMAIL_ID}/attachments`) {
        expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
        return json({
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'att-1',
              filename: 'quote.pdf',
              content_type: 'application/pdf',
              download_url: 'https://inbound-cdn.resend.com/quote.pdf',
            },
          ],
        });
      }
      expect(request.url).toBe('https://inbound-cdn.resend.com/quote.pdf');
      expect(request.headers.get('authorization')).toBeNull();
      return new Response(pdf);
    });

    const message = await resendToInbound(receivedEvent(), { apiKey: API_KEY, fetch: stub.fetch, receivedAt });

    expect(message?.attachments).toEqual([{ filename: 'quote.pdf', contentType: 'application/pdf', content: pdf }]);
  });

  test('ignores events that are not email.received', async () => {
    const stub = stubFetch(() => json({}));
    expect(await resendToInbound({ type: 'email.sent', data: { email_id: EMAIL_ID } }, { apiKey: API_KEY, fetch: stub.fetch, receivedAt })).toBeNull();
    expect(stub.requests).toEqual([]);
  });

  test('email.received without an id throws before fetching', async () => {
    const stub = stubFetch(() => json({}));
    await expect(resendToInbound({ type: 'email.received', data: {} }, { apiKey: API_KEY, fetch: stub.fetch, receivedAt })).rejects.toThrow(/email_id/);
    expect(stub.requests).toEqual([]);
  });

  test('a truncated attachment list throws instead of dropping files', async () => {
    const stub = stubFetch((request) => {
      if (new URL(request.url).pathname.endsWith('/attachments')) return json({ object: 'list', has_more: true, data: [] });
      return json({ id: EMAIL_ID, from: 'a@b.example', to: ['inbox@harbour.example'], text: 'hi', attachments: [{ id: 'att-1' }] });
    });
    await expect(resendToInbound(receivedEvent(), { apiKey: API_KEY, fetch: stub.fetch, receivedAt })).rejects.toThrow(/truncated/);
  });

  test('a failed fetch throws without echoing the API key', async () => {
    const stub = stubFetch(() => json({ message: `nope ${API_KEY}` }, 500));
    const error = await resendToInbound(receivedEvent(), { apiKey: API_KEY, fetch: stub.fetch, receivedAt }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(API_KEY);
  });
});

describe('Resend env config', () => {
  test('requires the webhook secret and API key together', () => {
    expect(resendInboundConfig({})).toBeNull();
    expect(resendInboundConfig({ RESEND_API_KEY: '  re_test  ', RESEND_WEBHOOK_SECRET: '  whsec_local  ' })).toEqual({
      apiKey: 're_test',
      webhookSecret: 'whsec_local',
    });
    expect(() => resendInboundConfig({ RESEND_API_KEY: 're_test' })).toThrow(/RESEND_WEBHOOK_SECRET/);
    expect(() => resendInboundConfig({ RESEND_WEBHOOK_SECRET: 'whsec_local' })).toThrow(/RESEND_API_KEY/);
  });

  test('startup throws when only one of the pair is set, before opening a database', async () => {
    await expect(createDemo({ env: { RESEND_API_KEY: 're_test' }, seedAgency: false })).rejects.toThrow(/Set both RESEND_WEBHOOK_SECRET and RESEND_API_KEY/);
  });
});
