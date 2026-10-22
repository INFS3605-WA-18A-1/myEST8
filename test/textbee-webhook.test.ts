import { describe, expect, test, vi } from 'vitest';
import { createTextbeeMessenger } from '../src/adapters/textbee.ts';
import { all, one } from '../src/db.ts';
import { createHttpApp } from '../src/http.ts';
import { json, stubFetch } from './adapters/stub-fetch.ts';
import { TOM, world } from './support/world.ts';

// A text to the server's textbee phone (ADR 0013). textbee signs the raw body:
// X-Signature is the lowercase-hex HMAC-SHA256 keyed by the webhook secret.
// The hex below was computed once with openssl and pasted in.

const SECRET = 'textbee-webhook-secret-20';
const NUMBER = '+61412345678';
const API_KEY = 'textbee-test-api-key';
const DEVICE_ID = '664a9b8cd0e1f2a3b4c5d6e7';
const RECEIVED_SIGNATURE = 'cb882b6a1408a6ea3ab37c2890f6afd157720061586aab73d279a2d7f1c04af5';
// Lowercase-hex HMAC-SHA256 of SENT with SECRET, computed once with openssl and pasted in.
const SENT_SIGNATURE = '3ada0ad04ed3bbb97af292716f3ed4d74af077125527629c215fe17622d292fe';
// Lowercase-hex HMAC-SHA256 of FROM_PHONE with SECRET, computed once with openssl and pasted in.
const FROM_PHONE_SIGNATURE = '468db3372503b7ccebe10de2df1e8c0acd336a642de9afadb1aa6c2d25d5d07d';

const RECEIVED =
  '{"smsId":"66f7c1e2a4d5e6f7a8b9c0d1","message":"The kitchen tap is dripping","deviceId":"664a9b8cd0e1f2a3b4c5d6e7","webhookSubscriptionId":"664a9b8cd0e1f2a3b4c5d6e8","webhookEvent":"MESSAGE_RECEIVED","idempotencyKey":"8f7e6d5c-4b3a-4c1d-8e9f-8a7b6c5d4e3f","sender":"+61400000001","receivedAt":"2026-10-08T09:14:03.000Z"}';
const SENT =
  '{"smsId":"66f7c3a9b1c2d3e4f5a6b7c8","message":"Your order has shipped.","deviceId":"664a9b8cd0e1f2a3b4c5d6e7","webhookSubscriptionId":"664a9b8cd0e1f2a3b4c5d6e8","webhookEvent":"MESSAGE_SENT","idempotencyKey":"2b4d6f8a-1c3e-4a5b-9d7f-0e2c4a6b8d1f","smsBatchId":"66f7c3a8b1c2d3e4f5a6b7c0","status":"sent","recipient":"+61400000001","sentAt":"2026-09-28T10:02:17.000Z"}';
const FROM_PHONE =
  '{"smsId":"66f7c1e2a4d5e6f7a8b9c0d2","message":"The kitchen tap is dripping","deviceId":"664a9b8cd0e1f2a3b4c5d6e7","webhookSubscriptionId":"664a9b8cd0e1f2a3b4c5d6e8","webhookEvent":"MESSAGE_RECEIVED","idempotencyKey":"1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d","sender":"+61412345678","receivedAt":"2026-10-08T09:14:03.000Z"}';

const queued = () =>
  json({
    data: {
      success: true,
      message: 'SMS added to queue for processing',
      smsBatchId: '66b1f2c3a4d5e6f7a8b9c0d2',
      recipientCount: 1,
    },
  });

/** Harbour Realty, with textbee catching replies. `connected` false leaves the phone's number unconnected. */
async function agency({ connected = true } = {}) {
  const stub = stubFetch(queued);
  const w = await world({ messenger: createTextbeeMessenger({ apiKey: API_KEY, deviceId: DEVICE_ID, fetch: stub.fetch }) });
  if (connected) await w.alice.connectChannel('sms', NUMBER);
  const http = createHttpApp(w.h.app, {
    publicUrl: 'https://myest8.test',
    twilioAuthToken: null,
    sendgridPublicKey: '',
    clock: w.h.clock,
    textbee: { webhookSecret: SECRET, number: NUMBER },
  });

  /** Posts a textbee webhook. `signature` null omits X-Signature. */
  function post(body: string, signature: string | null) {
    return http.request('/webhooks/textbee', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(signature === null ? {} : { 'x-signature': signature }),
      },
      body,
    });
  }

  return { ...w, stub, post };
}

describe('a text received by the textbee phone', () => {
  test('a signed text from a tenant reaches that Agency, and the reply goes out through textbee', async () => {
    const { h, stub, post } = await agency();
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });

    const response = await post(RECEIVED, RECEIVED_SIGNATURE);
    await h.drain();

    expect(response.status).toBe(200);
    expect(await one(h.db, 'SELECT provider_message_id, channel_type, sender, text, attachments, received_at FROM inbound_messages')).toEqual({
      provider_message_id: '66f7c1e2a4d5e6f7a8b9c0d1',
      channel_type: 'sms',
      sender: TOM,
      text: 'The kitchen tap is dripping',
      attachments: '[]',
      received_at: '2026-10-08T09:14:03.000Z',
    });
    expect(stub.requests.map((request) => request.url)).toEqual([
      'https://api.textbee.dev/api/v1/gateway/send-sms',
      'https://api.textbee.dev/api/v1/gateway/send-sms',
    ]);
    expect(stub.requests[0]!.headers.get('x-api-key')).toBe(API_KEY);
    expect(await stub.requests[0]!.json()).toEqual({
      recipients: [TOM],
      message: "Hi Tom, this is Harbour Realty. Thanks for letting us know about an issue at 12 King St, Newtown NSW 2042. We've got your message.",
      deviceId: DEVICE_ID,
    });
    expect(await stub.requests[1]!.json()).toEqual({
      recipients: [TOM],
      message: 'Where in the property is the issue?',
      deviceId: DEVICE_ID,
    });
  });

  test('a wrong signature, a missing signature, and a body changed after signing are each refused and store nothing', async () => {
    const { h, post } = await agency();
    const changed = RECEIVED.replace('dripping', 'drippinx');

    expect((await post(RECEIVED, '0000000000000000000000000000000000000000000000000000000000000000')).status).toBe(401);
    expect((await post(RECEIVED, null)).status).toBe(401);
    expect((await post(changed, RECEIVED_SIGNATURE)).status).toBe(401);

    expect(await all(h.db, 'SELECT id FROM inbound_messages')).toEqual([]);
  });

  test('a sent-message event is acknowledged and stores nothing', async () => {
    const { h, post } = await agency();

    const response = await post(SENT, SENT_SIGNATURE);

    expect(response.status).toBe(200);
    expect(await all(h.db, 'SELECT id FROM inbound_messages')).toEqual([]);
  });

  test('a text before any Agency has connected the number is acknowledged, logged, and stores nothing', async () => {
    const { h, post } = await agency({ connected: false });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const response = await post(RECEIVED, RECEIVED_SIGNATURE);

      expect(response.status).toBe(200);
      expect(await all(h.db, 'SELECT id FROM inbound_messages')).toEqual([]);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('nothing was stored'));
    } finally {
      log.mockRestore();
    }
  });

  test('the same smsId posted twice is stored once', async () => {
    const { h, stub, post } = await agency();
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });

    expect((await post(RECEIVED, RECEIVED_SIGNATURE)).status).toBe(200);
    expect((await post(RECEIVED, RECEIVED_SIGNATURE)).status).toBe(200);
    await h.drain();

    expect(await all(h.db, 'SELECT provider_message_id FROM inbound_messages')).toEqual([{ provider_message_id: '66f7c1e2a4d5e6f7a8b9c0d1' }]);
    expect(stub.requests).toHaveLength(2);
  });

  test('a text from the phone itself is acknowledged and stores nothing', async () => {
    const { h, stub, post } = await agency();

    const response = await post(FROM_PHONE, FROM_PHONE_SIGNATURE);
    await h.drain();

    expect(response.status).toBe(200);
    expect(await all(h.db, 'SELECT id FROM inbound_messages')).toEqual([]);
    expect(stub.requests).toEqual([]);
  });

  test('with textbee unset the route is off and stores nothing', async () => {
    const received: unknown[] = [];
    const http = createHttpApp({ receiveInbound: async (message: unknown) => void received.push(message) } as never, {
      publicUrl: 'https://myest8.test',
      twilioAuthToken: null,
      sendgridPublicKey: '',
      clock: { now: () => new Date('2026-10-08T09:00:00Z') },
    });

    const response = await http.request('/webhooks/textbee', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': RECEIVED_SIGNATURE },
      body: RECEIVED,
    });

    expect(response.status).toBe(404);
    expect(received).toEqual([]);
  });
});
