// An in-memory stand-in for the parts of Twilio's REST API that number setup uses
// (accounts, incoming phone numbers, available Australian mobile numbers). The same
// handler backs the tests (as a `fetch`) and `scripts/fake-twilio.ts` (as a local
// server for `npm run demo`), so both exercise one picture of how Twilio answers.

import { randomBytes } from 'node:crypto';

export interface FakeNumber {
  sid: string;
  phone_number: string;
  friendly_name: string;
  sms_url: string;
  capabilities: { sms: boolean; voice: boolean; mms: boolean };
}

export interface FakeAccount {
  accountSid: string;
  authToken: string;
  type?: 'Full' | 'Trial';
  status?: 'active' | 'suspended' | 'closed';
  /** Numbers the account already owns, as { number, name?, sms? }. */
  numbers?: { number: string; name?: string; sms?: boolean }[];
}

const hex = (bytes: number) => randomBytes(bytes).toString('hex');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const failure = (status: number, code: number, message: string) => json({ code, message, status }, status);

/** Twilio's list of every purchase and release, so a test can say what the server paid for. */
export interface FakeTwilioLog {
  bought: { accountSid: string; phoneNumber: string; friendlyName: string; bundleSid: string; addressSid: string }[];
  released: { accountSid: string; phoneNumber: string }[];
  /** Texts sent through Messages.json, by the account that sent them. */
  sent: { accountSid: string; from: string; to: string; body: string }[];
}

export function fakeTwilio(o: {
  accounts: FakeAccount[];
  /** Australian mobile numbers on sale. */
  available?: string[];
  /** The regulatory bundles and addresses the account has, for scripts/twilio-setup.ts. */
  bundles?: { sid: string; status: string; friendly_name?: string }[];
  addresses?: { sid: string; friendly_name?: string; street?: string; city?: string }[];
}) {
  const accounts = new Map(
    o.accounts.map((a) => [
      a.accountSid,
      {
        ...a,
        type: a.type ?? 'Full',
        status: a.status ?? 'active',
        owned: new Map<string, FakeNumber>(
          (a.numbers ?? []).map((n) => {
            const sid = `PN${hex(16)}`;
            return [sid, { sid, phone_number: n.number, friendly_name: n.name ?? n.number, sms_url: '', capabilities: { sms: n.sms ?? true, voice: true, mms: false } }];
          }),
        ),
      },
    ]),
  );
  const forSale = [...(o.available ?? [])];
  const log: FakeTwilioLog = { bought: [], released: [], sent: [] };

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/v2/RegulatoryCompliance/Bundles') {
      const wanted = url.searchParams.get('Status');
      return json({ results: (o.bundles ?? []).filter((b) => !wanted || b.status === wanted), meta: { page: 0 } });
    }
    const match = /^\/2010-04-01\/Accounts\/([^/]+?)(?:\.json|\/(.*))$/.exec(url.pathname);
    if (!match) return failure(404, 20404, 'The requested resource was not found');
    const account = accounts.get(decodeURIComponent(match[1]!));
    const [user, password] = Buffer.from((request.headers.get('authorization') ?? '').replace(/^Basic /, ''), 'base64').toString().split(':');
    if (!account || user !== account.accountSid || password !== account.authToken) return failure(401, 20003, 'Authenticate');
    const rest = match[2];
    const form = request.method === 'POST' ? new URLSearchParams(await request.text()) : new URLSearchParams();

    if (rest === undefined) {
      return json({ sid: account.accountSid, friendly_name: 'My Twilio account', status: account.status, type: account.type });
    }

    const available = /^AvailablePhoneNumbers\/([A-Z]{2})\/Mobile\.json$/.exec(rest);
    if (available) {
      const taken = new Set([...accounts.values()].flatMap((a) => [...a.owned.values()].map((n) => n.phone_number)));
      const numbers = forSale.filter((n) => !taken.has(n)).slice(0, Number(url.searchParams.get('PageSize') ?? 50));
      return json({ available_phone_numbers: numbers.map((phone_number) => ({ phone_number, iso_country: available[1], capabilities: { sms: true } })) });
    }

    if (rest === 'Addresses.json') {
      return json({ addresses: (o.addresses ?? []).map((a) => ({ iso_country: url.searchParams.get('IsoCountry'), ...a })) });
    }

    if (rest === 'Messages.json' && request.method === 'POST') {
      log.sent.push({ accountSid: account.accountSid, from: form.get('From') ?? '', to: form.get('To') ?? '', body: form.get('Body') ?? '' });
      return json({ sid: `SM${hex(16)}`, status: 'queued' }, 201);
    }

    if (rest === 'IncomingPhoneNumbers.json') {
      if (request.method === 'POST') {
        const phoneNumber = form.get('PhoneNumber') ?? '';
        const index = forSale.indexOf(phoneNumber);
        if (index < 0) return failure(400, 21452, `Phone number ${phoneNumber} is not available`);
        if (!form.get('BundleSid') || !form.get('AddressSid')) return failure(400, 21649, 'Australian numbers need a regulatory bundle and an address');
        forSale.splice(index, 1);
        const sid = `PN${hex(16)}`;
        const number: FakeNumber = {
          sid,
          phone_number: phoneNumber,
          friendly_name: form.get('FriendlyName') ?? phoneNumber,
          sms_url: form.get('SmsUrl') ?? '',
          capabilities: { sms: true, voice: false, mms: false },
        };
        account.owned.set(sid, number);
        log.bought.push({ accountSid: account.accountSid, phoneNumber, friendlyName: number.friendly_name, bundleSid: form.get('BundleSid')!, addressSid: form.get('AddressSid')! });
        return json(number, 201);
      }
      const name = url.searchParams.get('FriendlyName');
      const numbers = [...account.owned.values()].filter((n) => name === null || n.friendly_name === name);
      return json({ incoming_phone_numbers: numbers, page: 0, page_size: 1000 });
    }

    const one = /^IncomingPhoneNumbers\/([^/]+)\.json$/.exec(rest);
    if (one) {
      const number = account.owned.get(one[1]!);
      if (!number) return failure(404, 20404, `The requested resource ${url.pathname} was not found`);
      if (request.method === 'DELETE') {
        account.owned.delete(number.sid);
        log.released.push({ accountSid: account.accountSid, phoneNumber: number.phone_number });
        return new Response(null, { status: 204 });
      }
      if (request.method === 'POST') {
        if (form.has('SmsUrl')) number.sms_url = form.get('SmsUrl')!;
        if (form.has('FriendlyName')) number.friendly_name = form.get('FriendlyName')!;
      }
      return json(number);
    }

    return failure(404, 20404, 'The requested resource was not found');
  }

  return {
    /** A `fetch` that answers as Twilio would. */
    fetch: (async (input, init) => handle(new Request(input, init))) as typeof fetch,
    handle,
    log,
    /** Every account, for a script that signs a text with the token of the account that owns the number. */
    accounts: () => [...accounts.values()],
    /** What an account owns now, by number. */
    numbersOf: (accountSid: string) => [...(accounts.get(accountSid)?.owned.values() ?? [])],
  };
}
