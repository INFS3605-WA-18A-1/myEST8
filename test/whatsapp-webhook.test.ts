import { createHmac, generateKeyPairSync } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { createHttpApp } from '../src/http.ts';
import { all } from '../src/db.ts';
import { TOM, world } from './support/world.ts';

const APP_SECRET = 'meta-app-secret';
const VERIFY_TOKEN = 'verify-me';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

async function server(options: { whatsapp?: boolean } = { whatsapp: true }) {
  const w = await world();
  const download = vi.fn(async () => ({ content: JPEG, contentType: 'image/jpeg' }));
  const http = createHttpApp(w.h.app, {
    publicUrl: 'https://myest8.test',
    twilioAuthToken: 'twilio-token',
    sendgridPublicKey: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    clock: w.h.clock,
    ...(options.whatsapp ? { whatsapp: { appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, download } } : {}),
  });
  return { ...w, http, download };
}

const payload = (messages: unknown[], extra: object = {}) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '61290000000', phone_number_id: 'PNID' }, messages, ...extra } }] }],
});
const text = (id: string, body: string) => ({ from: '61400000001', id, timestamp: '1791420000', type: 'text', text: { body } });
const signed = (body: string) => `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;

function post(http: Awaited<ReturnType<typeof server>>['http'], body: string, signature: string | null = signed(body)) {
  return http.request('/webhooks/whatsapp', { method: 'POST', headers: { 'content-type': 'application/json', ...(signature ? { 'x-hub-signature-256': signature } : {}) }, body });
}
const stored = (w: { h: { db: Parameters<typeof all>[0] } }) => all<{ provider_message_id: string; sender: string; channel_type: string }>(w.h.db, 'SELECT provider_message_id, sender, channel_type FROM inbound_messages ORDER BY id');

describe('POST /webhooks/whatsapp', () => {
  test('a signed message is stored for the Agency’s WhatsApp number and handled by the worker', async () => {
    const w = await server();
    w.h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    const res = await post(w.http, JSON.stringify(payload([text('wamid.1', 'The kitchen tap is dripping')])));
    expect(res.status).toBe(200);
    await w.h.drain();
    expect(await stored(w)).toEqual([{ provider_message_id: 'wamid.1', sender: TOM, channel_type: 'whatsapp' }]);
  });

  test('the same delivery twice is processed once', async () => {
    const w = await server();
    w.h.classifier.when('Hello', { messageClass: 'other' });
    const body = JSON.stringify(payload([text('wamid.2', 'Hello')]));
    expect((await post(w.http, body)).status).toBe(200);
    expect((await post(w.http, body)).status).toBe(200);
    await w.h.drain();
    expect(await stored(w)).toHaveLength(1);
  });

  test('a missing or wrong signature is refused and nothing is stored', async () => {
    const w = await server();
    const body = JSON.stringify(payload([text('wamid.3', 'Hello')]));
    expect((await post(w.http, body, null)).status).toBe(403);
    expect((await post(w.http, body, `sha256=${'0'.repeat(64)}`)).status).toBe(403);
    expect((await post(w.http, body + ' ', signed(body))).status).toBe(403);
    expect(await stored(w)).toEqual([]);
  });

  test('delivery receipts are accepted and ignored', async () => {
    const w = await server();
    const body = JSON.stringify(payload([], { statuses: [{ id: 'wamid.OUT', status: 'delivered', timestamp: '1791420000', recipient_id: '61400000001' }] }));
    expect((await post(w.http, body)).status).toBe(200);
    expect(await stored(w)).toEqual([]);
  });

  test('a photo is downloaded before the request is answered', async () => {
    const w = await server();
    w.h.classifier.when('', { messageClass: 'update', updateType: 'general' });
    const body = JSON.stringify(payload([{ from: '61400000001', id: 'wamid.4', timestamp: '1791420000', type: 'image', image: { id: 'MEDIA1', mime_type: 'image/jpeg' } }]));
    expect((await post(w.http, body)).status).toBe(200);
    expect(w.download).toHaveBeenCalledWith('MEDIA1');
  });

  test('a body that is not JSON is a 400, and a huge one a 413', async () => {
    const w = await server();
    expect((await post(w.http, 'not json')).status).toBe(400);
    const huge = JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 10) });
    expect((await post(w.http, huge)).status).toBe(413);
  });

  test('a download that fails is a 500 so Meta delivers it again', async () => {
    const w = await server();
    w.download.mockRejectedValueOnce(new Error('media expired'));
    const body = JSON.stringify(payload([{ from: '61400000001', id: 'wamid.5', timestamp: '1791420000', type: 'image', image: { id: 'MEDIA2', mime_type: 'image/jpeg' } }]));
    expect((await post(w.http, body)).status).toBe(500);
    expect(await stored(w)).toEqual([]);
  });
});

describe('GET /webhooks/whatsapp', () => {
  const verify = (http: Awaited<ReturnType<typeof server>>['http'], token: string) =>
    http.request(`/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1158201444`);

  test('answers Meta’s handshake with the challenge', async () => {
    const { http } = await server();
    const res = await verify(http, VERIFY_TOKEN);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('1158201444');
  });

  test('refuses the wrong verify token', async () => {
    const { http } = await server();
    expect((await verify(http, 'guess')).status).toBe(403);
  });
});

describe('without WhatsApp configured', () => {
  test('the webhook does not exist', async () => {
    const { http } = await server({});
    expect((await http.request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=&hub.challenge=1')).status).toBe(404);
    expect((await post(http, '{}')).status).toBe(404);
  });
});
