import { describe, expect, test } from 'vitest';
import { messengersFromEnv, routeByChannel } from '../../src/adapters/messenger.ts';
import type { OutboundMessage } from '../../src/ports.ts';
import { FakeClock, FakeMessenger } from '../support/fakes.ts';
import { json, stubFetch } from './stub-fetch.ts';

const clock = new FakeClock(new Date('2026-10-08T09:00:00+11:00'));
const SECRET = 'a-test-secret-that-is-long-enough-1234';

const message = (channelType: OutboundMessage['channelType'], to: string): OutboundMessage => ({
  channelType,
  from: channelType === 'email' ? 'inbox@harbour.example' : '+61290000000',
  to,
  cc: [],
  subject: 'Test',
  text: 'Hello from myEST8',
  template: 'onboarding.test_message',
  data: {},
  attachments: [],
});

describe('routing by channel', () => {
  test('each message goes to the Messenger for its channel', async () => {
    const sms = new FakeMessenger();
    const email = new FakeMessenger();
    const messenger = routeByChannel({ sms, whatsapp: sms, email });
    await messenger.send(message('sms', '+61400000001'));
    await messenger.send(message('whatsapp', '+61400000002'));
    await messenger.send(message('email', 'tom@example.com'));
    expect(sms.sent.map((m) => [m.channel, m.to])).toEqual([
      ['sms', '+61400000001'],
      ['whatsapp', '+61400000002'],
    ]);
    expect(email.sent.map((m) => m.to)).toEqual(['tom@example.com']);
  });

  test('a channel with no provider throws', async () => {
    await expect(routeByChannel({}).send(message('email', 'tom@example.com'))).rejects.toThrow('No provider is configured for email messages');
  });
});

describe('providers from the environment', () => {
  const twilioEnv = { TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'token', FILE_LINK_SECRET: SECRET, PUBLIC_URL: 'https://myest8.test' };

  test('nothing set configures nothing', () => {
    expect(messengersFromEnv({}, { clock })).toEqual({ channels: {}, fileLinks: null });
  });

  test('Twilio covers SMS and WhatsApp, SendGrid covers email, each with its own credentials and sender', async () => {
    const stub = stubFetch((request) =>
      new URL(request.url).hostname === 'api.twilio.com' ? new Response('{"sid":"SM1"}', { status: 201 }) : new Response(null, { status: 202 }),
    );
    const { channels, fileLinks } = messengersFromEnv(
      { ...twilioEnv, TWILIO_SMS_FROM: '+61480000000', TWILIO_WHATSAPP_FROM: '+14155238886', SENDGRID_API_KEY: 'SG.key', SENDGRID_FROM: 'noreply@myest8.example' },
      { clock, fetch: stub.fetch },
    );
    expect(Object.keys(channels).sort()).toEqual(['email', 'sms', 'whatsapp']);
    expect(fileLinks?.url(1)).toMatch(/^https:\/\/myest8\.test\/media\/1\?expires=\d+&signature=/);

    const messenger = routeByChannel(channels);
    await messenger.send(message('sms', '+61400000001'));
    await messenger.send(message('whatsapp', '+61400000001'));
    await messenger.send(message('email', 'tom@example.com'));

    const [sms, whatsapp, email] = stub.requests;
    expect(sms!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(new URLSearchParams(await sms!.text()).get('From')).toBe('+61480000000');
    expect(new URLSearchParams(await whatsapp!.text()).get('From')).toBe('whatsapp:+14155238886');
    expect(email!.url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect(email!.headers.get('authorization')).toBe('Bearer SG.key');
    expect(((await email!.json()) as { from: unknown }).from).toEqual({ email: 'noreply@myest8.example' });
  });

  test('RESEND_API_KEY alone enables email, and takes precedence over SendGrid', async () => {
    const stub = stubFetch(() => json({ id: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c' }));
    const alone = messengersFromEnv({ RESEND_API_KEY: 're_test_key' }, { clock, fetch: stub.fetch });
    expect(Object.keys(alone.channels)).toEqual(['email']);
    expect(alone.fileLinks).toBeNull();

    const both = messengersFromEnv(
      { RESEND_API_KEY: 're_test_key', SENDGRID_API_KEY: 'SG.key', SENDGRID_FROM: 'noreply@myest8.example' },
      { clock, fetch: stub.fetch },
    );
    await routeByChannel(both.channels).send(message('email', 'tom@example.com'));
    const request = stub.requests[0]!;
    expect(request.url).toBe('https://api.resend.com/emails');
    expect(request.headers.get('authorization')).toBe('Bearer re_test_key');
    expect(((await request.json()) as { from: string }).from).toBe('inbox@harbour.example');
  });

  test.each([
    ['only the account SID', { TWILIO_ACCOUNT_SID: 'AC123' }, 'Set both TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN'],
    ['Twilio without a file link secret', { TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'token', PUBLIC_URL: 'https://myest8.test' }, 'set FILE_LINK_SECRET'],
    ['a short file link secret', { ...twilioEnv, FILE_LINK_SECRET: 'short' }, 'at least 32 characters'],
  ])('a half-configured provider fails at start-up: %s', (_, env, text) => {
    expect(() => messengersFromEnv(env, { clock })).toThrow(text);
  });
});
