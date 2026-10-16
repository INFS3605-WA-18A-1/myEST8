// Proves a Property Manager owns an SMS, WhatsApp or email address before it is
// stored. start sends a 6-digit code; confirm stores the address, through
// profiles.connectChannel, only after the code matches.

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { Context } from './context.ts';
import { all, one, run, transaction } from './db.ts';
import { UndeliverableError, type ChannelType } from './ports.ts';
import { addMs, invalid, isEmail, iso, normalizeAddress } from './shared.ts';

const CHANNEL_TYPES: ChannelType[] = ['sms', 'whatsapp', 'email'];
const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

type Row = {
  address: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  confirmed_at: string | null;
};

/** The inbound mail domain. Tests leave RESEND_INBOUND_DOMAIN unset and get the default. */
export function inboundEmailDomain(env: Record<string, string | undefined> = process.env) {
  return env.RESEND_INBOUND_DOMAIN?.trim() || 'mail.example.test';
}

/** "Sunrise Realty" -> "sunrise-realty". */
export function agencySlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agency';
}

function newCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function hashCode(code: string) {
  return createHash('sha256').update(code).digest('base64');
}

/** Compares the submitted code to the stored hash without leaking how much matched. */
function sameCode(code: string, stored: string) {
  const actual = createHash('sha256').update(code).digest();
  const expected = Buffer.from(stored, 'base64');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export function createChannelVerification({ db, clock, modules }: Context) {
  const { profiles } = modules;

  function requireChannel(channelType: ChannelType) {
    if (!CHANNEL_TYPES.includes(channelType)) invalid(`Unknown channel ${channelType}`);
  }

  async function heardEmail(agencyId: number) {
    return Boolean(await one(db, 'SELECT 1 FROM inbound_messages WHERE agency_id = ? AND channel_type = ? LIMIT 1', agencyId, 'email'));
  }

  return {
    /**
     * Sends a 6-digit code to `address` and stores only its hash. The address is
     * not connected until confirm. A new call replaces any code still open.
     */
    async start(agencyId: number, channelType: ChannelType, address: string) {
      requireChannel(channelType);
      const normalized = normalizeAddress(address);
      const usable = channelType === 'email' ? isEmail(normalized) : normalized.startsWith('+');
      if (!usable) invalid(channelType === 'email' ? 'Enter an email address' : 'Enter a mobile number', 'address');
      const owner = await profiles.agencyByChannel(channelType, normalized);
      if (owner !== null && owner !== agencyId) invalid(`${address} is connected to another Agency`);

      const code = newCode();
      await transaction(db, async () => {
        await run(db, 'DELETE FROM channel_verifications WHERE agency_id = ? AND channel_type = ?', agencyId, channelType);
        await run(
          db,
          `INSERT INTO channel_verifications (agency_id, channel_type, address, code_hash, expires_at, attempts)
           VALUES (?, ?, ?, ?, ?, 0)`,
          agencyId,
          channelType,
          normalized,
          hashCode(code),
          iso(addMs(clock.now(), CODE_TTL_MS)),
        );
      });
      try {
        await modules.notifications.sendVerificationCode(agencyId, channelType, normalized, code);
      } catch (error) {
        if (!(error instanceof UndeliverableError)) throw error;
        // No provider for this channel, or it refused the address: say so rather than fail, and keep no code nobody received.
        await run(db, 'DELETE FROM channel_verifications WHERE agency_id = ? AND channel_type = ?', agencyId, channelType);
        invalid(`We couldn't send a code to ${address}. ${error.message}`, 'address');
      }
    },

    /**
     * Stores the address once the code matches. A wrong code counts as an
     * attempt; five wrong codes, or a code older than 10 minutes, refuse.
     */
    async confirm(agencyId: number, channelType: ChannelType, address: string, code: string) {
      requireChannel(channelType);
      const normalized = normalizeAddress(address);
      const outcome = await transaction(db, async () => {
        const row = await one<Row>(db, 'SELECT address, code_hash, expires_at, attempts, confirmed_at FROM channel_verifications WHERE agency_id = ? AND channel_type = ?', agencyId, channelType);
        if (!row || row.address !== normalized) return 'missing' as const;
        if (row.confirmed_at) return 'ok' as const;
        if (row.expires_at <= iso(clock.now())) return 'expired' as const;
        if (row.attempts >= MAX_ATTEMPTS) return 'locked' as const;
        if (!sameCode(code.trim(), row.code_hash)) {
          await run(db, 'UPDATE channel_verifications SET attempts = attempts + 1 WHERE agency_id = ? AND channel_type = ?', agencyId, channelType);
          return 'wrong' as const;
        }
        await run(db, 'UPDATE channel_verifications SET confirmed_at = ? WHERE agency_id = ? AND channel_type = ?', iso(clock.now()), agencyId, channelType);
        return 'ok' as const;
      });
      if (outcome === 'missing') invalid('Send a code to this number first', 'code');
      if (outcome === 'expired') invalid('That code has expired. Send a new one.', 'code');
      if (outcome === 'locked') invalid('That code has been tried too many times. Send a new one.', 'code');
      if (outcome === 'wrong') invalid('That code is wrong.', 'code');
      await profiles.connectChannel(agencyId, channelType, normalized);
      await profiles.markChannelTested(agencyId, channelType);
    },

    /** Codes still open: unconfirmed, unexpired, and under the attempt limit. */
    async pending(agencyId: number) {
      const now = iso(clock.now());
      return (await all<{ channel_type: ChannelType; address: string; expires_at: string; attempts: number; confirmed_at: string | null }>(
        db,
        'SELECT channel_type, address, expires_at, attempts, confirmed_at FROM channel_verifications WHERE agency_id = ?',
        agencyId,
      ))
        .filter((row) => !row.confirmed_at && row.expires_at > now && row.attempts < MAX_ATTEMPTS)
        .map((row) => ({ channelType: row.channel_type, address: row.address }));
    },

    /**
     * The Agency's inbound email address, `<slug>@RESEND_INBOUND_DOMAIN`, stored
     * as its email channel. An address already connected (Gmail, the demo) is
     * left as it is. `waiting` until the first inbound email, then `verified`.
     */
    async ensureInboundEmail(agencyId: number): Promise<{ address: string; state: 'waiting' | 'verified' | 'connected' }> {
      const domain = inboundEmailDomain();
      const existing = await profiles.channelAddress(agencyId, 'email');
      if (existing && !existing.endsWith(`@${domain}`)) {
        const tested = (await profiles.channels(agencyId)).some((channel) => channel.type === 'email' && channel.testedAt);
        return { address: existing, state: tested ? 'verified' : 'connected' };
      }
      let address = existing;
      if (!address) {
        const agency = await profiles.agency(agencyId);
        const slug = agencySlug(agency.name);
        address = `${slug}@${domain}`;
        const owner = await profiles.agencyByChannel('email', address);
        if (owner !== null && owner !== agencyId) address = `${slug}-${agencyId}@${domain}`;
        await profiles.connectChannel(agencyId, 'email', address);
      }
      return { address, state: (await heardEmail(agencyId)) ? 'verified' : 'waiting' };
    },
  };
}

export type ChannelVerification = ReturnType<typeof createChannelVerification>;
