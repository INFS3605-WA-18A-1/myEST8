// An Agency's connected mailbox (Gmail, ADR 0004): the OAuth connection, reading
// new mail into the inbound pipeline, and sending as the mailbox. Refresh tokens
// are stored encrypted (AES-256-GCM).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  attachmentParts,
  createGmailClient,
  buildRawMessage,
  GmailAuthError,
  GmailHistoryExpiredError,
  header,
  messageText,
} from './adapters/gmail.ts';
import { one, all, run, type Db } from './db.ts';
import type { Clock, InboundAttachment, InboundMessage, Messenger, OutboundMessage } from './ports.ts';
import { normalizeAddress } from './shared.ts';
import type { GmailConnector } from './web/connectors.ts';

interface MailboxRow {
  agency_id: number;
  address: string;
  refresh_token: string;
  history_id: string | null;
  status: string;
}

/** iv, auth tag and ciphertext as one base64 string. */
export function encryptToken(plain: string, keyBase64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decryptToken(stored: string, keyBase64: string): string {
  const bytes = Buffer.from(stored, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}

export function createGmailMailboxes(deps: {
  db: Db;
  clock: Clock;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
  fetch?: typeof fetch;
}): {
  connector: GmailConnector;
  messenger: Messenger;
  poll(receive: (m: InboundMessage) => Promise<void>): Promise<Error[]>;
} {
  const { db, clock } = deps;
  if (Buffer.from(deps.encryptionKey, 'base64').length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be base64 of 32 bytes (openssl rand -base64 32)');
  const gmail = createGmailClient({ clientId: deps.clientId, clientSecret: deps.clientSecret, redirectUri: deps.redirectUri, fetch: deps.fetch });
  const now = () => clock.now().toISOString();
  const accessToken = (row: MailboxRow) => gmail.refresh(decryptToken(row.refresh_token, deps.encryptionKey));

  const connector: GmailConnector = {
    authUrl: (state) => gmail.authUrl(state),

    async connect(agencyId, code) {
      const tokens = await gmail.exchangeCode(code);
      if (!tokens.refreshToken) throw new Error('Google did not return a refresh token. Remove myEST8 from your Google account permissions and connect again.');
      const profile = await gmail.profile(tokens.accessToken);
      const address = normalizeAddress(profile.emailAddress);
      await run(
        db,
        `INSERT INTO mailbox_connections (agency_id, provider, address, refresh_token, history_id, status, connected_at, checked_at)
         VALUES (?, 'gmail', ?, ?, ?, 'connected', ?, NULL)
         ON CONFLICT (agency_id) DO UPDATE SET provider = 'gmail', address = excluded.address, refresh_token = excluded.refresh_token,
           history_id = excluded.history_id, status = 'connected', connected_at = excluded.connected_at, checked_at = NULL`,
        agencyId,
        address,
        encryptToken(tokens.refreshToken, deps.encryptionKey),
        profile.historyId,
        now(),
      );
      return { address };
    },

    async disconnect(agencyId) {
      await run(db, 'DELETE FROM mailbox_connections WHERE agency_id = ?', agencyId);
    },

    async status(agencyId) {
      const row = await one<{ address: string; status: string }>(db, 'SELECT address, status FROM mailbox_connections WHERE agency_id = ?', agencyId);
      return row ? { address: row.address, status: row.status === 'connected' ? 'connected' : 'reconnect' } : null;
    },
  };

  const messenger: Messenger = {
    async send(message: OutboundMessage) {
      const from = normalizeAddress(message.from);
      const row = await one<MailboxRow>(db, 'SELECT * FROM mailbox_connections WHERE address = ?', from);
      if (!row) throw new Error(`No Gmail mailbox is connected for ${from}`);
      const token = await accessToken(row);
      await gmail.send(
        token,
        buildRawMessage({ from, to: message.to, cc: message.cc, subject: message.subject, text: message.text, attachments: message.attachments }),
      );
    },
  };

  async function pollMailbox(row: MailboxRow, receive: (m: InboundMessage) => Promise<void>) {
    const token = await accessToken(row);
    if (!row.history_id) {
      const profile = await gmail.profile(token);
      await run(db, 'UPDATE mailbox_connections SET history_id = ?, checked_at = ? WHERE agency_id = ?', profile.historyId, now(), row.agency_id);
      return;
    }
    let result: { messageIds: string[]; historyId: string };
    try {
      result = await gmail.history(token, row.history_id);
    } catch (error) {
      if (!(error instanceof GmailHistoryExpiredError)) throw error;
      // Too old to list from: skip what we missed and carry on from now.
      const profile = await gmail.profile(token);
      await run(db, 'UPDATE mailbox_connections SET history_id = ?, checked_at = ? WHERE agency_id = ?', profile.historyId, now(), row.agency_id);
      return;
    }
    for (const id of result.messageIds) {
      const message = await gmail.message(token, id);
      const labels = message.labelIds ?? [];
      if (labels.some((l) => l === 'SENT' || l === 'DRAFT' || l === 'SPAM') || !message.payload) continue;
      const fromField = header(message.payload, 'From');
      const from = normalizeAddress(/<([^>]+)>/.exec(fromField)?.[1] ?? fromField);
      if (from === row.address) continue;

      const attachments: InboundAttachment[] = [];
      for (const part of attachmentParts(message.payload)) {
        const content = part.attachmentId
          ? await gmail.attachment(token, id, part.attachmentId)
          : new Uint8Array(Buffer.from(part.data!, 'base64url'));
        attachments.push({ filename: part.filename, contentType: part.contentType, content });
      }
      const subject = header(message.payload, 'Subject').trim();
      const body = messageText(message.payload);
      await receive({
        providerMessageId: `gmail-${id}`,
        agencyChannel: row.address,
        channelType: 'email',
        from,
        text: subject && !/^(re|fwd?):/i.test(subject) ? `${subject}\n\n${body}` : body,
        attachments,
        receivedAt: message.internalDate ? new Date(Number(message.internalDate)) : clock.now(),
      });
    }
    await run(db, 'UPDATE mailbox_connections SET history_id = ?, checked_at = ? WHERE agency_id = ?', result.historyId, now(), row.agency_id);
  }

  return {
    connector,
    messenger,
    async poll(receive) {
      const errors: Error[] = [];
      const rows = await all<MailboxRow>(db, "SELECT * FROM mailbox_connections WHERE status = 'connected' AND provider = 'gmail' ORDER BY agency_id");
      for (const row of rows) {
        try {
          await pollMailbox(row, receive);
        } catch (error) {
          if (error instanceof GmailAuthError) {
            await run(db, "UPDATE mailbox_connections SET status = 'reconnect', checked_at = ? WHERE agency_id = ?", now(), row.agency_id);
          }
          errors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      return errors;
    },
  };
}
