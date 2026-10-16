import { describe, expect, test } from 'vitest';
import { createResendMailer } from '../../src/adapters/resend-mailer.ts';
import { UndeliverableError, type OutboundMessage } from '../../src/ports.ts';
import { json, stubFetch } from './stub-fetch.ts';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const API_KEY = 're_test_key';

const message = (overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
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

const accepted = () => json({ id: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c' });

function resend(respond: () => Response = accepted) {
  const stub = stubFetch(respond);
  return { stub, mailer: createResendMailer({ apiKey: API_KEY, fetch: stub.fetch }) };
}

describe('Resend outbound email', () => {
  test('posts the Agency channel address, subject and plain text to /emails', async () => {
    const { stub, mailer } = resend();
    await mailer.send(message());

    const request = stub.requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://api.resend.com/emails');
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(request.headers.get('idempotency-key')).toBeNull();
    expect(await request.json()).toEqual({
      from: 'inbox@harbour.example',
      to: ['quotes@quickpipes.example'],
      subject: 'Quote request: 12 King St, Newtown',
      text: 'Could you quote for a dripping kitchen tap?',
    });
  });

  test('sends an Idempotency-Key when the outbound message has an id', async () => {
    const { stub, mailer } = resend();
    await mailer.send(message({ id: 'out-41' }));
    expect(stub.requests[0]!.headers.get('idempotency-key')).toBe('out-41');
  });

  test('cc is a list of addresses, without repeating the recipient', async () => {
    const { stub, mailer } = resend();
    await mailer.send(message({ to: 'bella@example.com', cc: ['bob@harbour.example', 'Bob@Harbour.example', 'BELLA@example.com'] }));
    const body = (await stub.requests[0]!.json()) as { cc: unknown };
    expect(body.cc).toEqual(['bob@harbour.example']);
  });

  test('attachments go base64-encoded with their filename', async () => {
    const { stub, mailer } = resend();
    await mailer.send(message({ attachments: [{ id: 3, filename: 'quote.pdf', contentType: 'application/pdf', content: PDF }] }));
    const body = (await stub.requests[0]!.json()) as { attachments: unknown };
    expect(body.attachments).toEqual([{ content: 'JVBERi0=', filename: 'quote.pdf' }]);
  });

  test('SMS is not a Resend channel', async () => {
    const { stub, mailer } = resend();
    await expect(mailer.send(message({ channelType: 'sms', to: '+61400000001' }))).rejects.toThrow("Resend can't send sms messages");
    expect(stub.requests).toHaveLength(0);
  });

  test.each([
    ['an invalid recipient', () => json({ statusCode: 422, name: 'validation_error', message: 'Invalid `to` field.' }, 422), 'not-an-address', 'Undeliverable email message to not-an-address: Resend validation_error: Invalid `to` field.'],
    ['a validation error', () => json({ statusCode: 400, name: 'validation_error', message: 'An error was found with one or more fields in the request.' }, 400), 'quotes@quickpipes.example', 'Undeliverable email message to quotes@quickpipes.example: Resend validation_error: An error was found with one or more fields in the request.'],
    ['an invalid attachment', () => json({ statusCode: 422, name: 'invalid_attachment', message: 'Attachment must have either a `content` or `path`.' }, 422), 'quotes@quickpipes.example', 'Undeliverable email message to quotes@quickpipes.example: Resend invalid_attachment: Attachment must have either a `content` or `path`.'],
    ['a missing field', () => json({ statusCode: 422, name: 'missing_required_field', message: 'The request body is missing one or more required fields.' }, 422), 'quotes@quickpipes.example', 'Undeliverable email message to quotes@quickpipes.example: Resend missing_required_field: The request body is missing one or more required fields.'],
    ['an invalid parameter', () => json({ statusCode: 422, name: 'invalid_parameter', message: 'The `parameter` must be a valid UUID.' }, 422), 'quotes@quickpipes.example', 'Undeliverable email message to quotes@quickpipes.example: Resend invalid_parameter: The `parameter` must be a valid UUID.'],
    ['an unverified sending domain', () => json({ statusCode: 403, name: 'validation_error', message: 'The `harbour.example` domain is not verified. Please, add and verify your domain.' }, 403), 'quotes@quickpipes.example', 'Undeliverable email message to quotes@quickpipes.example: Resend validation_error: The `harbour.example` domain is not verified. Please, add and verify your domain.'],
  ])('%s is undeliverable, which the worker does not retry', async (_, respond, to, text) => {
    const { mailer } = resend(respond);
    const error = await mailer.send(message({ to })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UndeliverableError);
    expect((error as UndeliverableError).permanent).toBe(true);
    expect((error as Error).message).toBe(text);
    expect((error as Error).message).not.toContain(API_KEY);
  });

  test.each([
    ['a rate limit', () => json({ statusCode: 429, name: 'rate_limit_exceeded', message: 'Too many requests.' }, 429), 'Resend returned 429: rate_limit_exceeded: Too many requests.'],
    ['an outage', () => new Response('upstream connect error', { status: 502 }), 'Resend returned 502: upstream connect error'],
    ['bad credentials', () => json({ statusCode: 401, name: 'missing_api_key', message: `Missing API key ${API_KEY}` }, 401), 'Resend returned 401: missing_api_key: Missing API key [redacted]'],
    ['an idempotency conflict', () => json({ statusCode: 409, name: 'concurrent_idempotent_requests', message: 'There is another request in progress with the same idempotency key.' }, 409), 'Resend returned 409: concurrent_idempotent_requests: There is another request in progress with the same idempotency key.'],
  ])('%s throws a plain error, so the worker retries', async (_, respond, text) => {
    const { mailer } = resend(respond);
    const error = await mailer.send(message()).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(UndeliverableError);
    expect((error as Error).message).toBe(text);
    expect((error as Error).message).not.toContain(API_KEY);
  });
});
