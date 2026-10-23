import { describe, expect, test } from 'vitest';
import { createSmsNumbers } from '../../src/sms-numbers.ts';
import { fakeTwilio } from '../support/fake-twilio.ts';
import { visible, webWorld } from '../support/web.ts';

// The SMS number component on Settings' Channels tab (pages/sms-number.ts): its Twilio help links.

const SERVER = { accountSid: `AC${'a'.repeat(32)}`, authToken: 'the-servers-auth-token' };
const OWN = { accountSid: `AC${'b'.repeat(32)}`, authToken: 'sunrises-own-auth-token' };

/** An Agency whose server sets up SMS numbers, and a Twilio account of its own with no number to offer. */
async function withTwilio() {
  const twilio = fakeTwilio({ accounts: [{ ...SERVER }, { ...OWN }] });
  return webWorld({
    smsNumbers: (db, clock) =>
      createSmsNumbers({ db, clock, encryptionKey: Buffer.alloc(32, 7).toString('base64'), server: SERVER, publicUrl: 'https://myest8.test', fetch: twilio.fetch }),
  });
}

/** A link in the page by its words, or undefined. */
const link = (html: string, words: string) => html.match(new RegExp(`<a [^>]*>${words}</a>`))?.[0];

describe('the SMS number component', () => {
  test('sends you to Twilio in the same tab, with noopener noreferrer for anyone who opens it in a new one', async () => {
    const w = await withTwilio();
    const cookie = await w.signIn();

    const html = await (await w.get('/settings?tab=channels', cookie)).text();

    expect(visible(html)).toContain('Register a Twilio number');
    for (const words of ['sign up for Twilio', 'Twilio Console']) {
      expect(link(html, words), words).toMatch(/^<a class="link" href="https:\/\/[^"]*twilio\.com[^"]*" rel="noopener noreferrer">/);
    }
  });

  test('says where to buy a number, in the same tab, when the Twilio account has none that can text', async () => {
    const w = await withTwilio();
    const cookie = await w.signIn();
    await w.alice.checkTwilioAccount(OWN.accountSid, OWN.authToken);

    const html = await (await w.get('/settings?tab=channels', cookie)).text();

    expect(visible(html)).toContain('has no number that can send and receive texts.');
    expect(link(html, 'Buy one in Twilio')).toMatch(/^<a class="link" href="https:\/\/[^"]*twilio\.com[^"]*" rel="noopener noreferrer">/);
  });
});
