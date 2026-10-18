import { describe, expect, test } from 'vitest';
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

    // DONE after the visit: the Tradie is asked for the Firm Quote with their link, and reminded after 48 hours.
    h.classifier.when('Been and had a look', { replyType: 'done', relatedItem: `work_order:${view.inspections.visits[0]!.workOrderId}` });
    await h.receive(tradies.dana.address, 'Been and had a look');
    expect(await quoteRequestFor(w, job, tradies.dana)).toMatchObject({ status: 'inspected', inspection: { status: 'done' } });
    expect(h.messenger.last(tradies.dana.address)).toMatchObject({ template: 'tradie.firm_quote_request', data: { quoteLink: expect.stringContaining('/q/') } });
    await h.advance(49 * HOUR);
    expect(h.messenger.last(tradies.dana.address)!.template).toBe('tradie.firm_quote_reminder');

    const dana = await firmQuote(w, job, tradies.dana, { priceCents: 420_00, durationDays: 2, availableDates: [dateAhead(w, 3), dateAhead(w, 4)] });
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
    const firm = await firmQuote(w, job, w.tradies.pete, { priceCents: 175_00, scopeOfWork: 'New mixer tap', durationDays: 1, availableDates: [dateAhead(w, 2)] });

    const view = await jobView(w, job);
    const est = view.quotes.find((q) => q.stage === 'estimate')!;
    expect(est).toMatchObject({ priceCents: 150_00, status: 'superseded', supersededByQuoteId: firm.quoteId });
    expect(firm).toMatchObject({ stage: 'firm', priceCents: 175_00, scopeOfWork: 'New mixer tap', availableDates: [dateAhead(w, 2)], supersedesQuoteId: est.quoteId });
    expect(view.quoteRequests[0]).toMatchObject({ status: 'firm_quoted', estimate: { quoteId: est.quoteId }, firmQuote: { quoteId: firm.quoteId } });
    await expect(w.alice.chooseQuote(est.quoteId, 'x')).rejects.toThrow(/An Estimate is not a Firm Quote/);
    await expect(w.alice.proceedOnEstimate(est.quoteId, { capCents: 200_00, reason: 'x' })).rejects.toThrow(/no longer/);
    // A second Firm Quote is refused; the first stands.
    await expect(firmQuote(w, job, w.tradies.pete, { priceCents: 160_00 })).rejects.toThrow(/already given a Firm Quote/);
  });

  test('a Firm Quote is checked field by field', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    const token = await quoteToken(w, job, w.tradies.pete);
    const valid = { priceCents: 175_00, scopeOfWork: 'New tap', durationDays: 1, availableDates: [dateAhead(w, 2)] };
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
    expect(await fieldOf({ availableDates: [] })).toEqual(['availableDates']);
    expect(await fieldOf({ availableDates: ['2020-01-01'] })).toEqual(['availableDates']);
    expect(await fieldOf({ availableDates: ['2026-02-30'] })).toEqual(['availableDates']);
    expect(await fieldOf({ availableDates: [dateAhead(w, 1), dateAhead(w, 2), dateAhead(w, 3), dateAhead(w, 4)] })).toEqual(['availableDates']);
    await expect(w.h.app.submitFirmQuote('nope', valid)).rejects.toThrow(/not found/);
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

describe('requirement 5: proceeding on an Estimate with a Not-to-exceed Cap', () => {
  async function routineEstimates(w: World) {
    const job = await tomsTapTicket(w);
    const [pete, dana] = await confirmedEstimates(w, job, [
      [w.tradies.pete, 120_00],
      [w.tradies.dana, 140_00],
    ]);
    return { job, pete: pete!, dana: dana! };
  }

  test('a routine Job goes ahead on an Estimate; the cap counts towards the Repair Cost and the others are told', async () => {
    const w = await world();
    const { job, pete } = await routineEstimates(w);
    expect((await quoteRequestFor(w, job, w.tradies.pete)).canProceedOnEstimate).toBe(true);

    await w.alice.proceedOnEstimate(pete.quoteId, { capCents: 150_00 });

    expect(await jobView(w, job)).toMatchObject({ status: 'approved' });
    expect((await jobView(w, job)).quotes.find((q) => q.quoteId === pete.quoteId)).toMatchObject({ status: 'approved', notToExceedCents: 150_00, priceCents: 120_00 });
    expect((await w.alice.ticket(job.ticketId)).repairCostCents).toBe(150_00);
    expect(w.h.messenger.last(w.tradies.dana.address)!.template).toBe('tradie.not_chosen');
    expect((await w.alice.ticket(job.ticketId)).timeline.find((e) => e.kind === 'proceeded_on_estimate')).toMatchObject({ priceCents: 120_00, capCents: 150_00 });
  });

  test('a cap over the Max Repair Cost goes to the Property Owner', async () => {
    const w = await world();
    const { job, pete } = await routineEstimates(w);
    await w.alice.proceedOnEstimate(pete.quoteId, { capCents: 600_00 });
    expect(await jobView(w, job)).toMatchObject({ status: 'awaiting_owner' });
    expect(w.h.messenger.last('+61400000100')).toMatchObject({ template: 'owner.approval_request', data: { quotePriceCents: 600_00 } });
  });

  test('refused below the Estimate, when the Tradie needs an inspection, on a High Ticket without confirm, and with one Estimate and no reason', async () => {
    const w = await world();
    const { job, pete } = await routineEstimates(w);
    await expect(w.alice.proceedOnEstimate(pete.quoteId, { capCents: 100_00 })).rejects.toThrow(/can't be below the Estimate of \$120\.00/);

    const peteRequest = await quoteRequestFor(w, job, w.tradies.pete);
    await w.alice.setInspectionNeeded(peteRequest.quoteRequestId, true);
    await expect(w.alice.proceedOnEstimate(pete.quoteId, { capCents: 150_00 })).rejects.toThrow(/needs a Site Inspection/);
    expect((await quoteRequestFor(w, job, w.tradies.pete)).canProceedOnEstimate).toBe(false);
    await w.alice.setInspectionNeeded(peteRequest.quoteRequestId, false);

    await w.alice.changeUrgency({ ticketId: job.ticketId }, 'high');
    await expect(w.alice.proceedOnEstimate(pete.quoteId, { capCents: 150_00 })).rejects.toThrow(/for Routine Jobs/);
    await w.alice.proceedOnEstimate(pete.quoteId, { capCents: 150_00, confirm: true });
    expect(await jobView(w, job)).toMatchObject({ status: 'approved' });

    const w2 = await world();
    const lone = await tomsTapTicket(w2);
    const [only] = await confirmedEstimates(w2, lone, [[w2.tradies.pete, 120_00]]);
    await expect(w2.alice.proceedOnEstimate(only!.quoteId, { capCents: 150_00 })).rejects.toThrow(/at least two/);
    await w2.alice.proceedOnEstimate(only!.quoteId, { capCents: 150_00, reason: 'Small job, usual plumber' });
    expect(await jobView(w2, lone)).toMatchObject({ status: 'approved', quotes: [{ reason: 'Small job, usual plumber' }] });
  });

  test('a Tradie who asked to inspect is never proceeded on', async () => {
    const w = await world();
    const job = await askPeteAndDana(w);
    await estimate(w, job, w.tradies.pete, { priceCents: 120_00, needsInspection: true, calloutFeeCents: 60_00 });
    const quote = (await quoteRequestFor(w, job, w.tradies.pete)).estimate!;
    await expect(w.alice.proceedOnEstimate(quote.quoteId, { capCents: 150_00, reason: 'x' })).rejects.toThrow(/needs a Site Inspection/);
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
    expect(h.messenger.last(TOM)!.text).toMatch(/Drip Doctors \(plumbing\) will come to inspect/);

    await h.answer(TOM, 'Yes that works', 'confirm');
    expect((await quoteRequestFor(w, job, w.tradies.dana)).inspection).toMatchObject({ visitConfirmed: true });
    const tracker = await h.tracker(trackerLink);
    expect(tracker.stages.find((s) => s.stage === 'site_visit')).toMatchObject({ reached: true, visits: [{ tradie: 'Drip Doctors' }] });
  });
});
