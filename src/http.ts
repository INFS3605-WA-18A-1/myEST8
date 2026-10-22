// The thin HTTP layer: provider webhooks, the JSON behind the two no-login links
// (/api/u/:token and /api/t/:token; the HTML pages own /u/:token and /t/:token),
// and signed file links (/media/:id, src/file-links.ts) that Twilio fetches media from.
// WhatsApp through Meta's Cloud API has its own webhook (/webhooks/whatsapp), served only when configured.
// Webhooks only store the message and return; the background worker does the rest.

import { Hono, type Context as HonoContext } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { metaStatusFailures, metaToInbound, verifyMetaSignature } from './adapters/meta-whatsapp.ts';
import { resendToInbound, verifyResendSignature } from './adapters/resend.ts';
import { sendgridToInbound, verifySendgridSignature } from './adapters/sendgrid.ts';
import { textbeeToInbound, verifyTextbeeSignature } from './adapters/textbee.ts';
import { twilioToInbound, verifyTwilioSignature } from './adapters/twilio.ts';
import type { App } from './app.ts';
import type { FileLinks } from './file-links.ts';
import type { Clock } from './ports.ts';
import type { SmsNumbers } from './sms-numbers.ts';
import { ActionError, invalid } from './shared.ts';
import { optionalCents } from './web/forms.ts';
import { streamOf } from './web/stream.ts';

const STATUS = { not_found: 404, invalid: 400, conflict: 409 } as const;
const MB = 1024 * 1024;

export function createHttpApp(
  app: App,
  config: {
    /** The address providers call, which Twilio signs: "https://myest8.example". */
    publicUrl: string;
    /** Twilio's auth token. With no Agency numbers either, null (hosted, none set) turns /webhooks/twilio off with a 404. */
    twilioAuthToken: string | null;
    /**
     * Agencies' own Twilio numbers (ADR 0005). A text to one is checked with the token of the
     * account that owns the number; the server's token covers every other number, as before.
     */
    smsNumbers?: Pick<SmsNumbers, 'authTokenFor'> | null;
    /** SendGrid's verification key (base64 DER). Every email webhook must be signed with it. */
    sendgridPublicKey: string;
    clock: Clock;
    /** Checks signed file links. Without it, /media/:id serves nothing. */
    fileLinks?: FileLinks | null;
    /** Meta's WhatsApp Cloud API: the app secret that signs webhooks, and the verify token for its handshake. */
    whatsapp?: { appSecret: string; verifyToken: string } | null;
    /** Resend inbound email. Absent unless both the webhook secret and the API key are set. */
    resend?: { webhookSecret: string; apiKey: string; fetch?: typeof fetch } | null;
    /** The server's textbee phone (ADR 0013). Absent turns /webhooks/textbee off with a 404. */
    textbee?: { webhookSecret: string; number: string } | null;
  },
) {
  const http = new Hono();

  /** The URL as the provider saw it, not as the proxy in front of us forwarded it. */
  const publicUrl = (c: HonoContext) => {
    const { pathname, search } = new URL(c.req.url);
    return config.publicUrl.replace(/\/$/, '') + pathname + search;
  };

  http.post('/webhooks/twilio', bodyLimit({ maxSize: MB }), async (c) => {
    if (!config.twilioAuthToken && !config.smsNumbers) return c.notFound();
    const params = Object.fromEntries(new URLSearchParams(await c.req.text()));
    const message = twilioToInbound(params, config.clock.now());
    // The token that signs a text is the one of the Twilio account that owns the number it was sent to.
    const token = (message.channelType === 'sms' ? await config.smsNumbers?.authTokenFor(message.agencyChannel) : null) ?? config.twilioAuthToken;
    // A bad signature and a number no Agency has get the same answer, so neither says which was wrong.
    const refused = () => c.text('Forbidden', 403);
    if (!token || !verifyTwilioSignature(token, publicUrl(c), params, c.req.header('x-twilio-signature') ?? '')) return refused();
    if (!(await app.receiveInbound(message))) return refused();
    return c.body('<Response/>', 200, { 'content-type': 'text/xml' });
  });

  // textbee posts one JSON event (ADR 0013). The signature covers the raw bytes, so check it before parsing.
  http.post('/webhooks/textbee', bodyLimit({ maxSize: MB }), async (c) => {
    if (!config.textbee) return c.notFound();
    const raw = new Uint8Array(await c.req.arrayBuffer());
    if (!verifyTextbeeSignature(config.textbee.webhookSecret, raw, c.req.header('x-signature') ?? '')) {
      return c.text('Invalid signature', 401);
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return c.text('Invalid JSON', 400);
    }
    const message = textbeeToInbound(body, config.textbee.number);
    // No Agency yet: 200, not 4xx. textbee stops retrying a 4xx and pauses a webhook that keeps failing.
    if (message && !(await app.receiveInbound(message))) {
      console.log(`[textbee] a text from ${message.from} to ${config.textbee.number} arrived before any Agency connected it, so nothing was stored`);
    }
    return c.text('ok', 200);
  });

  http.get('/webhooks/whatsapp', (c) => {
    if (!config.whatsapp) return c.notFound();
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = c.req.query();
    if (mode === 'subscribe' && token === config.whatsapp.verifyToken) return c.text(challenge ?? '', 200);
    return c.text('Invalid verify token', 403);
  });

  http.post('/webhooks/whatsapp', bodyLimit({ maxSize: MB }), async (c) => {
    if (!config.whatsapp) return c.notFound();
    const raw = new Uint8Array(await c.req.arrayBuffer());
    if (!verifyMetaSignature(config.whatsapp.appSecret, raw, c.req.header('x-hub-signature-256') ?? '')) {
      return c.text('Invalid signature', 403);
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return c.text('Invalid JSON', 400);
    }
    for (const message of metaToInbound(body, config.clock.now())) await app.receiveInbound(message);
    for (const failure of metaStatusFailures(body)) await app.recordDeliveryFailure(failure);
    return c.text('ok', 200);
  });

  http.post('/webhooks/sendgrid', bodyLimit({ maxSize: 40 * MB }), async (c) => {
    // The signature covers the raw bytes, so check it before parsing the multipart body.
    const raw = new Uint8Array(await c.req.arrayBuffer());
    const signature = c.req.header('x-twilio-email-event-webhook-signature');
    const timestamp = c.req.header('x-twilio-email-event-webhook-timestamp');
    if (!signature || !timestamp || !verifySendgridSignature(config.sendgridPublicKey, timestamp, raw, signature)) {
      return c.text('Invalid signature', 403);
    }
    const form = await new Request(c.req.url, {
      method: 'POST',
      headers: { 'content-type': c.req.header('content-type') ?? '' },
      body: raw,
    })
      .formData()
      .catch(() => null);
    if (!form) return c.text('Expected multipart/form-data', 400);
    await app.receiveInbound(await sendgridToInbound(form, config.clock.now()));
    return c.body(null, 200);
  });

  http.post('/webhooks/resend', bodyLimit({ maxSize: MB }), async (c) => {
    if (!config.resend) return c.notFound();
    // The signature covers the raw bytes, so check it before parsing JSON.
    const raw = new Uint8Array(await c.req.arrayBuffer());
    if (
      !verifyResendSignature(
        config.resend.webhookSecret,
        raw,
        {
          id: c.req.header('svix-id') ?? '',
          timestamp: c.req.header('svix-timestamp') ?? '',
          signature: c.req.header('svix-signature') ?? '',
        },
        config.clock.now(),
      )
    ) {
      return c.text('Invalid signature', 403);
    }
    let event: unknown;
    try {
      event = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return c.text('Invalid JSON', 400);
    }
    const message = await resendToInbound(event, {
      apiKey: config.resend.apiKey,
      fetch: config.resend.fetch ?? fetch,
      receivedAt: config.clock.now(),
    });
    if (message) await app.receiveInbound(message);
    return c.text('ok', 200);
  });

  // Uploads straight to storage, for files past the function's request size limit:
  // `prepare` hands out one URL per file, the browser PUTs to them, `complete` collects them.
  http.post('/api/u/:token/prepare', bodyLimit({ maxSize: 64 * 1024 }), async (c) => {
    const body = await c.req.json().catch(() => null);
    const count = Array.isArray(body?.files) ? body.files.length : 0;
    const slots = await app.uploadSlots(c.req.param('token'), count);
    return c.json(slots ? { direct: true, slots } : { direct: false });
  });

  http.post('/api/u/:token/complete', bodyLimit({ maxSize: 64 * 1024 }), async (c) => {
    const body = await c.req.json().catch(() => null);
    const sent = Array.isArray(body?.files) ? (body.files as unknown[]) : [];
    const files = sent.map((f) => {
      const { path, filename, contentType } = (f ?? {}) as Record<string, unknown>;
      if (typeof path !== 'string' || typeof filename !== 'string') invalid('Expected the files that were uploaded');
      return { path, filename, contentType: typeof contentType === 'string' && contentType ? contentType : 'application/octet-stream' };
    });
    // A receipt's upload may say how much the Tenant claims, in dollars as typed.
    await app.completeUpload(c.req.param('token'), files, { amountCents: optionalCents(body?.amount, 'the amount') });
    return c.json({ ok: true, count: files.length }, 202);
  });

  http.post('/api/u/:token', bodyLimit({ maxSize: 105 * MB }), async (c) => {
    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ error: 'Expected multipart/form-data' }, 400);
    const files = form.getAll('files').filter((f) => typeof f !== 'string');
    const uploads = await Promise.all(
      files.map(async (f) => ({ filename: f.name, contentType: f.type || 'application/octet-stream', content: new Uint8Array(await f.arrayBuffer()) })),
    );
    await app.upload(c.req.param('token'), uploads, { amountCents: optionalCents(form.get('amount'), 'the amount') });
    return c.json({ ok: true }, 202);
  });

  http.get('/api/t/:token', async (c) => c.json(await app.tracker(c.req.param('token'))));

  // A stored file behind a signed, expiring link. The signature is the only access
  // check, so a bad or expired one gets the same answer as a file that isn't there.
  http.get('/media/:id', async (c) => {
    const id = c.req.param('id');
    if (!config.fileLinks?.check(id, c.req.query('expires'), c.req.query('signature'))) return c.text('Not found', 404);
    const file = await app.linkedFile(Number(id));
    return c.body(streamOf(file.content), 200, {
      'content-type': file.contentType,
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      // Uploaded content is never run as a page on this origin.
      'content-security-policy': "default-src 'none'; sandbox",
      'referrer-policy': 'no-referrer',
    });
  });

  http.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    if (error instanceof ActionError) return c.json({ error: error.message }, STATUS[error.code]);
    console.error(error);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  return http;
}
