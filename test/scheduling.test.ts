import { describe, expect, test } from 'vitest';
import {
  BELLA,
  confirmedEstimates,
  confirmedQuotes,
  jobView,
  KING_ST,
  OCEAN_AVE,
  OLIVIA,
  TOM,
  tomsTapTicket,
  world,
  type JobRef,
  type TradieRef,
  type World,
} from './support/world.ts';

const sydney = (local: string) => new Date(`${local}+11:00`);
const MON_9AM = sydney('2026-10-12T09:00:00');
const TUE_9AM = sydney('2026-10-13T09:00:00');

/** Tom's tap Ticket with its Job approved for `tradie`, who proposed `proposedTime`. */
async function approvedTapJob(w: World, tradie: TradieRef, proposedTime?: Date) {
  const job = await tomsTapTicket(w);
  await approve(w, job, tradie, proposedTime);
  return job;
}

async function approve(w: World, job: JobRef, tradie: TradieRef, proposedTime?: Date) {
  const [quote] = await confirmedQuotes(w, job, [[tradie, 150_00, proposedTime]]);
  await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
}

/** Bella, at Bob's Ocean Ave Property, emails about a blocked drain; Bob confirms it. */
async function bellasDrainTicket(w: World) {
  const { h, bob } = w;
  h.classifier.when('The shower drain is blocked', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
  await h.receive(BELLA, 'The shower drain is blocked');
  await h.answer(BELLA, 'Bathroom');
  await h.answer(BELLA, 'Yesterday');
  await h.answer(BELLA, 'No', 'no');
  await h.answer(BELLA, 'Any time', 'any_time');
  await h.advance(48 * 3_600_000);
  const [request] = (await bob.dashboard()).maintenanceRequests;
  const ticketId = await bob.confirmMaintenanceRequest(request!.issueId);
  return { ticketId, jobId: (await bob.ticket(ticketId)).jobs[0]!.jobId };
}

describe('Work Orders', () => {
  test("a Work Order starts at the Quote's proposed time when the Tradie is free, and tells the Tradie, Tenant and Property Owner", async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);

    await alice.sendWorkOrder(job.jobId);

    const visit = { visitStart: TUE_9AM.toISOString() };
    expect(h.messenger.last(tradies.pete.address)).toMatchObject({
      template: 'tradie.work_order',
      data: { ...visit, visitEnd: sydney('2026-10-13T11:00:00').toISOString(), propertyAddress: KING_ST, description: 'The kitchen tap is dripping', trade: 'plumbing' },
    });
    expect(h.messenger.last(TOM)).toMatchObject({
      template: 'tenant.visit_time',
      data: { ...visit, trade: 'plumbing', tradieBusinessName: "Pete's Plumbing" },
    });
    expect(h.messenger.last(TOM)!.text).not.toContain(tradies.pete.address);
    expect(h.messenger.last(OLIVIA)).toMatchObject({ template: 'owner.work_booked', data: { ...visit, propertyAddress: KING_ST } });
    expect(await jobView(w, job)).toMatchObject({
      status: 'scheduled',
      workOrder: { businessName: "Pete's Plumbing", start: TUE_9AM.toISOString(), visitConfirmed: false, rescheduleRequestedBy: null },
    });
    const tracker = await h.tracker(h.messenger.to(TOM).find((m) => m.template === 'tenant.confirmed')!.data.trackerLink as string);
    expect(tracker.stages.find((s) => s.stage === 'booked')).toMatchObject({ reached: true, visitStart: TUE_9AM.toISOString() });
  });

  test("the Work Order carries what was approved: the Firm Quote's price, or the Estimate's Not-to-exceed Cap", async () => {
    const w = await world();
    const job = await approvedTapJob(w, w.tradies.pete, TUE_9AM);
    await w.alice.sendWorkOrder(job.jobId);
    expect(w.h.messenger.last(w.tradies.pete.address)).toMatchObject({ template: 'tradie.work_order', data: { approvedCents: 150_00, stage: 'firm' } });
    expect(w.h.messenger.last(w.tradies.pete.address)!.text).toContain('Approved: your Firm Quote of $150.00.');

    const w2 = await world();
    const capped = await tomsTapTicket(w2);
    const [pete] = await confirmedEstimates(w2, capped, [
      [w2.tradies.pete, 120_00, TUE_9AM],
      [w2.tradies.dana, 140_00],
    ]);
    await w2.alice.proceedOnEstimate(pete!.quoteId, { capCents: 180_00 });
    await w2.alice.sendWorkOrder(capped.jobId);
    expect(w2.h.messenger.last(w2.tradies.pete.address)).toMatchObject({ template: 'tradie.work_order', data: { approvedCents: 180_00, stage: 'estimate' } });
    expect(w2.h.messenger.last(w2.tradies.pete.address)!.text).toContain('Approved on your Estimate: not to exceed $180.00.');
  });

  test('the slot is 2 hours by default and can be made longer', async () => {
    const w = await world();
    const { alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);

    await alice.sendWorkOrder(job.jobId, { durationMinutes: 240 });

    expect((await jobView(w, job)).workOrder).toMatchObject({ end: sydney('2026-10-13T13:00:00').toISOString() });
  });

  test('a Quote with no proposed time needs the Property Manager to pick a start', async () => {
    const w = await world();
    const { alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete);

    await expect(alice.sendWorkOrder(job.jobId)).rejects.toThrow(/start time/);
    await alice.sendWorkOrder(job.jobId, { start: TUE_9AM.toISOString() });

    expect(await jobView(w, job)).toMatchObject({ status: 'scheduled', workOrder: { start: TUE_9AM.toISOString() } });
  });

  test("the shared calendar stops a Property Manager double-booking a Tradie a colleague has booked, and shows the colleague's booking", async () => {
    const w = await world();
    const { alice, bob, tradies } = w;
    const alicesJob = await approvedTapJob(w, tradies.pete, TUE_9AM);
    await alice.sendWorkOrder(alicesJob.jobId);

    const bobsJob = await bellasDrainTicket(w);
    expect((await jobView(w, bobsJob)).recommendations.find((r) => r.tradieId === tradies.pete.id)!.bookings).toMatchObject([
      { start: TUE_9AM.toISOString(), end: sydney('2026-10-13T11:00:00').toISOString(), propertyManager: 'Alice Archer' },
    ]);
    await approve(w, bobsJob, tradies.pete, sydney('2026-10-13T10:00:00'));

    await expect(bob.sendWorkOrder(bobsJob.jobId)).rejects.toThrow(/booked/);
    await expect(bob.sendWorkOrder(bobsJob.jobId, { start: sydney('2026-10-13T10:00:00').toISOString() })).rejects.toThrow(/booked/);
    await bob.sendWorkOrder(bobsJob.jobId, { start: sydney('2026-10-13T11:00:00').toISOString() });

    const calendar = await bob.calendar({ from: MON_9AM.toISOString(), to: sydney('2026-10-14T00:00:00').toISOString() });
    expect(calendar.map((b) => [b.businessName, b.propertyAddress, b.propertyManager, b.start])).toEqual([
      ["Pete's Plumbing", KING_ST, 'Alice Archer', TUE_9AM.toISOString()],
      ["Pete's Plumbing", OCEAN_AVE, 'Bob Baker', sydney('2026-10-13T11:00:00').toISOString()],
    ]);
  });
});

describe('the calendar read', () => {
  test('each booking says what the visit is for, whose Property it is and how the visit stands, without loading the Ticket', async () => {
    const w = await world();
    const { h, alice, bob, tradies, ids } = w;
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);
    await alice.sendWorkOrder(job.jobId);
    const week = { from: MON_9AM.toISOString(), to: sydney('2026-10-19T00:00:00').toISOString() };

    const [booking] = await bob.calendar(week);
    expect(booking).toMatchObject({
      ticketId: job.ticketId,
      jobId: job.jobId,
      trade: 'plumbing',
      issue: 'The kitchen tap is dripping',
      propertyId: ids.kingSt,
      propertyAddress: KING_ST,
      suburb: 'Newtown',
      propertyManagerId: ids.aliceId,
      propertyManager: 'Alice Archer',
      visit: 'not_confirmed',
    });

    await h.answer(TOM, 'I have work on Tuesday, can we do another day?', 'reschedule');
    expect((await alice.calendar(week))[0]!.visit).toBe('reschedule_requested');

    await alice.acceptTime(booking!.workOrderId, sydney('2026-10-14T14:00:00').toISOString());
    await h.answer(TOM, 'Yes Wednesday works', 'confirm');
    expect((await alice.calendar(week))[0]!.visit).toBe('confirmed');
  });
});

describe('rescheduling', () => {
  test("a Tradie asks for another time; suggestions fit the Tradie's calendar and the Tenant's weekday-morning availability", async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    // Pete already has Monday 9-11 booked on another Job.
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);
    const otherJob = { ticketId: job.ticketId, jobId: await alice.addJob(job.ticketId, 'plumbing') };
    await approve(w, otherJob, tradies.pete, MON_9AM);
    await alice.sendWorkOrder(otherJob.jobId);
    await alice.sendWorkOrder(job.jobId);
    const { workOrder } = await jobView(w, job);

    h.classifier.when("Can't make Tuesday sorry", { replyType: 'reschedule_request', relatedItem: `work_order:${workOrder!.workOrderId}` });
    await h.receive(tradies.pete.address, "Can't make Tuesday sorry");

    expect((await jobView(w, job)).workOrder).toMatchObject({ rescheduleRequestedBy: 'tradie' });
    expect((await alice.dashboard()).tickets[0]).toMatchObject({ unreadMessages: 1 });

    // Now is Saturday 10 October, 9 am. Tom is home weekday mornings (8-12).
    const suggestions = await alice.suggestTimes(workOrder!.workOrderId);
    expect(suggestions).toEqual([
      { start: sydney('2026-10-13T08:00:00').toISOString(), end: sydney('2026-10-13T10:00:00').toISOString() },
      { start: sydney('2026-10-13T10:00:00').toISOString(), end: sydney('2026-10-13T12:00:00').toISOString() },
      { start: sydney('2026-10-14T08:00:00').toISOString(), end: sydney('2026-10-14T10:00:00').toISOString() },
    ]);

    h.messenger.clear();
    await alice.acceptTime(workOrder!.workOrderId, suggestions[2]!.start);

    expect(h.messenger.to(tradies.pete.address)).toMatchObject([{ template: 'tradie.visit_moved', data: { visitStart: suggestions[2]!.start } }]);
    expect(h.messenger.to(TOM)).toMatchObject([{ template: 'tenant.visit_moved', data: { visitStart: suggestions[2]!.start, tradieBusinessName: "Pete's Plumbing" } }]);
    expect((await jobView(w, job)).workOrder).toMatchObject({ start: suggestions[2]!.start, rescheduleRequestedBy: null });
  });

  test('a Tenant asks for another time by replying, and confirms the new one', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);
    await alice.sendWorkOrder(job.jobId);

    await h.answer(TOM, 'I have work on Tuesday, can we do another day?', 'reschedule');
    const { workOrder } = await jobView(w, job);
    expect(workOrder).toMatchObject({ rescheduleRequestedBy: 'tenant', visitConfirmed: false });

    // The Property Manager picks a free slot outside the suggestions.
    const wednesday2pm = sydney('2026-10-14T14:00:00').toISOString();
    await alice.acceptTime(workOrder!.workOrderId, wednesday2pm);
    expect(h.messenger.last(TOM)).toMatchObject({ template: 'tenant.visit_moved', data: { visitStart: wednesday2pm } });

    await h.answer(TOM, 'Yes Wednesday works', 'confirm');
    expect((await jobView(w, job)).workOrder).toMatchObject({ start: wednesday2pm, visitConfirmed: true, rescheduleRequestedBy: null });
  });

  test('a new time must be free for the Tradie', async () => {
    const w = await world();
    const { alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);
    const otherJob = { ticketId: job.ticketId, jobId: await alice.addJob(job.ticketId, 'plumbing') };
    await approve(w, otherJob, tradies.pete, MON_9AM);
    await alice.sendWorkOrder(otherJob.jobId);
    await alice.sendWorkOrder(job.jobId);
    const { workOrder } = await jobView(w, job);

    await expect(alice.acceptTime(workOrder!.workOrderId, sydney('2026-10-12T10:00:00').toISOString())).rejects.toThrow(/booked/);
  });
});

describe("the Tenant's tracker and the booked visit", () => {
  test('the booked stage says whether the Tenant has confirmed, and is done only once the Job is', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);
    await alice.sendWorkOrder(job.jobId);
    const link = h.messenger.to(TOM).find((m) => m.template === 'tenant.confirmed')!.data.trackerLink as string;
    const booked = async () => (await h.tracker(link)).stages.find((s) => s.stage === 'booked');

    expect(await booked()).toMatchObject({ reached: true, done: false, visitConfirmed: false, rescheduleRequested: false });
    expect((await h.tracker(link)).stages.find((s) => s.stage === 'approved')).toMatchObject({ reached: true, done: true });

    await h.answer(TOM, 'Yes that works', 'confirm');
    expect(await booked()).toMatchObject({ done: false, visitConfirmed: true });
  });

  test('the booked stage says when the Tenant asked for another time', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);
    await alice.sendWorkOrder(job.jobId);
    const link = h.messenger.to(TOM).find((m) => m.template === 'tenant.confirmed')!.data.trackerLink as string;

    await h.answer(TOM, 'I have work on Tuesday, can we do another day?', 'reschedule');

    expect((await h.tracker(link)).stages.find((s) => s.stage === 'booked')).toMatchObject({ done: false, visitConfirmed: false, rescheduleRequested: true });
  });
});
