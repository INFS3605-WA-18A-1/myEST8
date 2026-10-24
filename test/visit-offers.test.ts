import { describe, expect, test } from 'vitest';
import { all, one } from '../src/db.ts';
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

  test('replying none does not book a visit', async () => {
    const { w, job } = await timesOffered();
    w.h.classifier.when('none', { messageClass: 'other', 'answer:visit_offer': 'none' });
    await w.h.receive(TOM, 'none');
    expect(await jobView(w, job)).toMatchObject({ status: 'approved', workOrder: null });
    expect(w.h.messenger.last(w.tradies.pete.address)!.template).toBe('tradie.offer_times');
    expect(w.h.messenger.last(TOM)!.template).toBe('tenant.choose_visit_time');
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
