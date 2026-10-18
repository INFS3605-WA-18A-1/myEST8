import { describe, expect, test } from 'vitest';
import { HOUR } from './support/harness.ts';
import { BELLA, HANA, HANA_EMAIL, OSCAR, TOM, world } from './support/world.ts';

describe('choosing the channel', () => {
  test('a Tenant who messaged on WhatsApp gets replies on WhatsApp for 24 hours, then by SMS', async () => {
    const { h, alice } = await world();
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await h.receive(TOM, 'The kitchen tap is dripping', { channel: 'whatsapp' });
    await h.answer(TOM, 'Kitchen sink', 'answer', { channel: 'whatsapp' });
    await h.answer(TOM, 'Since Monday', 'answer', { channel: 'whatsapp' });
    await h.answer(TOM, 'No', 'no', { channel: 'whatsapp' });
    await h.answer(TOM, 'Mornings', 'weekday_mornings', { channel: 'whatsapp' });
    expect(new Set(h.messenger.to(TOM).map((m) => m.channel))).toEqual(new Set(['whatsapp']));

    await h.advance(48 * HOUR);
    const [request] = (await alice.dashboard()).maintenanceRequests;
    await alice.confirmMaintenanceRequest(request!.issueId);

    expect(h.messenger.last(TOM)).toMatchObject({ channel: 'sms', template: 'tenant.confirmed' });
  });

  test('a Tenant with a mobile who emailed gets email replies for 24 hours, then SMS', async () => {
    const { h, alice } = await world();
    h.classifier.when('The bathroom fan is rattling', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'electrical' });
    await h.receive(HANA_EMAIL, 'The bathroom fan is rattling');
    await h.answer(HANA_EMAIL, 'Bathroom');
    await h.answer(HANA_EMAIL, 'Last week');
    await h.answer(HANA_EMAIL, 'No', 'no');
    await h.answer(HANA_EMAIL, 'Afternoons', 'weekday_afternoons');
    expect(h.messenger.to(HANA_EMAIL).map((m) => m.channel)).toEqual(['email', 'email', 'email', 'email', 'email', 'email']);

    await h.advance(48 * HOUR);
    const [request] = (await alice.dashboard()).maintenanceRequests;
    await alice.confirmMaintenanceRequest(request!.issueId);

    expect(h.messenger.last(HANA)).toMatchObject({ channel: 'sms', template: 'tenant.confirmed' });
  });

  test('a Tenant with no mobile number always gets email', async () => {
    const { h, bob } = await world();
    h.classifier.when('The shower drain is blocked', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await h.receive(BELLA, 'The shower drain is blocked');
    await h.answer(BELLA, 'Bathroom');
    await h.answer(BELLA, 'Yesterday');
    await h.answer(BELLA, 'No', 'no');
    await h.answer(BELLA, 'Any time', 'any_time');
    await h.advance(48 * HOUR);
    const [request] = (await bob.dashboard()).maintenanceRequests;
    await bob.confirmMaintenanceRequest(request!.issueId);

    expect(new Set(h.messenger.to(BELLA).map((m) => m.channel))).toEqual(new Set(['email']));
    expect(h.messenger.last(BELLA)!.template).toBe('tenant.confirmed');
  });

  test('a receipt for a Property Owner with no email goes by SMS, and the Property Manager gets their own copy by email', async () => {
    const { h, bob } = await world();
    h.classifier.when('Gas smell in the kitchen', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'urgent', trade: 'plumbing' });
    await h.receive(BELLA, 'Gas smell in the kitchen');
    const reminder = h.messenger.last(BELLA)!;
    expect(reminder.data.nominatedTradies).toEqual([]);

    await h.upload(reminder.data.receiptLink as string, [{ filename: 'receipt.jpg', contentType: 'image/jpeg', content: new Uint8Array([1]) }]);
    const [received] = (await bob.dashboard()).urgentRepairs;
    await bob.forwardReimbursement(received!.urgentRepairId, { amountCents: 300_00 });

    expect(h.messenger.to(OSCAR)).toMatchObject([{ channel: 'sms', template: 'owner.urgent_repair_receipt', attachments: ['receipt.jpg'], cc: [] }]);
    expect(h.messenger.to('bob@harbour.example')).toMatchObject([{ channel: 'email', template: 'owner.urgent_repair_receipt', attachments: ['receipt.jpg'] }]);
    expect((await bob.dashboard()).urgentRepairs).toMatchObject([{ status: 'receipt_forwarded' }]);
  });
});

describe('onboarding', () => {
  test('each channel is tested with a test message', async () => {
    const { h, alice } = await world();

    await alice.sendTestMessage('whatsapp', TOM);
    await alice.sendTestMessage('email', 'alice@harbour.example');

    expect(h.messenger.sent).toMatchObject([
      { to: TOM, channel: 'whatsapp', template: 'onboarding.test_message' },
      { to: 'alice@harbour.example', channel: 'email', template: 'onboarding.test_message' },
    ]);
  });
});
