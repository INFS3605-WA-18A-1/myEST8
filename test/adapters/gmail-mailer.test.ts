import { describe, expect, test, vi } from 'vitest';
import { createGmailMessenger } from '../../src/adapters/gmail-mailer.ts';
import { UndeliverableError, type OutboundMessage } from '../../src/ports.ts';
import { json, stubFetch } from './stub-fetch.ts';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

const message = (overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
  agencyId: 7,
  channelType: 'email',
  from: 'inbox@harbour.example',
  to: 'quotes@quickpipes.example',
  cc: [],
  subject: 'Quote request: 12 King St, Newtown',
  text: 'Could you quote for a dripping kitchen tap?\nThanks, Harbour Realty',
  template: 'quotes.request',
  data: {},
  attachments: [],
  ...overrides,
});

const accepted = () => json({ id: '19a1b2c3', threadId: '19a1b2c3', labelIds: ['SENT'] });

function gmail(respond: () => Response = accepted) {
  const stub = stubFetch(respond);
  const accessToken = vi.fn(async (_agencyId: number) => 'ya29.test');
  return { stub, accessToken, mailer: createGmailMessenger({ accessToken, fetch: stub.fetch }) };
}

/** The RFC 5322 message Gmail was asked to send, headers unfolded and lowercased. */
async function sentMessage(request: Request) {
  const { raw } = (await request.json()) as { raw: string };
  expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const split = text.indexOf('\r\n\r\n');
  const headers = new Map<string, string>();
  for (const line of text.slice(0, split).replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const colon = line.indexOf(':');
    headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
  }
  return { headers, body: text.slice(split + 4), text };
}
const decodeBase64 = (block: string) => Buffer.from(block.replace(/\s/g, ''), 'base64');

describe('Gmail outbound email', () => {
  test('sends as the Agency mailbox: posts the raw message to messages.send with the Agency token', async () => {
    const { stub, accessToken, mailer } = gmail();
    await mailer.send(message());

    expect(accessToken).toHaveBeenCalledWith(7);
    const request = stub.requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(request.headers.get('authorization')).toBe('Bearer ya29.test');
    expect(request.headers.get('content-type')).toBe('application/json');

    const sent = await sentMessage(request);
    expect(sent.headers.get('from')).toBe('inbox@harbour.example');
    expect(sent.headers.get('to')).toBe('quotes@quickpipes.example');
    expect(sent.headers.get('subject')).toBe('Quote request: 12 King St, Newtown');
    expect(sent.headers.get('mime-version')).toBe('1.0');
    expect(sent.headers.get('content-type')).toBe('text/plain; charset=UTF-8');
    expect(sent.headers.get('content-transfer-encoding')).toBe('base64');
    expect(sent.headers.has('cc')).toBe(false);
    expect(decodeBase64(sent.body).toString('utf8')).toBe('Could you quote for a dripping kitchen tap?\nThanks, Harbour Realty');
  });

  test('cc goes in the Cc header, without repeating an address', async () => {
    const { stub, mailer } = gmail();
    await mailer.send(message({ to: 'bella@example.com', cc: ['bob@harbour.example', 'Bob@Harbour.example', 'BELLA@example.com'] }));
    expect((await sentMessage(stub.requests[0]!)).headers.get('cc')).toBe('bob@harbour.example');
  });

  test('a subject with characters outside ASCII is encoded, a plain one is not', async () => {
    const { stub, mailer } = gmail();
    await mailer.send(message({ subject: 'Quote request: 12 King St – Newtown' }));
    const encoded = (await sentMessage(stub.requests[0]!)).headers.get('subject')!;
    expect(encoded).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    expect(Buffer.from(encoded.slice('=?UTF-8?B?'.length, -2), 'base64').toString('utf8')).toBe('Quote request: 12 King St – Newtown');
  });

  test('a subject cannot smuggle in another header', async () => {
    const { stub, mailer } = gmail();
    await mailer.send(message({ subject: 'Quote request\r\nBcc: attacker@evil.example' }));
    const sent = await sentMessage(stub.requests[0]!);
    expect(sent.headers.has('bcc')).toBe(false);
    expect(sent.headers.get('subject')).not.toMatch(/[\r\n]/);
  });

  test('an address that is not a plain email is undeliverable and nothing is sent', async () => {
    const { stub, mailer } = gmail();
    await expect(mailer.send(message({ to: 'a@b.example\r\nBcc: x@y.example' }))).rejects.toBeInstanceOf(UndeliverableError);
    await expect(mailer.send(message({ to: '+61400000001' }))).rejects.toBeInstanceOf(UndeliverableError);
    await expect(mailer.send(message({ cc: ['not an email'] }))).rejects.toBeInstanceOf(UndeliverableError);
    expect(stub.requests).toHaveLength(0);
  });

  test('attachments make a multipart message with the text first', async () => {
    const { stub, mailer } = gmail();
    await mailer.send(message({ attachments: [{ filename: 'Quote-1042.pdf', contentType: 'application/pdf', content: PDF }] }));
    const sent = await sentMessage(stub.requests[0]!);

    const contentType = sent.headers.get('content-type')!;
    const boundary = /^multipart\/mixed; boundary="([^"]+)"$/.exec(contentType)?.[1];
    expect(boundary).toBeTruthy();
    const parts = sent.body.split(`--${boundary}`).filter((part) => part.trim() && part.trim() !== '--');
    expect(parts).toHaveLength(2);

    const [textPart, filePart] = parts.map((part) => {
      const [head, ...rest] = part.replace(/^\r\n/, '').split('\r\n\r\n');
      return { head: head!, body: rest.join('\r\n\r\n') };
    });
    expect(textPart!.head).toMatch(/Content-Type: text\/plain; charset=UTF-8/i);
    expect(decodeBase64(textPart!.body).toString('utf8')).toBe('Could you quote for a dripping kitchen tap?\nThanks, Harbour Realty');
    expect(filePart!.head).toMatch(/Content-Type: application\/pdf/i);
    expect(filePart!.head).toMatch(/Content-Disposition: attachment; filename="Quote-1042\.pdf"/i);
    expect(Uint8Array.from(decodeBase64(filePart!.body))).toEqual(PDF);
  });

  test('Gmail refusing a recipient is undeliverable, so the worker stops retrying', async () => {
    for (const reason of ['Invalid To header', 'Recipient address required']) {
      const { mailer } = gmail(() => json({ error: { code: 400, message: reason, status: 'INVALID_ARGUMENT' } }, 400));
      await expect(mailer.send(message())).rejects.toBeInstanceOf(UndeliverableError);
    }
  });

  test('other failures throw an ordinary error so the worker retries, without the token in it', async () => {
    const failures = [
      json({ error: { code: 400, message: 'Message too large' } }, 400),
      json({ error: { code: 401, message: 'Invalid Credentials' } }, 401),
      json({ error: { code: 429, message: 'Rate Limit Exceeded' } }, 429),
      new Response('backend error', { status: 500 }),
    ];
    for (const failure of failures) {
      const { mailer } = gmail(() => failure.clone());
      const error = await mailer.send(message()).catch((e: unknown) => e as Error);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(UndeliverableError);
      expect((error as Error).message).not.toContain('ya29.test');
    }
  });
});
