// A fake Twilio for trying number setup in `npm run demo` without a Twilio account or a
// bill. It answers the REST calls myEST8 makes (src/adapters/twilio-numbers.ts) from memory,
// and can play a Tenant texting an Agency's number. The same fake backs the tests
// (test/support/fake-twilio.ts).
//
//   npx tsx scripts/fake-twilio.ts                      # listens on http://127.0.0.1:4010
//   TWILIO_API_BASE_URL=http://127.0.0.1:4010 \
//   TWILIO_ACCOUNT_SID=AC...a TWILIO_AUTH_TOKEN=server-token TWILIO_BUNDLE_SID=BU... TWILIO_ADDRESS_SID=AD... \
//   TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32) FILE_LINK_SECRET=... npm run demo
//
// The accounts it knows (the ids are fixed, so the demo's env can name them):
//   server    ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  token "server-token"   the platform's own account
//   agency    ACbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  token "agency-token"   an Agency's own, with two numbers
//   trial     ACcccccccccccccccccccccccccccccccc  token "trial-token"    a trial account (refused)
//   empty     ACdddddddddddddddddddddddddddddddd  token "empty-token"    upgraded, no numbers
// Helpers:
//   GET  /fake/state                           what has been bought, released and sent
//   POST /fake/text?to=+61...&from=+61...&body=Hi   a text to a number, signed like Twilio signs it, posted to its webhook

import { createHmac } from 'node:crypto';
import { serve } from '@hono/node-server';
import { fakeTwilio } from '../test/support/fake-twilio.ts';

const port = Number(process.env.PORT ?? 4010);
const sid = (letter: string) => `AC${letter.repeat(32)}`;

const twilio = fakeTwilio({
  accounts: [
    { accountSid: sid('a'), authToken: 'server-token' },
    {
      accountSid: sid('b'),
      authToken: 'agency-token',
      numbers: [
        { number: '+61422000111', name: 'Shop line' },
        { number: '+61422000222', name: 'After hours' },
      ],
    },
    { accountSid: sid('c'), authToken: 'trial-token', type: 'Trial' },
    { accountSid: sid('d'), authToken: 'empty-token' },
  ],
  available: Array.from({ length: 20 }, (_, i) => `+614110000${String(i + 1).padStart(2, '0')}`),
  bundles: [{ sid: `BU${'e'.repeat(32)}`, status: 'twilio-approved', friendly_name: 'myEST8 Australian mobile' }],
  addresses: [{ sid: `AD${'f'.repeat(32)}`, friendly_name: 'myEST8 office', street: '1 Sample St', city: 'Sydney' }],
});

serve({ port, hostname: '127.0.0.1', fetch: async (request) => {
  const url = new URL(request.url);
  if (url.pathname === '/fake/state') {
    return Response.json({ log: twilio.log, accounts: twilio.accounts().map((a) => ({ accountSid: a.accountSid, numbers: twilio.numbersOf(a.accountSid) })) });
  }
  if (url.pathname === '/fake/text' && request.method === 'POST') {
    const to = url.searchParams.get('to') ?? '';
    const owner = twilio.accounts().find((a) => twilio.numbersOf(a.accountSid).some((n) => n.phone_number === to));
    const number = owner && twilio.numbersOf(owner.accountSid).find((n) => n.phone_number === to);
    if (!owner || !number?.sms_url) return new Response(`No number ${to} with a webhook`, { status: 404 });
    const params: Record<string, string> = {
      MessageSid: `SM${Date.now().toString(16).padEnd(32, '0')}`,
      AccountSid: owner.accountSid,
      From: url.searchParams.get('from') ?? '+61400000000',
      To: to,
      Body: url.searchParams.get('body') ?? 'Hello',
      NumMedia: '0',
    };
    const payload = number.sms_url + Object.keys(params).sort().map((k) => k + params[k]).join('');
    const response = await fetch(number.sms_url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': createHmac('sha1', owner.authToken).update(payload).digest('base64') },
      body: new URLSearchParams(params).toString(),
    });
    return Response.json({ webhook: number.sms_url, status: response.status });
  }
  return twilio.handle(request);
} });
console.log(`Fake Twilio on http://127.0.0.1:${port}. Point TWILIO_API_BASE_URL at it.`);
