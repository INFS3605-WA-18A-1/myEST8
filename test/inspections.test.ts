import { describe, expect, test } from 'vitest';
import { all, one, run } from '../src/db.ts';
import { HOUR } from './support/harness.ts';
import {
  confirmedEstimates,
  dateAhead,
  firmQuote,
  jobView,
  quoteRequestFor,
  quoteToken,
  TOM,
  tomsTapTicket,
  tradieQuotes,
  world,
  visitStarted,
  type JobRef,
  type TradieRef,
  type World,
} from './support/world.ts';

// Estimates, Site Inspections and Firm Quotes (docs/adr/0009). Each Tradie's Quote
// Request moves on its own; the Job stays quoting throughout.

const sydney = (local: string) => new Date(`${local}+11:00`);
const TUE_10AM = sydney('2026-10-13T10:00:00');
const WED_10AM = sydney('2026-10-14T10:00:00');

/** The Tradie gives an Estimate on their quote page. */
async function estimate(w: World, job: JobRef, tradie: TradieRef, input: { priceCents: number; needsInspection: boolean; calloutFeeCents?: number }) {
  await w.h.app.submitEstimate(await quoteToken(w, job, tradie), input);
  await w.h.drain();
}

/** Tom's tap with Quote Requests to Pete and Dana. */
async function askPeteAndDana(w: World) {
  const job = await tomsTapTicket(w);
  await w.alice.sendQuoteRequests(job.jobId, [w.tradies.pete.id, w.tradies.dana.id]);
  return job;
}

describe('Quote Requests carry a private quote page link', () => {
  test('each Tradie gets their own link, and the message says what an Estimate and a Firm Quote are', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    const pete = w.h.messenger.last(w.tradies.pete.address)!;
    const dana = w.h.messenger.last(w.tradies.dana.address)!;
    expect(pete.data.quoteLink).toMatch(/^https:\/\/myest8\.test\/q\/[\w-]{20,}$/);
    expect(pete.data.quoteLink).not.toBe(dana.data.quoteLink);
    expect(pete.text).toContain(String(pete.data.quoteLink));
    expect(pete.text).toMatch(/Estimate/);
    expect(pete.text).toMatch(/Firm Quote/);
    expect(await w.h.app.quotePage(await quoteToken(w, job, w.tradies.pete))).toMatchObject({ next: 'estimate', suburb: 'Newtown', propertyAddress: null });
    expect(await w.h.app.quotePage('not-a-token')).toBeNull();
  });
});

describe('requirement 1: each Tradie progresses on their own', () => {
  test('one Tradie quotes firm remotely while the other needs a Site Inspection, and the Job stays quoting', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await askPeteAndDana(w);

    await estimate(w, job, tradies.pete, { priceCents: 180_00, needsInspection: false });
    await estimate(w, job, tradies.dana, { priceCents: 400_00, needsInspection: true, calloutFeeCents: 80_00 });
    expect(await jobView(w, job)).toMatchObject({ status: 'quoting', decision: 'book_inspection' });
    expect((await quoteRequestFor(w, job, tradies.dana)).estimate).toMatchObject({ stage: 'estimate', priceCents: 400_00, needsInspection: true, calloutFeeCents: 80_00, confirmed: true });

    // Pete goes straight to his Firm Quote; Dana can't until she has inspected.
    await firmQuote(w, job, tradies.pete, { priceCents: 190_00, scopeOfWork: 'Replace the cartridge', durationDays: 1 });
    await expect(firmQuote(w, job, tradies.dana, { priceCents: 420_00 })).rejects.toThrow(/Site Inspection comes first/);

    h.messenger.clear();
    const danaRequest = await quoteRequestFor(w, job, tradies.dana);
    await alice.bookInspection(danaRequest.quoteRequestId, { start: TUE_10AM.toISOString() });
    expect(h.messenger.last(tradies.dana.address)).toMatchObject({ template: 'tradie.inspection', data: { propertyAddress: expect.stringContaining('King St'), visitStart: TUE_10AM.toISOString() } });
    expect(h.messenger.templatesTo(tradies.pete.address)).toEqual([]);
    expect(h.messenger.last(TOM)).toMatchObject({ template: 'tenant.inspection' });
    await expect(firmQuote(w, job, tradies.dana, { priceCents: 420_00 })).rejects.toThrow(/after your Site Inspection/);

    const view = await jobView(w, job);
    expect(view.status).toBe('quoting');
    expect(view.quoteRequests.map((r) => [r.businessName, r.status])).toEqual([
      ["Pete's Plumbing", 'firm_quoted'],
      ['Drip Doctors', 'inspection_booked'],
    ]);
    expect(view.quoteRequests[1]!.inspection).toMatchObject({ start: TUE_10AM.toISOString(), status: 'active' });
    expect(view.inspections.visits).toMatchObject([{ kind: 'inspection', businessName: 'Drip Doctors' }]);
    // On the shared calendar, and Dana is busy then.
    expect(await alice.calendar({ from: TUE_10AM.toISOString(), to: WED_10AM.toISOString() })).toMatchObject([{ kind: 'inspection', businessName: 'Drip Doctors' }]);
    await expect(alice.bookInspection(danaRequest.quoteRequestId, { start: WED_10AM.toISOString() })).rejects.toThrow(/already/);

    // DONE before the visit has started is answered politely and changes nothing.
    h.classifier.when('Been and had a look', { replyType: 'done', relatedItem: `work_order:${view.inspections.visits[0]!.workOrderId}` });
    await h.receive(tradies.dana.address, 'Been and had a look');
    expect(await quoteRequestFor(w, job, tradies.dana)).toMatchObject({ status: 'inspection_booked', inspection: { status: 'active' } });
    expect(h.messenger.last(tradies.dana.address)).toMatchObject({ template: 'tradie.done_too_early', data: { visitStart: TUE_10AM.toISOString() } });

    // DONE after the visit: the Tradie is asked for the Firm Quote with their link, and reminded after 48 hours.
    visitStarted(w, TUE_10AM);
    await h.receive(tradies.dana.address, 'Been and had a look');
    expect(await quoteRequestFor(w, job, tradies.dana)).toMatchObject({ status: 'inspected', inspection: { status: 'done' } });
    expect(h.messenger.last(tradies.dana.address)).toMatchObject({ template: 'tradie.firm_quote_request', data: { quoteLink: expect.stringContaining('/q/') } });
    await h.advance(49 * HOUR);
    expect(h.messenger.last(tradies.dana.address)!.template).toBe('tradie.firm_quote_reminder');

    const dana = await firmQuote(w, job, tradies.dana, { priceCents: 420_00, durationDays: 2, availableTimes: [dateAhead(w, 3), dateAhead(w, 4)] });
    expect(dana).toMatchObject({ stage: 'firm', priceCents: 420_00, durationDays: 2, confirmed: true });
    expect(await jobView(w, job)).toMatchObject({ status: 'quoting', decision: 'choose_quote' });
    await h.advance(49 * HOUR);
    expect(h.messenger.templatesTo(tradies.dana.address).filter((t) => t === 'tradie.firm_quote_reminder')).toHaveLength(1);
  });

  test('booking an inspection needs an Estimate first and a time in the future', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    const pete = await quoteRequestFor(w, job, w.tradies.pete);
    await expect(w.alice.bookInspection(pete.quoteRequestId, { start: TUE_10AM.toISOString() })).rejects.toThrow(/once the Tradie has given an Estimate/);
    await estimate(w, job, w.tradies.pete, { priceCents: 180_00, needsInspection: true });
    await expect(w.alice.bookInspection(pete.quoteRequestId, { start: '2020-01-01T09:00:00Z' })).rejects.toThrow(/future/);
    const slots = await w.alice.inspectionSlots(job.jobId);
    expect(slots).toMatchObject([{ quoteRequestId: pete.quoteRequestId, businessName: "Pete's Plumbing" }]);
    expect(slots[0]!.slots).toHaveLength(3);
    expect(Date.parse(slots[0]!.slots[0]!.end) - Date.parse(slots[0]!.slots[0]!.start)).toBe(HOUR);
  });

  test('the Property Manager can mark an inspection done, and override whether one is needed', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    await estimate(w, job, w.tradies.pete, { priceCents: 180_00, needsInspection: true });
    await estimate(w, job, w.tradies.dana, { priceCents: 200_00, needsInspection: false });
    const pete = await quoteRequestFor(w, job, w.tradies.pete);
    const dana = await quoteRequestFor(w, job, w.tradies.dana);

    // Dana is asked to inspect after all; Pete is let off.
    await w.alice.setInspectionNeeded(dana.quoteRequestId, true);
    await w.alice.setInspectionNeeded(pete.quoteRequestId, false);
    expect(await quoteRequestFor(w, job, w.tradies.dana)).toMatchObject({ inspectionNeeded: true, inspectionOverride: true, estimate: { needsInspection: false } });
    await firmQuote(w, job, w.tradies.pete, { priceCents: 185_00 });
    await expect(firmQuote(w, job, w.tradies.dana, { priceCents: 210_00 })).rejects.toThrow(/Site Inspection comes first/);

    const id = await w.alice.bookInspection(dana.quoteRequestId, { start: TUE_10AM.toISOString(), durationMinutes: 30 });
    await expect(w.alice.setInspectionNeeded(dana.quoteRequestId, false)).rejects.toThrow(/before one is booked/);
    // Not before the visit has started.
    await expect(w.alice.markInspected(id)).rejects.toThrow(/once it has started/);
    expect((await quoteRequestFor(w, job, w.tradies.dana)).status).toBe('inspection_booked');
    visitStarted(w, TUE_10AM);
    await w.alice.markInspected(id);
    expect((await quoteRequestFor(w, job, w.tradies.dana)).status).toBe('inspected');
    expect((await w.alice.ticket(job.ticketId)).timeline.map((e) => e.kind)).toEqual(expect.arrayContaining(['inspection_need_set', 'inspection_booked', 'inspected']));
  });
});

describe('requirement 2: the routine path skips the inspection', () => {
  test('two Tradies give Estimates and Firm Quotes without any Site Inspection, and one is chosen', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    await estimate(w, job, w.tradies.pete, { priceCents: 150_00, needsInspection: false });
    await estimate(w, job, w.tradies.dana, { priceCents: 170_00, needsInspection: false });
    expect(await jobView(w, job)).toMatchObject({ decision: null, inspections: { visits: [], slots: [] } });
    const pete = await firmQuote(w, job, w.tradies.pete, { priceCents: 155_00 });
    await firmQuote(w, job, w.tradies.dana, { priceCents: 165_00 });

    await w.alice.chooseQuote(pete.quoteId);

    expect(await jobView(w, job)).toMatchObject({ status: 'approved' });
    expect((await w.alice.ticket(job.ticketId)).repairCostCents).toBe(155_00);
  });
});

describe('requirements 3 and 4: Estimates and Firm Quotes are apart, and a Firm Quote supersedes an Estimate', () => {
  test('the Firm Quote is a new Quote; the Estimate stays, marked superseded, and is never chosen', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    await estimate(w, job, w.tradies.pete, { priceCents: 150_00, needsInspection: false });
    const firm = await firmQuote(w, job, w.tradies.pete, { priceCents: 175_00, scopeOfWork: 'New mixer tap', durationDays: 1, availableTimes: [dateAhead(w, 2)] });

    const view = await jobView(w, job);
    const est = view.quotes.find((q) => q.stage === 'estimate')!;
    expect(est).toMatchObject({ priceCents: 150_00, status: 'superseded', supersededByQuoteId: firm.quoteId });
    expect(firm).toMatchObject({ stage: 'firm', priceCents: 175_00, scopeOfWork: 'New mixer tap', availableTimes: [dateAhead(w, 2)], supersedesQuoteId: est.quoteId });
    expect(view.quoteRequests[0]).toMatchObject({ status: 'firm_quoted', estimate: { quoteId: est.quoteId }, firmQuote: { quoteId: firm.quoteId } });
    await expect(w.alice.chooseQuote(est.quoteId, 'x')).rejects.toThrow(/An Estimate is not a Firm Quote/);
    // A routine Job with two confirmed Estimates needs Firm Quotes before choosing.
    // A second Firm Quote is refused; the first stands.
    await expect(firmQuote(w, job, w.tradies.pete, { priceCents: 160_00 })).rejects.toThrow(/already given a Firm Quote/);
  });

  test('a Firm Quote is checked field by field', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    const token = await quoteToken(w, job, w.tradies.pete);
    const valid = { priceCents: 175_00, scopeOfWork: 'New tap', durationDays: 1, availableTimes: [dateAhead(w, 2)] };
    await expect(w.h.app.submitFirmQuote(token, valid)).rejects.toThrow(/Estimate first/);
    await estimate(w, job, w.tradies.pete, { priceCents: 150_00, needsInspection: false });
    const fieldOf = async (input: Partial<typeof valid>) => {
      try {
        await w.h.app.submitFirmQuote(token, { ...valid, ...input });
      } catch (e) {
        return Object.keys((e as { fields: Record<string, string> }).fields);
      }
      throw new Error('accepted');
    };
    expect(await fieldOf({ priceCents: NaN })).toEqual(['price']);
    expect(await fieldOf({ scopeOfWork: '  ' })).toEqual(['scopeOfWork']);
    expect(await fieldOf({ durationDays: 0 })).toEqual(['durationDays']);
    expect(await fieldOf({ availableTimes: [] })).toEqual(['availableTimes']);
    expect(await fieldOf({ availableTimes: ['2020-01-01'] })).toEqual(['availableTimes']);
    expect(await fieldOf({ availableTimes: ['2026-02-30'] })).toEqual(['availableTimes']);
    expect(await fieldOf({ availableTimes: [dateAhead(w, 1), dateAhead(w, 2), dateAhead(w, 3), dateAhead(w, 4)] })).toEqual(['availableTimes']);
    await expect(w.h.app.submitFirmQuote('nope', valid)).rejects.toThrow(/not found/);
  });

  test("a Firm Quote keeps the Tradie's start times in the order they were entered, preferred first", async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    await estimate(w, job, w.tradies.pete, { priceCents: 150_00, needsInspection: false });
    // Later instant first: sorting by date would make the earlier backup the preferred time.
    const preferred = '2026-10-20T04:00:00.000Z';
    const backup = '2026-10-15T00:00:00.000Z';
    const firm = await firmQuote(w, job, w.tradies.pete, {
      priceCents: 175_00,
      availableTimes: [preferred, '  ', backup, preferred],
    });

    expect(firm.availableTimes).toEqual([preferred, backup]);
    expect((await w.h.app.quotePage(await quoteToken(w, job, w.tradies.pete)))!.firmQuote!.availableTimes).toEqual([preferred, backup]);

    await w.alice.chooseQuote(firm.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    expect((await jobView(w, job)).workOrder!.start).toBe(preferred);
  });

  test('an Estimate is checked too, and given once', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    const token = await quoteToken(w, job, w.tradies.pete);
    await expect(w.h.app.submitEstimate(token, { priceCents: 0, needsInspection: false })).rejects.toThrow(/Estimate in dollars/);
    await expect(w.h.app.submitEstimate(token, { priceCents: 100_00, needsInspection: false, proposedTime: '2020-01-01T00:00:00Z' })).rejects.toThrow(/future/);
    // A Call-out Fee only counts with an inspection.
    await w.h.app.submitEstimate(token, { priceCents: 100_00, needsInspection: false, calloutFeeCents: 50_00 });
    expect((await quoteRequestFor(w, job, w.tradies.pete)).estimate).toMatchObject({ calloutFeeCents: null });
    await expect(w.h.app.submitEstimate(token, { priceCents: 100_00, needsInspection: false })).rejects.toThrow(/already given an Estimate/);
  });

  test('a price by SMS after the Estimate is not a Firm Quote: the Tradie is sent their link and the message is left unread', async () => {
    const w = await world();
    const { h, tradies } = w;
    const job = await askPeteAndDana(w);
    await tradieQuotes(w, job, tradies.pete, '$150 Tuesday', { priceCents: 150_00 });
    await estimate(w, job, tradies.dana, { priceCents: 160_00, needsInspection: true });
    const dana = await quoteRequestFor(w, job, tradies.dana);
    const visitId = await w.alice.bookInspection(dana.quoteRequestId, { start: TUE_10AM.toISOString() });
    visitStarted(w, TUE_10AM);
    await w.alice.markInspected(visitId);
    h.messenger.clear();

    // Dana, inspected, texts a price: still waiting on her Firm Quote, so it is routed to her request.
    h.classifier.when('Had a look, $380 all up', { replyType: 'quote', relatedItem: `quote_request:${dana.quoteRequestId}` });
    await h.receive(tradies.dana.address, 'Had a look, $380 all up');

    expect(h.messenger.last(tradies.dana.address)).toMatchObject({ template: 'tradie.firm_quote_link', data: { quoteLink: expect.stringContaining('/q/') } });
    const view = await jobView(w, job);
    expect(view.quotes.filter((q) => q.stage === 'firm')).toEqual([]);
    expect(view.quotes).toHaveLength(2);
    const ticket = await w.alice.ticket(job.ticketId);
    expect(ticket.messages.find((m) => m.text === 'Had a look, $380 all up')).toMatchObject({ unread: true });
  });
});

describe('requirement 5: choosing a Firm Quote (always required)', () => {
  /** Quote Requests to Pete and Dana, both give routine Estimates (no Site Inspection needed). */
  async function routineEstimates(w: World) {
    const job = await tomsTapTicket(w);
    const [pete, dana] = await confirmedEstimates(w, job, [
      [w.tradies.pete, 120_00],
      [w.tradies.dana, 140_00],
    ]);
    return { job, pete: pete!, dana: dana! };
  }

  /** Gets Estimates without a Site Inspection, then Firm Quotes and chooses one. */
  async function routineFirmQuotes(w: World) {
    const { job } = await routineEstimates(w);
    const pete = await firmQuote(w, job, w.tradies.pete, { priceCents: 150_00, availableTimes: [dateAhead(w, 2) + 'T09:00:00.000Z'] });
    const dana = await firmQuote(w, job, w.tradies.dana, { priceCents: 145_00, availableTimes: [dateAhead(w, 3) + 'T10:00:00.000Z'] });
    return { job, pete, dana };
  }

  test('a routine Job gets Firm Quotes and one is chosen; the Repair Cost is the Firm Quote price, the others are told', async () => {
    const w = await world();
    const { job, pete } = await routineFirmQuotes(w);

    await w.alice.chooseQuote(pete.quoteId, 'Usual plumber');

    expect(await jobView(w, job)).toMatchObject({ status: 'approved' });
    const firm = (await jobView(w, job)).quotes.find((q) => q.quoteId === pete.quoteId)!;
    expect(firm).toMatchObject({ status: 'approved', priceCents: 150_00, stage: 'firm' });
    expect(firm.notToExceedCents).toBeNull();
    expect((await w.alice.ticket(job.ticketId)).repairCostCents).toBe(150_00);
    expect(w.h.messenger.last(w.tradies.dana.address)!.template).toBe('tradie.not_chosen');
    expect((await w.alice.ticket(job.ticketId)).timeline.find((e) => e.kind === 'quote_chosen')).toMatchObject({ priceCents: 150_00, tradie: "Pete's Plumbing" });
  });

  test('choosing an Estimate is refused: a Firm Quote is always required', async () => {
    const w = await world();
    const { job, pete } = await routineEstimates(w);

    await expect(w.alice.chooseQuote(pete.quoteId, 'x')).rejects.toThrow(/An Estimate is not a Firm Quote/);
    expect(await jobView(w, job)).toMatchObject({ status: 'quoting' });
  });

  test('an expensive Firm Quote goes to the Property Owner for approval', async () => {
    const w = await world();
    const { job } = await routineEstimates(w);
    const pete = await firmQuote(w, job, w.tradies.pete, { priceCents: 600_00, availableTimes: [dateAhead(w, 2) + 'T09:00:00.000Z'] });

    await w.alice.chooseQuote(pete.quoteId, 'Only Firm Quote in');

    expect(await jobView(w, job)).toMatchObject({ status: 'awaiting_owner' });
    expect(w.h.messenger.last('+61400000100')).toMatchObject({ template: 'owner.approval_request', data: { quotePriceCents: 600_00 } });
  });

  test('an Estimate needs at least a Site Inspection or a Firm Quote before it can be chosen', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    await estimate(w, job, w.tradies.pete, { priceCents: 120_00, needsInspection: true, calloutFeeCents: 60_00 });
    const quote = (await quoteRequestFor(w, job, w.tradies.pete)).estimate!;

    await expect(w.alice.chooseQuote(quote.quoteId, 'x')).rejects.toThrow(/An Estimate is not a Firm Quote/);
  });
});

describe('choosing ends every inspection on the Job', () => {
  test("approval cancels the other Tradies' inspections and frees their slots", async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    await estimate(w, job, w.tradies.pete, { priceCents: 150_00, needsInspection: false });
    await estimate(w, job, w.tradies.dana, { priceCents: 160_00, needsInspection: true });
    await w.alice.bookInspection((await quoteRequestFor(w, job, w.tradies.dana)).quoteRequestId, { start: WED_10AM.toISOString() });
    const pete = await firmQuote(w, job, w.tradies.pete, { priceCents: 155_00 });
    w.h.messenger.clear();

    await w.alice.chooseQuote(pete.quoteId, 'Dana is a week away');

    const view = await jobView(w, job);
    expect(view.status).toBe('approved');
    expect(view.inspections.visits).toEqual([]);
    expect(w.h.messenger.templatesTo(w.tradies.dana.address)).toEqual(['tradie.not_chosen']);
    expect(await w.alice.freeSlots(w.tradies.dana.id, { days: 7 })).toEqual(expect.arrayContaining([expect.objectContaining({ start: WED_10AM.toISOString() })]));
    expect(await w.h.app.quotePage(await quoteToken(w, job, w.tradies.dana))).toMatchObject({ outcome: 'not_chosen', next: 'done' });
    expect(await w.h.app.quotePage(await quoteToken(w, job, w.tradies.pete))).toMatchObject({ outcome: 'chosen' });
  });
});

describe('the Tenant', () => {
  test("is told each Tradie's inspection, can confirm it, and sees it on the tracker", async () => {
    const w = await world();
    const { h } = w;
    const job = await askPeteAndDana(w);
    const trackerLink = h.messenger.to(TOM).find((m) => m.template === 'tenant.confirmed')!.data.trackerLink as string;
    await estimate(w, job, w.tradies.dana, { priceCents: 160_00, needsInspection: true });
    await w.alice.bookInspection((await quoteRequestFor(w, job, w.tradies.dana)).quoteRequestId, { start: TUE_10AM.toISOString() });
    const text = h.messenger.last(TOM)!.text;
    expect(text).toMatch(/Drip Doctors \(plumbing\) will come to inspect/);
    const token = text.match(/\/v\/confirm\/([^?\s]+)/)?.[1];
    expect(text).toContain(`Confirm this time: https://myest8.test/v/confirm/${token}`);
    expect(text).toContain(`Need another time?: https://myest8.test/v/confirm/${token}?another=1`);
    expect(text).not.toMatch(/Reply YES/);

    await h.answer(TOM, 'Yes that works', 'confirm');
    expect((await quoteRequestFor(w, job, w.tradies.dana)).inspection).toMatchObject({ visitConfirmed: true });
    const tracker = await h.tracker(trackerLink);
    expect(tracker.stages.find((s) => s.stage === 'site_visit')).toMatchObject({ reached: true, visits: [{ tradie: 'Drip Doctors' }] });
  });

  test('need another time on a Site Inspection records a reschedule and does not ask the Tradie to offer times', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    await estimate(w, job, w.tradies.dana, { priceCents: 160_00, needsInspection: true });
    await w.alice.bookInspection((await quoteRequestFor(w, job, w.tradies.dana)).quoteRequestId, { start: TUE_10AM.toISOString() });
    const token = w.h.messenger.last(TOM)!.text.match(/\/v\/confirm\/([^?\s]+)/)![1]!;
    w.h.messenger.clear();

    await w.h.app.askToMoveVisit(token);

    expect((await quoteRequestFor(w, job, w.tradies.dana)).inspection).toMatchObject({ rescheduleRequestedBy: 'tenant', visitConfirmed: false, start: TUE_10AM.toISOString() });
    expect(w.h.messenger.last(w.tradies.dana.address)).toBeUndefined();
  });
});

describe('the Property Manager enters a Firm Quote the Tradie sent another way', () => {
  test('it is recorded like one from the quote page, marked as entered by the Property Manager, and checked the same way', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    await estimate(w, job, w.tradies.pete, { priceCents: 180_00, needsInspection: false });
    const pete = await quoteRequestFor(w, job, w.tradies.pete);

    await expect(w.alice.enterFirmQuote(pete.quoteRequestId, { priceCents: 190_00, scopeOfWork: ' ', durationDays: 1, availableTimes: [dateAhead(w, 2)] })).rejects.toThrow(/scope of work/);
    await w.alice.enterFirmQuote(pete.quoteRequestId, { priceCents: 190_00, scopeOfWork: 'Replace the cartridge', durationDays: 2, availableTimes: [dateAhead(w, 2), dateAhead(w, 3)] });

    const view = await jobView(w, job);
    expect(view.quoteRequests.find((r) => r.tradieId === w.tradies.pete.id)).toMatchObject({ status: 'firm_quoted', firmQuote: { priceCents: 190_00, durationDays: 2, confirmed: true } });
    expect(view.quotes.find((q) => q.stage === 'estimate' && q.tradieId === w.tradies.pete.id)).toMatchObject({ status: 'superseded' });
    expect((await w.alice.ticket(job.ticketId)).timeline.findLast((e) => e.kind === 'firm_quote_received')).toMatchObject({ enteredBy: 'property_manager', priceCents: 190_00 });
  });

  test("is refused for another Agency's Quote Request", async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    await estimate(w, job, w.tradies.pete, { priceCents: 180_00, needsInspection: false });
    const pete = await quoteRequestFor(w, job, w.tradies.pete);
    const other = await w.h.app.setup.createAgency({ name: 'Other Realty', timeZone: 'Australia/Sydney' });
    const olga = w.h.as(await w.h.app.setup.addPropertyManager(other, { name: 'Olga Other', email: 'olga@other.example', password: 'other-password' }));

    await expect(olga.enterFirmQuote(pete.quoteRequestId, { priceCents: 190_00, scopeOfWork: 'Replace the cartridge', durationDays: 1, availableTimes: [dateAhead(w, 2)] })).rejects.toThrow(/Quote Request/);
    expect((await quoteRequestFor(w, job, w.tradies.pete)).status).toBe('estimated');
  });
});

describe('the timeline records what happens to each Site Inspection', () => {
  test('an inspection still booked when another Quote is approved is cancelled, and the timeline says so', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    await estimate(w, job, w.tradies.pete, { priceCents: 120_00, needsInspection: false });
    await estimate(w, job, w.tradies.dana, { priceCents: 160_00, needsInspection: true });
    await w.alice.bookInspection((await quoteRequestFor(w, job, w.tradies.dana)).quoteRequestId, { start: TUE_10AM.toISOString() });
    const peteQuote = await firmQuote(w, job, w.tradies.pete, { priceCents: 150_00, availableTimes: [dateAhead(w, 2) + 'T09:00:00.000Z'] });
    await w.alice.chooseQuote(peteQuote.quoteId, 'Usual plumber');

    expect((await w.alice.ticket(job.ticketId)).timeline.findLast((e) => e.kind === 'inspection_cancelled')).toMatchObject({ tradie: 'Drip Doctors', visitStart: TUE_10AM.toISOString(), why: 'quote_approved' });
  });
});

describe("the Tenant's tracker", () => {
  test('a Site visit is done only once every inspection has happened, not when it is booked', async () => {
    const w = await world();
    const { h } = w;
    const job = await askPeteAndDana(w);
    const trackerLink = h.messenger.to(TOM).find((m) => m.template === 'tenant.confirmed')!.data.trackerLink as string;
    await estimate(w, job, w.tradies.dana, { priceCents: 160_00, needsInspection: true });
    const id = await w.alice.bookInspection((await quoteRequestFor(w, job, w.tradies.dana)).quoteRequestId, { start: TUE_10AM.toISOString() });

    const booked = (await h.tracker(trackerLink)).stages.find((s) => s.stage === 'site_visit');
    expect(booked).toMatchObject({ reached: true, done: false, visits: [{ tradie: 'Drip Doctors', visitStart: TUE_10AM.toISOString(), done: false }] });

    visitStarted(w, TUE_10AM);
    await w.alice.markInspected(id);

    const after = await h.tracker(trackerLink);
    expect(after.stages.find((s) => s.stage === 'site_visit')).toMatchObject({ reached: true, done: true, visits: [{ tradie: 'Drip Doctors', done: true }] });
    // Getting quotes goes on until a Quote is approved.
    expect(after.stages.find((s) => s.stage === 'getting_quotes')).toMatchObject({ reached: true, done: false });
  });
});

describe('a cancelled Site Inspection is told to the people expecting it', () => {
  /** Pete prices remotely and Dana needs an inspection, booked for Tuesday: the Tenant is asked to confirm it. */
  async function danaBooked(w: World) {
    const job = await askPeteAndDana(w);
    await estimate(w, job, w.tradies.pete, { priceCents: 150_00, needsInspection: false });
    await estimate(w, job, w.tradies.dana, { priceCents: 160_00, needsInspection: true });
    const visitId = await w.alice.bookInspection((await quoteRequestFor(w, job, w.tradies.dana)).quoteRequestId, { start: WED_10AM.toISOString() });
    return { job, visitId };
  }
  const pendingVisits = async (w: World) =>
    (await all<{ awaiting: string }>(w.h.db, `SELECT awaiting FROM pending_answers WHERE person_id = ? AND kind = 'visit'`, w.ids.tom)).map((r) => JSON.parse(r.awaiting));

  test('when another Quote is approved, the Tenant is told, stops being asked to confirm, and the Tradie hears it in one message', async () => {
    const w = await world();
    const { job, visitId } = await danaBooked(w);
    expect(await pendingVisits(w)).toEqual([{ kind: 'visit', workOrderId: visitId }]);
    const pete = await firmQuote(w, job, w.tradies.pete, { priceCents: 155_00 });
    w.h.messenger.clear();

    await w.alice.chooseQuote(pete.quoteId, 'Dana is a week away');

    expect(w.h.messenger.last(TOM)).toMatchObject({ template: 'tenant.inspection_cancelled', data: { tradieBusinessName: 'Drip Doctors', visitStart: WED_10AM.toISOString() } });
    expect(w.h.messenger.last(TOM)!.text).toMatch(/Drip Doctors won't be coming to inspect/);
    expect(await pendingVisits(w)).toEqual([]);
    // One message to Dana: not chosen, and her visit is off.
    expect(w.h.messenger.templatesTo(w.tradies.dana.address)).toEqual(['tradie.not_chosen']);
    expect(w.h.messenger.last(w.tradies.dana.address)!.text).toMatch(/Your Site Inspection on .* is cancelled/);
    expect(w.h.messenger.templatesTo(w.tradies.pete.address)).toEqual(['tradie.offer_times']);
  });

  test('when the Job is cancelled, the Tenant is told the Site Inspection is off and stops being asked to confirm it', async () => {
    const w = await world();
    const { job, visitId } = await danaBooked(w);
    expect(await pendingVisits(w)).toEqual([{ kind: 'visit', workOrderId: visitId }]);
    w.h.messenger.clear();

    await w.alice.cancelJob(job.jobId);

    expect(w.h.messenger.last(TOM)).toMatchObject({ template: 'tenant.inspection_cancelled', data: { tradieBusinessName: 'Drip Doctors', visitStart: WED_10AM.toISOString() } });
    expect(await pendingVisits(w)).toEqual([]);
    expect((await w.alice.ticket(job.ticketId)).timeline.findLast((e) => e.kind === 'inspection_cancelled')).toMatchObject({ tradie: 'Drip Doctors', why: 'job_cancelled' });
  });
});

describe('a price by message before a Firm Quote is allowed', () => {
  test('a price about a booked Site Inspection sends no Firm Quote link and is left unread', async () => {
    const w = await world();
    const { h, tradies } = w;
    const job = await askPeteAndDana(w);
    await estimate(w, job, tradies.dana, { priceCents: 160_00, needsInspection: true });
    const visitId = await w.alice.bookInspection((await quoteRequestFor(w, job, tradies.dana)).quoteRequestId, { start: TUE_10AM.toISOString() });
    h.messenger.clear();

    h.classifier.when('Will be about $380', { replyType: 'quote', relatedItem: `work_order:${visitId}` });
    await h.receive(tradies.dana.address, 'Will be about $380');

    expect(h.messenger.templatesTo(tradies.dana.address)).toEqual([]);
    expect((await w.alice.ticket(job.ticketId)).messages.find((m) => m.text === 'Will be about $380')).toMatchObject({ unread: true });
    expect((await jobView(w, job)).quotes.filter((q) => q.stage === 'firm')).toEqual([]);
  });
});

describe('confirming is for unconfirmed Estimates read from a message', () => {
  test('a Firm Quote is binding and is never rewritten, and an Estimate typed on the quote page is already confirmed', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    await estimate(w, job, w.tradies.pete, { priceCents: 150_00, needsInspection: false });
    const typed = (await quoteRequestFor(w, job, w.tradies.pete)).estimate!;
    await expect(w.alice.confirmQuote(typed.quoteId, { priceCents: 99_00 })).rejects.toThrow(/already confirmed/);
    const pete = await firmQuote(w, job, w.tradies.pete, { priceCents: 155_00 });

    await expect(w.alice.confirmQuote(pete.quoteId, { priceCents: 99_00 })).rejects.toThrow(/Firm Quote is binding/);
    expect((await jobView(w, job)).quotes.find((q) => q.quoteId === pete.quoteId)).toMatchObject({ priceCents: 155_00 });
  });
});

describe('amounts are checked for size', () => {
  test('an absurd Estimate, Firm Quote, Call-out Fee, confirmed price or cap is refused by its field', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    const token = await quoteToken(w, job, w.tradies.pete);
    const huge = 1e20;
    await expect(w.h.app.submitEstimate(token, { priceCents: huge, needsInspection: false })).rejects.toMatchObject({ fields: { price: expect.stringMatching(/\$1,000,000/) } });
    await expect(w.h.app.submitEstimate(token, { priceCents: 100_00, needsInspection: true, calloutFeeCents: huge })).rejects.toMatchObject({ fields: { calloutFee: expect.any(String) } });
    await estimate(w, job, w.tradies.pete, { priceCents: 150_00, needsInspection: false });
    await expect(firmQuote(w, job, w.tradies.pete, { priceCents: huge })).rejects.toMatchObject({ fields: { price: expect.any(String) } });

    await tradieQuotes(w, job, w.tradies.dana, '$140', { priceCents: 140_00 });
    const dana = (await quoteRequestFor(w, job, w.tradies.dana)).estimate!;
    await expect(w.alice.confirmQuote(dana.quoteId, { priceCents: huge })).rejects.toThrow(/\$1,000,000/);
    await w.alice.confirmQuote(dana.quoteId);
  });

  test('a refused Firm Quote leaves no PDF behind', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    const files = async () => (await one<{ n: number }>(w.h.db, 'SELECT count(*) AS n FROM files'))!.n;
    const before = await files();
    const pdf = { filename: 'quote.pdf', contentType: 'application/pdf', content: new Uint8Array([37, 80, 68, 70]) };

    // Before the Estimate, and then with a bad price.
    await expect(
      w.h.app.submitFirmQuote(await quoteToken(w, job, w.tradies.pete), { priceCents: 200_00, scopeOfWork: 'New tap', durationDays: 1, availableTimes: [dateAhead(w, 2)], pdf }),
    ).rejects.toThrow(/Estimate first/);
    await estimate(w, job, w.tradies.dana, { priceCents: 160_00, needsInspection: true });
    await expect(
      w.h.app.submitFirmQuote(await quoteToken(w, job, w.tradies.dana), { priceCents: 200_00, scopeOfWork: 'New tap', durationDays: 1, availableTimes: [dateAhead(w, 2)], pdf }),
    ).rejects.toThrow(/Site Inspection comes first/);

    expect(await files()).toBe(before);
  });
});

describe("the Tradie's quote page while the Property Owner decides", () => {
  test('the Tradie whose quote is with the Owner is told so, and the others that the request is still open', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    await estimate(w, job, w.tradies.pete, { priceCents: 600_00, needsInspection: false });
    await estimate(w, job, w.tradies.dana, { priceCents: 700_00, needsInspection: false });
    const pete = await firmQuote(w, job, w.tradies.pete, { priceCents: 650_00 });

    await w.alice.chooseQuote(pete.quoteId, 'Dana is a week away');

    expect(await jobView(w, job)).toMatchObject({ status: 'awaiting_owner' });
    expect(await w.h.app.quotePage(await quoteToken(w, job, w.tradies.pete))).toMatchObject({ outcome: 'with_owner', next: 'done' });
    expect(await w.h.app.quotePage(await quoteToken(w, job, w.tradies.dana))).toMatchObject({ outcome: 'on_hold', next: 'done' });
  });

  test("the Property Owner's NO declines the chosen Firm Quote", async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const [pete] = await confirmedEstimates(w, job, [
      [w.tradies.pete, 120_00],
      [w.tradies.dana, 140_00],
    ]);
    const peteQuote = await firmQuote(w, job, w.tradies.pete, { priceCents: 600_00, availableTimes: [dateAhead(w, 2) + 'T09:00:00.000Z'] });
    await w.alice.chooseQuote(peteQuote.quoteId, 'Only Firm Quote in');
    const { approval } = await jobView(w, job);
    w.h.classifier.when('No thanks', { replyType: 'approval_answer', answer: 'no', relatedItem: `approval:${approval!.approvalId}` });

    await w.h.receive('+61400000100', 'No thanks');

    expect((await jobView(w, job)).quotes.find((q) => q.quoteId === peteQuote.quoteId)).toMatchObject({ status: 'declined_by_owner' });
    expect((await w.alice.ticket(job.ticketId)).timeline.findLast((e) => e.kind === 'owner_declined')).toMatchObject({ priceCents: 600_00 });
  });
});

describe('the Tenant tracker ignores Site Inspection moves', () => {
  test('a legacy Site Quote visit moved is not the repair visit', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const trackerLink = w.h.messenger.to(TOM).find((m) => m.template === 'tenant.confirmed')!.data.trackerLink as string;
    await run(w.h.db, 'INSERT INTO timeline (ticket_id, kind, data, at) VALUES (?, ?, ?, ?)', job.ticketId, 'visit_moved', JSON.stringify({ jobId: job.jobId, visitStart: TUE_10AM.toISOString(), siteQuote: true }), w.h.clock.now().toISOString());

    const booked = (await w.h.tracker(trackerLink)).stages.find((s) => s.stage === 'booked');
    expect(booked).not.toMatchObject({ visitStart: TUE_10AM.toISOString() });
  });
});

describe('recommendations compare Firm Quotes only', () => {
  test("a Tradie's median previous Quote leaves their Estimates out", async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    await estimate(w, job, w.tradies.pete, { priceCents: 100_00, needsInspection: false });
    const pete = () => w.alice.ticket(job.ticketId).then((t) => t.jobs[0]!.recommendations.find((r) => r.tradieId === w.tradies.pete.id)!);
    expect(await pete()).toMatchObject({ medianQuoteCents: null });

    await firmQuote(w, job, w.tradies.pete, { priceCents: 180_00 });

    expect(await pete()).toMatchObject({ medianQuoteCents: 180_00 });
  });
});
