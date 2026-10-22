import { createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { createHttpApp } from '../src/http.ts';
import { json, stubFetch } from './adapters/stub-fetch.ts';
import { FakeBlobStore } from './support/fakes.ts';
import { AGENCY_INBOX, AGENCY_NUMBER } from './support/harness.ts';
import { photo } from './support/photos.ts';
import { BELLA, TOM, tomsTapTicket, world } from './support/world.ts';

const PUBLIC_URL = 'https://myest8.test';
const TWILIO_TOKEN = 'twilio-auth-token';
const sendgridKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

async function server(options: Parameters<typeof world>[0] = {}) {
  const w = await world(options);
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
    expect(h.messenger.templatesTo(TOM)).toEqual(['tenant.acknowledgement', 'tenant.missing_details']);
  });

  test('the same webhook delivered twice is processed once', async () => {
    const { h, http } = await server();
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });

    await twilioWebhook(http, tomsSms);
    await twilioWebhook(http, tomsSms);
    await h.drain();

    expect(h.messenger.templatesTo(TOM)).toEqual(['tenant.acknowledgement', 'tenant.missing_details']);
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
      { channel: 'email', template: 'tenant.missing_details' },
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
    await h.answerAll(TOM, { location: 'Kitchen sink', started: 'Since Monday', worsening: 'no', availability: 'weekday_mornings' });
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

  test('with storage, photos go straight to it: prepare hands out slots, complete collects them, and nothing outside the Agency can be collected', async () => {
    const blobs = new FakeBlobStore();
    const { h, alice, http } = await server({ blobs });
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await h.receive(TOM, 'The kitchen tap is dripping');
    await h.answerAll(TOM, { location: 'Kitchen sink', started: 'Since Monday', worsening: 'no', availability: 'weekday_mornings' });
    const api = `/api${new URL(h.messenger.last(TOM)!.data.uploadLink as string).pathname}`;
    const post = (path: string, body: unknown) =>
      http.request(`${api}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const prepared = await post('prepare', { files: [{ filename: 'tap.jpg' }] });
    expect(prepared.status).toBe(200);
    const { direct, slots } = (await prepared.json()) as { direct: boolean; slots: { path: string; url: string }[] };
    expect(direct).toBe(true);
    expect(slots[0]!.url).toBe(`https://storage.test/upload/${slots[0]!.path}`);

    await blobs.put(slots[0]!.path, photo({ takenAt: '2026:10:08 08:30:00' }), 'image/jpeg'); // the browser's PUT
    const done = await post('complete', { files: [{ path: slots[0]!.path, filename: 'tap.jpg', contentType: 'image/jpeg' }] });
    expect(done.status).toBe(202);
    await h.drain();
    expect((await alice.dashboard()).maintenanceRequests).toMatchObject([{ photos: [{ metadata: 'ok' }] }]);
    expect(blobs.objects.has(slots[0]!.path)).toBe(false); // the staged copy is gone
    expect([...blobs.objects.keys()].every((path) => /^\d+\/[0-9a-f-]{36}$/.test(path))).toBe(true); // the kept copy is named by the app, not the upload

    blobs.objects.set('staging/999/other', { content: photo(), contentType: 'image/jpeg' });
    const stolen = await post('complete', { files: [{ path: 'staging/999/other', filename: 'x.jpg', contentType: 'image/jpeg' }] });
    expect(stolen.status).toBeGreaterThanOrEqual(400);
    expect(blobs.objects.has('staging/999/other')).toBe(true);
    expect((await http.request('/api/u/not-a-real-token/prepare', { method: 'POST', body: JSON.stringify({ files: [{}] }) })).status).toBe(404);
  });

  test("a receipt sent through the JSON endpoints must be a photo or PDF, and may say the amount, directly or through storage", async () => {
    const blobs = new FakeBlobStore();
    const { h, alice, http } = await server({ blobs });
    h.classifier.when('Water is pouring through the ceiling', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'urgent', trade: 'plumbing' });
    await h.receive(TOM, 'Water is pouring through the ceiling');
    const api = `/api${new URL(h.messenger.last(TOM)!.data.receiptLink as string).pathname}`;
    const { urgentRepairId } = (await alice.dashboard()).urgentRepairs[0]!;

    const notes = new FormData();
    notes.append('files', new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    const refused = await http.request(api, { method: 'POST', body: notes });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'Upload the receipt as a photo or PDF' });
    const empty = await http.request(api, { method: 'POST', body: new FormData() });
    expect(await empty.json()).toEqual({ error: 'Add a photo or PDF of the receipt' });

    const receipt = new FormData();
    receipt.append('files', new File([new Uint8Array([1, 2])], 'receipt.pdf', { type: 'application/pdf' }));
    receipt.append('amount', '$350');
    expect((await http.request(api, { method: 'POST', body: receipt })).status).toBe(202);
    await h.drain();
    expect(await alice.reimbursement(urgentRepairId)).toMatchObject({ status: 'receipt_received', amountCents: 350_00, receipts: [{ filename: 'receipt.pdf' }] });

    const post = (path: string, body: unknown) =>
      http.request(`${api}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const { slots } = (await (await post('prepare', { files: [{ filename: 'page-2.jpg' }] })).json()) as { slots: { path: string }[] };
    await blobs.put(slots[0]!.path, new Uint8Array([1]), 'image/jpeg');
    expect((await post('complete', { files: [{ path: slots[0]!.path, filename: 'page-2.jpg', contentType: 'image/jpeg' }], amount: '360.00' })).status).toBe(202);
    await h.drain();
    expect(await alice.reimbursement(urgentRepairId)).toMatchObject({ amountCents: 360_00, receipts: [{ filename: 'receipt.pdf' }, { filename: 'page-2.jpg' }] });
  });

  test('without storage, prepare says to use the ordinary form', async () => {
    const { h, http } = await server();
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await h.receive(TOM, 'The kitchen tap is dripping');
    await h.answerAll(TOM, { location: 'Kitchen sink', started: 'Since Monday', worsening: 'no', availability: 'weekday_mornings' });
    const api = `/api${new URL(h.messenger.last(TOM)!.data.uploadLink as string).pathname}`;
    const prepared = await http.request(`${api}/prepare`, { method: 'POST', body: JSON.stringify({ files: [{}] }) });
    expect(await prepared.json()).toEqual({ direct: false });
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

describe('the Twilio webhook with no auth token (hosted without Twilio)', () => {
  test('is off: 404, even for a request signed with the demo key', async () => {
    const received: unknown[] = [];
    const http = createHttpApp({ receiveInbound: async (m: unknown) => void received.push(m) } as never, {
      publicUrl: PUBLIC_URL,
      twilioAuthToken: null,
      sendgridPublicKey: '',
      clock: { now: () => new Date('2026-10-13T00:00:00Z') },
    });
    const params = { From: '+61400000001', To: '+61290000000', Body: 'hi', MessageSid: 'SM1' };
    const payload = `${PUBLIC_URL}/webhooks/twilio` + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join('');
    const res = await http.request('/webhooks/twilio', {
      method: 'POST',
      headers: { 'x-twilio-signature': createHmac('sha1', 'demo').update(payload).digest('base64') },
      body: new URLSearchParams(params).toString(),
    });
    expect(res.status).toBe(404);
    expect(received).toEqual([]);
  });
});

describe('the Meta WhatsApp webhook', () => {
  const SECRET = 'meta-app-secret';
  function whatsappServer(enabled = true) {
    const received: unknown[] = [];
    const http = createHttpApp({ receiveInbound: async (m: unknown) => void received.push(m) } as never, {
      publicUrl: PUBLIC_URL,
      twilioAuthToken: TWILIO_TOKEN,
      sendgridPublicKey: '',
      clock: { now: () => new Date('2026-10-13T00:00:00Z') },
      whatsapp: enabled ? { appSecret: SECRET, verifyToken: 'verify-me' } : null,
    });
    return { http, received };
  }
  const body = JSON.stringify({
    entry: [{ changes: [{ field: 'messages', value: { metadata: { display_phone_number: '61290000000' }, messages: [{ from: '61400000001', id: 'wamid.A', timestamp: '1760313600', type: 'text', text: { body: 'hi' } }] } }] }],
  });
  const sign = (text: string) => 'sha256=' + createHmac('sha256', SECRET).update(text).digest('hex');

  test('the handshake echoes the challenge for the right token only', async () => {
    const { http } = whatsappServer();
    const good = await http.request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1234');
    expect(good.status).toBe(200);
    expect(await good.text()).toBe('1234');
    expect((await http.request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1')).status).toBe(403);
  });

  test('a signed POST is passed to receiveInbound and a bad signature is refused', async () => {
    const { http, received } = whatsappServer();
    const bad = await http.request('/webhooks/whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=00' }, body });
    expect(bad.status).toBe(403);
    expect(received).toEqual([]);
    const good = await http.request('/webhooks/whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': sign(body) }, body });
    expect(good.status).toBe(200);
    expect(received).toMatchObject([{ providerMessageId: 'wa-wamid.A', from: '+61400000001', text: 'hi', agencyChannel: '+61290000000' }]);
  });

  test('without configuration both routes are 404', async () => {
    const { http } = whatsappServer(false);
    expect((await http.request('/webhooks/whatsapp?hub.mode=subscribe')).status).toBe(404);
    expect((await http.request('/webhooks/whatsapp', { method: 'POST', body })).status).toBe(404);
  });

  test('a failed delivery status is recorded against the message', async () => {
    const failures: unknown[] = [];
    const http = createHttpApp(
      { receiveInbound: async () => {}, recordDeliveryFailure: async (failure: unknown) => void failures.push(failure) } as never,
      {
        publicUrl: PUBLIC_URL,
        twilioAuthToken: TWILIO_TOKEN,
        sendgridPublicKey: '',
        clock: { now: () => new Date('2026-10-13T00:00:00Z') },
        whatsapp: { appSecret: SECRET, verifyToken: 'verify-me' },
      },
    );
    const status = JSON.stringify({
      entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'w2', status: 'failed', recipient_id: '61400000001', errors: [{ code: 131047, title: 'Re-engagement message' }] }] } }] }],
    });
    const res = await http.request('/webhooks/whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': sign(status) }, body: status });
    expect(res.status).toBe(200);
    expect(failures).toEqual([{ to: '+61400000001', code: 131047, title: 'Re-engagement message' }]);
  });
});

describe('the Resend webhook', () => {
  const secretBytes = randomBytes(24);
  const SECRET = `whsec_${secretBytes.toString('base64')}`;
  const API_KEY = 're_test_not_a_real_key';
  const NOW = new Date('2026-10-13T00:00:00Z');
  const EMAIL_ID = '4ef9a417-02e9-4d39-ad75-9611e0fcc33c';
  const MB = 1024 * 1024;

  function svix(body: string, timestamp = String(Math.floor(NOW.getTime() / 1000)), id = 'msg_resend_test') {
    const signature = createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${body}`).digest('base64');
    return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` };
  }

  function resendServer(enabled = true, fetchImpl: typeof fetch = async () => json({})) {
    const received: unknown[] = [];
    const http = createHttpApp({ receiveInbound: async (m: unknown) => void received.push(m) } as never, {
      publicUrl: PUBLIC_URL,
      twilioAuthToken: TWILIO_TOKEN,
      sendgridPublicKey: '',
      clock: { now: () => NOW },
      resend: enabled ? { webhookSecret: SECRET, apiKey: API_KEY, fetch: fetchImpl } : null,
    });
    return { http, received };
  }

  const payload = JSON.stringify({
    type: 'email.received',
    data: { email_id: EMAIL_ID, from: 'bella@example.com', to: ['inbox@harbour.example'] },
  });

  test('without configuration the route is 404', async () => {
    const { http, received } = resendServer(false);
    expect((await http.request('/webhooks/resend', { method: 'POST', headers: svix(payload), body: payload })).status).toBe(404);
    expect(received).toEqual([]);
  });

  test('a signed email is fetched and passed to receiveInbound; a bad or stale signature is refused', async () => {
    const stub = stubFetch(() =>
      json({
        id: EMAIL_ID,
        from: 'Bella <bella@example.com>',
        to: ['Inbox@Harbour.example'],
        text: 'The shower drain is blocked\n\nOn Tue, 6 Oct 2026 at 9:00, Harbour <inbox@harbour.example> wrote:\n> old',
        attachments: [],
      }),
    );
    const { http, received } = resendServer(true, stub.fetch);
    const bad = await http.request('/webhooks/resend', { method: 'POST', headers: { ...svix(payload), 'svix-signature': 'v1,bm90LXRoaXM=' }, body: payload });
    expect(bad.status).toBe(403);
    expect(received).toEqual([]);
    expect(stub.requests).toEqual([]);

    const staleAt = String(Math.floor(NOW.getTime() / 1000) - 301);
    const stale = await http.request('/webhooks/resend', { method: 'POST', headers: svix(payload, staleAt), body: payload });
    expect(stale.status).toBe(403);

    const pretty = JSON.stringify(JSON.parse(payload), null, 2);
    const reformatted = await http.request('/webhooks/resend', { method: 'POST', headers: svix(payload), body: pretty });
    expect(reformatted.status).toBe(403);
    expect(stub.requests).toEqual([]);

    const good = await http.request('/webhooks/resend', { method: 'POST', headers: svix(payload), body: payload });
    expect(good.status).toBe(200);
    expect(await good.text()).toBe('ok');
    expect(received).toMatchObject([{ providerMessageId: `re-${EMAIL_ID}`, agencyChannel: 'inbox@harbour.example', from: 'bella@example.com', text: 'The shower drain is blocked' }]);
    expect(stub.requests[0]?.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
  });

  test('an event that is not email.received is acknowledged and not fetched', async () => {
    const body = JSON.stringify({ type: 'email.sent', data: { email_id: EMAIL_ID } });
    const stub = stubFetch(() => json({}));
    const { http, received } = resendServer(true, stub.fetch);
    const response = await http.request('/webhooks/resend', { method: 'POST', headers: svix(body), body });
    expect(response.status).toBe(200);
    expect(received).toEqual([]);
    expect(stub.requests).toEqual([]);
  });

  test('signed JSON that does not parse is 400', async () => {
    const body = '{"type":';
    const { http, received } = resendServer();
    const response = await http.request('/webhooks/resend', { method: 'POST', headers: svix(body), body });
    expect(response.status).toBe(400);
    expect(received).toEqual([]);
  });

  test('a body over 1MB is refused', async () => {
    const { http, received } = resendServer();
    const body = 'x'.repeat(MB + 1);
    const response = await http.request('/webhooks/resend', {
      method: 'POST',
      headers: { ...svix(body), 'content-length': String(body.length) },
      body,
    });
    expect(response.status).toBe(413);
    expect(received).toEqual([]);
  });
});
