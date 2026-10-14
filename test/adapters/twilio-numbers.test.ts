import { describe, expect, test } from 'vitest';
import { createTwilioNumbers } from '../../src/adapters/twilio-numbers.ts';
import { json, stubFetch } from './stub-fetch.ts';

const ACCOUNT = 'https://api.twilio.com/2010-04-01/Accounts/AC123';

function twilio(owned: string[] = [], available = ['+61485855341']) {
  const stub = stubFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/IncomingPhoneNumbers.json') && request.method === 'GET') {
      const name = url.searchParams.get('FriendlyName');
      return json({ incoming_phone_numbers: name ? owned.filter((n) => n === name).map(() => ({ phone_number: '+61400000001' })) : owned.map((n) => ({ phone_number: n })) });
    }
    if (url.pathname.endsWith('/AvailablePhoneNumbers/AU/Mobile.json')) return json({ available_phone_numbers: available.map((phone_number) => ({ phone_number })) });
    if (url.pathname.endsWith('/IncomingPhoneNumbers.json')) return json({ phone_number: available[0] }, 201);
    return json({ code: 20404, message: 'Not found' }, 404);
  });
  const numbers = createTwilioNumbers({ accountSid: 'AC123', authToken: 'secret', smsUrl: 'https://myest8.test/webhooks/twilio', bundleSid: 'BU1', addressSid: 'AD1', fetch: stub.fetch });
  return { stub, numbers };
}

describe('Twilio SMS numbers', () => {
  test('buys an Australian mobile under the bundle, named after the Agency, with texts sent to the webhook', async () => {
    const { stub, numbers } = twilio();
    expect(await numbers.provision(7)).toBe('+61485855341');
    const buys = stub.requests.filter((r) => r.method === 'POST');
    expect(buys).toHaveLength(1);
    const buy = buys[0]!;
    expect(buy.url).toBe(`${ACCOUNT}/IncomingPhoneNumbers.json`);
    expect(buy.headers.get('authorization')).toBe(`Basic ${Buffer.from('AC123:secret').toString('base64')}`);
    expect(Object.fromEntries(new URLSearchParams(await buy.text()))).toEqual({
      PhoneNumber: '+61485855341',
      FriendlyName: 'myEST8 Agency 7',
      SmsUrl: 'https://myest8.test/webhooks/twilio',
      SmsMethod: 'POST',
      BundleSid: 'BU1',
      AddressSid: 'AD1',
    });
    expect(stub.requests.some((r) => r.url.includes('/AvailablePhoneNumbers/AU/Mobile.json?SmsEnabled=true'))).toBe(true);
    expect(await numbers.owns('+61 485 855 341')).toBe(true);
  });

  test('asking again gives back the number bought before, without buying another', async () => {
    const { stub, numbers } = twilio(['myEST8 Agency 7']);
    expect(await numbers.provision(7)).toBe('+61400000001');
    expect(stub.requests.every((r) => r.method === 'GET')).toBe(true);
  });

  test("owns only the account's numbers", async () => {
    const { numbers } = twilio(['+61400000001']);
    expect(await numbers.owns('0400 000 001')).toBe(true);
    expect(await numbers.owns('+61291000003')).toBe(false);
  });

  test("Twilio's refusal and an empty search are errors that say why", async () => {
    const refused = createTwilioNumbers({
      accountSid: 'AC123',
      authToken: 'secret',
      smsUrl: 'https://myest8.test/webhooks/twilio',
      bundleSid: 'BU1',
      fetch: stubFetch((r) => (r.method === 'POST' ? json({ code: 21649, message: 'Bundle required' }, 400) : json({ incoming_phone_numbers: [], available_phone_numbers: [{ phone_number: '+61485855341' }] }))).fetch,
    });
    await expect(refused.provision(1)).rejects.toThrow('Twilio returned 400: 21649 Bundle required');
    await expect(twilio([], []).numbers.provision(1)).rejects.toThrow(/no Australian mobile numbers/);
  });
});
