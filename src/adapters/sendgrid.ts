// Twilio SendGrid Inbound Parse (email): the inbound webhook and its request signature.

import { createHash, verify } from 'node:crypto';
import type { InboundAttachment, InboundMessage } from '../ports.ts';
import { emailAddress, htmlToText, withoutQuotedReply } from './email-text.ts';

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : null;
};

/** Converts an Inbound Parse POST into the common inbound message. */
export async function sendgridToInbound(form: FormData, receivedAt: Date): Promise<InboundMessage> {
  const headers = field(form, 'headers') ?? '';
  const rawText = field(form, 'text') ?? htmlToText(field(form, 'html') ?? '');
  const envelope = JSON.parse(field(form, 'envelope') ?? '{}') as { to?: string[]; from?: string };
  const subject = (field(form, 'subject') ?? '').trim();
  const body = withoutQuotedReply(rawText.replace(/\r\n/g, '\n'));
  const isReply = /^(re|fwd?):/i.test(subject);

  const info = JSON.parse(field(form, 'attachment-info') ?? '{}') as Record<string, { filename?: string; type?: string }>;
  const attachments: InboundAttachment[] = [];
  for (let i = 1; i <= Number(field(form, 'attachments') ?? 0); i++) {
    const file = form.get(`attachment${i}`);
    if (!(file instanceof File)) continue;
    attachments.push({
      filename: info[`attachment${i}`]?.filename ?? file.name,
      contentType: info[`attachment${i}`]?.type ?? (file.type || 'application/octet-stream'),
      content: new Uint8Array(await file.arrayBuffer()),
    });
  }

  return {
    // SendGrid retries a failed POST with the same email, so its Message-ID identifies it.
    providerMessageId:
      /^Message-ID:\s*(.+)$/im.exec(headers)?.[1]?.trim() ?? createHash('sha256').update(headers + rawText).digest('hex'),
    agencyChannel: emailAddress(envelope.to?.[0] ?? field(form, 'to') ?? ''),
    channelType: 'email',
    from: emailAddress(envelope.from ?? field(form, 'from') ?? ''),
    text: subject && !isReply ? `${subject}\n\n${body}` : body,
    attachments,
    receivedAt,
  };
}

/**
 * Checks a signed Inbound Parse request: an ECDSA (P-256, SHA-256) signature over the
 * timestamp header followed by the raw request body, made with SendGrid's private key.
 * Verify before any multipart parsing, which would change the bytes.
 */
export function verifySendgridSignature(publicKeyBase64: string, timestamp: string, rawBody: Uint8Array, signatureBase64: string) {
  try {
    return verify(
      'sha256',
      Buffer.concat([Buffer.from(timestamp), rawBody]),
      { key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' },
      Buffer.from(signatureBase64, 'base64'),
    );
  } catch {
    return false;
  }
}
