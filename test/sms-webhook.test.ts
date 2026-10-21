import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { createHttpApp } from '../src/http.ts';
import { createSmsNumbers } from '../src/sms-numbers.ts';
import { fakeTwilio } from './support/fake-twilio.ts';
import { PASSWORD, STRANGER, world } from './support/world.ts';

// Texts to an Agency's own SMS number (ADR 0005): the webhook finds the Agency by the
// number the text was sent to, and checks the signature with the auth token of the
// Twilio account that owns that number.

const PUBLIC_URL = 'https://myest8.test';
const SERVER = { accountSid: `AC${'a'.repeat(32)}`, authToken: 'the-servers-auth-token' };
const SUNRISE = { accountSid: `AC${'b'.repeat(32)}`, authToken: 'sunrises-own-auth-token' };

/** Harbour Realty (the standard Agency) with a number myEST8 bought, and Sunrise Realty with a number from its own Twilio account. */
async function twoAgencies() {
  const twilio = fakeTwilio({
    accounts: [{ ...SERVER }, { ...SUNRISE, numbers: [{ number: '+61422000111', name: "Sunrise's shop line" }] }],
    available: ['+61411000001'],
  });
  const w = await world({
    smsNumbers: (db, clock) =>
      createSmsNumbers({
        db,
        clock,
        encryptionKey: Buffer.alloc(32, 7).toString('base64'),
        server: SERVER,
        bundleSid: `BU${'c'.repeat(32)}`,
        addressSid: `AD${'d'.repeat(32)}`,
        publicUrl: PUBLIC_URL,
        fetch: twilio.fetch,
      }),
  });

  const harbourNumber = await w.alice.createSmsNumber();

  const sunriseId = await w.h.app.setup.createAgency({ name: 'Sunrise Realty', timeZone: 'Australia/Brisbane' });
  const sam = w.h.as(await w.h.app.setup.addPropertyManager(sunriseId, { name: 'Sam Sun', email: 'sam@sunrise.example', password: PASSWORD }));
  await sam.checkTwilioAccount(SUNRISE.accountSid, SUNRISE.authToken);
  const [offered] = await sam.twilioNumbers();
  const sunriseNumber = await sam.registerTwilioNumber(offered!.sid);

  const http = createHttpApp(w.h.app, {
    publicUrl: PUBLIC_URL,
    twilioAuthToken: SERVER.authToken,
    smsNumbers: w.h.smsNumbers,
    sendgridPublicKey: '',
    clock: w.h.clock,
  });

  /** Posts a Twilio messaging webhook for a text to `to`, signed with `token` (or not at all when it is null). */
  function textTo(to: string, body: string, token: string | null, from = STRANGER) {
    const params = { MessageSid: `SM${Buffer.from(body).toString('hex').padEnd(32, '0').slice(0, 32)}`, From: from, To: to, Body: body, NumMedia: '0' };
    const payload = `${PUBLIC_URL}/webhooks/twilio` + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join('');
    return http.request('/webhooks/twilio', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(token === null ? {} : { 'x-twilio-signature': createHmac('sha1', token).update(payload).digest('base64') }),
      },
      body: new URLSearchParams(params).toString(),
    });
  }

  const inboxOf = async (actions: typeof w.alice) => {
    await w.h.drain();
    return (await actions.dashboard()).inbox.map((item) => item.text);
  };

  return { ...w, sam, harbourNumber, sunriseNumber, textTo, inboxOf };
}

describe('a text to an Agency number', () => {
  test('a number myEST8 created, signed with the server token, reaches that Agency and no other', async () => {
    const { alice, sam, harbourNumber, textTo, inboxOf } = await twoAgencies();

    const response = await textTo(harbourNumber, 'The gate is stuck', SERVER.authToken);

    expect(response.status).toBe(200);
    expect(await inboxOf(alice)).toEqual(['The gate is stuck']);
    expect(await inboxOf(sam)).toEqual([]);
  });

  test("a registered number, signed with that Agency's own token, reaches that Agency and no other", async () => {
    const { alice, sam, sunriseNumber, textTo, inboxOf } = await twoAgencies();

    const response = await textTo(sunriseNumber, 'The fence is down', SUNRISE.authToken);

    expect(response.status).toBe(200);
    expect(await inboxOf(sam)).toEqual(['The fence is down']);
    expect(await inboxOf(alice)).toEqual([]);
  });

  test("a registered number's text signed with the server token is refused", async () => {
    const { alice, sam, sunriseNumber, textTo, inboxOf } = await twoAgencies();

    const response = await textTo(sunriseNumber, 'The fence is down', SERVER.authToken);

    expect(response.status).toBe(403);
    expect(await inboxOf(sam)).toEqual([]);
    expect(await inboxOf(alice)).toEqual([]);
  });

  test("a created number's text signed with another Agency's token is refused", async () => {
    const { alice, sam, harbourNumber, textTo, inboxOf } = await twoAgencies();

    const response = await textTo(harbourNumber, 'The gate is stuck', SUNRISE.authToken);

    expect(response.status).toBe(403);
    expect(await inboxOf(alice)).toEqual([]);
    expect(await inboxOf(sam)).toEqual([]);
  });

  test('a bad or missing signature is refused and stores nothing', async () => {
    const { alice, sam, harbourNumber, sunriseNumber, textTo, inboxOf } = await twoAgencies();

    for (const to of [harbourNumber, sunriseNumber]) {
      expect((await textTo(to, 'Hello', 'not-the-token')).status).toBe(403);
      expect((await textTo(to, 'Hello', null)).status).toBe(403);
    }

    expect(await inboxOf(alice)).toEqual([]);
    expect(await inboxOf(sam)).toEqual([]);
  });

  test('a number no Agency has is refused the same way as a bad signature, and stores nothing', async () => {
    const { alice, sam, textTo, inboxOf } = await twoAgencies();

    const unknown = await textTo('+61433999999', 'Hello', SERVER.authToken);
    const badSignature = await textTo('+61433999999', 'Hello', 'not-the-token');

    expect(unknown.status).toBe(403);
    expect(await unknown.text()).toBe(await badSignature.text());
    expect(await inboxOf(alice)).toEqual([]);
    expect(await inboxOf(sam)).toEqual([]);
  });
});
