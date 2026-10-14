// Gmail as the Agency's email channel (docs/adr/0004): connecting it from Settings,
// and the poll that turns new mail in each connected mailbox into inbound messages.

import { randomBytes } from 'node:crypto';
import { pollGmailInbox } from './adapters/gmail-inbox.ts';
import { newPkce } from './adapters/gmail-oauth.ts';
import type { Context } from './context.ts';
import { GmailConnectionLost, type GmailCredentials, type GmailStatus } from './gmail-credentials.ts';

export const GMAIL_POLL_INTERVAL_MS = 60_000;

export function createGmailChannel({ worker, modules }: Context, gmail: GmailCredentials | null) {
  if (gmail) {
    worker.every('gmail.poll', GMAIL_POLL_INTERVAL_MS, async () => {
      const failures: unknown[] = [];
      // One Agency's mailbox failing never keeps another's mail waiting.
      for (const connection of await gmail.active()) {
        try {
          const poll = await pollGmailInbox({ accessToken: await gmail.accessToken(connection.agencyId), address: connection.email, cursor: connection.cursor, fetch: gmail.fetch });
          // Receiving is idempotent by message id, so a poll repeated after a failure doesn't duplicate.
          for (const message of poll.messages) await modules.intake.receive(message);
          await gmail.setCursor(connection.agencyId, poll.cursor);
        } catch (error) {
          if (!(error instanceof GmailConnectionLost)) failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, `Gmail polling failed for ${failures.length} Agency mailbox(es)`);
    });
  }

  return {
    async status(agencyId: number): Promise<GmailStatus | 'unavailable'> {
      return gmail ? gmail.status(agencyId) : 'unavailable';
    },

    /**
     * Starts a Google sign-in: the URL to send the Property Manager to, and the state and PKCE verifier
     * to remember (in cookies) until Google sends them back. Null when Gmail isn't set up on this server.
     */
    begin(redirectUri: string): { url: string; state: string; codeVerifier: string } | null {
      if (!gmail) return null;
      const pkce = newPkce();
      const state = randomBytes(24).toString('base64url');
      return { url: gmail.authorizationUrl({ redirectUri, state, codeChallenge: pkce.challenge }), state, codeVerifier: pkce.verifier };
    },

    /**
     * Finishes the Google sign-in: connects the Agency's email channel to the Gmail address and
     * stores the token. Polling starts from now. Returns the address.
     */
    async connect(agencyId: number, o: { code: string; codeVerifier: string; redirectUri: string }): Promise<string> {
      if (!gmail) throw new Error('Gmail is not set up on this server (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and CHANNEL_SECRET_KEY).');
      const tokens = await gmail.exchange(o);
      // Refused here, before anything is stored, when another Agency already has this address.
      await modules.profiles.connectChannel(agencyId, 'email', tokens.email);
      await gmail.save(agencyId, { refreshToken: tokens.refreshToken, email: tokens.email });
      if ((await gmail.active()).find((c) => c.agencyId === agencyId)?.cursor == null) {
        const start = await pollGmailInbox({ accessToken: tokens.accessToken, address: tokens.email, cursor: null, fetch: gmail.fetch });
        await gmail.setCursor(agencyId, start.cursor);
      }
      return tokens.email;
    },
  };
}

export type GmailChannel = ReturnType<typeof createGmailChannel>;
