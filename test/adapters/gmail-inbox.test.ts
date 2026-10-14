import { describe, expect, test } from 'vitest';
import { pollGmailInbox } from '../../src/adapters/gmail-inbox.ts';
import { json, stubFetch } from './stub-fetch.ts';

const MAILBOX = 'inbox@harbour.example';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const b64 = (value: string | Uint8Array) => Buffer.from(value).toString('base64url');
const AT = 1791420000000;

type Part = { mimeType: string; filename?: string; headers?: { name: string; value: string }[]; body: { data?: string; attachmentId?: string; size?: number }; parts?: Part[] };
type GmailMessage = { id: string; threadId: string; labelIds: string[]; internalDate: string; payload: Part & { headers: { name: string; value: string }[] } };

const headers = (from: string, subject: string) => [
  { name: 'From', value: from },
  { name: 'To', value: MAILBOX },
  { name: 'Subject', value: subject },
  { name: 'Message-ID', value: '<CAJ8x3k2@mail.example>' },
];
const text = (id: string, from: string, subject: string, body: string, extra: Partial<GmailMessage> = {}): GmailMessage => ({
  id,
  threadId: `t-${id}`,
  labelIds: ['INBOX', 'UNREAD'],
  internalDate: String(AT),
  payload: { mimeType: 'text/plain', headers: headers(from, subject), body: { data: b64(body) } },
  ...extra,
});

interface World {
  profileHistoryId?: string;
  /** history.list pages, in order, keyed by the page token that fetches them ('' is the first). */
  history?: Record<string, { history?: { id: string; messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[]; historyId: string; nextPageToken?: string }>;
  historyStatus?: number;
  messages?: Record<string, GmailMessage>;
  attachments?: Record<string, Uint8Array>;
}

function gmail(world: World) {
  const stub = stubFetch((request) => {
    const url = new URL(request.url);
    const path = url.pathname.replace('/gmail/v1/users/me/', '');
    if (request.headers.get('authorization') !== 'Bearer ya29.test') return json({ error: { code: 401 } }, 401);
    if (path === 'profile') return json({ emailAddress: MAILBOX, historyId: world.profileHistoryId ?? '5000' });
    if (path === 'history') {
      if (world.historyStatus) return json({ error: { code: world.historyStatus, message: 'x' } }, world.historyStatus);
      return json(world.history?.[url.searchParams.get('pageToken') ?? ''] ?? { historyId: url.searchParams.get('startHistoryId') });
    }
    const attachment = /^messages\/([^/]+)\/attachments\/(.+)$/.exec(path);
    if (attachment) return json({ size: 5, data: b64(world.attachments?.[attachment[2]!] ?? new Uint8Array()) });
    const message = /^messages\/(.+)$/.exec(path);
    if (message) {
      const found = world.messages?.[message[1]!];
      return found ? json(found) : json({ error: { code: 404, message: 'Requested entity was not found.' } }, 404);
    }
    return json({ error: { code: 404 } }, 404);
  });
  const poll = (cursor: string | null) => pollGmailInbox({ accessToken: 'ya29.test', address: MAILBOX, cursor, fetch: stub.fetch });
  return { stub, poll };
}

const added = (...ids: string[]) => [{ id: '5001', messagesAdded: ids.map((id) => ({ message: { id, labelIds: ['INBOX'] } })) }];

describe('Gmail inbox polling', () => {
  test('the first poll only records where the mailbox is up to, and reads no mail', async () => {
    const { stub, poll } = gmail({ profileHistoryId: '5000', messages: { old: text('old', 'Ruby <r@example.com>', 'Old mail', 'x') } });
    expect(await poll(null)).toEqual({ messages: [], cursor: '5000', reset: false });
    expect(stub.requests.map((r) => new URL(r.url).pathname)).toEqual(['/gmail/v1/users/me/profile']);
  });

  test('a new message becomes an inbound message, and the cursor moves to where Gmail says it is', async () => {
    const { stub, poll } = gmail({
      history: { '': { history: added('m1'), historyId: '5010' } },
      messages: { m1: text('m1', 'Ruby Russo <Ruby@Example.com>', 'Leaking tap', 'The kitchen tap is leaking.') },
    });
    expect(await poll('5000')).toEqual({
      messages: [
        {
          providerMessageId: `gmail:${MAILBOX}:m1`,
          agencyChannel: MAILBOX,
          channelType: 'email',
          from: 'ruby@example.com',
          text: 'Leaking tap\n\nThe kitchen tap is leaking.',
          attachments: [],
          receivedAt: new Date(AT),
        },
      ],
      cursor: '5010',
      reset: false,
    });
    const history = new URL(stub.requests.find((r) => r.url.includes('/history'))!.url).searchParams;
    expect(history.get('startHistoryId')).toBe('5000');
    expect(history.get('historyTypes')).toBe('messageAdded');
    expect(history.get('labelId')).toBe('INBOX');
    expect(stub.requests.find((r) => r.url.includes('/messages/m1'))!.url).toContain('format=full');
  });

  test('a reply keeps only what was written, with no subject and no quoted message', async () => {
    const body = ['$260 inc GST, Wednesday 9am.', '', 'Quinn', '', 'On Thu, 8 Oct 2026 at 18:00, Harbour Realty <inbox@harbour.example> wrote:', '> Harbour Realty is asking for a quote.'].join('\r\n');
    const { poll } = gmail({
      history: { '': { history: added('m2'), historyId: '5010' } },
      messages: { m2: text('m2', 'Quinn Quick <Quotes@QuickPipes.example>', 'Re: Quote request', body) },
    });
    const [message] = (await poll('5000')).messages;
    expect(message!.from).toBe('quotes@quickpipes.example');
    expect(message!.text).toBe('$260 inc GST, Wednesday 9am.\n\nQuinn');
  });

  test('prefers the plain text of a multipart message, and falls back to the HTML', async () => {
    const alternative = (parts: Part[]): GmailMessage => ({
      ...text('m3', 'Ruby <r@example.com>', 'Hello', ''),
      payload: { mimeType: 'multipart/alternative', headers: headers('Ruby <r@example.com>', 'Hello'), body: {}, parts },
    });
    const both = alternative([
      { mimeType: 'text/plain', body: { data: b64('plain version') } },
      { mimeType: 'text/html', body: { data: b64('<p>html version</p>') } },
    ]);
    const htmlOnly = { ...alternative([{ mimeType: 'text/html', body: { data: b64('<p>Only HTML</p><div>second line</div>') } }]), id: 'm4' };
    const { poll } = gmail({ history: { '': { history: added('m3', 'm4'), historyId: '5010' } }, messages: { m3: both, m4: htmlOnly } });
    const texts = (await poll('5000')).messages.map((m) => m.text);
    expect(texts).toEqual(['Hello\n\nplain version', 'Hello\n\nOnly HTML\nsecond line']);
  });

  test('downloads attachments, whether Gmail sends them inline or by attachment id', async () => {
    const mixed: GmailMessage = {
      ...text('m5', 'Quinn <q@example.com>', 'Re: Quote request', ''),
      payload: {
        mimeType: 'multipart/mixed',
        headers: headers('Quinn <q@example.com>', 'Re: Quote request'),
        body: {},
        parts: [
          { mimeType: 'text/plain', body: { data: b64('Quote attached.') } },
          { mimeType: 'application/pdf', filename: 'Quote-1042.pdf', body: { attachmentId: 'att1', size: 5 } },
          { mimeType: 'image/jpeg', filename: 'tap.jpg', body: { data: b64(PDF), size: 5 } },
        ],
      },
    };
    const { poll } = gmail({ history: { '': { history: added('m5'), historyId: '5010' } }, messages: { m5: mixed }, attachments: { att1: PDF } });
    const [message] = (await poll('5000')).messages;
    expect(message!.text).toBe('Quote attached.');
    expect(message!.attachments).toEqual([
      { filename: 'Quote-1042.pdf', contentType: 'application/pdf', content: PDF },
      { filename: 'tap.jpg', contentType: 'image/jpeg', content: PDF },
    ]);
  });

  test('skips the Agency’s own sent mail and drafts, but still moves the cursor past them', async () => {
    const { poll } = gmail({
      history: { '': { history: added('sent', 'self', 'draft', 'real'), historyId: '5020' } },
      messages: {
        sent: text('sent', 'Harbour <inbox@harbour.example>', 'Quote request', 'x', { labelIds: ['SENT'] }),
        self: text('self', 'Harbour Realty <INBOX@harbour.example>', 'Note to self', 'x'),
        draft: text('draft', 'Ruby <r@example.com>', 'Draft', 'x', { labelIds: ['DRAFT'] }),
        real: text('real', 'Ruby <r@example.com>', 'Real', 'hello'),
      },
    });
    const result = await poll('5000');
    expect(result.messages.map((m) => m.providerMessageId)).toEqual([`gmail:${MAILBOX}:real`]);
    expect(result.cursor).toBe('5020');
  });

  test('a message that shows up in two history records is read once', async () => {
    const { stub, poll } = gmail({
      history: { '': { history: [...added('m1'), { id: '5002', messagesAdded: [{ message: { id: 'm1', labelIds: ['INBOX'] } }] }], historyId: '5010' } },
      messages: { m1: text('m1', 'Ruby <r@example.com>', 'Hi', 'hello') },
    });
    expect((await poll('5000')).messages).toHaveLength(1);
    expect(stub.requests.filter((r) => r.url.includes('/messages/m1'))).toHaveLength(1);
  });

  test('follows history pages, and the cursor is the last page’s', async () => {
    const { poll } = gmail({
      history: {
        '': { history: added('m1'), historyId: '5010', nextPageToken: 'p2' },
        p2: { history: [{ id: '5011', messagesAdded: [{ message: { id: 'm2', labelIds: ['INBOX'] } }] }], historyId: '5030' },
      },
      messages: { m1: text('m1', 'Ruby <r@example.com>', 'One', 'a'), m2: text('m2', 'Ruby <r@example.com>', 'Two', 'b') },
    });
    const result = await poll('5000');
    expect(result.messages.map((m) => m.text)).toEqual(['One\n\na', 'Two\n\nb']);
    expect(result.cursor).toBe('5030');
  });

  test('messages come back oldest first', async () => {
    const { poll } = gmail({
      history: { '': { history: added('later', 'earlier'), historyId: '5010' } },
      messages: {
        later: text('later', 'Ruby <r@example.com>', 'Later', 'b', { internalDate: String(AT + 60_000) }),
        earlier: text('earlier', 'Ruby <r@example.com>', 'Earlier', 'a'),
      },
    });
    expect((await poll('5000')).messages.map((m) => m.text)).toEqual(['Earlier\n\na', 'Later\n\nb']);
  });

  test('a message deleted before it could be read is skipped, and the rest still arrive', async () => {
    const { poll } = gmail({
      history: { '': { history: added('gone', 'm1'), historyId: '5010' } },
      messages: { m1: text('m1', 'Ruby <r@example.com>', 'Hi', 'hello') },
    });
    expect((await poll('5000')).messages.map((m) => m.providerMessageId)).toEqual([`gmail:${MAILBOX}:m1`]);
  });

  test('history Gmail no longer keeps starts again from now and says so', async () => {
    const { poll } = gmail({ profileHistoryId: '9000', historyStatus: 404 });
    expect(await poll('100')).toEqual({ messages: [], cursor: '9000', reset: true });
  });

  test('any other failure throws, so the cursor is not moved and nothing is lost', async () => {
    const { poll } = gmail({ historyStatus: 500 });
    await expect(poll('5000')).rejects.toThrow(/500/);
  });
});
