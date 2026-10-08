import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { sendgridToInbound, verifySendgridSignature } from '../../src/adapters/sendgrid.ts';

const receivedAt = new Date('2026-10-08T09:00:00+11:00');
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

/** An Inbound Parse POST as SendGrid sends it: a reply from a Tradie with a PDF quote. */
function recordedParse() {
  const form = new FormData();
  form.set(
    'headers',
    [
      'Received: by mx0047p1mdw1.sendgrid.net with SMTP id 6WCVv7KAWn Thu, 08 Oct 2026 09:00:00 +0000 (UTC)',
      'MIME-Version: 1.0',
      'From: Quinn Quick <Quotes@QuickPipes.example>',
      'Date: Thu, 8 Oct 2026 20:00:00 +1100',
      'Message-ID: <CAJ8x3k2=qQ9@mail.quickpipes.example>',
      'Subject: Re: Quote request',
      'To: inbox@harbour.example',
      'Content-Type: multipart/mixed; boundary="000000000000a1b2c3"',
    ].join('\n'),
  );
  form.set('dkim', '{@quickpipes.example : pass}');
  form.set('content-ids', '{}');
  form.set('to', 'inbox@harbour.example');
  form.set('from', 'Quinn Quick <Quotes@QuickPipes.example>');
  form.set(
    'text',
    [
      '$260 inc GST, I can come Wednesday 9am.',
      '',
      'Quinn',
      '',
      'On Thu, 8 Oct 2026 at 18:00, Harbour Realty <inbox@harbour.example> wrote:',
      '> Harbour Realty is asking for a quote: plumbing job in Newtown (routine).',
      '> Reply with your price and earliest time, or reply NO to decline.',
    ].join('\n'),
  );
  form.set('sender_ip', '209.85.208.41');
  form.set('envelope', JSON.stringify({ to: ['inbox@harbour.example'], from: 'Quotes@QuickPipes.example' }));
  form.set('attachments', '1');
  form.set('subject', 'Re: Quote request');
  form.set('attachment-info', JSON.stringify({ attachment1: { filename: 'Quote-1042.pdf', name: 'Quote-1042.pdf', type: 'application/pdf' } }));
  form.set('charsets', JSON.stringify({ to: 'UTF-8', subject: 'UTF-8', from: 'UTF-8', text: 'UTF-8' }));
  form.set('SPF', 'pass');
  form.set('attachment1', new File([PDF], 'Quote-1042.pdf', { type: 'application/pdf' }));
  return form;
}

describe('SendGrid Inbound Parse', () => {
  test('a reply with a PDF becomes an inbound message, without the quoted text', async () => {
    const message = await sendgridToInbound(recordedParse(), receivedAt);

    expect(message).toEqual({
      providerMessageId: '<CAJ8x3k2=qQ9@mail.quickpipes.example>',
      agencyChannel: 'inbox@harbour.example',
      channelType: 'email',
      from: 'quotes@quickpipes.example',
      text: '$260 inc GST, I can come Wednesday 9am.\n\nQuinn',
      attachments: [{ filename: 'Quote-1042.pdf', contentType: 'application/pdf', content: PDF }],
      receivedAt,
    });
  });

  test("a new email keeps its subject, and falls back to the From and To fields when there's no envelope", async () => {
    const form = new FormData();
    form.set('headers', 'Subject: Leaking tap\nTo: inbox@harbour.example');
    form.set('to', 'Harbour Realty <Inbox@Harbour.example>');
    form.set('from', 'Bella Bui <Bella@Example.com>');
    form.set('subject', 'Leaking tap');
    form.set('html', '<p>The bathroom tap <b>drips</b> all night.</p>');
    form.set('attachments', '0');

    const message = await sendgridToInbound(form, receivedAt);

    expect(message).toMatchObject({
      agencyChannel: 'inbox@harbour.example',
      from: 'bella@example.com',
      text: 'Leaking tap\n\nThe bathroom tap drips all night.',
      attachments: [],
    });
    expect(message.providerMessageId).toMatch(/^[0-9a-f]{64}$/);
    expect((await sendgridToInbound(form, receivedAt)).providerMessageId).toBe(message.providerMessageId);
  });
});

describe('SendGrid request signature', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const timestamp = '1791496800';
  const body = new TextEncoder().encode('--xYzZY\r\nContent-Disposition: form-data; name="text"\r\n\r\nYES\r\n--xYzZY--\r\n');
  const signature = sign('sha256', Buffer.concat([Buffer.from(timestamp), body]), privateKey).toString('base64');

  test('a request signed by SendGrid is accepted', () => {
    expect(verifySendgridSignature(publicKeyBase64, timestamp, body, signature)).toBe(true);
  });

  test('an altered body, a different timestamp or a garbage signature is refused', () => {
    const altered = new TextEncoder().encode(new TextDecoder().decode(body).replace('YES', 'NO!'));
    expect(verifySendgridSignature(publicKeyBase64, timestamp, altered, signature)).toBe(false);
    expect(verifySendgridSignature(publicKeyBase64, '1791496801', body, signature)).toBe(false);
    expect(verifySendgridSignature(publicKeyBase64, timestamp, body, 'not-a-signature')).toBe(false);
    expect(verifySendgridSignature('not-a-key', timestamp, body, signature)).toBe(false);
  });
});
