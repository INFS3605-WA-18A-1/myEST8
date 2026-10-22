// Outbound SMS through textbee (ADR 0013): an Android phone sends the text.
//   POST {apiBaseUrl}/api/v1/gateway/send-sms
//   x-api-key: the dashboard API key
//   { recipients, message, deviceId } -> 200 { data: { smsBatchId, ... } }
// deviceId is a body field (textbee's API reference). A request that names a
// device never falls back to another phone. SMS can't carry files, so an
// attachment goes out as its signed file link, appended to the text.
// A 400 whose reason is "Invalid recipients" is a number that will never work.
// Anything else is retried. The API key is never left in an error.

import type { FileLinks } from '../file-links.ts';
import { UndeliverableError, type Messenger, type OutboundMessage } from '../ports.ts';

const TIMEOUT_MS = 15_000;
const TEXTBEE_ENV = ['TEXTBEE_API_KEY', 'TEXTBEE_DEVICE_ID', 'TEXTBEE_NUMBER', 'TEXTBEE_WEBHOOK_SECRET'] as const;

/** The server's textbee phone. One number, read in this one place. */
export interface TextbeeConfig {
  apiKey: string;
  deviceId: string;
  /** The phone's number, E.164. */
  number: string;
  webhookSecret: string;
  apiBaseUrl: string;
}

/**
 * The four TEXTBEE_* settings, or null when none are set. A partial set throws,
 * naming what is missing. TEXTBEE_API_URL overrides the API origin.
 */
export function textbeeFromEnv(env: Record<string, string | undefined>): TextbeeConfig | null {
  const set = (name: string) => env[name]?.trim() || undefined;
  const missing = TEXTBEE_ENV.filter((name) => !set(name));
  if (missing.length === TEXTBEE_ENV.length) return null;
  if (missing.length) {
    throw new Error(
      `Set TEXTBEE_API_KEY, TEXTBEE_DEVICE_ID, TEXTBEE_NUMBER and TEXTBEE_WEBHOOK_SECRET, or none. Missing: ${missing.join(', ')}`,
    );
  }
  return {
    apiKey: set('TEXTBEE_API_KEY')!,
    deviceId: set('TEXTBEE_DEVICE_ID')!,
    number: set('TEXTBEE_NUMBER')!,
    webhookSecret: set('TEXTBEE_WEBHOOK_SECRET')!,
    apiBaseUrl: (set('TEXTBEE_API_URL') ?? 'https://api.textbee.dev').replace(/\/$/, ''),
  };
}

export interface TextbeeMessengerConfig {
  apiKey: string;
  deviceId: string;
  /** Signs the links an attachment becomes. Without it, a message with attachments throws. */
  fileLinks?: FileLinks | null;
  fetch?: typeof fetch;
  apiBaseUrl?: string;
}

/** The Messenger for the 'sms' channel when textbee is the server's phone. */
export function createTextbeeMessenger({
  apiKey,
  deviceId,
  fileLinks,
  fetch: fetchImpl = fetch,
  apiBaseUrl = 'https://api.textbee.dev',
}: TextbeeMessengerConfig): Messenger {
  const url = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/gateway/send-sms`;

  return {
    async send(message) {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ recipients: [message.to], message: messageText(message, fileLinks), deviceId }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return;
      const text = await response.text();
      const reason = scrub(apiKey, errorReason(text) ?? text.slice(0, 200));
      if (response.status === 400 && /invalid recipients/i.test(reason)) {
        throw new UndeliverableError(message.channelType, message.to, `Textbee ${reason}`, "that doesn't look like a valid phone number");
      }
      throw new Error(`Textbee returned ${response.status}: ${reason}`);
    },
  };
}

function scrub(apiKey: string, detail: string): string {
  return apiKey ? detail.replaceAll(apiKey, '[redacted]') : detail;
}

/** textbee's 400s carry `error`; 401 and 429 carry `message`. */
function errorReason(text: string): string | null {
  try {
    const body = JSON.parse(text) as unknown;
    if (typeof body !== 'object' || body === null) return null;
    const { error, message } = body as Record<string, unknown>;
    if (typeof error === 'string' && error) return error;
    if (typeof message === 'string' && message) return message;
    return null;
  } catch {
    return null;
  }
}

/** The text, then one signed link per attachment. SMS has nowhere else to put a file. */
function messageText(message: OutboundMessage, fileLinks: FileLinks | null | undefined): string {
  if (message.attachments.length === 0) return message.text;
  const links = message.attachments.map((attachment) => {
    if (attachment.id === undefined) throw new Error(`textbee can only send stored files: ${attachment.filename} has no file id`);
    if (!fileLinks) throw new Error('textbee needs file links (FILE_LINK_SECRET and PUBLIC_URL) to send attachments');
    return fileLinks.url(attachment.id);
  });
  return [message.text, ...links].join('\n');
}
