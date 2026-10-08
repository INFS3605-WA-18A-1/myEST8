import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { createHttpApp } from '../src/http.ts';
import { AGENCY_INBOX, AGENCY_NUMBER } from './support/harness.ts';
import { photo } from './support/photos.ts';
import { BELLA, TOM, tomsTapTicket, world } from './support/world.ts';

const PUBLIC_URL = 'https://myest8.test';
const TWILIO_TOKEN = 'twilio-auth-token';
const sendgridKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

async function server() {
  const w = await world();
  const http = createHttpApp(w.h.app, {
    publicUrl: PUBLIC_URL,
    twilioAuthToken: TWILIO_TOKEN,
    sendgridPublicKey: sendgridKeys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    clock: w.h.clock,
  });
  return { ...w, http };
}

/** Posts a Twilio messaging webhook, signed the way Twilio signs it unless a signature is given. */
function twilioWebhook(http: Awaited<ReturnType<typeof server>>['http'], params: Record<string, string>, signature?: string) {
  const payload = `${PUBLIC_URL}/webhooks/twilio` + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return http.request('/webhooks/twilio', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature ?? createHmac('sha1', TWILIO_TOKEN).update(payload).digest('base64'),
    },
    body: new URLSearchParams(params).toString(),
  });
}

const tomsSms = {
  MessageSid: 'SM00000000000000000000000000000001',
  AccountSid: 'AC00000000000000000000000000000000',
  From: TOM,
  To: AGENCY_NUMBER,
  Body: 'The kitchen tap is dripping',
  NumMedia: '0',
};

describe('the Twilio webhook', () => {
  test("a signed SMS is stored straight away and reaches the intake agent through the worker", async () => {
    const { h, http } = await server();
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });

    const response = await twilioWebhook(http, tomsSms);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/xml');
    expect(await response.text()).toBe('<Response/>');
    expect(h.messenger.sent).toEqual([]);

    await h.drain();
    expect(h.messenger.templatesTo(TOM)).toEqual(['tenant.acknowledgement', 'tenant.guided_question']);
  });

  test('the same webhook delivered twice is processed once', async () => {
    const { h, http } = await server();
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });

    await twilioWebhook(http, tomsSms);
    await twilioWebhook(http, tomsSms);
    await h.drain();

    expect(h.messenger.templatesTo(TOM)).toEqual(['tenant.acknowledgement', 'tenant.guided_question']);
  });

  test('a request with a bad signature is refused and nothing is stored', async () => {
    const { h, alice, http } = await server();
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });

    const response = await twilioWebhook(http, tomsSms, 'bm90IGEgcmVhbCBzaWduYXR1cmU=');

    expect(response.status).toBe(403);
    await h.drain();
    expect(h.messenger.sent).toEqual([]);
    expect((await alice.dashboard()).inbox).toEqual([]);
  });
});

describe('the SendGrid webhook', () => {
  async function signedEmail(form: FormData, { sign: signIt = true } = {}) {
    const request = new Request('http://localhost/', { method: 'POST', body: form });
    const body = new Uint8Array(await request.arrayBuffer());
    const timestamp = '1791496800';
    const headers: Record<string, string> = { 'content-type': request.headers.get('content-type')! };
    if (signIt) {
      headers['x-twilio-email-event-webhook-timestamp'] = timestamp;
      headers['x-twilio-email-event-webhook-signature'] = sign('sha256', Buffer.concat([Buffer.from(timestamp), body]), sendgridKeys.privateKey).toString('base64');
    }
    return { method: 'POST', headers, body };
  }

  function bellasEmail() {
    const form = new FormData();
    form.set('headers', 'Message-ID: <bella-1@example.com>\nSubject: Shower drain');
    form.set('envelope', JSON.stringify({ to: [AGENCY_INBOX], from: BELLA }));
    form.set('from', `Bella Bui <${BELLA}>`);
    form.set('to', AGENCY_INBOX);
    form.set('subject', 'Shower drain');
    form.set('text', 'The shower drain is blocked');
    form.set('attachments', '0');
    return form;
  }

  test('a signed email reaches the intake agent', async () => {
    const { h, http } = await server();
    h.classifier.when('Shower drain\n\nThe shower drain is blocked', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });

    const response = await http.request('/webhooks/sendgrid', await signedEmail(bellasEmail()));

    expect(response.status).toBe(200);
    await h.drain();
    expect(h.messenger.to(BELLA)).toMatchObject([
      { channel: 'email', template: 'tenant.acknowledgement' },
      { channel: 'email', template: 'tenant.guided_question' },
    ]);
  });

  test('an unsigned email is refused', async () => {
    const { h, http } = await server();

    const response = await http.request('/webhooks/sendgrid', await signedEmail(bellasEmail(), { sign: false }));

    expect(response.status).toBe(403);
    await h.drain();
    expect(h.messenger.sent).toEqual([]);
  });
});

describe('the no-login links', () => {
  test('photos uploaded through the JSON upload endpoint reach the Maintenance Request', async () => {
    const { h, alice, http } = await server();
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await h.receive(TOM, 'The kitchen tap is dripping');
    await h.answer(TOM, 'Kitchen sink');
    await h.answer(TOM, 'Since Monday');
    await h.answer(TOM, 'No', 'no');
    await h.answer(TOM, 'Mornings', 'weekday_mornings');
    const { pathname } = new URL(h.messenger.last(TOM)!.data.uploadLink as string);
    const api = `/api${pathname}`;

    const form = new FormData();
    form.append('files', new File([photo({ takenAt: '2026:10:08 08:30:00' })], 'tap-1.jpg', { type: 'image/jpeg' }));
    form.append('files', new File([photo()], 'tap-2.jpg', { type: 'image/jpeg' }));
    const response = await http.request(api, { method: 'POST', body: form });

    expect(response.status).toBe(202);
    await h.drain();
    expect((await alice.dashboard()).maintenanceRequests).toMatchObject([{ photos: [{ metadata: 'ok' }, { metadata: 'no_metadata' }] }]);

    const notAPhoto = new FormData();
    notAPhoto.append('files', new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    const refused = await http.request(api, { method: 'POST', body: notAPhoto });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'Only photos can be uploaded here (JPEG, PNG, HEIC, WebP or GIF)' });

    expect((await http.request('/api/u/not-a-real-token', { method: 'POST', body: form })).status).toBe(404);
  });

  test("the Tenant's progress tracker is served as JSON for its link's token, and an unknown token is not found", async () => {
    const w = await server();
    const { h, http } = w;
    await tomsTapTicket(w);
    const { pathname } = new URL(h.messenger.to(TOM).find((m) => m.template === 'tenant.confirmed')!.data.trackerLink as string);

    const response = await http.request(`/api${pathname}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      description: 'The kitchen tap is dripping',
      stages: [{ stage: 'reported', reached: true }, { stage: 'confirmed', reached: true }, { stage: 'getting_quotes', reached: false }, {}, {}, {}, {}],
    });
    expect((await http.request('/api/t/not-a-real-token')).status).toBe(404);
  });
});
