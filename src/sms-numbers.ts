// An Agency's own SMS number on Twilio (ADR 0005). Two ways to get one:
//   create    myEST8 buys an Australian mobile number on the server's Twilio account,
//             named "myEST8 Agency <id>", so asking again finds it instead of buying another;
//   register  the Agency gives its own Twilio account's Account SID and Auth Token, then picks
//             one of that account's SMS-capable numbers.
// Either way the number's incoming-text webhook is set to `${publicUrl}/webhooks/twilio`.
// A text to the number is checked with the token of the account that owns it, and a text
// from it goes out through that account. A registered account's token is stored encrypted
// (AES-256-GCM, TOKEN_ENCRYPTION_KEY), as Gmail's refresh token is.
//
// This module owns the Twilio side and its table. Connecting the number as the Agency's
// SMS channel is the app's job (src/app.ts), so the Agency's channels stay in one place.

import { createTwilioNumbersApi, TwilioApiError, type TwilioNumber } from './adapters/twilio-numbers.ts';
import { createTwilioMessenger } from './adapters/twilio-messenger.ts';
import { all, one, run, type Db } from './db.ts';
import type { FileLinks } from './file-links.ts';
import { decryptToken, encryptToken } from './mailboxes.ts';
import type { Clock, Messenger } from './ports.ts';
import { invalid, iso, normalizeAddress } from './shared.ts';

export type SmsNumberKind = 'created' | 'registered';

/** Where an Agency's SMS number stands, for the Channels pages. */
export interface SmsNumberStatus {
  /** The Agency's connected number, or null. */
  number: { kind: SmsNumberKind; phoneNumber: string } | null;
  /** A registered Twilio account whose details were accepted and whose number hasn't been picked yet. */
  choosing: { accountSid: string } | null;
  /** Whether "Create a new number" can work on this server, and why not when it can't. */
  creation: { ok: true } | { ok: false; reason: string };
}

export interface OfferedNumber {
  sid: string;
  phoneNumber: string;
  name: string;
}

interface Row {
  agency_id: number;
  kind: SmsNumberKind;
  phone_number: string | null;
  number_sid: string | null;
  account_sid: string | null;
  auth_token: string | null;
}

export interface SmsNumbersConfig {
  db: Db;
  clock: Clock;
  /** TOKEN_ENCRYPTION_KEY: base64 of 32 bytes. */
  encryptionKey: string;
  /** The platform's own Twilio account (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN), which owns the numbers it creates. */
  server?: { accountSid: string; authToken: string } | null;
  /** TWILIO_BUNDLE_SID and TWILIO_ADDRESS_SID: what Twilio needs to sell an Australian mobile number. */
  bundleSid?: string | undefined;
  addressSid?: string | undefined;
  /** The https address Twilio posts incoming texts to, under /webhooks/twilio. */
  publicUrl: string;
  /** Twilio's API address. Defaults to https://api.twilio.com; the demo points it at a local fake. */
  apiBaseUrl?: string;
  /** Signs the links Twilio fetches attachments from. */
  fileLinks?: FileLinks | null;
  fetch?: typeof fetch;
}

export function createSmsNumbers(config: SmsNumbersConfig) {
  const { db, clock, encryptionKey } = config;
  if (Buffer.from(encryptionKey, 'base64').length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be base64 of 32 bytes (openssl rand -base64 32)');
  const server = config.server ?? null;
  const webhookUrl = `${config.publicUrl.replace(/\/$/, '')}/webhooks/twilio`;
  const apiFor = (accountSid: string, authToken: string) =>
    createTwilioNumbersApi({ accountSid, authToken, ...(config.apiBaseUrl ? { apiBaseUrl: config.apiBaseUrl } : {}), ...(config.fetch ? { fetch: config.fetch } : {}) });

  const friendlyName = (agencyId: number) => `myEST8 Agency ${agencyId}`;
  const row = (agencyId: number) => one<Row>(db, 'SELECT * FROM sms_numbers WHERE agency_id = ?', agencyId);
  const rowOfNumber = (phoneNumber: string) => one<Row>(db, 'SELECT * FROM sms_numbers WHERE phone_number = ?', normalizeAddress(phoneNumber));

  /** What stops "Create a new number", in a line for the person who runs the server. */
  function creationBlocker(): string | null {
    const missing = [
      ...(server ? [] : ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']),
      ...(config.bundleSid ? [] : ['TWILIO_BUNDLE_SID']),
      ...(config.addressSid ? [] : ['TWILIO_ADDRESS_SID']),
    ];
    if (!missing.length) return null;
    const hint = config.bundleSid && config.addressSid ? '' : ' Running npx tsx scripts/twilio-setup.ts finds the bundle and address.';
    const names = missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}` : missing[0];
    return `The server operator hasn't set ${names} yet.${hint}`;
  }

  /** Which Twilio account a number belongs to, and the credentials to use it. */
  function credentialsOf(r: Row): { accountSid: string; authToken: string } {
    if (r.kind === 'created') {
      if (!server) throw new Error("This server's own Twilio account isn't configured");
      return server;
    }
    return { accountSid: r.account_sid!, authToken: decryptToken(r.auth_token!, encryptionKey) };
  }

  /** Whether another Agency has this number, as an SMS channel or as a Twilio number it set up. */
  async function takenByAnother(agencyId: number, phoneNumber: string) {
    const normalized = normalizeAddress(phoneNumber);
    const owner =
      (await rowOfNumber(normalized))?.agency_id ??
      (await one<{ agency_id: number }>(db, "SELECT agency_id FROM agency_channels WHERE channel_type = 'sms' AND address = ?", normalized))?.agency_id;
    return owner !== undefined && owner !== agencyId;
  }

  /** Turns a Twilio refusal into a message for the person at the page. Anything else is left to surface. */
  function refusal(error: unknown, whose: 'server' | 'agency'): never {
    if (error instanceof TwilioApiError) {
      if (error.status === 401) {
        invalid(
          whose === 'agency'
            ? "Twilio didn't accept that Account SID and Auth Token. Check both against the Twilio Console."
            : "myEST8's own Twilio account didn't accept its credentials. Tell the person who runs this server.",
        );
      }
      if (error.status >= 400 && error.status < 500) invalid(`Twilio refused that: ${error.message.replace(/^Twilio returned \d+( \(code \d+\))?: /, '')}`);
      invalid("Twilio couldn't be reached just now. Try again in a minute.");
    }
    throw error;
  }

  // Two clicks on "Create a new number" at once would each buy one. Within one server they take turns;
  // after the first, the second finds the number by its name.
  const busy = new Map<number, Promise<unknown>>();
  async function exclusively<T>(agencyId: number, work: () => Promise<T>): Promise<T> {
    const turn = (busy.get(agencyId) ?? Promise.resolve()).catch(() => {}).then(work);
    busy.set(agencyId, turn);
    try {
      return await turn;
    } finally {
      if (busy.get(agencyId) === turn) busy.delete(agencyId);
    }
  }

  async function save(agencyId: number, r: Omit<Row, 'agency_id'>) {
    await run(
      db,
      `INSERT INTO sms_numbers (agency_id, kind, phone_number, number_sid, account_sid, auth_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (agency_id) DO UPDATE SET kind = excluded.kind, phone_number = excluded.phone_number, number_sid = excluded.number_sid,
         account_sid = excluded.account_sid, auth_token = excluded.auth_token, created_at = excluded.created_at`,
      agencyId,
      r.kind,
      r.phone_number,
      r.number_sid,
      r.account_sid,
      r.auth_token,
      iso(clock.now()),
    );
  }

  /** Sends SMS from an Agency's number, through the Twilio account that owns it. */
  const messenger: Messenger = {
    async send(message) {
      const r = await rowOfNumber(message.from);
      if (!r) throw new Error(`${message.from} is not an Agency number set up in myEST8`);
      const { accountSid, authToken } = credentialsOf(r);
      await createTwilioMessenger({
        accountSid,
        authToken,
        ...(config.apiBaseUrl ? { apiBaseUrl: config.apiBaseUrl } : {}),
        ...(config.fileLinks ? { fileLinks: config.fileLinks } : {}),
        ...(config.fetch ? { fetch: config.fetch } : {}),
      }).send({ ...message, from: r.phone_number! });
    },
  };

  return {
    async status(agencyId: number): Promise<SmsNumberStatus> {
      const r = await row(agencyId);
      const blocker = creationBlocker();
      return {
        number: r?.phone_number ? { kind: r.kind, phoneNumber: r.phone_number } : null,
        choosing: r && !r.phone_number ? { accountSid: r.account_sid! } : null,
        creation: blocker ? { ok: false, reason: blocker } : { ok: true },
      };
    },

    /**
     * Buys the Agency an Australian mobile number on the server's Twilio account, or finds the
     * one already bought for it, and points its incoming texts at myEST8. Returns the number.
     */
    create(agencyId: number): Promise<string> {
      return exclusively(agencyId, async () => {
        const blocker = creationBlocker();
        if (blocker) invalid(blocker);
        const existing = await row(agencyId);
        if (existing?.phone_number && existing.kind === 'created') return existing.phone_number;
        if (existing?.phone_number) invalid('This Agency already uses its own Twilio number. Disconnect it before creating a new one.');
        const twilio = apiFor(server!.accountSid, server!.authToken);
        try {
          let number = (await twilio.ownedNumbers({ friendlyName: friendlyName(agencyId) }))[0];
          if (!number) {
            const wanted = await twilio.availableMobileNumber();
            if (!wanted) invalid("Twilio has no Australian mobile numbers to sell right now. Try again in a few minutes.");
            number = await twilio.buy({ phoneNumber: wanted, friendlyName: friendlyName(agencyId), bundleSid: config.bundleSid!, addressSid: config.addressSid!, smsUrl: webhookUrl });
          }
          if (number.smsUrl !== webhookUrl) number = await twilio.setSmsUrl(number.sid, webhookUrl);
          if (await takenByAnother(agencyId, number.phoneNumber)) invalid(`${number.phoneNumber} is connected to another Agency`);
          await save(agencyId, { kind: 'created', phone_number: normalizeAddress(number.phoneNumber), number_sid: number.sid, account_sid: null, auth_token: null });
          return normalizeAddress(number.phoneNumber);
        } catch (error) {
          return refusal(error, 'server');
        }
      });
    },

    /**
     * Checks a Twilio account's Account SID and Auth Token with Twilio, and keeps them (the token
     * encrypted) until the Agency picks one of the account's numbers. Returns how many SMS-capable
     * numbers the account has.
     */
    async checkAccount(agencyId: number, accountSid: string, authToken: string): Promise<number> {
      const sid = accountSid.trim();
      const token = authToken.trim();
      if (!/^AC[0-9a-fA-F]{32}$/.test(sid)) invalid('An Account SID starts with AC and is 34 characters long', 'accountSid');
      if (!token) invalid('Enter the Auth Token', 'authToken');
      if ((await row(agencyId))?.phone_number) invalid('Disconnect the current SMS number before connecting another');
      const twilio = apiFor(sid, token);
      try {
        const account = await twilio.account();
        if (account.status !== 'active') invalid(`That Twilio account is ${account.status || 'not active'}. Use an active account.`);
        if (account.type === 'Trial') {
          invalid("That is a Twilio trial account, which can't send myEST8's own message text. Upgrade it in the Twilio Console first.");
        }
        const numbers = (await twilio.ownedNumbers()).filter((n) => n.smsCapable);
        await save(agencyId, { kind: 'registered', phone_number: null, number_sid: null, account_sid: sid, auth_token: encryptToken(token, encryptionKey) });
        return numbers.length;
      } catch (error) {
        return refusal(error, 'agency');
      }
    },

    /** The SMS-capable numbers on the Twilio account the Agency gave, for it to pick from. Null before it has given one. */
    async offered(agencyId: number): Promise<OfferedNumber[] | null> {
      const r = await row(agencyId);
      if (!r || r.phone_number || r.kind !== 'registered') return null;
      const { accountSid, authToken } = credentialsOf(r);
      try {
        const numbers = await apiFor(accountSid, authToken).ownedNumbers();
        const free: OfferedNumber[] = [];
        for (const n of numbers.filter((n) => n.smsCapable)) {
          if (!(await takenByAnother(agencyId, n.phoneNumber))) free.push({ sid: n.sid, phoneNumber: n.phoneNumber, name: n.friendlyName });
        }
        return free;
      } catch (error) {
        return refusal(error, 'agency');
      }
    },

    /** Points the chosen number's incoming texts at myEST8 and keeps it as the Agency's. Returns the number. */
    async register(agencyId: number, numberSid: string): Promise<string> {
      const r = await row(agencyId);
      if (!r || r.phone_number || r.kind !== 'registered') invalid('Enter your Twilio Account SID and Auth Token first');
      const { accountSid, authToken } = credentialsOf(r);
      const twilio = apiFor(accountSid, authToken);
      try {
        const number: TwilioNumber | undefined = (await twilio.ownedNumbers()).find((n) => n.sid === numberSid && n.smsCapable);
        if (!number) invalid("That number isn't an SMS-capable number on your Twilio account");
        if (await takenByAnother(agencyId, number.phoneNumber)) invalid(`${number.phoneNumber} is connected to another Agency`);
        await twilio.setSmsUrl(number.sid, webhookUrl);
        await run(db, 'UPDATE sms_numbers SET phone_number = ?, number_sid = ? WHERE agency_id = ?', normalizeAddress(number.phoneNumber), number.sid, agencyId);
        return normalizeAddress(number.phoneNumber);
      } catch (error) {
        return refusal(error, 'agency');
      }
    },

    /**
     * Lets the number go. A created number is released on Twilio, so it stops costing the platform
     * money; if Twilio can't release it, nothing changes and the person is told. A registered number
     * only has its webhook cleared (when it still points at myEST8) and its stored credentials deleted.
     */
    async release(agencyId: number): Promise<void> {
      const r = await row(agencyId);
      if (!r) return;
      if (r.kind === 'created' && r.number_sid) {
        if (!server) invalid("This server can't reach its own Twilio account, so the number can't be released.");
        try {
          await apiFor(server.accountSid, server.authToken).release(r.number_sid);
        } catch (error) {
          // Already gone from Twilio is the outcome we wanted.
          if (!(error instanceof TwilioApiError && error.status === 404)) refusal(error, 'server');
        }
      } else if (r.kind === 'registered' && r.number_sid) {
        try {
          const { accountSid, authToken } = credentialsOf(r);
          const twilio = apiFor(accountSid, authToken);
          if ((await twilio.number(r.number_sid)).smsUrl === webhookUrl) await twilio.setSmsUrl(r.number_sid, '');
        } catch {
          // The Agency may have changed or closed its Twilio account. Unlinking in myEST8 still goes ahead.
        }
      }
      await run(db, 'DELETE FROM sms_numbers WHERE agency_id = ?', agencyId);
    },

    /**
     * The auth token that signs texts to `phoneNumber`: that of the Twilio account which owns it.
     * Null when the number isn't one an Agency set up here.
     */
    async authTokenFor(phoneNumber: string): Promise<string | null> {
      const r = await rowOfNumber(phoneNumber);
      // A created number needs the server's own Twilio account, which a server without it can't vouch for.
      if (!r || (r.kind === 'created' && !server)) return null;
      return credentialsOf(r).authToken;
    },

    /** The auth token of a registered Twilio account, for fetching the media its texts carry. */
    async authTokenForAccount(accountSid: string): Promise<string | null> {
      const [r] = await all<Row>(db, "SELECT * FROM sms_numbers WHERE kind = 'registered' AND account_sid = ? AND phone_number IS NOT NULL LIMIT 1", accountSid);
      return r ? credentialsOf(r).authToken : null;
    },

    /** Whether an Agency's number set up here is `phoneNumber`, so texts from it go through this module's messenger. */
    async owns(phoneNumber: string): Promise<boolean> {
      return (await rowOfNumber(phoneNumber)) !== undefined;
    },

    messenger,
  };
}

export type SmsNumbers = ReturnType<typeof createSmsNumbers>;
