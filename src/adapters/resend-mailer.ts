// Outbound email through Resend's Email API:
//   POST {apiBaseUrl}/emails   authorization: Bearer <apiKey>
//   { from, to, cc, subject, text, attachments: [{ content, filename }] }
//   Idempotency-Key: the outbound message id, when the message has one
//   -> 200 { id }
// from is the Agency channel address. Errors come back as
// { "statusCode", "name", "message" }. A 4xx whose name is a recipient or
// validation error is permanent; 401, 409, 429 and 5xx are retried.
// https://resend.com/docs/api-reference/emails/send-email

import { UndeliverableError, type Messenger } from '../ports.ts';
import { toBase64 } from './json-api.ts';

const TIMEOUT_MS = 15_000;
/** Resend names a refused recipient or a request it will not accept. */
const VALIDATION_ERROR = new Set(['validation_error', 'invalid_attachment', 'missing_required_field', 'invalid_parameter']);

export interface ResendMailerConfig {
  apiKey: string;
  fetch?: typeof fetch;
  apiBaseUrl?: string;
}

/** The Messenger for the 'email' channel. */
export function createResendMailer({ apiKey, fetch: fetchImpl = fetch, apiBaseUrl = 'https://api.resend.com' }: ResendMailerConfig): Messenger {
  const scrub = (detail: string) => (apiKey ? detail.replaceAll(apiKey, '[redacted]') : detail);

  return {
    async send(message) {
      if (message.channelType !== 'email') throw new Error(`Resend can't send ${message.channelType} messages`);
      // Resend rejects an address that appears twice in one email.
      const seen = new Set([message.to.toLowerCase()]);
      const cc: string[] = [];
      for (const address of message.cc) {
        if (seen.has(address.toLowerCase())) continue;
        seen.add(address.toLowerCase());
        cc.push(address);
      }
      const body = {
        from: message.from,
        to: [message.to],
        ...(cc.length ? { cc } : {}),
        subject: message.subject,
        text: message.text,
        ...(message.attachments.length
          ? { attachments: message.attachments.map((a) => ({ content: toBase64(a.content), filename: a.filename })) }
          : {}),
      };
      const headers: Record<string, string> = {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      };
      if (message.id) headers['Idempotency-Key'] = message.id;

      const response = await fetchImpl(`${apiBaseUrl}/emails`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return;
      const text = await response.text();
      const error = parseError(text);
      const detail = scrub(error ? (error.name ? `${error.name}: ${error.message}` : error.message) : text.slice(0, 200));
      if (response.status >= 400 && response.status < 500 && response.status !== 429 && error?.name && VALIDATION_ERROR.has(error.name)) {
        throw new UndeliverableError('email', message.to, `Resend ${detail}`);
      }
      throw new Error(`Resend returned ${response.status}: ${detail}`);
    },
  };
}

function parseError(text: string): { name?: string; message: string } | null {
  try {
    const body = JSON.parse(text) as unknown;
    if (typeof body !== 'object' || body === null) return null;
    const { message, name } = body as Record<string, unknown>;
    if (typeof message !== 'string') return null;
    return { message, ...(typeof name === 'string' ? { name } : {}) };
  } catch {
    return null;
  }
}
