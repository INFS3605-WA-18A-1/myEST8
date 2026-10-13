import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { createMetaWhatsApp, metaFetchMedia, metaStatusFailures, metaToInbound, verifyMetaSignature } from '../../src/adapters/meta-whatsapp.ts';
import { UndeliverableError, type OutboundMessage } from '../../src/ports.ts';
import { json, stubFetch } from './stub-fetch.ts';

const message = (overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
  channelType: 'whatsapp',
  from: '+61290000000',
  to: '+61400000001',
  cc: [],
  subject: '',
  text: 'Thanks, we got your message.',
  template: 'intake.acknowledged',
  data: {},
  attachments: [],
  ...overrides,
});

function meta(respond: (r: Request) => Response) {
  const stub = stubFetch(respond);
  return { stub, messenger: createMetaWhatsApp({ phoneNumberId: '1055', accessToken: 'tok', fetch: stub.fetch }) };
}
const ok = () => json({ messages: [{ id: 'wamid.OUT' }] });

describe('Meta WhatsApp outbound', () => {
  test('a text message posts to /messages with the digits-only recipient', async () => {
    const { stub, messenger } = meta(ok);
    await messenger.send(message());
    expect(stub.requests).toHaveLength(1);
    const [request] = stub.requests;
    expect(request!.url).toBe('https://graph.facebook.com/v21.0/1055/messages');
    expect(request!.headers.get('authorization')).toBe('Bearer tok');
    expect(await request!.json()).toEqual({
      messaging_product: 'whatsapp',
      to: '61400000001',
      type: 'text',
      text: { body: 'Thanks, we got your message.' },
    });
  });

  test('attachments upload first, then go as image and document messages', async () => {
    const { stub, messenger } = meta((r) => (r.url.endsWith('/media') ? json({ id: 'MEDIA1' }) : ok()));
    await messenger.send(
      message({
        attachments: [
          { filename: 'tap.jpg', contentType: 'image/jpeg', content: new Uint8Array([1, 2]) },
          { filename: 'quote.pdf', contentType: 'application/pdf', content: new Uint8Array([3]) },
        ],
      }),
    );
    expect(stub.requests.map((r) => r.url.split('/').slice(-1)[0])).toEqual(['messages', 'media', 'messages', 'media', 'messages']);
    const upload = await stub.requests[1]!.formData();
    expect(upload.get('messaging_product')).toBe('whatsapp');
    expect((upload.get('file') as File).name).toBe('tap.jpg');
    expect(await stub.requests[2]!.json()).toMatchObject({ type: 'image', image: { id: 'MEDIA1' } });
    expect(await stub.requests[4]!.json()).toMatchObject({ type: 'document', document: { id: 'MEDIA1', filename: 'quote.pdf' } });
  });

  test('an invalid recipient is undeliverable', async () => {
    const { messenger } = meta(() => json({ error: { code: 131026, message: 'Message undeliverable' } }, 400));
    await expect(messenger.send(message())).rejects.toBeInstanceOf(UndeliverableError);
  });

  test('code 100 about the recipient parameter is undeliverable', async () => {
    const { messenger } = meta(() => json({ error: { code: 100, message: 'Invalid parameter', error_data: { details: "Recipient phone number not valid" } } }, 400));
    await expect(messenger.send(message())).rejects.toBeInstanceOf(UndeliverableError);
  });

  test('other failures are plain errors so the worker retries', async () => {
    const { messenger } = meta(() => json({ error: { code: 2, message: 'Service temporarily unavailable' } }, 503));
    const error = await messenger.send(message()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UndeliverableError);
  });
});

describe('Meta signature', () => {
  const body = new TextEncoder().encode('{"a":1}');
  const good = 'sha256=' + createHmac('sha256', 'secret').update(body).digest('hex');
  test('accepts the right signature', () => expect(verifyMetaSignature('secret', body, good)).toBe(true));
  test('rejects a wrong, missing or other-secret signature', () => {
    expect(verifyMetaSignature('secret', body, 'sha256=' + '0'.repeat(64))).toBe(false);
    expect(verifyMetaSignature('secret', body, '')).toBe(false);
    expect(verifyMetaSignature('other', body, good)).toBe(false);
  });
});

const payload = (messages: unknown[], statuses: unknown[] = []) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '61 2-9000 0000', phone_number_id: '1055' },
            contacts: [{ profile: { name: 'Tom' }, wa_id: '61400000001' }],
            messages,
            statuses,
          },
        },
      ],
    },
  ],
});
const now = new Date('2026-10-13T00:00:00Z');

describe('metaToInbound', () => {
  test('a text message', () => {
    const body = payload([{ from: '61400000001', id: 'wamid.A', timestamp: '1760313600', type: 'text', text: { body: 'Tap is dripping' } }]);
    expect(metaToInbound(body, now)).toEqual([
      {
        providerMessageId: 'wa-wamid.A',
        agencyChannel: '+61290000000',
        channelType: 'whatsapp',
        from: '+61400000001',
        text: 'Tap is dripping',
        attachments: [],
        receivedAt: new Date(1760313600 * 1000),
      },
    ]);
  });

  test('an image with a caption carries one attachment', () => {
    const body = payload([{ from: '61400000001', id: 'wamid.B', timestamp: '1760313600', type: 'image', image: { id: 'IMG9', mime_type: 'image/jpeg', caption: 'See this' } }]);
    const [m] = metaToInbound(body, now);
    expect(m!.text).toBe('See this');
    expect(m!.attachments).toEqual([{ filename: 'image-IMG9', contentType: 'image/jpeg', url: 'meta-media:IMG9' }]);
  });

  test('a button reply uses its title and non-message fields are ignored', () => {
    const body = payload([{ from: '61400000001', id: 'wamid.C', timestamp: '1760313600', type: 'interactive', interactive: { button_reply: { id: 'y', title: 'Yes' } } }]);
    expect(metaToInbound(body, now)[0]!.text).toBe('Yes');
    const other = { entry: [{ changes: [{ field: 'account_update', value: { messages: [{ from: '1', id: 'x' }] } }] }] };
    expect(metaToInbound(other, now)).toEqual([]);
    expect(metaToInbound('junk', now)).toEqual([]);
  });
});

describe('metaStatusFailures', () => {
  test('returns failed statuses only', () => {
    const body = payload([], [
      { id: 'w1', status: 'delivered', recipient_id: '61400000001' },
      { id: 'w2', status: 'failed', recipient_id: '61400000001', errors: [{ code: 131047, title: 'Re-engagement message' }] },
    ]);
    expect(metaStatusFailures(body)).toEqual([{ to: '+61400000001', code: 131047, title: 'Re-engagement message' }]);
    expect(metaToInbound(body, now)).toEqual([]);
  });
});

describe('metaFetchMedia', () => {
  test('looks up the id, then downloads the url with the token', async () => {
    const stub = stubFetch((r) => (r.url.includes('/v21.0/IMG9') ? json({ url: 'https://lookaside.example/file' }) : new Response(new Uint8Array([7, 8]))));
    const fetchMedia = metaFetchMedia({ accessToken: 'tok', fetch: stub.fetch });
    expect(Array.from(await fetchMedia('meta-media:IMG9'))).toEqual([7, 8]);
    expect(stub.requests.map((r) => r.url)).toEqual(['https://graph.facebook.com/v21.0/IMG9', 'https://lookaside.example/file']);
    expect(stub.requests.every((r) => r.headers.get('authorization') === 'Bearer tok')).toBe(true);
  });

  test('refuses anything else', async () => {
    const fetchMedia = metaFetchMedia({ accessToken: 'tok', fetch: stubFetch(() => json({})).fetch });
    await expect(fetchMedia('https://evil.example/x')).rejects.toThrow();
  });
});
