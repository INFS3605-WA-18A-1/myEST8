import { describe, expect, test } from 'vitest';
import { one } from '../src/db.ts';
import { UndeliverableError } from '../src/ports.ts';
import { createHarness, MINUTE, AGENCY_NUMBER } from './support/harness.ts';
import { TOM, world } from './support/world.ts';

const NUMBER = '+61 2 9000 1111';
const NORMALIZED = '+61290001111';

async function sunrise() {
  const h = await createHarness();
  const agencyId = await h.app.setup.createAgency({ name: 'Sunrise Realty', timeZone: 'Australia/Sydney' });
  const pmId = await h.app.setup.addPropertyManager(agencyId, { name: 'Sam Sun', email: 'sam@sunrise.example', password: 'sunrise-2026' });
  return { h, agencyId, sam: h.as(pmId) };
}

function sentCode(h: Awaited<ReturnType<typeof createHarness>>, to: string) {
  const sent = h.messenger.last(to);
  expect(sent?.template).toBe('onboarding.verification_code');
  const code = String(sent?.data.code);
  expect(code).toMatch(/^\d{6}$/);
  return code;
}

describe('channel verification', () => {
  test('a code that cannot be delivered is refused with a reason, and nothing is left open', async () => {
    const { h, agencyId, sam } = await sunrise();
    h.messenger.send = async (message) => {
      throw new UndeliverableError(message.channelType, message.to, 'no sms provider is configured');
    };

    await expect(sam.startChannelVerification('sms', NUMBER)).rejects.toThrow(/couldn't send a code to \+61 2 9000 1111.*no sms provider is configured/);
    expect(await one(h.db, 'SELECT 1 FROM channel_verifications WHERE agency_id = ?', agencyId)).toBeUndefined();
  });

  test('allows one code per channel per minute, counted on the injected clock', async () => {
    const { h, sam } = await sunrise();
    await sam.startChannelVerification('sms', NUMBER);
    const first = sentCode(h, NORMALIZED);

    h.clock.advance(25_000);
    await expect(sam.startChannelVerification('sms', NUMBER)).rejects.toThrow('Wait 35 seconds');
    expect(sentCode(h, NORMALIZED)).toBe(first);
    // Another channel has its own cooldown.
    await sam.startChannelVerification('whatsapp', NUMBER);

    h.clock.advance(35_000);
    await sam.startChannelVerification('sms', NUMBER);
    await expect(sam.confirmChannelVerification('sms', NUMBER, first)).rejects.toThrow('wrong');
    await sam.confirmChannelVerification('sms', NUMBER, sentCode(h, NORMALIZED));
  });

  test('sends a 6-digit code and stores the address only after the code matches', async () => {
    const { h, agencyId, sam } = await sunrise();

    await sam.startChannelVerification('sms', NUMBER);

    expect(await sam.channels()).toEqual([]);
    const code = sentCode(h, NORMALIZED);
    const row = await one<{ code_hash: string; expires_at: string; attempts: number }>(
      h.db,
      'SELECT code_hash, expires_at, attempts FROM channel_verifications WHERE agency_id = ? AND channel_type = ?',
      agencyId,
      'sms',
    );
    expect(row?.code_hash).not.toBe(code);
    expect(row?.code_hash).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(row?.attempts).toBe(0);
    expect(new Date(row!.expires_at).getTime() - h.clock.now().getTime()).toBe(10 * MINUTE);
    expect(await one(h.db, 'SELECT 1 FROM messages WHERE text LIKE ?', `%${code}%`)).toBeUndefined();

    await expect(sam.confirmChannelVerification('sms', NUMBER, '000000')).rejects.toThrow('That code is wrong');
    expect(await sam.channels()).toEqual([]);

    await sam.confirmChannelVerification('sms', NUMBER, code);
    expect(await sam.channels()).toEqual([{ type: 'sms', address: NORMALIZED, testedAt: expect.any(String) }]);
  });

  test('locks the code after five wrong attempts, and an expired code is refused', async () => {
    const { h, sam } = await sunrise();
    await sam.startChannelVerification('whatsapp', NUMBER);
    const code = sentCode(h, NORMALIZED);

    for (let i = 0; i < 5; i++) await expect(sam.confirmChannelVerification('whatsapp', NUMBER, '111111')).rejects.toThrow('That code is wrong');
    await expect(sam.confirmChannelVerification('whatsapp', NUMBER, code)).rejects.toThrow('tried too many times');
    expect(await sam.channels()).toEqual([]);

    h.clock.advance(MINUTE);
    await sam.startChannelVerification('whatsapp', NUMBER);
    const fresh = sentCode(h, NORMALIZED);
    h.clock.advance(10 * MINUTE + 1);
    await expect(sam.confirmChannelVerification('whatsapp', NUMBER, fresh)).rejects.toThrow('expired');
    expect(await sam.channels()).toEqual([]);
  });

  test('refuses a number another Agency already has, and does not send a code', async () => {
    const w = await world();
    const agencyId = await w.h.app.setup.createAgency({ name: 'Sunrise Realty', timeZone: 'Australia/Sydney' });
    const pmId = await w.h.app.setup.addPropertyManager(agencyId, { name: 'Sam Sun', email: 'sam@sunrise.example', password: 'sunrise-2026' });
    const sam = w.h.as(pmId);

    await expect(sam.startChannelVerification('sms', '+61 2 9000 0000')).rejects.toThrow(`${'+61 2 9000 0000'} is connected to another Agency`);
    expect(w.h.messenger.templatesTo(AGENCY_NUMBER)).not.toContain('onboarding.verification_code');
  });

  test('allocates the Agency inbound address and marks it verified once mail arrives', async () => {
    const { h, sam } = await sunrise();

    expect(await sam.ensureInboundEmail()).toEqual({ address: 'sunrise-realty@mail.example.test', state: 'waiting' });
    expect(await sam.channels()).toEqual([{ type: 'email', address: 'sunrise-realty@mail.example.test', testedAt: null }]);

    const otherId = await h.app.setup.createAgency({ name: 'Sunrise Realty', timeZone: 'Australia/Sydney' });
    const otherPm = await h.app.setup.addPropertyManager(otherId, { name: 'Pat Sun', email: 'pat@sunrise.example', password: 'sunrise-2026' });
    const other = h.as(otherPm);
    expect(await other.ensureInboundEmail()).toEqual({ address: `sunrise-realty-${otherId}@mail.example.test`, state: 'waiting' });
    expect(await sam.ensureInboundEmail()).toEqual({ address: 'sunrise-realty@mail.example.test', state: 'waiting' });

    await h.app.receiveInbound({
      providerMessageId: 're-1',
      agencyChannel: 'sunrise-realty@mail.example.test',
      channelType: 'email',
      from: 'tenant@example.com',
      text: 'The kitchen tap is dripping',
      attachments: [],
      receivedAt: h.clock.now(),
    });

    expect(await sam.ensureInboundEmail()).toEqual({ address: 'sunrise-realty@mail.example.test', state: 'verified' });
  });

  test('records a WhatsApp delivery failure against the outbound message', async () => {
    const w = await world();
    w.h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await w.h.receive(TOM, 'The kitchen tap is dripping', { channel: 'whatsapp' });
    await w.h.answer(TOM, 'Kitchen sink', 'answer', { channel: 'whatsapp' });
    await w.h.answer(TOM, 'Since Monday', 'answer', { channel: 'whatsapp' });
    await w.h.answer(TOM, 'No', 'no', { channel: 'whatsapp' });
    await w.h.answer(TOM, 'Mornings', 'weekday_mornings', { channel: 'whatsapp' });
    await w.h.advance(48 * 3_600_000);

    await w.h.app.recordDeliveryFailure({ to: TOM, code: 131047, title: 'Re-engagement message' });

    const [request] = (await w.alice.dashboard()).maintenanceRequests;
    const ticketId = await w.alice.confirmMaintenanceRequest(request!.issueId);
    const ticket = await w.alice.ticket(ticketId);
    expect(ticket.messages.some((m) => m.deliveryError?.includes('131047') && m.deliveryError.includes('Re-engagement message'))).toBe(true);
  });
});
