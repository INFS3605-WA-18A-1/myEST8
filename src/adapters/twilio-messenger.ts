// Outbound SMS and WhatsApp through Twilio Programmable Messaging (ADR-0003):
//   POST {apiBaseUrl}/2010-04-01/Accounts/{AccountSid}/Messages.json
//   authorization: Basic base64(AccountSid:AuthToken), form-encoded
//   To, From, Body, MediaUrl (repeatable)  -> 201 { "sid": "SM...", "status": "queued", ... }
// WhatsApp addresses take the "whatsapp:" prefix on both To and From.
// Twilio fetches each MediaUrl itself, so attachments go as signed, expiring file
// links (src/file-links.ts). WhatsApp takes one media file per message, so the
// rest follow as media-only messages; an MMS takes up to ten.
// Errors come back as { "code": 21211, "message": "...", "status": 400 }.

import type { FileLinks } from '../file-links.ts';
import { ProviderRefusedError, UndeliverableError, type Messenger, type OutboundMessage } from '../ports.ts';

const TIMEOUT_MS = 15_000;
const MAX_MMS_MEDIA = 10;

/**
 * Twilio error codes for a recipient that no retry will fix: 21211 not a valid
 * phone number, 21610 the recipient replied STOP, 21614 not a mobile number.
 */
export const TWILIO_UNDELIVERABLE_CODES: ReadonlySet<number> = new Set([21211, 21610, 21614]);

/** What a person is told for each Twilio error code we recognise. */
export const TWILIO_USER_REASONS: ReadonlyMap<number, string> = new Map([
  [21211, "that doesn't look like a valid phone number"],
  [21614, "that isn't a mobile number that can receive texts"],
  [21610, 'that number has opted out of messages'],
  [21608, 'this server can only text numbers verified on its trial SMS account'],
  [21408, "texts to that country aren't enabled on this server"],
]);

export interface TwilioMessengerConfig {
  accountSid: string;
  authToken: string;
  /**
   * Sends every SMS from this number instead of the Agency's connected SMS number
   * (OutboundMessage.from): for the demo, whose seeded Agency number isn't a Twilio number.
   */
  smsFrom?: string;
  /** The same for WhatsApp: the sandbox number, "+14155238886", or a registered sender. */
  whatsappFrom?: string;
  /** Signs the links Twilio fetches attachments from. Without it, a message with attachments throws. */
  fileLinks?: FileLinks | null;
  fetch?: typeof fetch;
  apiBaseUrl?: string;
}

/** The Messenger for the 'sms' and 'whatsapp' channels. */
export function createTwilioMessenger({
  accountSid,
  authToken,
  smsFrom,
  whatsappFrom,
  fileLinks,
  fetch: fetchImpl = fetch,
  apiBaseUrl = 'https://api.twilio.com',
}: TwilioMessengerConfig): Messenger {
  const url = `${apiBaseUrl}/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;

  async function post(message: OutboundMessage, params: URLSearchParams) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: params.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return;
    const text = await response.text();
    const error = parseError(text);
    const detail = error ? `${error.code ?? 'no code'} ${error.message ?? ''}`.trim() : text.slice(0, 200);
    if (error?.code !== undefined && TWILIO_UNDELIVERABLE_CODES.has(error.code)) {
      throw new UndeliverableError(message.channelType, message.to, `Twilio ${detail}`, TWILIO_USER_REASONS.get(error.code));
    }
    const friendly = error?.code === undefined ? undefined : TWILIO_USER_REASONS.get(error.code);
    if (friendly) throw new ProviderRefusedError(`Twilio returned ${response.status}: ${detail}`, friendly);
    throw new Error(`Twilio returned ${response.status}: ${detail}`);
  }

  return {
    async send(message) {
      const { channelType } = message;
      if (channelType !== 'sms' && channelType !== 'whatsapp') throw new Error(`Twilio can't send ${channelType} messages`);
      const prefix = channelType === 'whatsapp' ? 'whatsapp:' : '';
      const from = (channelType === 'whatsapp' ? whatsappFrom : smsFrom) ?? message.from;
      const media = message.attachments.map((attachment) => {
        if (attachment.id === undefined) throw new Error(`Twilio can only send stored files: ${attachment.filename} has no file id`);
        if (!fileLinks) throw new Error('Twilio needs file links (FILE_LINK_SECRET and PUBLIC_URL) to send attachments');
        return fileLinks.url(attachment.id);
      });

      // The first message carries the text; any media that doesn't fit follows on its own.
      const perMessage = channelType === 'whatsapp' ? 1 : MAX_MMS_MEDIA;
      const batches: string[][] = [media.slice(0, perMessage)];
      for (let i = perMessage; i < media.length; i += perMessage) batches.push(media.slice(i, i + perMessage));

      for (const [i, batch] of batches.entries()) {
        const params = new URLSearchParams({ To: prefix + message.to, From: prefix + from });
        if (i === 0) params.set('Body', message.text);
        for (const mediaUrl of batch) params.append('MediaUrl', mediaUrl);
        await post(message, params);
      }
    },
  };
}

function parseError(text: string): { code?: number; message?: string } | null {
  try {
    const body = JSON.parse(text) as unknown;
    if (typeof body !== 'object' || body === null) return null;
    const { code, message } = body as Record<string, unknown>;
    return { ...(typeof code === 'number' ? { code } : {}), ...(typeof message === 'string' ? { message } : {}) };
  } catch {
    return null;
  }
}
