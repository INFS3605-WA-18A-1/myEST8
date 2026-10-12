import { describe, expect, test } from 'vitest';
import { upload } from './support/photos.ts';
import { HOUR } from './support/harness.ts';
import { confirmedQuotes, jobView, BARRY, BELLA, HANA, KING_ST, KING_ST_LOCATION, NINA, OCEAN_AVE, OLIVIA_EMAIL, SAM, STRANGER, TOM, tomsTapTicket, world } from './support/world.ts';

type World = Awaited<ReturnType<typeof world>>;

/** Tom reports a dripping tap and answers every question, so the issue is waiting for photos. */
async function tomReportsTap({ h }: World) {
  h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
  await h.receive(TOM, 'The kitchen tap is dripping');
  await h.answer(TOM, 'Kitchen sink');
  await h.answer(TOM, 'Since Monday');
  await h.answer(TOM, 'No', 'no');
  await h.answer(TOM, 'Mornings', 'weekday_mornings');
  return h.messenger.last(TOM)!.data.uploadLink as string;
}

describe('a Routine issue', () => {
  test('a Tenant texts about a leaking tap, answers the questions, uploads two photos, and the Property Manager confirms it into a Ticket', async () => {
    const { h, alice } = await world();
    h.classifier.when('The kitchen tap is dripping', {
      messageClass: 'new_issue',
      relatedItem: 'none',
      urgency: 'routine',
      trade: 'plumbing',
    });

    await h.receive(TOM, 'The kitchen tap is dripping');
    expect(h.messenger.to(TOM)).toMatchObject([
      { channel: 'sms', template: 'tenant.acknowledgement' },
      { channel: 'sms', template: 'tenant.guided_question', data: { question: 'location' } },
    ]);

    await h.answer(TOM, 'Kitchen sink');
    expect(h.messenger.last(TOM)).toMatchObject({ data: { question: 'started' } });
    await h.answer(TOM, 'Since Monday');
    expect(h.messenger.last(TOM)).toMatchObject({ data: { question: 'worsening' } });
    await h.answer(TOM, 'No', 'no');
    expect(h.messenger.last(TOM)).toMatchObject({ data: { question: 'availability' } });
    await h.answer(TOM, 'Mornings', 'weekday_mornings');

    const uploadLink = h.messenger.last(TOM)!;
    expect(uploadLink.template).toBe('tenant.upload_link');
    expect((await alice.dashboard()).maintenanceRequests).toEqual([]);

    await h.upload(uploadLink.data.uploadLink as string, [
      upload('tap-1.jpg', { takenAt: '2026:10:08 08:30:00', gps: KING_ST_LOCATION }),
      upload('tap-2.jpg', { takenAt: '2026:10:08 08:31:00' }),
    ]);

    const { maintenanceRequests } = await alice.dashboard();
    expect(maintenanceRequests).toMatchObject([
      {
        propertyAddress: KING_ST,
        tenantName: 'Tom Tran',
        description: 'The kitchen tap is dripping',
        answers: { location: 'Kitchen sink', started: 'Since Monday', worsening: 'no', availability: 'weekday_mornings' },
        photos: [{ metadata: 'ok' }, { metadata: 'ok' }],
        imageMatch: { result: 'matches' },
        noPhotos: false,
        urgency: 'routine',
        checkUrgency: false,
        trade: 'plumbing',
        checkTrade: false,
      },
    ]);

    const ticketId = await alice.confirmMaintenanceRequest(maintenanceRequests[0]!.issueId);

    const confirmed = h.messenger.last(TOM)!;
    expect(confirmed.template).toBe('tenant.confirmed');
    const dashboard = await alice.dashboard();
    expect(dashboard.maintenanceRequests).toEqual([]);
    expect(dashboard.tickets).toMatchObject([
      { ticketId, propertyAddress: KING_ST, urgency: 'routine', jobs: [{ trade: 'plumbing', status: 'quoting' }] },
    ]);
    expect((await h.tracker(confirmed.data.trackerLink as string)).stages.map((s) => [s.stage, s.reached])).toEqual([
      ['reported', true],
      ['confirmed', true],
      ['getting_quotes', false],
      ['approved', false],
      ['booked', false],
      ['done', false],
      ['closed', false],
    ]);
  });
});

describe('rejecting a Maintenance Request', () => {
  test('the Tenant is told why', async () => {
    const w = await world();
    const { h, alice } = w;
    const link = await tomReportsTap(w);
    await h.upload(link, [upload('tap.jpg')]);
    const [request] = (await alice.dashboard()).maintenanceRequests;

    await expect(alice.rejectMaintenanceRequest(request!.issueId, '  ')).rejects.toThrow(/reason/);
    await alice.rejectMaintenanceRequest(request!.issueId, 'The tap is the Tenant\'s own fitting');

    expect(h.messenger.last(TOM)).toMatchObject({ template: 'tenant.rejected', data: { reason: "The tap is the Tenant's own fitting" } });
    expect((await alice.dashboard()).maintenanceRequests).toEqual([]);
    await expect(h.upload(link, [upload('more.jpg')])).rejects.toThrow(/expired/);
  });
});

describe('an Urgent issue', () => {
  test('the Tenant is reminded to arrange it, and the receipt uploaded through the link reaches the Property Owner with the Property Manager copied in', async () => {
    const { h, alice, bob } = await world();
    h.classifier.when('Water is pouring through the ceiling', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'urgent', trade: 'plumbing' });

    await h.receive(TOM, 'Water is pouring through the ceiling');

    const reminder = h.messenger.last(TOM)!;
    expect(reminder).toMatchObject({
      template: 'tenant.urgent_repair_reminder',
      data: {
        limitCents: 1000_00,
        nominatedTradies: [
          { businessName: "Nina's Plumbing", phone: NINA },
          { businessName: 'Sparky Sam', phone: SAM },
        ],
      },
    });
    expect(h.messenger.to(TOM)).toHaveLength(1);
    expect((await alice.dashboard()).urgentRepairs).toMatchObject([
      { propertyAddress: KING_ST, tenantName: 'Tom Tran', description: 'Water is pouring through the ceiling', status: 'reminder_sent' },
    ]);
    expect((await bob.dashboard()).urgentRepairs).toEqual([]);

    await h.upload(reminder.data.receiptLink as string, [{ filename: 'receipt.pdf', contentType: 'application/pdf', content: new Uint8Array([1, 2]) }]);

    expect(h.messenger.to(OLIVIA_EMAIL)).toMatchObject([
      {
        channel: 'email',
        template: 'owner.urgent_repair_receipt',
        cc: ['alice@harbour.example'],
        attachments: ['receipt.pdf'],
        data: { propertyAddress: KING_ST, tenantName: 'Tom Tran', limitCents: 1000_00 },
      },
    ]);
    const dashboard = await alice.dashboard();
    expect(dashboard.urgentRepairs).toMatchObject([{ status: 'receipt_forwarded', receipts: 1 }]);
    expect(dashboard.tickets).toEqual([]);
    expect(dashboard.maintenanceRequests).toEqual([]);
  });

  test('a receipt sent as a WhatsApp attachment is forwarded too', async () => {
    const { h, alice } = await world();
    h.classifier.when('No power in the whole flat', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'urgent', trade: 'electrical' });
    await h.receive(TOM, 'No power in the whole flat', { channel: 'whatsapp' });
    const [urgentRepair] = (await alice.dashboard()).urgentRepairs;

    h.classifier.when('Here is the electrician receipt', {
      messageClass: 'update',
      relatedItem: `urgent_repair:${urgentRepair!.urgentRepairId}`,
      updateType: 'receipt',
    });
    await h.receive(TOM, 'Here is the electrician receipt', {
      channel: 'whatsapp',
      attachments: [{ filename: 'receipt.jpg', contentType: 'image/jpeg', content: new Uint8Array([1]) }],
    });

    expect(h.messenger.to(OLIVIA_EMAIL)).toMatchObject([{ template: 'owner.urgent_repair_receipt', attachments: ['receipt.jpg'] }]);
    expect((await alice.dashboard()).urgentRepairs).toMatchObject([{ status: 'receipt_forwarded' }]);
  });

  test('an issue ranked Urgent once the answers are in becomes an Urgent Repair', async () => {
    const w = await world();
    const { h, alice } = w;
    h.classifier.when('The hot water is lukewarm', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'high', trade: 'plumbing' });
    await h.receive(TOM, 'The hot water is lukewarm');
    await h.answer(TOM, 'Whole flat');
    await h.answer(TOM, 'This morning');
    await h.answer(TOM, 'Yes, now there is none', 'yes');
    // With the answers in, the issue is no hot water at all.
    h.classifier.when('The hot water is lukewarm', { urgency: 'urgent', trade: 'plumbing' });
    await h.answer(TOM, 'Any time', 'any_time');

    expect(h.messenger.last(TOM)!.template).toBe('tenant.urgent_repair_reminder');
    expect((await alice.dashboard()).urgentRepairs).toHaveLength(1);
  });

  test('a Property Manager who changes a Maintenance Request to Urgent closes it the Urgent way', async () => {
    const w = await world();
    const { h, alice } = w;
    await tomReportsTap(w);
    await h.advance(48 * HOUR);
    const [request] = (await alice.dashboard()).maintenanceRequests;

    await alice.changeUrgency({ issueId: request!.issueId }, 'urgent');

    expect(h.messenger.last(TOM)!.template).toBe('tenant.urgent_repair_reminder');
    const dashboard = await alice.dashboard();
    expect(dashboard.maintenanceRequests).toEqual([]);
    expect(dashboard.urgentRepairs).toHaveLength(1);
  });
});

describe('a Common Area issue', () => {
  test('is passed to the Building Manager and the Tenant is told', async () => {
    const { h, bob } = await world();
    h.classifier.when('The lift is broken again', { messageClass: 'common_area' });

    await h.receive(BELLA, 'The lift is broken again');

    expect(h.messenger.to(BARRY)).toMatchObject([
      { template: 'building_manager.common_area_issue', data: { propertyAddress: OCEAN_AVE, tenantName: 'Bella Bui', message: 'The lift is broken again' } },
    ]);
    expect(h.messenger.to(BELLA)).toMatchObject([{ channel: 'email', template: 'tenant.common_area_passed_on', data: { buildingManagerName: 'Barry Strata' } }]);
    expect((await bob.dashboard()).inbox).toEqual([]);
  });

  test('on a Property with no Building Manager goes to the inbox without a reply', async () => {
    const { h, alice } = await world();
    h.classifier.when('The shared driveway gate is stuck', { messageClass: 'common_area' });

    await h.receive(TOM, 'The shared driveway gate is stuck');

    expect(h.messenger.sent).toEqual([]);
    expect((await alice.dashboard()).inbox).toMatchObject([
      { reason: 'common_area_no_building_manager', from: TOM, personName: 'Tom Tran', text: 'The shared driveway gate is stuck' },
    ]);
  });
});

describe('the Agency inbox', () => {
  test('a message from an unknown number lands in the inbox, and once linked the next message is recognised', async () => {
    const { h, alice, ids } = await world();

    await h.receive(STRANGER, 'Hi, this is Tom on my work phone');

    expect(h.messenger.sent).toEqual([]);
    const [item] = (await alice.dashboard()).inbox;
    expect(item).toMatchObject({ reason: 'unknown_sender', from: STRANGER, personName: null });

    await alice.linkSender(item!.itemId, ids.tom);
    await alice.dismissInboxItem(item!.itemId);
    expect((await alice.dashboard()).inbox).toEqual([]);

    h.classifier.when('The oven is not heating', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'appliances' });
    await h.receive(STRANGER, 'The oven is not heating');
    expect(h.messenger.templatesTo(STRANGER)).toEqual(['tenant.acknowledgement', 'tenant.guided_question']);
  });

  test('a message that is not about maintenance is left in the inbox without a reply', async () => {
    const { h, alice } = await world();
    h.classifier.when('Can I pay rent a week late?', { messageClass: 'other' });

    await h.receive(TOM, 'Can I pay rent a week late?');

    expect(h.messenger.sent).toEqual([]);
    expect((await alice.dashboard()).inbox).toMatchObject([{ reason: 'other', text: 'Can I pay rent a week late?' }]);
  });

  test('a message the agent is unsure about goes to the inbox with its best guess and is routed in one click', async () => {
    const { h, alice } = await world();
    h.classifier.when('the thing in the bathroom is doing it again', {
      messageClass: ['new_issue', 0.55],
      relatedItem: 'none',
      urgency: 'routine',
      trade: ['plumbing', 0.5],
    });

    await h.receive(TOM, 'the thing in the bathroom is doing it again');

    expect(h.messenger.sent).toEqual([]);
    const [item] = (await alice.dashboard()).inbox;
    expect(item).toMatchObject({ reason: 'low_confidence', bestGuess: { messageClass: 'new_issue', trade: 'plumbing', urgency: 'routine' } });

    await alice.routeInboxItem(item!.itemId);

    expect((await alice.dashboard()).inbox).toEqual([]);
    expect(h.messenger.templatesTo(TOM)).toEqual(['tenant.acknowledgement', 'tenant.guided_question']);
  });
});

describe('unsure Urgency and Trade', () => {
  test('an issue whose Urgency the agent is unsure of is treated as High and flagged, and an unsure Trade is flagged', async () => {
    const { h, alice } = await world();
    h.classifier.when('Something smells odd near the heater', {
      messageClass: 'new_issue',
      relatedItem: 'none',
      urgency: ['routine', 0.4],
      trade: ['appliances', 0.6],
    });
    await h.receive(TOM, 'Something smells odd near the heater');
    await h.answer(TOM, 'Lounge room');
    await h.answer(TOM, 'Yesterday');
    await h.answer(TOM, 'No', 'no');
    await h.answer(TOM, 'Any time', 'any_time');
    await h.advance(48 * HOUR);

    const [request] = (await alice.dashboard()).maintenanceRequests;
    expect(request).toMatchObject({ urgency: 'high', checkUrgency: true, trade: 'appliances', checkTrade: true, noPhotos: true });

    await alice.changeUrgency({ issueId: request!.issueId }, 'routine');
    expect((await alice.dashboard()).maintenanceRequests[0]).toMatchObject({ urgency: 'routine', checkUrgency: false });
  });
});

describe('the 48-hour "no photos" timeout', () => {
  test('an issue with no photos after 48 hours reaches the Property Manager marked "no photos", and photos can still be added', async () => {
    const w = await world();
    const { h, alice } = w;
    const link = await tomReportsTap(w);

    await h.advance(47 * HOUR);
    expect((await alice.dashboard()).maintenanceRequests).toEqual([]);

    await h.advance(1 * HOUR);
    expect((await alice.dashboard()).maintenanceRequests).toMatchObject([{ noPhotos: true, photos: [], imageMatch: null }]);

    await h.upload(link, [upload('late.jpg')]);
    expect((await alice.dashboard()).maintenanceRequests).toMatchObject([{ noPhotos: false, photos: [{}], imageMatch: { result: 'matches' } }]);
  });
});

describe('follow-ups and duplicates', () => {
  test("a housemate's report of the same issue is attached to the existing Maintenance Request", async () => {
    const w = await world();
    const { h, alice } = w;
    await h.upload(await tomReportsTap(w), [upload('tap.jpg')]);
    const [request] = (await alice.dashboard()).maintenanceRequests;
    h.classifier.when('Our kitchen tap keeps dripping', { messageClass: 'new_issue', relatedItem: `issue:${request!.issueId}` });

    await h.receive(HANA, 'Our kitchen tap keeps dripping');

    expect(h.messenger.templatesTo(HANA)).toEqual(['tenant.acknowledgement']);
    expect((await alice.dashboard()).maintenanceRequests).toMatchObject([{ issueId: request!.issueId, unreadMessages: 1 }]);
  });

  test("a Tenant's follow-up is added to their Ticket and marked unread", async () => {
    const w = await world();
    const { h, alice } = w;
    const { ticketId } = await tomsTapTicket(w);
    h.classifier.when('It is dripping faster now', { messageClass: 'update', relatedItem: `ticket:${ticketId}`, updateType: 'general' });

    await h.receive(TOM, 'It is dripping faster now');

    expect(h.messenger.to(TOM).at(-1)!.template).toBe('tenant.confirmed');
    expect((await alice.dashboard()).tickets).toMatchObject([{ ticketId, unreadMessages: 1 }]);
    expect((await alice.ticket(ticketId)).messages.at(-1)).toMatchObject({ direction: 'in', text: 'It is dripping faster now', unread: true });

    await alice.markTicketRead(ticketId);
    expect((await alice.dashboard()).tickets).toMatchObject([{ unreadMessages: 0 }]);
  });
});

describe('the Ticket list', () => {
  test('ranks High before Routine, then the oldest first', async () => {
    const { h, alice } = await world();
    const report = async (from: string, text: string, urgency: 'high' | 'routine') => {
      h.classifier.when(text, { messageClass: 'new_issue', relatedItem: 'none', urgency, trade: 'carpentry' });
      await h.receive(from, text);
      await h.answer(from, `${text}: where`);
      await h.answer(from, `${text}: when`);
      await h.answer(from, 'No', 'no');
      await h.answer(from, 'Any time', 'any_time');
      await h.advance(HOUR);
    };
    await report(TOM, 'Wardrobe door off its hinge', 'routine');
    await report(HANA, 'Back door will not lock properly', 'high');
    await report(TOM, 'Loose stair tread', 'high');
    await h.advance(48 * HOUR);
    for (const request of (await alice.dashboard()).maintenanceRequests) await alice.confirmMaintenanceRequest(request.issueId);

    expect((await alice.dashboard()).tickets.map((t) => [t.urgency, t.description])).toEqual([
      ['high', 'Back door will not lock properly'],
      ['high', 'Loose stair tread'],
      ['routine', 'Wardrobe door off its hinge'],
    ]);
  });
});

describe('nothing stalls', () => {
  test('an issue whose questions go unanswered reaches the Property Manager after 48 hours with the answers so far', async () => {
    const { h, alice } = await world();
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await h.receive(TOM, 'The kitchen tap is dripping');
    await h.answer(TOM, 'Kitchen sink');

    await h.advance(48 * HOUR);

    expect((await alice.dashboard()).maintenanceRequests).toMatchObject([
      { description: 'The kitchen tap is dripping', answers: { location: 'Kitchen sink', started: null }, noPhotos: true },
    ]);
  });

  test('a message whose handling fails part-way is not handled twice when the worker retries', async () => {
    const { h, alice } = await world();
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    h.messenger.failures = 1;

    await expect(h.receive(TOM, 'The kitchen tap is dripping')).rejects.toThrow(/provider unavailable/);
    await h.advance(10 * 60_000);
    await h.advance(48 * HOUR);

    expect((await alice.dashboard()).maintenanceRequests).toHaveLength(1);
  });

  test('a Tenant can answer guided questions while a visit time is also waiting on them', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[tradies.pete, 150_00, new Date('2026-10-13T09:00:00+11:00')]]);
    await alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    h.classifier.when('The oven is not heating', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'appliances' });
    await h.receive(TOM, 'The oven is not heating');

    await alice.sendWorkOrder(job.jobId);
    await h.answer(TOM, 'In the kitchen');

    expect(h.messenger.last(TOM)).toMatchObject({ template: 'tenant.guided_question', data: { question: 'started' } });

    await h.answer(TOM, 'Yes see you Tuesday', 'confirm');
    expect((await jobView(w, job)).workOrder).toMatchObject({ visitConfirmed: true });
  });
});
