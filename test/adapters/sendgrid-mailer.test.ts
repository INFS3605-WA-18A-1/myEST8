import { describe, expect, test } from 'vitest';
import { createSendgridMailer } from '../../src/adapters/sendgrid-mailer.ts';
import { UndeliverableError, type OutboundMessage } from '../../src/ports.ts';
import { json, stubFetch } from './stub-fetch.ts';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

const message = (overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
  agencyId: 1,
  channelType: 'email',
  from: 'inbox@harbour.example',
  to: 'quotes@quickpipes.example',
  cc: [],
  subject: 'Quote request: 12 King St, Newtown',
  text: 'Could you quote for a dripping kitchen tap?',
  template: 'quotes.request',
  data: {},
  attachments: [],
  ...overrides,
});

const accepted = () => new Response(null, { status: 202 });

function sendgrid(respond: () => Response = accepted, from?: string) {
  const stub = stubFetch(respond);
  return { stub, mailer: createSendgridMailer({ apiKey: 'SG.test-key', fetch: stub.fetch, ...(from ? { from } : {}) }) };
}

describe('SendGrid outbound email', () => {
  test('posts to v3 mail/send with the key, plain text, and reply-to the Agency inbox', async () => {
    const { stub, mailer } = sendgrid();
    await mailer.send(message());

    const request = stub.requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect(request.headers.get('authorization')).toBe('Bearer SG.test-key');
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(await request.json()).toEqual({
      personalizations: [{ to: [{ email: 'quotes@quickpipes.example' }] }],
      from: { email: 'inbox@harbour.example' },
      reply_to: { email: 'inbox@harbour.example' },
      subject: 'Quote request: 12 King St, Newtown',
      content: [{ type: 'text/plain', value: 'Could you quote for a dripping kitchen tap?' }],
    });
  });

  test('a configured sender replaces the from address, and replies still go to the Agency inbox', async () => {
    const { stub, mailer } = sendgrid(accepted, 'notifications@myest8.example');
    await mailer.send(message());
    const body = (await stub.requests[0]!.json()) as { from: unknown; reply_to: unknown };
    expect(body.from).toEqual({ email: 'notifications@myest8.example' });
    expect(body.reply_to).toEqual({ email: 'inbox@harbour.example' });
  });

  test('cc goes in the personalization, without repeating an address', async () => {
    const { stub, mailer } = sendgrid();
    await mailer.send(message({ to: 'bella@example.com', cc: ['bob@harbour.example', 'Bob@Harbour.example', 'BELLA@example.com'] }));
    const body = (await stub.requests[0]!.json()) as { personalizations: unknown };
    expect(body.personalizations).toEqual([{ to: [{ email: 'bella@example.com' }], cc: [{ email: 'bob@harbour.example' }] }]);
  });

  test('attachments go base64-encoded with their name and type', async () => {
    const { stub, mailer } = sendgrid();
    await mailer.send(message({ attachments: [{ id: 3, filename: 'quote.pdf', contentType: 'application/pdf', content: PDF }] }));
    const body = (await stub.requests[0]!.json()) as { attachments: unknown };
    expect(body.attachments).toEqual([{ content: 'JVBERi0=', filename: 'quote.pdf', type: 'application/pdf', disposition: 'attachment' }]);
  });

  test('SMS is not a SendGrid channel', async () => {
    const { mailer } = sendgrid();
    await expect(mailer.send(message({ channelType: 'sms', to: '+61400000001' }))).rejects.toThrow("SendGrid can't send sms messages");
  });

  test('a 400 refusing the recipient address is undeliverable, which the worker does not retry', async () => {
    const { mailer } = sendgrid(() =>
      json({ errors: [{ message: 'Does not contain a valid address.', field: 'personalizations.0.to.0.email', help: 'http://sendgrid.com/docs/API_Reference/Web_API_v3/Mail/errors.html#message.personalizations.to' }] }, 400),
    );
    const error = await mailer.send(message({ to: 'not-an-address' })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UndeliverableError);
    expect((error as Error).message).toBe('Undeliverable email message to not-an-address: SendGrid personalizations.0.to.0.email: Does not contain a valid address.');
  });

  test.each([
    ['an unverified sender', () => json({ errors: [{ message: 'The from address does not match a verified Sender Identity.', field: 'from', help: null }] }, 403), 'SendGrid returned 403: from: The from address does not match a verified Sender Identity.'],
    ['a rate limit', () => json({ errors: [{ message: 'too many requests', field: null, help: null }] }, 429), 'SendGrid returned 429: too many requests'],
    ['an outage', () => new Response('upstream connect error', { status: 502 }), 'SendGrid returned 502: upstream connect error'],
    ['bad credentials', () => json({ errors: [{ message: 'The provided authorization grant is invalid, expired, or revoked', field: null, help: null }] }, 401), 'SendGrid returned 401: The provided authorization grant is invalid, expired, or revoked'],
  ])('%s throws a plain error, so the worker retries', async (_, respond, text) => {
    const { mailer } = sendgrid(respond);
    const error = await mailer.send(message()).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(UndeliverableError);
    expect((error as Error).message).toBe(text);
    expect((error as Error).message).not.toContain('SG.test-key');
  });
});
