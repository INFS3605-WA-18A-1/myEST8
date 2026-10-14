// The Gmail connections of the Agencies (docs/adr/0004): each Agency's refresh
// token (encrypted), the address it belongs to, where polling is up to and
// whether Google still accepts it. Also the short-lived access tokens, kept in
// memory. The one place that knows the Google client and CHANNEL_SECRET_KEY.

import { decryptSecret, encryptSecret } from './channel-secrets.ts';
import { all, one, run, type Db } from './db.ts';
import { exchangeGmailCode, GmailReconnectRequired, gmailAuthorizationUrl, refreshGmailAccessToken } from './adapters/gmail-oauth.ts';
import type { Clock } from './ports.ts';
import { iso } from './shared.ts';

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  /** CHANNEL_SECRET_KEY: 32 bytes, base64. */
  secretKey: string;
  fetch?: typeof fetch;
}

export type GmailStatus = 'not_connected' | 'connected' | 'needs_reconnect';

/** Sending or reading can't go on until the Agency reconnects Gmail. `permanent`, so the worker doesn't retry a send. */
export class GmailConnectionLost extends Error {
  readonly permanent = true;
  constructor(reason: string) {
    super(reason);
    this.name = 'GmailConnectionLost';
  }
}

const EXPIRY_MARGIN_MS = 60_000;

export function createGmailCredentials({ db, clock, config }: { db: Db; clock: Clock; config: GmailConfig }) {
  const tokens = new Map<number, { token: string; expiresAt: number }>();
  const fetchImpl = config.fetch;
  const client = { clientId: config.clientId, clientSecret: config.clientSecret, ...(fetchImpl ? { fetch: fetchImpl } : {}) };

  async function markNeedsReconnect(agencyId: number) {
    tokens.delete(agencyId);
    await run(db, `UPDATE channel_credentials SET status = 'needs_reconnect', updated_at = ? WHERE agency_id = ? AND channel_type = 'email'`, iso(clock.now()), agencyId);
  }

  return {
    fetch: fetchImpl ?? fetch,

    authorizationUrl: (o: { redirectUri: string; state: string; codeChallenge: string }) => gmailAuthorizationUrl({ clientId: config.clientId, ...o }),

    /** Trades the sign-in code for tokens, without storing anything yet. */
    exchange: (o: { code: string; codeVerifier: string; redirectUri: string }) => exchangeGmailCode({ ...client, ...o }),

    /**
     * Stores a connection, replacing any the Agency had. Reconnecting the same address keeps
     * the polling cursor, so mail that arrived while the connection was down is still read.
     */
    async save(agencyId: number, o: { refreshToken: string; email: string }) {
      const existing = await one<{ data: string; cursor: string | null }>(db, `SELECT data, cursor FROM channel_credentials WHERE agency_id = ? AND channel_type = 'email'`, agencyId);
      const sameAddress = existing && (JSON.parse(existing.data) as { email?: string }).email === o.email;
      tokens.delete(agencyId);
      await run(
        db,
        `INSERT INTO channel_credentials (agency_id, channel_type, provider, secret, data, cursor, status, updated_at)
         VALUES (?, 'email', 'gmail', ?, ?, ?, 'ok', ?)
         ON CONFLICT (agency_id, channel_type) DO UPDATE SET provider = excluded.provider, secret = excluded.secret, data = excluded.data,
           cursor = excluded.cursor, status = 'ok', updated_at = excluded.updated_at`,
        agencyId,
        encryptSecret(config.secretKey, o.refreshToken),
        JSON.stringify({ email: o.email }),
        sameAddress ? existing.cursor : null,
        iso(clock.now()),
      );
    },

    async status(agencyId: number): Promise<GmailStatus> {
      const row = await one<{ status: string }>(db, `SELECT status FROM channel_credentials WHERE agency_id = ? AND channel_type = 'email' AND provider = 'gmail'`, agencyId);
      return !row ? 'not_connected' : row.status === 'ok' ? 'connected' : 'needs_reconnect';
    },

    /** An access token for the Agency's Gmail, refreshed when it is about to expire. */
    async accessToken(agencyId: number): Promise<string> {
      const cached = tokens.get(agencyId);
      if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > clock.now().getTime()) return cached.token;
      const row = await one<{ secret: Uint8Array | null; status: string }>(db, `SELECT secret, status FROM channel_credentials WHERE agency_id = ? AND channel_type = 'email' AND provider = 'gmail'`, agencyId);
      if (!row?.secret) throw new GmailConnectionLost('Gmail is not connected for this Agency: connect it in Settings.');
      if (row.status !== 'ok') throw new GmailConnectionLost('Gmail needs reconnecting for this Agency: connect it again in Settings.');
      try {
        const fresh = await refreshGmailAccessToken({ ...client, refreshToken: decryptSecret(config.secretKey, row.secret) });
        tokens.set(agencyId, { token: fresh.accessToken, expiresAt: clock.now().getTime() + fresh.expiresInSeconds * 1000 });
        return fresh.accessToken;
      } catch (error) {
        if (!(error instanceof GmailReconnectRequired)) throw error;
        await markNeedsReconnect(agencyId);
        throw new GmailConnectionLost(error.message);
      }
    },

    /** Every connection polling should read: working, with its address and cursor. */
    async active(): Promise<{ agencyId: number; email: string; cursor: string | null }[]> {
      const rows = await all<{ agency_id: number; data: string; cursor: string | null }>(db, `SELECT agency_id, data, cursor FROM channel_credentials WHERE provider = 'gmail' AND status = 'ok' ORDER BY agency_id`);
      return rows.map((r) => ({ agencyId: r.agency_id, email: (JSON.parse(r.data) as { email: string }).email, cursor: r.cursor }));
    },

    async setCursor(agencyId: number, cursor: string) {
      await run(db, `UPDATE channel_credentials SET cursor = ?, updated_at = ? WHERE agency_id = ? AND channel_type = 'email'`, cursor, iso(clock.now()), agencyId);
    },

    markNeedsReconnect,
  };
}

export type GmailCredentials = ReturnType<typeof createGmailCredentials>;
