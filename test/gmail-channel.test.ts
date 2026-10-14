import { describe, expect, test } from 'vitest';
import { createGmailMessenger } from '../src/adapters/gmail-mailer.ts';
import { all } from '../src/db.ts';
import { FakeGmail } from './support/fake-gmail.ts';
import { MINUTE } from './support/harness.ts';
import { BELLA, PASSWORD, world } from './support/world.ts';

const INBOX = 'inbox@harbour.example';
const redirectUri = 'https://myest8.example/oauth/google/callback';
const code = (email: string) => ({ code: `code-for-${email}`, codeVerifier: 'verifier', redirectUri });

async function gmailWorld() {
  const gmail = new FakeGmail();
  const w = await world({ gmailFetch: gmail.fetch });
  return { ...w, gmail };
}

const inbound = async (h: { db: Parameters<typeof all>[0] }) =>
  all<{ provider_message_id: string; sender: string; processed: number }>(h.db, 'SELECT provider_message_id, sender, processed FROM inbound_messages ORDER BY id');

describe('Gmail channel', () => {
  test('without Google credentials Gmail is unavailable and nothing breaks', async () => {
    const { alice } = await world();
    expect(await alice.gmailStatus()).toBe('unavailable');
  });

  test('connecting connects the email channel to the Gmail address and keeps the token encrypted', async () => {
    const { h, alice, ids, gmail } = await gmailWorld();
    expect(await alice.gmailStatus()).toBe('not_connected');

    await alice.connectGmail(code('agency@gmail.example'));
    await alice.connectGmail(code('agency@gmail.example'));

    expect(await alice.gmailStatus()).toBe('connected');
    expect((await alice.channels()).find((c) => c.type === 'email')).toMatchObject({ address: 'agency@gmail.example' });
    expect(JSON.stringify(await alice.channels())).not.toContain('1//');

    const rows = await all<{ secret: Uint8Array; provider: string; status: string }>(h.db, 'SELECT secret, provider, status FROM channel_credentials WHERE agency_id = ?', ids.agencyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'gmail', status: 'ok' });
    expect(Buffer.from(rows[0]!.secret).includes('1//agency@gmail.example')).toBe(false);
    expect(gmail.mailbox('agency@gmail.example').sent).toEqual([]);
  });

  test('a poll reads only mail that arrives after connecting, and turns it into inbound messages once', async () => {
    const { h, alice, gmail } = await gmailWorld();
    gmail.deliver(INBOX, 'Old Sender <old@example.com>', 'Before connecting', 'This was here first');
    await alice.connectGmail(code(INBOX));
    h.classifier.when('Dripping tap\n\nThe kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });

    await h.advance(MINUTE + 1000);
    expect(await inbound(h)).toEqual([]);

    gmail.deliver(INBOX, 'Bella Bui <bella@example.com>', 'Dripping tap', 'The kitchen tap is dripping');
    await h.advance(MINUTE + 1000);
    expect(await inbound(h)).toMatchObject([{ provider_message_id: expect.stringMatching(new RegExp(`^gmail:${INBOX}:m`)), sender: BELLA, processed: 1 }]);

    await h.advance(5 * MINUTE);
    expect(await inbound(h)).toHaveLength(1);
  });

  test('a revoked connection is marked for reconnecting, not retried forever, and reconnecting picks up what arrived meanwhile', async () => {
    const { h, alice, gmail } = await gmailWorld();
    await alice.connectGmail(code(INBOX));
    gmail.mailbox(INBOX).revoked = true;
    await h.advance(MINUTE + 1000);
    expect(await alice.gmailStatus()).toBe('needs_reconnect');
    expect((await alice.channels()).find((c) => c.type === 'email')).toMatchObject({ address: INBOX });

    h.classifier.when('Leak\n\nWater under the sink', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    gmail.deliver(INBOX, 'Bella Bui <bella@example.com>', 'Leak', 'Water under the sink');
    gmail.mailbox(INBOX).revoked = false;
    await alice.connectGmail(code(INBOX));
    await h.advance(MINUTE + 1000);

    expect(await alice.gmailStatus()).toBe('connected');
    expect(await inbound(h)).toHaveLength(1);
  });

  test('one Agency’s failing mailbox does not stop another being read', async () => {
    const { h, alice, gmail } = await gmailWorld();
    const otherAgency = await h.app.setup.createAgency({ name: 'Other Realty', timeZone: 'Australia/Sydney' });
    const carol = h.as(await h.app.setup.addPropertyManager(otherAgency, { name: 'Carol', email: 'carol@other.example', password: PASSWORD }));
    await alice.connectGmail(code('first@gmail.example'));
    await carol.connectGmail(code('second@gmail.example'));
    gmail.mailbox('first@gmail.example').failHistory = true;
    h.classifier.when('Hello\n\nAre you there?', { messageClass: 'other' });
    gmail.deliver('second@gmail.example', 'Someone <someone@example.com>', 'Hello', 'Are you there?');

    h.clock.advance(MINUTE + 1000);
    const failures = await h.app.runWorker();
    expect(failures.length).toBeGreaterThan(0);
    expect(await inbound(h)).toMatchObject([{ provider_message_id: expect.stringContaining('second@gmail.example') }]);
  });

  test('email the app sends goes out through the Agency’s own Gmail', async () => {
    const { h, alice, ids, gmail } = await gmailWorld();
    await alice.connectGmail(code(INBOX));
    const messenger = createGmailMessenger({ accessToken: (agencyId) => h.gmail!.accessToken(agencyId), fetch: gmail.fetch });
    await messenger.send({
      agencyId: ids.agencyId,
      channelType: 'email',
      from: INBOX,
      to: 'bella@example.com',
      cc: [],
      subject: 'Your repair',
      text: 'Booked for Wednesday',
      template: 'tenant.visit',
      data: {},
      attachments: [],
    });
    expect(gmail.mailbox(INBOX).sent).toHaveLength(1);
    expect(gmail.mailbox(INBOX).sent[0]).toContain('To: bella@example.com');
  });

  test('a token that stops working while sending is permanent, so the worker does not retry it', async () => {
    const { h, alice, ids, gmail } = await gmailWorld();
    await alice.connectGmail(code(INBOX));
    gmail.mailbox(INBOX).revoked = true;
    const messenger = createGmailMessenger({ accessToken: (agencyId) => h.gmail!.accessToken(agencyId), fetch: gmail.fetch });
    const error = await messenger.send({ agencyId: ids.agencyId, channelType: 'email', from: INBOX, to: 'bella@example.com', cc: [], subject: 's', text: 't', template: 'x', data: {}, attachments: [] }).catch((e: unknown) => e as Error);
    expect(error).toMatchObject({ permanent: true });
    expect(await alice.gmailStatus()).toBe('needs_reconnect');
  });
});
