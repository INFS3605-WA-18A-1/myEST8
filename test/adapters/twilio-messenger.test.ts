import { describe, expect, test } from 'vitest';
import { createTwilioMessenger } from '../../src/adapters/twilio-messenger.ts';
import { createFileLinks } from '../../src/file-links.ts';
import { UndeliverableError, type OutboundMessage } from '../../src/ports.ts';
import { FakeClock } from '../support/fakes.ts';
import { json, stubFetch } from './stub-fetch.ts';

const SID = 'AC00000000000000000000000000000000';
const TOKEN = 'twilio-auth-token';
const clock = new FakeClock(new Date('2026-10-08T09:00:00+11:00'));
const fileLinks = createFileLinks({ secret: 'a-test-secret-that-is-long-enough-1234', baseUrl: 'https://myest8.test/', clock });

const queued = () => json({ sid: 'SM00000000000000000000000000000001', status: 'queued' }, 201);

const message = (overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
  channelType: 'sms',
  from: '+61290000000',
  to: '+61400000001',
  cc: [],
  subject: 'Your maintenance request',
  text: 'Thanks, we got your message about the kitchen tap.',
  template: 'intake.acknowledged',
  data: {},
  attachments: [],
  ...overrides,
});

const photo = (id: number) => ({ id, filename: `photo-${id}.jpg`, contentType: 'image/jpeg', content: new Uint8Array([0xff, 0xd8, 0xff]) });

function twilio(respond: () => Response = queued, config: { smsFrom?: string; whatsappFrom?: string } = {}) {
  const stub = stubFetch(respond);
  return { stub, messenger: createTwilioMessenger({ accountSid: SID, authToken: TOKEN, fileLinks, fetch: stub.fetch, ...config }) };
}

const form = async (request: Request) => new URLSearchParams(await request.text());

describe('Twilio outbound messages', () => {
  test('an SMS posts To, From and Body to the Messages API with basic auth', async () => {
    const { stub, messenger } = twilio();
    await messenger.send(message());

    expect(stub.requests).toHaveLength(1);
    const request = stub.requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
    expect(request.headers.get('authorization')).toBe(`Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`);
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect([...(await form(request))]).toEqual([
      ['To', '+61400000001'],
      ['From', '+61290000000'],
      ['Body', 'Thanks, we got your message about the kitchen tap.'],
    ]);
  });

  test('a WhatsApp message prefixes both addresses with whatsapp:', async () => {
    const { stub, messenger } = twilio();
    await messenger.send(message({ channelType: 'whatsapp' }));
    const params = await form(stub.requests[0]!);
    expect(params.get('To')).toBe('whatsapp:+61400000001');
    expect(params.get('From')).toBe('whatsapp:+61290000000');
  });

  test('a configured sender replaces the Agency number on its channel only', async () => {
    const { stub, messenger } = twilio(queued, { whatsappFrom: '+14155238886' });
    await messenger.send(message({ channelType: 'whatsapp' }));
    await messenger.send(message());
    expect((await form(stub.requests[0]!)).get('From')).toBe('whatsapp:+14155238886');
    expect((await form(stub.requests[1]!)).get('From')).toBe('+61290000000');
  });

  test('attachments go as signed, expiring file links in MediaUrl', async () => {
    const { stub, messenger } = twilio();
    await messenger.send(message({ attachments: [photo(7), photo(8)] }));

    const media = (await form(stub.requests[0]!)).getAll('MediaUrl');
    expect(media).toHaveLength(2);
    const url = new URL(media[0]!);
    expect(url.origin + url.pathname).toBe('https://myest8.test/media/7');
    expect(Number(url.searchParams.get('expires')) * 1000).toBe(clock.now().getTime() + 60 * 60 * 1000);
    expect(fileLinks.check('7', url.searchParams.get('expires')!, url.searchParams.get('signature')!)).toBe(true);
    expect(new URL(media[1]!).pathname).toBe('/media/8');
  });

  test('WhatsApp takes one media file per message, so the rest follow on their own', async () => {
    const { stub, messenger } = twilio();
    await messenger.send(message({ channelType: 'whatsapp', attachments: [photo(1), photo(2), photo(3)] }));

    expect(stub.requests).toHaveLength(3);
    const [first, second, third] = await Promise.all(stub.requests.map(form));
    expect(first!.get('Body')).toBe('Thanks, we got your message about the kitchen tap.');
    expect(first!.getAll('MediaUrl').map((u) => new URL(u).pathname)).toEqual(['/media/1']);
    expect(second!.has('Body')).toBe(false);
    expect(second!.getAll('MediaUrl').map((u) => new URL(u).pathname)).toEqual(['/media/2']);
    expect(third!.getAll('MediaUrl').map((u) => new URL(u).pathname)).toEqual(['/media/3']);
    expect(second!.get('To')).toBe('whatsapp:+61400000001');
  });

  test('an MMS takes up to ten media files', async () => {
    const { stub, messenger } = twilio();
    await messenger.send(message({ attachments: Array.from({ length: 12 }, (_, i) => photo(i + 1)) }));
    expect(stub.requests).toHaveLength(2);
    expect((await form(stub.requests[0]!)).getAll('MediaUrl')).toHaveLength(10);
    expect((await form(stub.requests[1]!)).getAll('MediaUrl')).toHaveLength(2);
  });

  test('an attachment that is not a stored file, or no file links, throws before anything is sent', async () => {
    const { stub, messenger } = twilio();
    const { id: _, ...unstored } = photo(1);
    await expect(messenger.send(message({ attachments: [unstored] }))).rejects.toThrow('photo-1.jpg has no file id');

    const bare = createTwilioMessenger({ accountSid: SID, authToken: TOKEN, fetch: stub.fetch });
    await expect(bare.send(message({ attachments: [photo(1)] }))).rejects.toThrow('FILE_LINK_SECRET');
    expect(stub.requests).toHaveLength(0);
  });

  test('email is not a Twilio channel', async () => {
    const { messenger } = twilio();
    await expect(messenger.send(message({ channelType: 'email', to: 'tom@example.com' }))).rejects.toThrow("Twilio can't send email messages");
  });

  test.each([
    [21211, "The 'To' number +61400000001 is not a valid phone number."],
    [21614, "'To' number is not a valid mobile number"],
    [21610, 'Attempt to send to unsubscribed recipient'],
  ])('error %i is an undeliverable recipient, which the worker does not retry', async (code, text) => {
    const { messenger } = twilio(() => json({ code, message: text, more_info: `https://www.twilio.com/docs/errors/${code}`, status: 400 }, 400));
    const error = await messenger.send(message()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UndeliverableError);
    expect((error as UndeliverableError).permanent).toBe(true);
    expect((error as Error).message).toBe(`Undeliverable sms message to +61400000001: Twilio ${code} ${text}`);
  });

  test.each([
    ['a rate limit', () => json({ code: 20429, message: 'Too Many Requests', status: 429 }, 429), 'Twilio returned 429: 20429 Too Many Requests'],
    ['bad credentials', () => json({ code: 20003, message: 'Authenticate', status: 401 }, 401), 'Twilio returned 401: 20003 Authenticate'],
    ['an outage', () => new Response('<html>Service Unavailable</html>', { status: 503 }), 'Twilio returned 503: <html>Service Unavailable</html>'],
  ])('%s throws a plain error, so the worker retries', async (_, respond, text) => {
    const { messenger } = twilio(respond);
    const error = await messenger.send(message()).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(UndeliverableError);
    expect((error as Error).message).toBe(text);
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
