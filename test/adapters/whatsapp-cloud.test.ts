import { createHmac } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import {
  createWhatsAppMediaFetcher,
  createWhatsAppMessenger,
  verifyWhatsAppSignature,
  whatsappChallenge,
  whatsappFailures,
  whatsappToInbound,
} from '../../src/adapters/whatsapp-cloud.ts';
import { UndeliverableError, type OutboundMessage } from '../../src/ports.ts';
import { json, stubFetch } from './stub-fetch.ts';

const PHONE_NUMBER_ID = '106540352242922';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

describe('WhatsApp webhook signature', () => {
  const secret = 'app-secret-from-meta';
  const body = new TextEncoder().encode('{"object":"whatsapp_business_account"}');
  const header = (s: string, b: Uint8Array) => `sha256=${createHmac('sha256', s).update(b).digest('hex')}`;

  test('accepts the app secret signing the raw body', () => {
    expect(verifyWhatsAppSignature(secret, body, header(secret, body))).toBe(true);
  });

  test('refuses a missing header, a wrong secret, a changed body and a header without sha256=', () => {
    expect(verifyWhatsAppSignature(secret, body, undefined)).toBe(false);
    expect(verifyWhatsAppSignature(secret, body, header('another-secret', body))).toBe(false);
    expect(verifyWhatsAppSignature(secret, new TextEncoder().encode('{"object":"x"}'), header(secret, body))).toBe(false);
    expect(verifyWhatsAppSignature(secret, body, header(secret, body).replace('sha256=', ''))).toBe(false);
    expect(verifyWhatsAppSignature(secret, body, 'sha256=nothex')).toBe(false);
  });

  test('refuses everything when no app secret is configured', () => {
    expect(verifyWhatsAppSignature('', body, header('', body))).toBe(false);
  });
});

describe('WhatsApp webhook verification handshake', () => {
  test('answers with the challenge when mode and verify token match', () => {
    expect(whatsappChallenge('verify-me', { mode: 'subscribe', token: 'verify-me', challenge: '1158201444' })).toBe('1158201444');
  });

  test('answers nothing for another token, another mode, a missing challenge or no configured token', () => {
    expect(whatsappChallenge('verify-me', { mode: 'subscribe', token: 'wrong', challenge: '1' })).toBeNull();
    expect(whatsappChallenge('verify-me', { mode: 'unsubscribe', token: 'verify-me', challenge: '1' })).toBeNull();
    expect(whatsappChallenge('verify-me', { mode: 'subscribe', token: 'verify-me' })).toBeNull();
    expect(whatsappChallenge('', { mode: 'subscribe', token: '', challenge: '1' })).toBeNull();
  });
});

const metadata = { display_phone_number: '15551234567', phone_number_id: PHONE_NUMBER_ID };
const webhook = (messages: unknown[], extra: Record<string, unknown> = {}, meta: unknown = metadata) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          field: 'messages',
          value: { messaging_product: 'whatsapp', metadata: meta, contacts: [{ profile: { name: 'Ruby Russo' }, wa_id: '61400000009' }], messages, ...extra },
        },
      ],
    },
  ],
});
const noMedia = async () => {
  throw new Error('no media expected');
};

describe('WhatsApp inbound webhook', () => {
  test('a text message becomes an inbound message with E.164 numbers', async () => {
    const payload = webhook([{ from: '61400000009', id: 'wamid.HBgLNjE0', timestamp: '1791420000', type: 'text', text: { body: 'The window frame is mouldy' } }]);
    expect(await whatsappToInbound(payload, noMedia)).toEqual([
      {
        providerMessageId: 'wamid.HBgLNjE0',
        agencyChannel: '+15551234567',
        channelType: 'whatsapp',
        from: '+61400000009',
        text: 'The window frame is mouldy',
        attachments: [],
        receivedAt: new Date(1791420000 * 1000),
      },
    ]);
  });

  test('a formatted display number is reduced to E.164', async () => {
    const payload = webhook([{ from: '61400000009', id: 'wamid.1', timestamp: '1791420000', type: 'text', text: { body: 'hi' } }], {}, {
      display_phone_number: '+1 555-123-4567',
      phone_number_id: PHONE_NUMBER_ID,
    });
    expect((await whatsappToInbound(payload, noMedia))[0]!.agencyChannel).toBe('+15551234567');
  });

  test('a photo is downloaded now and attached with its caption as the text', async () => {
    const fetchMedia = vi.fn(async () => ({ content: JPEG, contentType: 'image/jpeg' }));
    const payload = webhook([
      { from: '61400000009', id: 'wamid.2', timestamp: '1791420000', type: 'image', image: { id: 'MEDIA1', mime_type: 'image/jpeg', caption: 'Here it is' } },
    ]);
    const [message] = await whatsappToInbound(payload, fetchMedia);
    expect(fetchMedia).toHaveBeenCalledWith('MEDIA1');
    expect(message!.text).toBe('Here it is');
    expect(message!.attachments).toEqual([{ filename: 'image-MEDIA1.jpg', contentType: 'image/jpeg', content: JPEG }]);
  });

  test('a document keeps its file name, and a photo without a caption has empty text', async () => {
    const payload = webhook([
      { from: '61400000009', id: 'wamid.3', timestamp: '1791420000', type: 'document', document: { id: 'MEDIA2', mime_type: 'application/pdf', filename: 'Receipt.pdf' } },
      { from: '61400000009', id: 'wamid.4', timestamp: '1791420001', type: 'image', image: { id: 'MEDIA3', mime_type: 'image/png' } },
    ]);
    const fetchMedia = async (id: string) => (id === 'MEDIA2' ? { content: PDF, contentType: 'application/pdf' } : { content: JPEG, contentType: 'image/png' });
    const [doc, image] = await whatsappToInbound(payload, fetchMedia);
    expect(doc!.attachments).toEqual([{ filename: 'Receipt.pdf', contentType: 'application/pdf', content: PDF }]);
    expect(image!.text).toBe('');
    expect(image!.attachments[0]!.filename).toBe('image-MEDIA3.png');
  });

  test('delivery receipts, reactions and unsupported types are ignored', async () => {
    const statuses = webhook([], { statuses: [{ id: 'wamid.OUT1', status: 'delivered', timestamp: '1791420000', recipient_id: '61400000009' }] });
    expect(await whatsappToInbound(statuses, noMedia)).toEqual([]);
    const ignored = webhook([
      { from: '61400000009', id: 'wamid.5', timestamp: '1791420000', type: 'reaction', reaction: { message_id: 'wamid.OUT1', emoji: '👍' } },
      { from: '61400000009', id: 'wamid.6', timestamp: '1791420000', type: 'unsupported' },
    ]);
    expect(await whatsappToInbound(ignored, noMedia)).toEqual([]);
  });

  test('messages in several entries come back in order', async () => {
    const one = webhook([{ from: '61400000009', id: 'wamid.A', timestamp: '1791420000', type: 'text', text: { body: 'a' } }]);
    const two = webhook([{ from: '61400000009', id: 'wamid.B', timestamp: '1791420001', type: 'text', text: { body: 'b' } }]);
    const both = { ...one, entry: [...one.entry, ...two.entry] };
    expect((await whatsappToInbound(both, noMedia)).map((m) => m.providerMessageId)).toEqual(['wamid.A', 'wamid.B']);
  });

  test('a body that is not a WhatsApp webhook is malformed', async () => {
    await expect(whatsappToInbound('nope', noMedia)).rejects.toThrow(/malformed/);
    await expect(whatsappToInbound({ object: 'page', entry: [] }, noMedia)).rejects.toThrow(/malformed/);
  });
});

describe('WhatsApp delivery failures', () => {
  test('a failed status names the recipient and why; delivered and read statuses are not failures', () => {
    const failed = webhook([], {
      statuses: [
        { id: 'wamid.OUT1', status: 'delivered', recipient_id: '61400000009' },
        {
          id: 'wamid.OUT2',
          status: 'failed',
          recipient_id: '61432855883',
          errors: [{ code: 131047, title: 'Re-engagement message', error_data: { details: 'More than 24 hours have passed since the recipient last replied.' } }],
        },
      ],
    });
    expect(whatsappFailures(failed)).toEqual([{ to: '+61432855883', reason: '131047 Re-engagement message More than 24 hours have passed since the recipient last replied.' }]);
    expect(whatsappFailures({ object: 'page' })).toEqual([]);
  });
});

describe('WhatsApp media download', () => {
  test('looks the media id up, then downloads the file, both with the token', async () => {
    const stub = stubFetch((request) =>
      request.url === 'https://graph.facebook.com/v23.0/MEDIA1'
        ? json({ id: 'MEDIA1', url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'image/jpeg', file_size: 4 })
        : new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }),
    );
    const fetchMedia = createWhatsAppMediaFetcher({ token: 'EAAG-test', fetch: stub.fetch });
    expect(await fetchMedia('MEDIA1')).toEqual({ content: JPEG, contentType: 'image/jpeg' });
    expect(stub.requests.map((r) => r.url)).toEqual([
      'https://graph.facebook.com/v23.0/MEDIA1',
      'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1',
    ]);
    expect(stub.requests.every((r) => r.headers.get('authorization') === 'Bearer EAAG-test')).toBe(true);
  });

  test('a lookup without a url is malformed, and a failed download throws', async () => {
    const noUrl = createWhatsAppMediaFetcher({ token: 't', fetch: stubFetch(() => json({ id: 'MEDIA1' })).fetch });
    await expect(noUrl('MEDIA1')).rejects.toThrow(/malformed/);
    const gone = createWhatsAppMediaFetcher({
      token: 't',
      fetch: stubFetch((r) => (r.url.includes('lookaside') ? new Response('expired', { status: 404 }) : json({ url: 'https://lookaside.fbsbx.com/x', mime_type: 'image/jpeg' }))).fetch,
    });
    await expect(gone('MEDIA1')).rejects.toThrow(/404/);
  });
});

const message = (overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
  agencyId: 1,
  channelType: 'whatsapp',
  from: '+15551234567',
  to: '+61400000009',
  cc: [],
  subject: '',
  text: 'Hi Ruby, your repair is booked for Wednesday 9am.',
  template: 'tenant.visit',
  data: {},
  attachments: [],
  ...overrides,
});

const sent = () => json({ messaging_product: 'whatsapp', contacts: [{ input: '+61400000009', wa_id: '61400000009' }], messages: [{ id: 'wamid.OUT1' }] });

function whatsapp(respond: (request: Request) => Response = sent) {
  const stub = stubFetch(respond);
  return { stub, messenger: createWhatsAppMessenger({ token: 'EAAG-test', phoneNumberId: PHONE_NUMBER_ID, fetch: stub.fetch }) };
}

describe('WhatsApp outbound', () => {
  test('posts a text message to the phone number id with the token', async () => {
    const { stub, messenger } = whatsapp();
    await messenger.send(message());
    const request = stub.requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe(`https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`);
    expect(request.headers.get('authorization')).toBe('Bearer EAAG-test');
    expect(await request.json()).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+61400000009',
      type: 'text',
      text: { body: 'Hi Ruby, your repair is booked for Wednesday 9am.', preview_url: false },
    });
  });

  test('puts the plus on a bare number', async () => {
    const { stub, messenger } = whatsapp();
    await messenger.send(message({ to: '61400000009' }));
    expect(((await stub.requests[0]!.json()) as { to: string }).to).toBe('+61400000009');
  });

  test('a typed number with spaces or a leading 0 goes as E.164', async () => {
    const { stub, messenger } = whatsapp();
    await messenger.send(message({ to: '+61 432855883' }));
    await messenger.send(message({ to: '0432 855 883' }));
    for (const request of stub.requests) expect(((await request.json()) as { to: string }).to).toBe('+61432855883');
  });

  test('the onboarding test message goes as the approved sample template, which reaches a phone that has never messaged us', async () => {
    const { stub, messenger } = whatsapp();
    await messenger.send(message({ template: 'onboarding.test_message', text: 'This is a test message from Harbour Realty on myEST8.' }));
    expect(stub.requests).toHaveLength(1);
    expect(await stub.requests[0]!.json()).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+61400000009',
      type: 'template',
      template: { name: 'hello_world', language: { code: 'en_US' } },
    });
  });

  test('sends each attachment as its own message after uploading it', async () => {
    const { stub, messenger } = whatsapp((request) => (request.url.endsWith('/media') ? json({ id: 'MEDIA9' }) : sent()));
    await messenger.send(
      message({
        attachments: [
          { filename: 'Quote-1042.pdf', contentType: 'application/pdf', content: PDF },
          { filename: 'tap.jpg', contentType: 'image/jpeg', content: JPEG },
        ],
      }),
    );
    expect(stub.requests.map((r) => new URL(r.url).pathname.split('/').pop())).toEqual(['messages', 'media', 'messages', 'media', 'messages']);
    const upload = await stub.requests[1]!.formData();
    expect(upload.get('messaging_product')).toBe('whatsapp');
    expect(upload.get('type')).toBe('application/pdf');
    expect(upload.get('file')).toBeInstanceOf(File);
    expect(await stub.requests[2]!.json()).toMatchObject({ type: 'document', to: '+61400000009', document: { id: 'MEDIA9', filename: 'Quote-1042.pdf' } });
    expect(await stub.requests[4]!.json()).toMatchObject({ type: 'image', image: { id: 'MEDIA9' } });
  });

  test('a recipient Meta will never deliver to is undeliverable, so the worker stops retrying', async () => {
    for (const code of [131026, 131030, 131047, 131050]) {
      const { messenger } = whatsapp(() => json({ error: { message: 'nope', type: 'OAuthException', code } }, 400));
      await expect(messenger.send(message())).rejects.toBeInstanceOf(UndeliverableError);
    }
  });

  test('a rate limit or an outage throws an ordinary error, so the worker retries, without the token in it', async () => {
    for (const response of [json({ error: { message: 'Pair rate limit hit', code: 131056 } }, 400), new Response('bad gateway', { status: 502 })]) {
      const { messenger } = whatsapp(() => response.clone());
      const error = await messenger.send(message()).catch((e: unknown) => e as Error);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(UndeliverableError);
      expect((error as Error).message).not.toContain('EAAG-test');
    }
  });
});
