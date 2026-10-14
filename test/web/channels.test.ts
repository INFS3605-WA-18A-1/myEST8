import { describe, expect, test } from 'vitest';
import { all } from '../../src/db.ts';
import { FakeGmail } from '../support/fake-gmail.ts';
import { visible, webWorld } from '../support/web.ts';

const PROVIDER_WORDS = /Twilio|SendGrid|sandbox|Inbound Parse|webhooks|MX record/i;

/** A new Agency signs up on a server set up as `options`, and its Property Manager's session and channels are returned. */
async function newAgency(options: Parameters<typeof webWorld>[0]) {
  const w = await webWorld(options);
  const cookie = await w.signUp();
  const [{ id }] = await all<{ id: number }>(w.h.db, `SELECT id FROM property_managers WHERE email = 'sam@sunrise.example'`);
  const actions = await w.h.app.asPropertyManager(id!);
  const page = async (path = '/welcome/channels') => visible(await (await w.get(path, cookie)).text());
  return { ...w, cookie, actions, page };
}

describe('channels on a server with no real providers', () => {
  test('a new Agency has SMS, WhatsApp and email connected and tested, and is told what that means, without provider setup', async () => {
    const a = await newAgency({ channels: { gmail: false } });
    const channels = await a.actions.channels();
    expect(channels.map((c) => c.type)).toEqual(['sms', 'whatsapp', 'email']);
    expect(channels.every((c) => c.testedAt)).toBe(true);

    const page = await a.page();
    expect(page).toContain('Simulated');
    expect(page).toContain('phone simulator');
    expect(page).not.toMatch(PROVIDER_WORDS);
    expect(page).not.toMatch(/Connect (SMS|WhatsApp|Email)/);
  });

  test('the Settings page says the same', async () => {
    const a = await newAgency({ channels: { gmail: false } });
    expect(await a.page('/setup')).not.toMatch(PROVIDER_WORDS);
  });
});

describe('channels with Gmail set up', () => {
  const gmailWorld = () => newAgency({ gmailFetch: new FakeGmail().fetch, channels: { gmail: true } });

  test('email is left for the Agency to connect with Google, the other channels are simulated', async () => {
    const a = await gmailWorld();
    expect((await a.actions.channels()).map((c) => c.type)).toEqual(['sms', 'whatsapp']);
    const html = await (await a.get('/welcome', a.cookie)).text();
    expect(html).toMatch(/<a [^>]*href="\/oauth\/google\/start\?return=\/welcome"[^>]*>\s*Connect Gmail\s*<\/a>/);
    expect(visible(html)).not.toMatch(PROVIDER_WORDS);
    expect(html).not.toMatch(/name="address"[^>]*type="email"|type="email"[^>]*name="address"/);
  });

  test('once connected it shows the address and offers reconnecting', async () => {
    const gmail = new FakeGmail();
    const a = await newAgency({ gmailFetch: gmail.fetch, channels: { gmail: true } });
    await a.actions.connectGmail({ code: 'code-for-agency@gmail.example', codeVerifier: 'v', redirectUri: 'https://myest8.test/oauth/google/callback' });
    const page = await a.page('/welcome');
    expect(page).toContain('agency@gmail.example');
    expect(page).toContain('Reconnect Gmail');
  });

  test('signing in is not a test: the Agency sends a test email to an address it chooses, its own by default', async () => {
    const gmail = new FakeGmail();
    const a = await newAgency({ gmailFetch: gmail.fetch, channels: { gmail: true } });
    await a.actions.connectGmail({ code: 'code-for-agency@gmail.example', codeVerifier: 'v', redirectUri: 'https://myest8.test/oauth/google/callback' });
    expect((await a.actions.channels()).find((c) => c.type === 'email')?.testedAt).toBeNull();
    const html = await (await a.get('/welcome', a.cookie)).text();
    expect(html).toMatch(/<form[^>]*action="\/welcome\/email\/test"[\s\S]*?name="type" value="email"[\s\S]*?value="sam@sunrise.example"/);
    expect(visible(html)).toContain('Send a test email to');
  });

  test('a connection Google stopped accepting says so and offers reconnecting', async () => {
    const gmail = new FakeGmail();
    const a = await newAgency({ gmailFetch: gmail.fetch, channels: { gmail: true } });
    await a.actions.connectGmail({ code: 'code-for-agency@gmail.example', codeVerifier: 'v', redirectUri: 'https://myest8.test/oauth/google/callback' });
    gmail.mailbox('agency@gmail.example').revoked = true;
    await a.h.advance(61_000);
    const page = await a.page('/welcome');
    expect(page).toMatch(/needs reconnecting/i);
    expect(page).toContain('Reconnect Gmail');
  });
});

describe('channels with Twilio SMS numbers set up', () => {
  const smsWorld = () => {
    const bought: number[] = [];
    const smsNumbers = { provision: async (agencyId: number) => (bought.push(agencyId), `+6148000000${agencyId}`) };
    return { bought, ready: newAgency({ smsNumbers, channels: { gmail: false, smsNumbers: true } }) };
  };

  test('SMS is left for the Agency to get a number with one button, and nothing to type', async () => {
    const a = await smsWorld().ready;
    expect((await a.actions.channels()).map((c) => c.type)).toEqual(['whatsapp', 'email']);
    const html = await (await a.get('/setup', a.cookie)).text();
    expect(html).toMatch(/<form[^>]*action="\/setup\/channels\/sms"/);
    expect(visible(html)).toContain('Get an SMS number');
    expect(visible(html)).not.toMatch(PROVIDER_WORDS);
  });

  test('getting a number connects it in place of a simulated one, then offers a test message', async () => {
    const { bought, ready } = smsWorld();
    const a = await ready;
    await a.actions.connectChannel('sms', '+61 2 9100 0099');
    expect(await (await a.get('/setup', a.cookie)).text()).toContain('Get an SMS number');

    const res = await a.post('/welcome/channels/sms', {}, a.cookie);
    expect(res.headers.get('location')).toMatch(/ok=/);
    const sms = (await a.actions.channels()).find((c) => c.type === 'sms');
    expect(sms).toMatchObject({ address: expect.stringMatching(/^\+6148000000\d+$/), testedAt: null });
    expect(bought).toHaveLength(1);
    const page = await a.page();
    expect(page).not.toContain('Get an SMS number');
    expect(page).toContain('Send a test message to');
  });

  test("a provider failure is shown, and SMS stays as it was", async () => {
    const smsNumbers = { provision: async () => Promise.reject(new Error('Twilio returned 400: 21649 Bundle required')) };
    const a = await newAgency({ smsNumbers, channels: { gmail: false, smsNumbers: true } });
    const res = await a.post('/setup/channels/sms', {}, a.cookie);
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toMatch(/couldn't get an SMS number: Twilio returned 400: 21649 Bundle required/);
    expect((await a.actions.channels()).find((c) => c.type === 'sms')).toBeUndefined();
  });
});

describe('channels with the WhatsApp Cloud API set up', () => {
  const NUMBER = '+15551234567';

  test('WhatsApp is left to connect, with one button and no number to type', async () => {
    const a = await newAgency({ channels: { gmail: false, whatsappNumber: NUMBER } });
    expect((await a.actions.channels()).map((c) => c.type)).toEqual(['sms', 'email']);
    const html = await (await a.get('/welcome/channels', a.cookie)).text();
    expect(html).toMatch(/<form[^>]*action="\/welcome\/channels\/whatsapp"/);
    expect(visible(html)).toContain('Connect WhatsApp');
    expect(visible(html)).not.toMatch(PROVIDER_WORDS);
  });

  test('connecting gives the Agency the WhatsApp number, once: another Agency is refused', async () => {
    const a = await newAgency({ channels: { gmail: false, whatsappNumber: NUMBER } });
    const res = await a.post('/welcome/channels/whatsapp', {}, a.cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/ok=/);
    expect((await a.actions.channels()).find((c) => c.type === 'whatsapp')).toMatchObject({ address: NUMBER });

    const other = await a.post('/welcome/channels/whatsapp', {}, await a.signIn('bob@harbour.example'));
    expect(other.headers.get('location')).toMatch(/error=.*another/i);
  });
});
