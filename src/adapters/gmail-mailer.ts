// Sends email as the Agency's own Gmail mailbox (docs/adr/0004): builds the RFC 5322
// message and posts it to users.messages.send with the Agency's access token.

import { randomBytes } from 'node:crypto';
import { UndeliverableError, type Messenger, type OutboundMessage } from '../ports.ts';

const TIMEOUT_MS = 30_000;
const DEFAULT_BASE_URL = 'https://gmail.googleapis.com';
/** Gmail's 400s for an address it won't send to. */
const REFUSED_RECIPIENT = /invalid (to|cc|bcc) header|recipient address required/i;
/** One plain address: no spaces, quotes, angle brackets or line breaks that could add a header. */
const PLAIN_ADDRESS = /^[^\s<>"',;@]+@[^\s<>"',;@]+\.[^\s<>"',;@]+$/;

const CRLF = '\r\n';
/** Base64 in lines of 76 characters, as MIME wants. */
const wrap = (bytes: Uint8Array | string) => (Buffer.from(bytes).toString('base64').match(/.{1,76}/g) ?? []).join(CRLF);

/** A header value on one line, as an RFC 2047 encoded word when it isn't plain ASCII. */
function headerText(value: string): string {
  const oneLine = value.replace(/[\r\n]+/g, ' ').trim();
  if (/^[\x20-\x7e]*$/.test(oneLine)) return oneLine;
  const words: string[] = [];
  let chunk = '';
  for (const char of oneLine) {
    if (Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join(`${CRLF} `);
}

const quoted = (filename: string) => filename.replace(/["\\\r\n]/g, '_');

function rawMessage(message: OutboundMessage, cc: string[]): string {
  const headers = [`From: ${message.from}`, `To: ${message.to}`, ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []), `Subject: ${headerText(message.subject)}`, 'MIME-Version: 1.0'];
  const textPart = [`Content-Type: text/plain; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', wrap(message.text)].join(CRLF);
  if (!message.attachments.length) return [...headers, textPart].join(CRLF);

  const boundary = `myest8_${randomBytes(12).toString('hex')}`;
  const files = message.attachments.map((a) =>
    [
      `Content-Type: ${a.contentType.replace(/[\r\n]/g, '')}`,
      `Content-Disposition: attachment; filename="${quoted(a.filename)}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap(a.content),
    ].join(CRLF),
  );
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', ...[textPart, ...files].map((part) => `--${boundary}${CRLF}${part}`), `--${boundary}--`, ''].join(CRLF);
}

/**
 * `accessToken` gives the Agency's current Gmail access token (refreshed as needed).
 * An address that isn't a plain email, or one Gmail refuses, is undeliverable.
 */
export function createGmailMessenger(config: { accessToken: (agencyId: number) => Promise<string>; fetch?: typeof fetch; apiBaseUrl?: string }): Messenger {
  const fetchImpl = config.fetch ?? fetch;
  return {
    async send(message) {
      for (const address of [message.to, ...message.cc]) {
        if (!PLAIN_ADDRESS.test(address)) throw new UndeliverableError('email', message.to, `${JSON.stringify(address)} is not an email address`);
      }
      const seen = new Set([message.to.toLowerCase()]);
      const cc = message.cc.filter((a) => !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()));
      const raw = Buffer.from(rawMessage(message, cc)).toString('base64url');

      const response = await fetchImpl(`${config.apiBaseUrl ?? DEFAULT_BASE_URL}/gmail/v1/users/me/messages/send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await config.accessToken(message.agencyId)}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return;
      const text = await response.text();
      let reason = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text) as { error?: { message?: unknown } };
        if (typeof parsed.error?.message === 'string') reason = parsed.error.message;
      } catch {
        // not JSON: keep the excerpt
      }
      if (response.status === 400 && REFUSED_RECIPIENT.test(reason)) throw new UndeliverableError('email', message.to, reason);
      throw new Error(`Gmail returned ${response.status}: ${reason}`);
    },
  };
}
