import { randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { one, run } from '../src/db.ts';
import { decryptToken, createGmailMailboxes, encryptToken } from '../src/mailboxes.ts';
import type { InboundMessage } from '../src/ports.ts';
import { json, stubFetch } from './adapters/stub-fetch.ts';
import { FakeClock } from './support/fakes.ts';
import { testDb } from './support/db.ts';

const key = randomBytes(32).toString('base64');
const b64 = (s: string | Uint8Array) => Buffer.from(s).toString('base64url');
const h = (name: string, value: string) => ({ name, value });

type Handler = (url: URL, request: Request) => Response | undefined;

async function setup(handler: Handler) {
  const db = await testDb();
  const agencyId = await run(db, 'INSERT INTO agencies (name, time_zone) VALUES (?, ?) RETURNING id', 'Harbour Realty', 'Australia/Sydney');
  const stub = stubFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname === '/token') return json({ access_token: 'at', refresh_token: 'rt-secret' });
    if (url.pathname.endsWith('/profile')) return json({ emailAddress: 'Agency@Gmail.com', historyId: '100' });
    return handler(url, request) ?? json({}, 500);
  });
  const mailboxes = createGmailMailboxes({
    db,
    clock: new FakeClock(new Date("2026-10-13T00:00:00Z")),
    clientId: 'cid',
    clientSecret: 'sec',
    redirectUri: 'https://x.test/cb',
    encryptionKey: key,
    fetch: stub.fetch,
  });
  return { db, agencyId, stub, ...mailboxes };
}

const collect = () => {
  const received: InboundMessage[] = [];
  return { received, receive: async (m: InboundMessage) => void received.push(m) };
};

const inboxMessage = (id: string, from: string, labelIds = ['INBOX']) => ({
  id,
  labelIds,
  internalDate: '1791000000000',
  payload: {
    mimeType: 'multipart/mixed',
    headers: [h('From', from), h('Subject', 'Leaking tap')],
    parts: [
      { mimeType: 'text/plain', body: { data: b64('The kitchen tap is leaking') } },
      { mimeType: 'image/jpeg', filename: 'tap.jpg', body: { attachmentId: 'att1', size: 3 } },
    ],
  },
});

describe('token encryption', () => {
  test('round-trips, and differs each time', () => {
    const a = encryptToken('refresh-token', key);
    expect(a).not.toContain('refresh-token');
    expect(decryptToken(a, key)).toBe('refresh-token');
    expect(encryptToken('refresh-token', key)).not.toBe(a);
    expect(() => decryptToken(a, randomBytes(32).toString('base64'))).toThrow();
  });
});

describe('connect', () => {
  test('stores the encrypted token and the profile history id, and reports the address', async () => {
    const m = await setup(() => undefined);
    expect(await m.connector.connect(m.agencyId, 'code')).toEqual({ address: 'agency@gmail.com' });
    const row = await one<{ refresh_token: string; history_id: string; status: string }>(m.db, 'SELECT * FROM mailbox_connections WHERE agency_id = ?', m.agencyId);
    expect(row!.history_id).toBe('100');
    expect(row!.status).toBe('connected');
    expect(row!.refresh_token).not.toContain('rt-secret');
    expect(decryptToken(row!.refresh_token, key)).toBe('rt-secret');
    expect(await m.connector.status(m.agencyId)).toEqual({ address: 'agency@gmail.com', status: 'connected' });
    await m.connector.disconnect(m.agencyId);
    expect(await m.connector.status(m.agencyId)).toBeNull();
  });
});

describe('poll', () => {
  const handler: Handler = (url) => {
    if (url.pathname.endsWith('/history')) {
      return json({ history: [{ messagesAdded: ['m1', 'm2', 'm3', 'm4'].map((id) => ({ message: { id } })) }], historyId: '150' });
    }
    if (url.pathname.endsWith('/messages/m1')) return json(inboxMessage('m1', 'Tina Tenant <Tina@Example.com>'));
    if (url.pathname.endsWith('/messages/m2')) return json(inboxMessage('m2', 'Tina <tina@example.com>', ['SENT']));
    if (url.pathname.endsWith('/messages/m3')) return json(inboxMessage('m3', 'Agency <agency@gmail.com>'));
    if (url.pathname.endsWith('/messages/m4')) return json(inboxMessage('m4', 'spam@example.com', ['SPAM']));
    if (url.pathname.endsWith('/attachments/att1')) return json({ data: b64(new Uint8Array([1, 2, 3])) });
    return undefined;
  };

  test('maps a multipart message with an attachment, skips SENT, SPAM and self mail, and saves the history id', async () => {
    const m = await setup(handler);
    await m.connector.connect(m.agencyId, 'code');
    const { received, receive } = collect();
    expect(await m.poll(receive)).toEqual([]);
    expect(received).toEqual([
      {
        providerMessageId: 'gmail-m1',
        agencyChannel: 'agency@gmail.com',
        channelType: 'email',
        from: 'tina@example.com',
        text: 'Leaking tap\n\nThe kitchen tap is leaking',
        attachments: [{ filename: 'tap.jpg', contentType: 'image/jpeg', content: new Uint8Array([1, 2, 3]) }],
        receivedAt: new Date(1791000000000),
      },
    ]);
    const row = await one<{ history_id: string; checked_at: string }>(m.db, 'SELECT * FROM mailbox_connections WHERE agency_id = ?', m.agencyId);
    expect(row!.history_id).toBe('150');
    expect(row!.checked_at).toBeTruthy();
    const history = m.stub.requests.find((r) => r.url.includes('/history'))!;
    expect(new URL(history.url).searchParams.get('startHistoryId')).toBe('100');
  });

  test('a 404 from history resets the history id to the profile and reads nothing', async () => {
    const m = await setup((url) => (url.pathname.endsWith('/history') ? new Response('gone', { status: 404 }) : undefined));
    await m.connector.connect(m.agencyId, 'code');
    await run(m.db, "UPDATE mailbox_connections SET history_id = '5' WHERE agency_id = ?", m.agencyId);
    const { received, receive } = collect();
    expect(await m.poll(receive)).toEqual([]);
    expect(received).toEqual([]);
    expect((await one<{ history_id: string }>(m.db, 'SELECT history_id FROM mailbox_connections'))!.history_id).toBe('100');
  });

  test('invalid_grant marks the mailbox reconnect, and it is not polled again', async () => {
    const m = await setup(() => undefined);
    await m.connector.connect(m.agencyId, 'code');
    const revoked = createGmailMailboxes({
      db: m.db,
      clock: new FakeClock(new Date("2026-10-13T00:00:00Z")),
      clientId: 'cid',
      clientSecret: 'sec',
      redirectUri: 'https://x.test/cb',
      encryptionKey: key,
      fetch: stubFetch(() => json({ error: 'invalid_grant' }, 400)).fetch,
    });
    const { receive } = collect();
    const errors = await revoked.poll(receive);
    expect(errors).toHaveLength(1);
    expect(await m.connector.status(m.agencyId)).toEqual({ address: 'agency@gmail.com', status: 'reconnect' });
    expect(await revoked.poll(receive)).toEqual([]);
  });
});

describe('messenger', () => {
  test('sends the connected mailbox’s message as base64url RFC 2822', async () => {
    let sent: { raw: string } | undefined;
    const m = await setup((url, request) => {
      if (url.pathname.endsWith('/messages/send')) {
        void request.clone().json().then((b) => (sent = b as { raw: string }));
        return json({ id: 'sent1' });
      }
      return undefined;
    });
    await m.connector.connect(m.agencyId, 'code');
    await m.messenger.send({
      channelType: 'email',
      from: 'Agency@Gmail.com',
      to: 'tina@example.com',
      cc: [],
      subject: 'Your repair',
      text: 'A plumber is booked.',
      template: 'x',
      data: {},
      attachments: [],
    });
    await new Promise((r) => setTimeout(r, 10));
    const mime = Buffer.from(sent!.raw, 'base64url').toString('utf8');
    expect(mime).toContain('From: agency@gmail.com');
    expect(mime).toContain('To: tina@example.com');
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from('Your repair').toString('base64')}?=`);
    expect(Buffer.from(mime.split('\r\n\r\n')[1]!.replace(/\r\n/g, ''), 'base64').toString()).toBe('A plumber is booked.');
  });

  test('throws naming the address when no mailbox is connected', async () => {
    const m = await setup(() => undefined);
    await expect(
      m.messenger.send({ channelType: 'email', from: 'nobody@gmail.com', to: 'a@b.test', cc: [], subject: 's', text: 't', template: 'x', data: {}, attachments: [] }),
    ).rejects.toThrow('nobody@gmail.com');
  });
});
