// Twilio's REST API for the numbers behind an Agency's SMS (ADR 0005), over plain fetch:
//   GET    {api}/2010-04-01/Accounts/{AccountSid}.json                           the account: status, Trial or Full
//   GET    .../AvailablePhoneNumbers/AU/Mobile.json?SmsEnabled=true             Australian mobile numbers on sale
//   GET    .../IncomingPhoneNumbers.json[?FriendlyName=...]                     the numbers the account owns
//   POST   .../IncomingPhoneNumbers.json                                        buy one (PhoneNumber, BundleSid, AddressSid, SmsUrl, FriendlyName)
//   GET    .../IncomingPhoneNumbers/{PN...}.json                                one number
//   POST   .../IncomingPhoneNumbers/{PN...}.json                                change its SmsUrl
//   DELETE .../IncomingPhoneNumbers/{PN...}.json                                release it (stops the monthly fee)
//   GET    {numbers}/v2/RegulatoryCompliance/Bundles?...                        regulatory bundles (scripts/twilio-setup.ts)
//   GET    .../Addresses.json?IsoCountry=AU                                     addresses (scripts/twilio-setup.ts)
// Every call is authorised with Basic base64(AccountSid:AuthToken). Errors come back as
// { "code": 20003, "message": "Authenticate", "status": 401 }.

const TIMEOUT_MS = 15_000;

/** Twilio refused a call, or couldn't be reached. `status` is the HTTP status; `code` is Twilio's own error code. */
export class TwilioApiError extends Error {
  readonly status: number;
  readonly code: number | undefined;
  constructor(status: number, message: string, code?: number) {
    super(`Twilio returned ${status}${code === undefined ? '' : ` (code ${code})`}: ${message}`);
    this.name = 'TwilioApiError';
    this.status = status;
    this.code = code;
  }
}

export interface TwilioAccount {
  sid: string;
  /** 'active', 'suspended' or 'closed'. */
  status: string;
  /** 'Trial' accounts can't send their own message text; 'Full' ones are upgraded. */
  type: string;
}

export interface TwilioNumber {
  sid: string;
  /** E.164, "+61412345678". */
  phoneNumber: string;
  friendlyName: string;
  /** Where Twilio posts incoming texts. Empty when none is set. */
  smsUrl: string;
  smsCapable: boolean;
}

export interface TwilioBundle {
  sid: string;
  friendlyName: string;
  status: string;
}

export interface TwilioAddress {
  sid: string;
  friendlyName: string;
  isoCountry: string;
  street: string;
  city: string;
}

export interface TwilioApiConfig {
  accountSid: string;
  authToken: string;
  /** Defaults to https://api.twilio.com. Tests and the demo point it at a local fake. */
  apiBaseUrl?: string;
  /** Defaults to https://numbers.twilio.com. */
  numbersBaseUrl?: string;
  fetch?: typeof fetch;
}

type Json = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value : '');

function toNumber(raw: Json): TwilioNumber {
  const capabilities = (raw.capabilities ?? {}) as Json;
  return {
    sid: text(raw.sid),
    phoneNumber: text(raw.phone_number),
    friendlyName: text(raw.friendly_name),
    smsUrl: text(raw.sms_url),
    smsCapable: capabilities.sms === true,
  };
}

/** One Twilio account's numbers, called with that account's own credentials. */
export function createTwilioNumbersApi({
  accountSid,
  authToken,
  apiBaseUrl = 'https://api.twilio.com',
  numbersBaseUrl = 'https://numbers.twilio.com',
  fetch: fetchImpl = fetch,
}: TwilioApiConfig) {
  const base = `${apiBaseUrl.replace(/\/$/, '')}/2010-04-01/Accounts/${encodeURIComponent(accountSid)}`;
  const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;

  async function call(url: string, method = 'GET', form?: Record<string, string>): Promise<Json> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          authorization,
          accept: 'application/json',
          ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
        ...(form ? { body: new URLSearchParams(form).toString() } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new TwilioApiError(0, error instanceof Error ? error.message : 'could not be reached');
    }
    const body = await response.text();
    let parsed: Json = {};
    try {
      parsed = body ? (JSON.parse(body) as Json) : {};
    } catch {
      // Not JSON: the status below says enough.
    }
    if (!response.ok) {
      throw new TwilioApiError(response.status, text(parsed.message) || body.slice(0, 200) || 'no message', typeof parsed.code === 'number' ? parsed.code : undefined);
    }
    return parsed;
  }

  const query = (params: Record<string, string>) => `?${new URLSearchParams(params).toString()}`;

  return {
    async account(): Promise<TwilioAccount> {
      const raw = await call(`${base}.json`);
      return { sid: text(raw.sid), status: text(raw.status), type: text(raw.type) };
    },

    /** The numbers the account owns, all of them or those with this friendly name. */
    async ownedNumbers(o: { friendlyName?: string } = {}): Promise<TwilioNumber[]> {
      const raw = await call(`${base}/IncomingPhoneNumbers.json${query({ PageSize: '1000', ...(o.friendlyName ? { FriendlyName: o.friendlyName } : {}) })}`);
      return ((raw.incoming_phone_numbers as Json[] | undefined) ?? []).map(toNumber);
    },

    async number(numberSid: string): Promise<TwilioNumber> {
      return toNumber(await call(`${base}/IncomingPhoneNumbers/${encodeURIComponent(numberSid)}.json`));
    },

    /** An Australian mobile number on sale that can send and receive texts, or null when there is none. */
    async availableMobileNumber(country = 'AU'): Promise<string | null> {
      const raw = await call(`${base}/AvailablePhoneNumbers/${encodeURIComponent(country)}/Mobile.json${query({ SmsEnabled: 'true', PageSize: '1' })}`);
      const [first] = (raw.available_phone_numbers as Json[] | undefined) ?? [];
      return first ? text(first.phone_number) : null;
    },

    /** Buys a number. Australian numbers need an approved regulatory bundle and an address on the account. */
    async buy(o: { phoneNumber: string; friendlyName: string; bundleSid: string; addressSid: string; smsUrl: string }): Promise<TwilioNumber> {
      return toNumber(
        await call(`${base}/IncomingPhoneNumbers.json`, 'POST', {
          PhoneNumber: o.phoneNumber,
          FriendlyName: o.friendlyName,
          BundleSid: o.bundleSid,
          AddressSid: o.addressSid,
          SmsUrl: o.smsUrl,
          SmsMethod: 'POST',
        }),
      );
    },

    /** Points the number's incoming texts at `smsUrl`, or at nothing when it is empty. */
    async setSmsUrl(numberSid: string, smsUrl: string): Promise<TwilioNumber> {
      return toNumber(await call(`${base}/IncomingPhoneNumbers/${encodeURIComponent(numberSid)}.json`, 'POST', { SmsUrl: smsUrl, ...(smsUrl ? { SmsMethod: 'POST' } : {}) }));
    },

    /** Gives the number back to Twilio, which stops its monthly fee. */
    async release(numberSid: string): Promise<void> {
      await call(`${base}/IncomingPhoneNumbers/${encodeURIComponent(numberSid)}.json`, 'DELETE');
    },

    /** Regulatory bundles for mobile numbers in `country`, optionally only those with this status ('twilio-approved'). */
    async bundles(o: { country?: string; status?: string } = {}): Promise<TwilioBundle[]> {
      const raw = await call(
        `${numbersBaseUrl.replace(/\/$/, '')}/v2/RegulatoryCompliance/Bundles${query({ IsoCountry: o.country ?? 'AU', NumberType: 'mobile', PageSize: '50', ...(o.status ? { Status: o.status } : {}) })}`,
      );
      return ((raw.results as Json[] | undefined) ?? []).map((b) => ({ sid: text(b.sid), friendlyName: text(b.friendly_name), status: text(b.status) }));
    },

    /** The addresses on the account in `country`. */
    async addresses(country = 'AU'): Promise<TwilioAddress[]> {
      const raw = await call(`${base}/Addresses.json${query({ IsoCountry: country, PageSize: '50' })}`);
      return ((raw.addresses as Json[] | undefined) ?? []).map((a) => ({
        sid: text(a.sid),
        friendlyName: text(a.friendly_name),
        isoCountry: text(a.iso_country),
        street: text(a.street),
        city: text(a.city),
      }));
    },
  };
}

export type TwilioNumbersApi = ReturnType<typeof createTwilioNumbersApi>;
