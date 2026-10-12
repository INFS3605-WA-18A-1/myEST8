// A live smoke test of the real external services, run by hand before a demo or
// a release: sends one SMS through Twilio, makes one Jev classify call and one
// Google geocode, and prints what came back. It costs money and texts a real
// phone, so it refuses to run without every key and an explicit recipient.
//
//   npm run smoke:live -- --to +61412345678 [--from +61480000000] [--address "12 King St, Newtown NSW 2042"]
//
// Keys come from the environment only (see .env.example): TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM (or --from), JEV_API_URL, JEV_API_KEY and
// GOOGLE_MAPS_API_KEY.

import { parseArgs } from 'node:util';
import { createGooglePlaces } from '../src/adapters/google-places.ts';
import { createJevClassifier } from '../src/adapters/jev.ts';
import { createTwilioMessenger } from '../src/adapters/twilio-messenger.ts';
import { TRADES, URGENCIES } from '../src/shared.ts';

const USAGE = 'Usage: npm run smoke:live -- --to +61412345678 [--from +61480000000] [--address "12 King St, Newtown NSW 2042"]';
const E164 = /^\+[1-9]\d{6,14}$/;

function refuse(problem: string): never {
  console.error(`Refusing to run: ${problem}\n${USAGE}`);
  process.exit(2);
}

const { values } = (() => {
  try {
    return parseArgs({
      options: { to: { type: 'string' }, from: { type: 'string' }, address: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    });
  } catch (e) {
    return refuse(e instanceof Error ? e.message : String(e));
  }
})();

const env = (name: string) => process.env[name]?.trim() || undefined;
const to = values.to?.trim();
const from = values.from?.trim() || env('TWILIO_SMS_FROM');
if (!to) refuse('give the phone number to text with --to, in E.164 form (+61...)');
if (!E164.test(to)) refuse(`--to ${to} is not an E.164 phone number`);
if (from && !E164.test(from)) refuse(`the sender ${from} is not an E.164 phone number`);

const required = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'JEV_API_URL', 'JEV_API_KEY', 'GOOGLE_MAPS_API_KEY'];
const missing = [...required.filter((name) => !env(name)), ...(from ? [] : ['TWILIO_SMS_FROM (or --from)'])];
if (missing.length) refuse(`set ${missing.join(', ')}`);

const address = values.address?.trim() || '12 King St, Newtown NSW 2042';
let failed = false;

async function step(name: string, fn: () => Promise<unknown>) {
  const started = Date.now();
  try {
    const result = await fn();
    console.log(`ok   ${name} (${Date.now() - started} ms)\n     ${JSON.stringify(result)}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name} (${Date.now() - started} ms)\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}

await step(`Twilio SMS to ${to} from ${from}`, async () => {
  const twilio = createTwilioMessenger({ accountSid: env('TWILIO_ACCOUNT_SID')!, authToken: env('TWILIO_AUTH_TOKEN')! });
  await twilio.send({
    channelType: 'sms',
    from: from!,
    to,
    cc: [],
    subject: '',
    text: `myEST8 live smoke test, ${new Date().toISOString()}. No reply needed.`,
    template: 'smoke.live',
    data: {},
    attachments: [],
  });
  return 'accepted by Twilio (check the phone for delivery)';
});

await step('Jev classify', () =>
  createJevClassifier({ baseUrl: env('JEV_API_URL')!, apiKey: env('JEV_API_KEY')! }).classify({
    text: 'Water is pouring through the ceiling of the bathroom',
    state: { senderRole: 'tenant', hasAttachments: false },
    questions: [
      { id: 'messageClass', options: ['new_issue', 'update', 'common_area', 'other'] },
      { id: 'urgency', options: URGENCIES },
      { id: 'trade', options: TRADES },
    ],
  }),
);

await step(`Google geocode "${address}"`, () => createGooglePlaces({ apiKey: env('GOOGLE_MAPS_API_KEY')! }).geocode(address));

process.exit(failed ? 1 : 0);
