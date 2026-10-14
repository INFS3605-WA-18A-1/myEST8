// The real Messenger: SMS and WhatsApp through Twilio, email through SendGrid
// (ADR-0003), routed by the message's channel and built from environment
// variables. Credentials are only ever read from the environment.

import { createFileLinks, type FileLinks } from '../file-links.ts';
import type { ChannelType, Clock, Messenger } from '../ports.ts';
import { createMetaWhatsApp } from './meta-whatsapp.ts';
import { createSendgridMailer } from './sendgrid-mailer.ts';
import { createTwilioMessenger } from './twilio-messenger.ts';

export type ChannelMessengers = Partial<Record<ChannelType, Messenger>>;

/** Sends each message through the Messenger for its channel. A channel with none throws. */
export function routeByChannel(byChannel: ChannelMessengers): Messenger {
  return {
    async send(message) {
      const messenger = byChannel[message.channelType];
      if (!messenger) throw new Error(`No provider is configured for ${message.channelType} messages`);
      await messenger.send(message);
    },
  };
}

/**
 * The providers the environment configures, by channel, and the file links Twilio
 * attachments need:
 * - TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN: SMS and WhatsApp; needs FILE_LINK_SECRET
 *   and PUBLIC_URL. Optional TWILIO_SMS_FROM and TWILIO_WHATSAPP_FROM override the
 *   Agency's own numbers as the sender.
 * - SENDGRID_API_KEY: email. Optional SENDGRID_FROM overrides the Agency's inbox
 *   address as the sender (reply-to stays the Agency's inbox).
 * Throws when a provider is half-configured, so a wrong setup fails at start-up
 * rather than on the first message.
 */
export function messengersFromEnv(
  env: Record<string, string | undefined>,
  { clock, fetch: fetchImpl = fetch }: { clock: Clock; fetch?: typeof fetch },
): { channels: ChannelMessengers; fileLinks: FileLinks | null } {
  const set = (name: string) => env[name]?.trim() || undefined;
  const channels: ChannelMessengers = {};

  const fileLinks = set('FILE_LINK_SECRET') && set('PUBLIC_URL') ? createFileLinks({ secret: set('FILE_LINK_SECRET')!, baseUrl: set('PUBLIC_URL')!, clock }) : null;

  const accountSid = set('TWILIO_ACCOUNT_SID');
  const authToken = set('TWILIO_AUTH_TOKEN');
  if (!!accountSid !== !!authToken) throw new Error('Set both TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN, or neither');
  if (accountSid && authToken) {
    if (!fileLinks) throw new Error('Twilio sends attachments by link: set FILE_LINK_SECRET and a public PUBLIC_URL too');
    const smsFrom = set('TWILIO_SMS_FROM');
    const whatsappFrom = set('TWILIO_WHATSAPP_FROM');
    const twilio = createTwilioMessenger({
      accountSid,
      authToken,
      ...(smsFrom ? { smsFrom } : {}),
      ...(whatsappFrom ? { whatsappFrom } : {}),
      fileLinks,
      fetch: fetchImpl,
    });
    channels.sms = twilio;
    channels.whatsapp = twilio;
  }

  // Meta's WhatsApp Cloud API (ADR 0004) takes WhatsApp over from Twilio when set.
  const metaNumberId = set('META_WHATSAPP_PHONE_NUMBER_ID');
  const metaToken = set('META_WHATSAPP_ACCESS_TOKEN');
  if (!!metaNumberId !== !!metaToken) throw new Error('Set both META_WHATSAPP_PHONE_NUMBER_ID and META_WHATSAPP_ACCESS_TOKEN, or neither');
  if (metaNumberId && metaToken) channels.whatsapp = createMetaWhatsApp({ phoneNumberId: metaNumberId, accessToken: metaToken, fetch: fetchImpl });

  const sendgridKey = set('SENDGRID_API_KEY');
  if (sendgridKey) {
    const from = set('SENDGRID_FROM');
    channels.email = createSendgridMailer({ apiKey: sendgridKey, ...(from ? { from } : {}), fetch: fetchImpl });
  }

  return { channels, fileLinks };
}
