// Buying an Australian mobile number for an Agency's SMS channel through Twilio (docs/adr/0005):
//   GET  /2010-04-01/Accounts/{Sid}/IncomingPhoneNumbers.json?FriendlyName=...   the one bought before
//   GET  /2010-04-01/Accounts/{Sid}/AvailablePhoneNumbers/AU/Mobile.json?SmsEnabled=true
//   POST /2010-04-01/Accounts/{Sid}/IncomingPhoneNumbers.json   PhoneNumber, SmsUrl, BundleSid, ...
// Australian numbers need an approved regulatory bundle (and its address) on the account.

import type { SmsNumbers } from '../ports.ts';
import { normalizeAddress } from '../shared.ts';

const TIMEOUT_MS = 30_000;

export interface TwilioNumbersConfig {
  accountSid: string;
  authToken: string;
  /** Where Twilio posts the texts the number receives: PUBLIC_URL + "/webhooks/twilio". */
  smsUrl: string;
  /** The approved regulatory bundle Australian numbers are bought under. */
  bundleSid: string;
  /** The address in that bundle, when Twilio asks for it separately. */
  addressSid?: string | undefined;
  fetch?: typeof fetch;
  apiBaseUrl?: string;
}

type IncomingNumber = { phone_number: string };

/** Gets each Agency one number of its own, and knows which numbers are the account's. */
export function createTwilioNumbers(config: TwilioNumbersConfig): SmsNumbers & { owns(number: string): Promise<boolean> } {
  const fetchImpl = config.fetch ?? fetch;
  const base = `${config.apiBaseUrl ?? 'https://api.twilio.com'}/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}`;
  const authorization = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`;

  async function call<T>(path: string, body?: URLSearchParams): Promise<T> {
    const response = await fetchImpl(`${base}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization, accept: 'application/json', ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      ...(body ? { body: body.toString() } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    if (response.ok) return JSON.parse(text) as T;
    let reason = text.slice(0, 200);
    try {
      const error = JSON.parse(text) as { code?: number; message?: string };
      if (error.message) reason = `${error.code ?? ''} ${error.message}`.trim();
    } catch {
      // not JSON: keep the excerpt
    }
    throw new Error(`Twilio returned ${response.status}: ${reason}`);
  }

  // The account's numbers, read once and kept up to date as numbers are bought here.
  let owned: Promise<Set<string>> | null = null;
  const ownedNumbers = () =>
    (owned ??= call<{ incoming_phone_numbers: IncomingNumber[] }>('IncomingPhoneNumbers.json?PageSize=1000')
      .then((r) => new Set(r.incoming_phone_numbers.map((n) => normalizeAddress(n.phone_number))))
      .catch((error: unknown) => {
        owned = null;
        throw error;
      }));

  return {
    async provision(agencyId) {
      // Named after the Agency, so asking again (a second click, a failure after buying) never buys a second number.
      const friendlyName = `myEST8 Agency ${agencyId}`;
      const mine = await call<{ incoming_phone_numbers: IncomingNumber[] }>(`IncomingPhoneNumbers.json?FriendlyName=${encodeURIComponent(friendlyName)}`);
      if (mine.incoming_phone_numbers[0]) return normalizeAddress(mine.incoming_phone_numbers[0].phone_number);

      const available = await call<{ available_phone_numbers: IncomingNumber[] }>('AvailablePhoneNumbers/AU/Mobile.json?SmsEnabled=true&PageSize=1');
      const pick = available.available_phone_numbers[0];
      if (!pick) throw new Error('Twilio has no Australian mobile numbers that take SMS right now. Try again later.');
      const params = new URLSearchParams({ PhoneNumber: pick.phone_number, FriendlyName: friendlyName, SmsUrl: config.smsUrl, SmsMethod: 'POST', BundleSid: config.bundleSid });
      if (config.addressSid) params.set('AddressSid', config.addressSid);
      const bought = await call<IncomingNumber>('IncomingPhoneNumbers.json', params);
      const number = normalizeAddress(bought.phone_number);
      (await ownedNumbers().catch(() => null))?.add(number);
      return number;
    },

    async owns(number) {
      return (await ownedNumbers()).has(normalizeAddress(number));
    },
  };
}
