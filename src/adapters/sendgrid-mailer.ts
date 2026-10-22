// Outbound email through Twilio SendGrid's v3 Mail Send API (ADR-0003):
//   POST {apiBaseUrl}/v3/mail/send   authorization: Bearer <apiKey>
//   { personalizations: [{ to, cc }], from, reply_to, subject, content, attachments }
//   -> 202 with an empty body
// content is the plain text, then the HTML when there is one (SendGrid wants text/plain first).
// reply_to is the Agency's inbox address, the one its Inbound Parse host receives
// on, so a reply comes back in through /webhooks/sendgrid.
// Errors come back as { "errors": [{ "message": "...", "field": "...", "help": null }] }.

import { UndeliverableError, type Messenger } from '../ports.ts';
import { toBase64 } from './json-api.ts';

const TIMEOUT_MS = 15_000;
/** A 400 naming one of these fields refused a recipient's address. */
const RECIPIENT_FIELD = /^personalizations\.\d+\.(to|cc|bcc)\b/;

export interface SendgridMailerConfig {
  apiKey: string;
  /**
   * Sends every email from this address, on a domain verified with SendGrid,
   * instead of the Agency's inbox address. Replies still go to the Agency's inbox.
   */
  from?: string;
  fetch?: typeof fetch;
  apiBaseUrl?: string;
}

/** The Messenger for the 'email' channel. */
export function createSendgridMailer({ apiKey, from, fetch: fetchImpl = fetch, apiBaseUrl = 'https://api.sendgrid.com' }: SendgridMailerConfig): Messenger {
  return {
    async send(message) {
      if (message.channelType !== 'email') throw new Error(`SendGrid can't send ${message.channelType} messages`);
      // SendGrid refuses an address that appears twice in one personalization.
      const seen = new Set([message.to.toLowerCase()]);
      const cc: string[] = [];
      for (const address of message.cc) {
        if (seen.has(address.toLowerCase())) continue;
        seen.add(address.toLowerCase());
        cc.push(address);
      }
      const body = {
        personalizations: [{ to: [{ email: message.to }], ...(cc.length ? { cc: cc.map((email) => ({ email })) } : {}) }],
        from: { email: from ?? message.from },
        reply_to: { email: message.from },
        subject: message.subject,
        content: [{ type: 'text/plain', value: message.text }, ...(message.html ? [{ type: 'text/html', value: message.html }] : [])],
        ...(message.attachments.length
          ? {
              attachments: message.attachments.map((a) => ({
                content: toBase64(a.content),
                filename: a.filename,
                type: a.contentType,
                disposition: 'attachment',
              })),
            }
          : {}),
      };

      const response = await fetchImpl(`${apiBaseUrl}/v3/mail/send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return;
      const text = await response.text();
      const errors = parseErrors(text);
      const detail = errors.length ? errors.map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)).join('; ') : text.slice(0, 200);
      if (response.status === 400 && errors.some((e) => e.field && RECIPIENT_FIELD.test(e.field))) {
        throw new UndeliverableError('email', message.to, `SendGrid ${detail}`);
      }
      throw new Error(`SendGrid returned ${response.status}: ${detail}`);
    },
  };
}

function parseErrors(text: string): { message: string; field?: string }[] {
  try {
    const body = JSON.parse(text) as { errors?: unknown };
    if (!Array.isArray(body.errors)) return [];
    return body.errors.flatMap((e: unknown) => {
      if (typeof e !== 'object' || e === null) return [];
      const { message, field } = e as Record<string, unknown>;
      return typeof message === 'string' ? [{ message, ...(typeof field === 'string' ? { field } : {}) }] : [];
    });
  } catch {
    return [];
  }
}
