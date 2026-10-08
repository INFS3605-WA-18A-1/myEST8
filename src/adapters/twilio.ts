// Twilio Programmable Messaging (SMS and WhatsApp): the inbound webhook, its
// request signature, and downloading media it sends by URL.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FetchMedia, InboundMessage } from '../ports.ts';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

const stripWhatsApp = (address: string) => address.replace(/^whatsapp:/, '');

/** Converts Twilio's messaging webhook parameters into the common inbound message. */
export function twilioToInbound(params: Record<string, string>, receivedAt: Date): InboundMessage {
  const from = params.From ?? '';
  const mediaCount = Number(params.NumMedia ?? 0);
  return {
    providerMessageId: params.MessageSid ?? params.SmsMessageSid ?? '',
    agencyChannel: stripWhatsApp(params.To ?? ''),
    channelType: from.startsWith('whatsapp:') ? 'whatsapp' : 'sms',
    from: stripWhatsApp(from),
    text: params.Body ?? '',
    attachments: Array.from({ length: mediaCount }, (_, i) => {
      const contentType = params[`MediaContentType${i}`] ?? 'application/octet-stream';
      return { filename: `media-${i}.${EXTENSIONS[contentType] ?? 'bin'}`, contentType, url: params[`MediaUrl${i}`] ?? '' };
    }),
    receivedAt,
  };
}

/**
 * Checks the X-Twilio-Signature header: base64 HMAC-SHA1, keyed by the auth token,
 * of the full URL followed by every POST parameter's name and value, sorted by name.
 */
export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string) {
  const payload = url + Object.keys(params).sort().map((key) => key + params[key]).join('');
  const expected = Buffer.from(createHmac('sha1', authToken).update(payload).digest('base64'));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Downloads Twilio media, which needs the account's credentials when media auth is on. */
export function twilioFetchMedia(accountSid: string, authToken: string): FetchMedia {
  const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
  return async (url) => {
    const response = await fetch(url, { headers: { authorization } });
    if (!response.ok) throw new Error(`Twilio media download failed: ${response.status} ${url}`);
    return new Uint8Array(await response.arrayBuffer());
  };
}
