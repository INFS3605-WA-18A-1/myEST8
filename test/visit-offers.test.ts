import { describe, expect, test } from 'vitest';
import { all, one } from '../src/db.ts';
import { HOUR } from './support/harness.ts';
import { confirmedQuotes, jobView, KING_ST, OLIVIA, quoteToken, TOM, tomsTapTicket, world, type JobRef, type World } from './support/world.ts';

const TUE_27_9AM = new Date('2026-10-27T09:00:00+11:00');

/** Olivia replies to the approval request waiting on her. */
async function oliviaReplies(w: World, job: JobRef, text: string, answer: 'yes' | 'no') {
  const { approval } = await jobView(w, job);
  w.h.classifier.when(text, { replyType: 'approval_answer', answer, relatedItem: `approval:${approval!.approvalId}` });
  await w.h.receive(OLIVIA, text);
}

describe('asking the Tradie to offer visit times', () => {
  test('approving a Quote asks the chosen Tradie to offer times on their quote page, and does not book a visit', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[tradies.pete, 150_00]]);
    h.messenger.clear();

    await alice.chooseQuote(quote!.quoteId, 'Usual plumber');

    const link = `https://myest8.test/q/${await quoteToken(w, job, tradies.pete)}`;
    const sent = h.messenger.last(tradies.pete.address);
    expect(sent).toMatchObject({
      template: 'tradie.offer_times',
      subject: 'Offer visit times',
      data: { trade: 'plumbing', propertyAddress: KING_ST, quoteLink: link },
    });
    expect(sent!.text).toContain(`Offer visit times: ${link}`);
    expect(await jobView(w, job)).toMatchObject({ status: 'approved', workOrder: null });
  });

  test("an Owner's YES asks the chosen Tradie to offer times", async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [
      [tradies.dana, 650_00],
      [tradies.pete, 700_00],
    ]);
    await alice.chooseQuote(quote!.quoteId);
    h.messenger.clear();

    await oliviaReplies(w, job, 'YES go ahead', 'yes');

    expect(h.messenger.last(tradies.dana.address)).toMatchObject({
      template: 'tradie.offer_times',
      data: { propertyAddress: KING_ST, quoteLink: `https://myest8.test/q/${await quoteToken(w, job, tradies.dana)}` },
    });
    expect(h.messenger.last(tradies.pete.address)!.template).toBe('tradie.not_chosen');
    expect(await jobView(w, job)).toMatchObject({ status: 'approved', workOrder: null });
  });

  test('refuses a visit time the Tradie is already booked for, and fewer than two times', async () => {
    const w = await world();
    const { alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[tradies.pete, 150_00, TUE_27_9AM]]);
    await alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    const token = await quoteToken(w, job, tradies.pete);
    const wed = new Date('2026-10-28T13:00:00+11:00');

    await expect(w.h.app.offerVisitTimes(token, [TUE_27_9AM.toISOString()])).rejects.toThrow(/2 or 3/);

    const other = { ticketId: job.ticketId, jobId: await alice.addJob(job.ticketId, 'plumbing') };
    const [otherQuote] = await confirmedQuotes(w, other, [[tradies.pete, 80_00, TUE_27_9AM]]);
    await alice.chooseQuote(otherQuote!.quoteId, 'Same visit, listed apart');
    await alice.sendWorkOrder(other.jobId, { start: TUE_27_9AM.toISOString() });

    await expect(w.h.app.offerVisitTimes(token, [TUE_27_9AM.toISOString(), wed.toISOString()])).rejects.toThrow(/already booked at Tue 27 Oct, 9:00 am/);
    expect(w.h.messenger.last(TOM)?.template).not.toBe('tenant.choose_visit_time');
  });
});

/** Pete's quote is approved and he has offered Tuesday 9:00 am and Wednesday 1:00 pm. */
async function timesOffered() {
  const w = await world();
  const job = await tomsTapTicket(w);
  const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_27_9AM]]);
  await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
  await w.h.app.offerVisitTimes(await quoteToken(w, job, w.tradies.pete), [TUE_27_9AM.toISOString(), new Date('2026-10-28T13:00:00+11:00').toISOString()]);
  return { w, job };
}

describe('the Tenant replies to choose a time', () => {
  test('replying 1 books that time, already confirmed, with no YES to send', async () => {
    const { w, job } = await timesOffered();
    w.h.classifier.when('1', { messageClass: 'other', 'answer:visit_offer': '1' });
    await w.h.receive(TOM, '1');
    expect(await jobView(w, job)).toMatchObject({
      status: 'scheduled',
      workOrder: { start: TUE_27_9AM.toISOString(), visitConfirmed: true },
    });
    const booked = w.h.messenger.last(TOM)!;
    expect(booked.template).toBe('tenant.visit_booked');
    expect(booked.text).toContain('Booked for Tue 27 Oct, 9:00 am');
    expect(booked.text).not.toMatch(/\bYES\b/);
    expect(w.h.messenger.last(w.tradies.pete.address)!.template).toBe('tradie.work_order');
    expect(w.h.messenger.last(OLIVIA)!.template).toBe('owner.work_booked');
  });

  test('replying Tuesday books that day', async () => {
    const { w, job } = await timesOffered();
    w.h.classifier.when('Tuesday works', { messageClass: 'other', 'answer:visit_offer': 'Tuesday' });
    await w.h.receive(TOM, 'Tuesday works');
    expect(await jobView(w, job)).toMatchObject({
      status: 'scheduled',
      workOrder: { start: TUE_27_9AM.toISOString(), visitConfirmed: true },
    });
  });

  test('replying 2 books the Wednesday time', async () => {
    const { w, job } = await timesOffered();
    w.h.classifier.when('2', { messageClass: 'other', 'answer:visit_offer': '2' });
    await w.h.receive(TOM, '2');
    expect(await jobView(w, job)).toMatchObject({
      status: 'scheduled',
      workOrder: { start: new Date('2026-10-28T13:00:00+11:00').toISOString(), visitConfirmed: true },
    });
    expect(w.h.messenger.last(TOM)!.text).toContain('Booked for Wed 28 Oct, 1:00 pm');
  });

  test('replying none does not book a visit, asks the Tradie again, and points the Tenant at the page', async () => {
    const { w, job } = await timesOffered();
    const token = w.h.messenger.last(TOM)!.text.match(/\/v\/([^?\s]+)\?pick=1/)![1]!;
    w.h.classifier.when('none', { messageClass: 'other', 'answer:visit_offer': 'none' });
    await w.h.receive(TOM, 'none');

    expect(await jobView(w, job)).toMatchObject({ status: 'approved', workOrder: null });
    expect((await one<{ status: string; tenant_note: string | null }>(w.h.db, 'SELECT status, tenant_note FROM visit_offers WHERE token = ?', token))).toMatchObject({
      status: 'none_fit',
      tenant_note: null,
    });
    expect((await one<{ availability: string }>(w.h.db, 'SELECT availability FROM people WHERE mobile = ?', TOM))?.availability).toBe('weekday_mornings');
    const again = w.h.messenger.last(w.tradies.pete.address)!;
    expect(again).toMatchObject({
      template: 'tradie.offer_times_again',
      data: { availability: 'weekday_mornings', note: null, propertyAddress: KING_ST },
    });
    expect(again.text).toContain("They're usually home weekday mornings.");
    expect(again.text).not.toContain('They said:');
    expect((await w.alice.ticket(job.ticketId)).timeline.at(-1)).toMatchObject({ kind: 'other_times_requested', jobId: job.jobId });
    const reply = w.h.messenger.last(TOM)!;
    expect(reply.template).toBe('tenant.say_when_home');
    expect(reply.text).toContain(`Say when you're home: https://myest8.test/v/${token}?home=1`);
  });

  test("replying none keeps the rest of the reply as the Tenant's note", async () => {
    const { w, job } = await timesOffered();
    const token = w.h.messenger.last(TOM)!.text.match(/\/v\/([^?\s]+)\?pick=1/)![1]!;
    w.h.classifier.when('none. Sunday 10 am works', { messageClass: 'other', 'answer:visit_offer': 'none' });
    await w.h.receive(TOM, 'none. Sunday 10 am works');

    expect((await one<{ tenant_note: string | null }>(w.h.db, 'SELECT tenant_note FROM visit_offers WHERE token = ?', token))?.tenant_note).toBe('Sunday 10 am works');
    const again = w.h.messenger.last(w.tradies.pete.address)!;
    expect(again).toMatchObject({ template: 'tradie.offer_times_again', data: { note: 'Sunday 10 am works', availability: 'weekday_mornings' } });
    expect(again.text).toContain('They said: Sunday 10 am works.');
    expect((await w.alice.ticket(job.ticketId)).timeline.at(-1)).toMatchObject({ kind: 'other_times_requested', note: 'Sunday 10 am works' });
  });
});

/** Tom has booked Tuesday 9:00 am. The offer token is the visit's page. */
async function visitBooked() {
  const offered = await timesOffered();
  const token = offered.w.h.messenger.last(TOM)!.text.match(/\/v\/([^?\s]+)\?pick=1/)![1]!;
  await offered.w.h.app.pickVisitTime(token, '1');
  offered.w.h.messenger.clear();
  return { ...offered, token };
}

describe('rescheduling a booked visit', () => {
  test('the Property Manager can ask the Tradie to offer times for a booked visit', async () => {
    const { w, job } = await visitBooked();
    const booked = (await jobView(w, job)).workOrder!;
    w.h.messenger.clear();

    await w.alice.askTradieToOfferTimes(job.jobId);

    expect((await jobView(w, job)).workOrder).toMatchObject({
      workOrderId: booked.workOrderId,
      start: TUE_27_9AM.toISOString(),
      rescheduleRequestedBy: 'property_manager',
    });
    expect(w.h.messenger.last(w.tradies.pete.address)).toMatchObject({
      template: 'tradie.offer_new_times',
      subject: 'Offer new visit times',
    });
  });

  test('a Tradie asking for another time leaves the visit booked and is asked to offer new times', async () => {
    const { w, job } = await visitBooked();
    const { workOrder } = await jobView(w, job);
    const link = `https://myest8.test/q/${await quoteToken(w, job, w.tradies.pete)}`;
    w.h.classifier.when("Can't make Tuesday sorry", { replyType: 'reschedule_request', relatedItem: `work_order:${workOrder!.workOrderId}` });

    await w.h.receive(w.tradies.pete.address, "Can't make Tuesday sorry");

    expect((await jobView(w, job)).workOrder).toMatchObject({
      workOrderId: workOrder!.workOrderId,
      start: TUE_27_9AM.toISOString(),
      rescheduleRequestedBy: 'tradie',
    });
    const asked = w.h.messenger.last(w.tradies.pete.address)!;
    expect(asked).toMatchObject({
      template: 'tradie.offer_new_times',
      subject: 'Offer new visit times',
      data: { trade: 'plumbing', propertyAddress: KING_ST, quoteLink: link, availability: 'weekday_mornings' },
    });
    expect(asked.text).toContain('The current visit stays booked until they pick one.');
    expect(asked.text).toContain("They're usually home weekday mornings.");
    expect(asked.text).toContain(`Offer visit times: ${link}`);
  });

  test('the Tenant asking for another time starts a round, and picking a new time moves the visit', async () => {
    const { w, job, token } = await visitBooked();
    const booked = (await jobView(w, job)).workOrder!;
    const link = `https://myest8.test/q/${await quoteToken(w, job, w.tradies.pete)}`;

    await w.h.app.requestAnotherTime(token);

    expect((await jobView(w, job)).workOrder).toMatchObject({
      workOrderId: booked.workOrderId,
      start: TUE_27_9AM.toISOString(),
      rescheduleRequestedBy: 'tenant',
    });
    expect(w.h.messenger.last(w.tradies.pete.address)).toMatchObject({ template: 'tradie.offer_new_times', data: { quoteLink: link } });

    const thursday = new Date('2026-10-29T09:00:00+11:00');
    const friday = new Date('2026-10-30T13:00:00+11:00');
    await w.h.app.offerVisitTimes(await quoteToken(w, job, w.tradies.pete), [thursday.toISOString(), friday.toISOString()]);
    expect((await jobView(w, job)).workOrder!.start).toBe(TUE_27_9AM.toISOString());

    const next = w.h.messenger.last(TOM)!.text.match(/\/v\/([^?\s]+)\?pick=1/)![1]!;
    w.h.messenger.clear();
    await w.h.app.pickVisitTime(next, '1');

    const moved = (await jobView(w, job)).workOrder!;
    expect(moved).toMatchObject({
      workOrderId: booked.workOrderId,
      start: thursday.toISOString(),
      visitConfirmed: true,
      rescheduleRequestedBy: null,
    });
    expect(w.h.messenger.last(w.tradies.pete.address)).toMatchObject({ template: 'tradie.visit_moved', data: { visitStart: thursday.toISOString(), propertyAddress: KING_ST } });
    expect(w.h.messenger.last(OLIVIA)).toMatchObject({
      template: 'owner.work_moved',
      subject: 'Repair visit moved',
      data: { propertyAddress: KING_ST, trade: 'plumbing', visitStart: thursday.toISOString() },
    });
    expect(w.h.messenger.last(OLIVIA)!.text).toContain('has moved to Thu 29 Oct, 9:00 am');
    const tenant = w.h.messenger.last(TOM)!;
    expect(tenant.template).toBe('tenant.visit_booked');
    expect(tenant.text).toContain('Booked for Thu 29 Oct, 9:00 am');
    expect(tenant.text).not.toMatch(/\bYES\b/);
    expect(tenant.text).toContain(`Need another time?: https://myest8.test/v/${next}`);
  });

  test("the Property Manager booking supersedes an open offer", async () => {
    const { w, job } = await timesOffered();
    const token = w.h.messenger.last(TOM)!.text.match(/\/v\/([^?\s]+)\?pick=1/)![1]!;

    await w.alice.sendWorkOrder(job.jobId, { start: TUE_27_9AM.toISOString() });

    expect((await one<{ status: string }>(w.h.db, 'SELECT status FROM visit_offers WHERE token = ?', token))?.status).toBe('superseded');
    await expect(w.h.app.pickVisitTime(token, '1')).rejects.toThrow(/no longer/);
    expect(await jobView(w, job)).toMatchObject({ status: 'scheduled', workOrder: { start: TUE_27_9AM.toISOString() } });
  });
});

describe('nudges when a visit time is waiting', () => {
  test('the Tradie is reminded after 24 hours and the Property Manager alerted after 48', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[tradies.pete, 150_00, TUE_27_9AM]]);
    await alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    h.messenger.clear();

    await h.advance(24 * HOUR);
    const reminder = h.messenger.last(tradies.pete.address)!;
    expect(reminder).toMatchObject({
      template: 'tradie.offer_times_reminder',
      subject: 'Reminder: offer visit times',
      data: { trade: 'plumbing', propertyAddress: KING_ST },
    });
    expect(reminder.text).toContain('Offer visit times:');
    expect((await alice.dashboard()).alerts.filter((a) => a.kind === 'tradie_no_visit_times')).toEqual([]);

    await h.advance(24 * HOUR);
    expect((await alice.dashboard()).alerts).toMatchObject([
      { kind: 'tradie_no_visit_times', ticketId: job.ticketId, jobId: job.jobId, propertyAddress: KING_ST, businessName: "Pete's Plumbing" },
    ]);

    await h.app.offerVisitTimes(await quoteToken(w, job, tradies.pete), [TUE_27_9AM.toISOString(), new Date('2026-10-28T13:00:00+11:00').toISOString()]);
    expect((await alice.dashboard()).alerts.filter((a) => a.kind === 'tradie_no_visit_times')).toEqual([]);
  });

  test('the Tenant is reminded after 24 hours and the Property Manager alerted after 48', async () => {
    const { w, job } = await timesOffered();
    w.h.messenger.clear();

    await w.h.advance(24 * HOUR);
    const reminder = w.h.messenger.last(TOM)!;
    expect(reminder.template).toBe('tenant.pick_visit_time_reminder');
    expect(reminder.text).toContain('Tue 27 Oct, 9:00 am');
    expect(reminder.text).toContain('None of these work');
    expect((await w.alice.dashboard()).alerts.filter((a) => a.kind === 'tenant_no_visit_pick')).toEqual([]);

    await w.h.advance(24 * HOUR);
    expect((await w.alice.dashboard()).alerts).toMatchObject([
      { kind: 'tenant_no_visit_pick', ticketId: job.ticketId, jobId: job.jobId, propertyAddress: KING_ST },
    ]);

    const token = reminder.text.match(/\/v\/([^?\s]+)\?pick=1/)![1]!;
    await w.h.app.pickVisitTime(token, '1');
    expect((await w.alice.dashboard()).alerts.filter((a) => a.kind === 'tenant_no_visit_pick')).toEqual([]);
  });
});

describe('when none of the times work', () => {
  test('the Tenant says when they are home, and the Tradie is asked to offer another round', async () => {
    const { w, job } = await timesOffered();
    const token = w.h.messenger.last(TOM)!.text.match(/\/v\/([^?\s]+)\?pick=1/)![1]!;
    const link = `https://myest8.test/q/${await quoteToken(w, job, w.tradies.pete)}`;

    await w.h.app.declineVisitTimes(token, { availability: 'saturdays', note: 'Sunday 10 am works' });

    const offer = await one<{ status: string; tenant_note: string | null; round: number }>(
      w.h.db,
      'SELECT status, tenant_note, round FROM visit_offers WHERE token = ?',
      token,
    );
    expect(offer).toMatchObject({ status: 'none_fit', tenant_note: 'Sunday 10 am works' });
    expect(Number(offer?.round)).toBe(1);
    expect((await one<{ availability: string }>(w.h.db, 'SELECT availability FROM people WHERE mobile = ?', TOM))?.availability).toBe('saturdays');

    const again = w.h.messenger.last(w.tradies.pete.address)!;
    expect(again).toMatchObject({
      template: 'tradie.offer_times_again',
      subject: 'Offer visit times again',
      data: { trade: 'plumbing', propertyAddress: KING_ST, availability: 'saturdays', note: 'Sunday 10 am works', quoteLink: link },
    });
    expect(again.text).toContain("They're usually home Saturdays.");
    expect(again.text).toContain('They said: Sunday 10 am works.');
    expect(again.text).toContain(`Offer visit times: ${link}`);
    expect(await jobView(w, job)).toMatchObject({ status: 'approved', workOrder: null });
    expect((await w.alice.ticket(job.ticketId)).timeline.at(-1)).toMatchObject({ kind: 'other_times_requested', jobId: job.jobId });

    await w.h.app.offerVisitTimes(link.slice(link.lastIndexOf('/') + 1), [
      new Date('2026-10-29T09:00:00+11:00').toISOString(),
      new Date('2026-10-30T13:00:00+11:00').toISOString(),
    ]);
    const rounds = await all<{ round: number; status: string }>(w.h.db, 'SELECT round, status FROM visit_offers WHERE job_id = ? ORDER BY round', job.jobId);
    expect(rounds.map((r) => ({ round: Number(r.round), status: r.status }))).toEqual([
      { round: 1, status: 'none_fit' },
      { round: 2, status: 'offered' },
    ]);
    expect(w.h.messenger.last(TOM)!.text).toContain('Thu 29 Oct, 9:00 am');
    expect(w.h.messenger.last(TOM)!.text).toContain('Fri 30 Oct, 1:00 pm');
  });
});
