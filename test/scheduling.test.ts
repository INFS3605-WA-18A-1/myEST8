import { describe, expect, test } from 'vitest';
import { one, run } from '../src/db.ts';
import {
  BELLA,
  confirmedEstimates,
  dateAhead,
  firmQuote,
  confirmedQuotes,
  jobView,
  KING_ST,
  OCEAN_AVE,
  OLIVIA,
  TOM,
  tomsTapTicket,
  visitStarted,
  world,
  type JobRef,
  type TradieRef,
  type World,
} from './support/world.ts';

const sydney = (local: string) => new Date(`${local}+11:00`);

/** The visit confirmation still waiting on Tom, if any. */
async function pendingVisit(w: World) {
  const row = await one<{ awaiting: string }>(
    w.h.db,
    `SELECT awaiting FROM pending_answers WHERE person_id = (SELECT id FROM people WHERE mobile = ?) AND kind = 'visit'`,
    TOM,
  );
  return row ? (JSON.parse(row.awaiting) as { kind: string }) : null;
}
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
  await h.answerAll(BELLA, { location: 'Bathroom', started: 'Yesterday', worsening: 'no', availability: 'any_time' });
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

  test("the Work Order carries what was approved: the Firm Quote's price", async () => {
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
    await firmQuote(w2, capped, w2.tradies.pete, { priceCents: 180_00, availableTimes: [dateAhead(w2, 2) + "T09:00:00.000Z"] });
    await w2.alice.chooseQuote((await jobView(w2, capped)).quotes.find((q) => q.tradieId === w2.tradies.pete.id && q.stage === "firm")!.quoteId, "Usual plumber");
    await w2.alice.sendWorkOrder(capped.jobId);
    expect(w2.h.messenger.last(w2.tradies.pete.address)).toMatchObject({ template: 'tradie.work_order', data: { approvedCents: 180_00, stage: 'firm' } });
    expect(w2.h.messenger.last(w2.tradies.pete.address)!.text).toContain('Approved: your Firm Quote of $180.00.');
  });

  test('the slot is 2 hours by default and can be made longer', async () => {
    const w = await world();
    const { alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);

    await alice.sendWorkOrder(job.jobId, { durationMinutes: 240 });

    expect((await jobView(w, job)).workOrder).toMatchObject({ end: sydney('2026-10-13T13:00:00').toISOString() });
  });

  test('a Firm Quote with no proposed time uses its first available time as the start', async () => {
    const w = await world();
    const { alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete);

    await alice.sendWorkOrder(job.jobId);

    const view = await jobView(w, job);
    expect(view).toMatchObject({ status: 'scheduled' });
    expect(view.workOrder!.start).toBeTruthy();
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
    expect(h.messenger.last(OLIVIA)).toMatchObject({ template: 'owner.work_moved', data: { propertyAddress: KING_ST, trade: 'plumbing', visitStart: suggestions[2]!.start } });
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

  test('a Property Manager booking emails the Tenant confirm and need-another-time links, and YES still confirms', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);
    await alice.sendWorkOrder(job.jobId);

    const text = h.messenger.last(TOM)!.text;
    const token = text.match(/\/v\/confirm\/([^?\s]+)/)?.[1];
    expect(text).toContain(`Confirm this time: https://myest8.test/v/confirm/${token}`);
    expect(text).toContain(`Need another time?: https://myest8.test/v/confirm/${token}?another=1`);
    expect(text).not.toMatch(/Reply YES/);
    expect(text).toContain('Tue 13 Oct, 9:00 am');
    expect(await pendingVisit(w)).toMatchObject({ kind: 'visit' });

    await h.answer(TOM, 'Yes that works', 'confirm');
    expect((await jobView(w, job)).workOrder).toMatchObject({ visitConfirmed: true });
    expect(await pendingVisit(w)).toBeNull();
  });

  test('moving a visit emails the Tenant the same two links for the new time', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);
    await alice.sendWorkOrder(job.jobId);
    const { workOrder } = await jobView(w, job);
    const wednesday2pm = sydney('2026-10-14T14:00:00').toISOString();
    h.messenger.clear();

    await alice.acceptTime(workOrder!.workOrderId, wednesday2pm);

    const text = h.messenger.last(TOM)!.text;
    const token = text.match(/\/v\/confirm\/([^?\s]+)/)?.[1];
    expect(h.messenger.last(TOM)).toMatchObject({ template: 'tenant.visit_moved', data: { visitStart: wednesday2pm } });
    expect(text).toContain('Wed 14 Oct, 2:00 pm');
    expect(text).toContain(`Confirm this time: https://myest8.test/v/confirm/${token}`);
    expect(text).toContain(`Need another time?: https://myest8.test/v/confirm/${token}?another=1`);
    expect(text).not.toMatch(/Reply YES/);
  });

  test('confirming through the page records the confirmation and stops the YES wait', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);
    await alice.sendWorkOrder(job.jobId);
    const token = h.messenger.last(TOM)!.text.match(/\/v\/confirm\/([^?\s]+)/)![1]!;

    await h.app.confirmBookedVisit(token);

    expect((await jobView(w, job)).workOrder).toMatchObject({ visitConfirmed: true, start: TUE_9AM.toISOString() });
    expect(await pendingVisit(w)).toBeNull();
    expect((await alice.ticket(job.ticketId)).timeline.filter((e) => e.kind === 'visit_confirmed')).toHaveLength(1);
  });

  test('need another time starts a new offer round and leaves the visit booked', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);
    await alice.sendWorkOrder(job.jobId);
    const token = h.messenger.last(TOM)!.text.match(/\/v\/confirm\/([^?\s]+)/)![1]!;
    h.messenger.clear();

    await h.app.askToMoveVisit(token);

    expect((await jobView(w, job)).workOrder).toMatchObject({
      start: TUE_9AM.toISOString(),
      visitConfirmed: false,
      rescheduleRequestedBy: 'tenant',
    });
    expect(h.messenger.last(tradies.pete.address)).toMatchObject({ template: 'tradie.offer_new_times' });
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

/** Queues a resend the way a tasks row would, with no Property Manager session, and runs it. */
async function queueResend(w: World, workOrderId: number, to: 'tenant' | 'tradie') {
  await run(w.h.db, `INSERT INTO tasks (kind, payload, run_at) VALUES ('scheduling.resend_visit_emails', ?, ?)`, JSON.stringify({ workOrderId, to }), w.h.clock.now().toISOString());
  await w.h.drain();
}

async function logged(w: World, template: string) {
  return Number((await one<{ n: number }>(w.h.db, 'SELECT count(*) AS n FROM messages WHERE template = ?', template))?.n ?? 0);
}

describe('resending a visit email', () => {
  test('a Work Order with no token gets one the first time the Tenant is sent the visit link, and keeps it', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);
    await alice.sendWorkOrder(job.jobId);
    const { workOrder } = await jobView(w, job);
    await run(h.db, 'UPDATE work_orders SET token = NULL WHERE id = ?', workOrder!.workOrderId);
    h.messenger.clear();

    await queueResend(w, workOrder!.workOrderId, 'tenant');

    const saved = await one<{ token: string | null }>(h.db, 'SELECT token FROM work_orders WHERE id = ?', workOrder!.workOrderId);
    expect(saved?.token).toMatch(/^[\w-]{32}$/);
    expect(h.messenger.last(TOM)!.text).toContain(`/v/confirm/${saved!.token}`);
    h.messenger.clear();
    await queueResend(w, workOrder!.workOrderId, 'tenant');
    expect((await one<{ token: string | null }>(h.db, 'SELECT token FROM work_orders WHERE id = ?', workOrder!.workOrderId))?.token).toBe(saved!.token);
  });

  test("the task re-sends the Tenant's current visit email, with the confirm links, and logs it", async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);
    await alice.sendWorkOrder(job.jobId);
    const { workOrder } = await jobView(w, job);
    const before = await logged(w, 'tenant.visit_time');
    h.messenger.clear();

    await queueResend(w, workOrder!.workOrderId, 'tenant');

    const sent = h.messenger.last(TOM)!;
    expect(sent.template).toBe('tenant.visit_time');
    expect(sent.text).toContain('Confirm this time:');
    expect(sent.text).toContain('Need another time?:');
    expect(await logged(w, 'tenant.visit_time')).toBe(before + 1);
  });

  test("after a move, the task re-sends the moved visit, and the Tradie's Work Order at the new time", async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);
    await alice.sendWorkOrder(job.jobId);
    const { workOrder } = await jobView(w, job);
    const wednesday2pm = sydney('2026-10-14T14:00:00').toISOString();
    await alice.acceptTime(workOrder!.workOrderId, wednesday2pm);
    h.messenger.clear();

    await queueResend(w, workOrder!.workOrderId, 'tenant');
    const tenant = h.messenger.last(TOM)!;
    expect(tenant.template).toBe('tenant.visit_moved');
    expect(tenant.text).toContain('Wed 14 Oct, 2:00 pm');
    expect(tenant.text).toContain('Confirm this time:');
    expect(tenant.text).toContain('Need another time?:');

    h.messenger.clear();
    await queueResend(w, workOrder!.workOrderId, 'tradie');
    expect(h.messenger.last(tradies.pete.address)).toMatchObject({
      template: 'tradie.work_order',
      data: { visitStart: wednesday2pm, propertyAddress: KING_ST },
    });
    expect(await logged(w, 'tradie.work_order')).toBeGreaterThan(1);
  });

  test('it does nothing for a cancelled visit or a completed one', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await approvedTapJob(w, tradies.pete, TUE_9AM);
    await alice.sendWorkOrder(job.jobId);
    const { workOrder } = await jobView(w, job);
    await alice.cancelJob(job.jobId);
    h.messenger.clear();

    await queueResend(w, workOrder!.workOrderId, 'tenant');
    await queueResend(w, workOrder!.workOrderId, 'tradie');
    expect(h.messenger.last(TOM)).toBeUndefined();
    expect(h.messenger.last(tradies.pete.address)).toBeUndefined();

    const doneWorld = await world();
    const doneJob = await approvedTapJob(doneWorld, doneWorld.tradies.pete, TUE_9AM);
    await doneWorld.alice.sendWorkOrder(doneJob.jobId);
    const doneOrder = (await jobView(doneWorld, doneJob)).workOrder!;
    doneWorld.h.classifier.when('All done', { replyType: 'done', relatedItem: `work_order:${doneOrder.workOrderId}` });
    visitStarted(doneWorld, doneOrder.start);
    await doneWorld.h.receive(doneWorld.tradies.pete.address, 'All done');
    doneWorld.h.messenger.clear();

    await queueResend(doneWorld, doneOrder.workOrderId, 'tenant');
    expect(doneWorld.h.messenger.last(TOM)).toBeUndefined();
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
