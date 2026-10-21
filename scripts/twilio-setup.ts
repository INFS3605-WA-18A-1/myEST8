// One-time operator setup for Agency SMS numbers (ADR 0005). With the server's own
// Twilio credentials it checks the account is upgraded (not a trial), finds the approved
// Australian mobile regulatory bundle and an address, and prints the two env lines to paste.
// If something is missing it says what, and where in the Twilio Console to fix it.
//
//   npx tsx scripts/twilio-setup.ts
//
// Reads TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN from the environment only. To use the
// values in your live env file without printing them:
//
//   set -a; . ~/.config/myest8/live.env; set +a; npx tsx scripts/twilio-setup.ts
//
// TWILIO_API_BASE_URL points it at a fake Twilio (scripts/fake-twilio.ts) instead.
// It only reads from Twilio: nothing is bought or changed.

import { createTwilioNumbersApi, TwilioApiError } from '../src/adapters/twilio-numbers.ts';

const env = (name: string) => process.env[name]?.trim() || undefined;
const accountSid = env('TWILIO_ACCOUNT_SID');
const authToken = env('TWILIO_AUTH_TOKEN');
if (!accountSid || !authToken) {
  console.error('Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN first: the server\'s own Twilio account, from the Account info panel of the Twilio Console (https://console.twilio.com/).');
  process.exit(2);
}

const apiBaseUrl = env('TWILIO_API_BASE_URL');
const twilio = createTwilioNumbersApi({
  accountSid,
  authToken,
  ...(apiBaseUrl ? { apiBaseUrl } : {}),
  ...(env('TWILIO_NUMBERS_BASE_URL') || apiBaseUrl ? { numbersBaseUrl: (env('TWILIO_NUMBERS_BASE_URL') ?? apiBaseUrl)! } : {}),
});

const problems: string[] = [];
const found: string[] = [];

try {
  const account = await twilio.account();
  console.log(`Account ${account.sid}: ${account.status}, ${account.type}.`);
  if (account.status !== 'active') problems.push(`The account is ${account.status}. Use an active account.`);
  if (account.type === 'Trial') {
    problems.push(
      'The account is a trial account. A trial can only send Twilio\'s own template messages, so myEST8 can\'t use it. Upgrade it in the Twilio Console (the "Upgrade" button at the top of the page, then add a payment method).',
    );
  }

  const approved = await twilio.bundles({ status: 'twilio-approved' });
  if (approved.length) {
    const [bundle, ...others] = approved;
    console.log(`Approved Australian mobile bundle: ${bundle!.sid} (${bundle!.friendlyName || 'no name'})${others.length ? `; ${others.length} more: ${others.map((b) => b.sid).join(', ')}` : ''}.`);
    found.push(`TWILIO_BUNDLE_SID=${bundle!.sid}`);
  } else {
    const any = await twilio.bundles();
    problems.push(
      any.length
        ? `No Australian mobile bundle is approved yet. Found: ${any.map((b) => `${b.sid} (${b.status})`).join(', ')}. Finish or wait for review in the Twilio Console: Phone Numbers > Regulatory Compliance > Bundles.`
        : 'There is no Australian mobile regulatory bundle on this account. Create one in the Twilio Console: Phone Numbers > Regulatory Compliance > Bundles > Create a Regulatory Bundle (Australia, Mobile). Twilio reviews it before it can be used.',
    );
  }

  const addresses = await twilio.addresses();
  if (addresses.length) {
    const [address, ...others] = addresses;
    console.log(`Australian address: ${address!.sid} (${address!.friendlyName || [address!.street, address!.city].filter(Boolean).join(', ')})${others.length ? `; ${others.length} more: ${others.map((a) => a.sid).join(', ')}` : ''}.`);
    found.push(`TWILIO_ADDRESS_SID=${address!.sid}`);
  } else {
    problems.push('There is no Australian address on this account. Add one in the Twilio Console: Phone Numbers > Regulatory Compliance > Addresses (or Manage > Addresses).');
  }
} catch (error) {
  if (error instanceof TwilioApiError && error.status === 401) {
    console.error("Twilio didn't accept TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN. Copy both again from the Twilio Console.");
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
}

if (found.length) {
  console.log('\nAdd these to the server\'s environment (~/.config/myest8/live.env, or Vercel), next to TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN:\n');
  for (const line of found) console.log(line);
}
if (problems.length) {
  console.log('\nStill to do:');
  for (const problem of problems) console.log(`- ${problem}`);
  process.exit(1);
}
console.log('\nOne more thing: myEST8 only offers Agencies their own number when TOKEN_ENCRYPTION_KEY is set (openssl rand -base64 32), because a registered Agency\'s Auth Token is stored encrypted with it.');
