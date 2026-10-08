// The thin HTTP layer: provider webhooks and the JSON behind the two no-login links
// (/api/u/:token and /api/t/:token; the HTML pages own /u/:token and /t/:token).
// Webhooks only store the message and return; the background worker does the rest.

import { Hono, type Context as HonoContext } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { sendgridToInbound, verifySendgridSignature } from './adapters/sendgrid.ts';
import { twilioToInbound, verifyTwilioSignature } from './adapters/twilio.ts';
import type { App } from './app.ts';
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
    app.receiveInbound(twilioToInbound(params, config.clock.now()));
    return c.body('<Response/>', 200, { 'content-type': 'text/xml' });
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
    app.receiveInbound(await sendgridToInbound(form, config.clock.now()));
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

  http.get('/api/t/:token', (c) => c.json(app.tracker(c.req.param('token'))));

  http.onError((error, c) => {
    if (error instanceof ActionError) return c.json({ error: error.message }, STATUS[error.code]);
    console.error(error);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  return http;
}
