// The thin HTTP layer: provider webhooks, the JSON behind the two no-login links
// (/api/u/:token and /api/t/:token; the HTML pages own /u/:token and /t/:token),
// and signed file links (/media/:id, src/file-links.ts) that Twilio fetches media from.
// WhatsApp through Meta's Cloud API has its own webhook (/webhooks/whatsapp), served only when configured.
// Webhooks only store the message and return; the background worker does the rest.

import { Hono, type Context as HonoContext } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { metaStatusFailures, metaToInbound, verifyMetaSignature } from './adapters/meta-whatsapp.ts';
import { sendgridToInbound, verifySendgridSignature } from './adapters/sendgrid.ts';
import { twilioToInbound, verifyTwilioSignature } from './adapters/twilio.ts';
import type { App } from './app.ts';
import type { FileLinks } from './file-links.ts';
import type { Clock } from './ports.ts';
import { ActionError } from './shared.ts';

const STATUS = { not_found: 404, invalid: 400, conflict: 409 } as const;
const MB = 1024 * 1024;

export function createHttpApp(
  app: App,
  config: {
    /** The address providers call, which Twilio signs: "https://myest8.example". */
    publicUrl: string;
    twilioAuthToken: string;
    /** SendGrid's verification key (base64 DER). Every email webhook must be signed with it. */
    sendgridPublicKey: string;
    clock: Clock;
    /** Checks signed file links. Without it, /media/:id serves nothing. */
    fileLinks?: FileLinks | null;
    /** Meta's WhatsApp Cloud API: the app secret that signs webhooks, and the verify token for its handshake. */
    whatsapp?: { appSecret: string; verifyToken: string } | null;
  },
) {
  const http = new Hono();

  /** The URL as the provider saw it, not as the proxy in front of us forwarded it. */
  const publicUrl = (c: HonoContext) => {
    const { pathname, search } = new URL(c.req.url);
    return config.publicUrl.replace(/\/$/, '') + pathname + search;
  };

  http.post('/webhooks/twilio', bodyLimit({ maxSize: MB }), async (c) => {
    const params = Object.fromEntries(new URLSearchParams(await c.req.text()));
    if (!verifyTwilioSignature(config.twilioAuthToken, publicUrl(c), params, c.req.header('x-twilio-signature') ?? '')) {
      return c.text('Invalid signature', 403);
    }
    await app.receiveInbound(twilioToInbound(params, config.clock.now()));
    return c.body('<Response/>', 200, { 'content-type': 'text/xml' });
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

  http.post('/api/u/:token', bodyLimit({ maxSize: 105 * MB }), async (c) => {
    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ error: 'Expected multipart/form-data' }, 400);
    const files = form.getAll('files').filter((f) => typeof f !== 'string');
    const uploads = await Promise.all(
      files.map(async (f) => ({ filename: f.name, contentType: f.type || 'application/octet-stream', content: new Uint8Array(await f.arrayBuffer()) })),
    );
    await app.upload(c.req.param('token'), uploads);
    return c.json({ ok: true }, 202);
  });

  http.get('/api/t/:token', async (c) => c.json(await app.tracker(c.req.param('token'))));

  // A stored file behind a signed, expiring link. The signature is the only access
  // check, so a bad or expired one gets the same answer as a file that isn't there.
  http.get('/media/:id', async (c) => {
    const id = c.req.param('id');
    if (!config.fileLinks?.check(id, c.req.query('expires'), c.req.query('signature'))) return c.text('Not found', 404);
    const file = await app.linkedFile(Number(id));
    return c.body(Buffer.from(file.content), 200, {
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
    if (error instanceof ActionError) return c.json({ error: error.message }, STATUS[error.code]);
    console.error(error);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  return http;
}
