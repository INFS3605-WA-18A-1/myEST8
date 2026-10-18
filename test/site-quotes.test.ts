import { describe, expect, test } from 'vitest';
import { HOUR } from './support/harness.ts';
import { confirmedQuotes, jobView, quoteRequestFor, TOM, tomsTapTicket, world, type JobRef, type World } from './support/world.ts';

const sydney = (local: string) => new Date(`${local}+11:00`);
const TUE_10AM = sydney('2026-10-13T10:00:00');
const WED_10AM = sydney('2026-10-14T10:00:00');

/** Tom's tap becomes a High Ticket with Pete's and Dana's Quotes confirmed. */
async function highJobWithTwoQuotes(w: World) {
  const job = await tomsTapTicket(w);
  await w.alice.changeUrgency({ ticketId: job.ticketId }, 'high');
  const quotes = await confirmedQuotes(w, job, [
    [w.tradies.pete, 300_00],
    [w.tradies.dana, 340_00],
  ]);
  return { job, quotes };
}

async function bookBoth(w: World, job: JobRef) {
  await w.alice.bookSiteQuotes(job.jobId, [
    { tradieId: w.tradies.pete.id, start: TUE_10AM.toISOString() },
    { tradieId: w.tradies.dana.id, start: WED_10AM.toISOString() },
  ]);
}

describe('the High gate', () => {
  test('two confirmed Quotes on a High Ticket lead with Book site quotes; a Routine Ticket goes straight to choosing', async () => {
    const w = await world();
    const { job } = await highJobWithTwoQuotes(w);
    expect(await jobView(w, job)).toMatchObject({ decision: 'book_site_quotes', siteQuotes: { canBook: true } });
    const ticket = (await w.alice.dashboard()).tickets.find((t) => t.ticketId === job.ticketId);
    expect(ticket).toMatchObject({ decision: 'book_site_quotes', stage: 'quoting' });

    await w.alice.skipSiteQuotes(job.jobId);
    expect(await jobView(w, job)).toMatchObject({ status: 'quoting', decision: 'choose_quote', siteQuotes: { skipped: true } });
    expect((await w.alice.ticket(job.ticketId)).timeline.map((e) => e.kind)).toContain('site_quotes_skipped');

    const w2 = await world();
    const routine = await tomsTapTicket(w2);
    await confirmedQuotes(w2, routine, [
      [w2.tradies.pete, 300_00],
      [w2.tradies.dana, 340_00],
    ]);
    expect(await jobView(w2, routine)).toMatchObject({ decision: 'choose_quote' });
  });

  test('one confirmed Quote is not enough to prompt', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    await w.alice.changeUrgency({ ticketId: job.ticketId }, 'high');
    await confirmedQuotes(w, job, [[w.tradies.pete, 300_00]]);
    expect((await jobView(w, job)).decision).toBeNull();
  });
});

describe('booking Site Quotes', () => {
  test('creates site_quote Work Orders, moves the Job to site_quoting, and tells the Tradies and the Tenant', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const { job } = await highJobWithTwoQuotes(w);
    const trackerLink = h.messenger.to(TOM).find((m) => m.template === 'tenant.confirmed')!.data.trackerLink as string;
    h.messenger.clear();

    await bookBoth(w, job);

    const view = await jobView(w, job);
    expect(view).toMatchObject({
      status: 'site_quoting',
      workOrder: null,
      siteQuotes: { booked: true, openVisits: 2, visits: [{ kind: 'site_quote', businessName: "Pete's Plumbing" }, { kind: 'site_quote', businessName: 'Drip Doctors' }] },
    });
    expect(h.messenger.last(tradies.pete.address)).toMatchObject({
      template: 'tradie.site_quote',
      data: { propertyAddress: expect.stringContaining('King St'), trade: 'plumbing', visitStart: TUE_10AM.toISOString() },
    });
    expect(h.messenger.last(tradies.dana.address)!.template).toBe('tradie.site_quote');
    expect(h.messenger.last(TOM)).toMatchObject({ template: 'tenant.site_quotes' });
    expect(h.messenger.last(TOM)!.text).toMatch(/2 tradies will come to look and quote/);
    expect((await alice.ticket(job.ticketId)).timeline.map((e) => e.kind)).toContain('site_quotes_booked');

    // On the shared calendar, and the Tradie is busy then.
    const calendar = await alice.calendar({ from: TUE_10AM.toISOString(), to: WED_10AM.toISOString() });
    expect(calendar).toMatchObject([{ kind: 'site_quote', businessName: "Pete's Plumbing" }]);
    await expect(
      alice.bookSiteQuotes(job.jobId, [{ tradieId: tradies.pete.id, start: TUE_10AM.toISOString() }]),
    ).rejects.toThrow(/already/);

    // The tracker shows the visits.
    const tracker = await h.tracker(trackerLink);
    expect(tracker.stages.find((s) => s.stage === 'site_visit')).toMatchObject({
      reached: true,
      visits: [{ tradie: "Pete's Plumbing" }, { tradie: 'Drip Doctors' }],
    });
  });

  test('needs a confirmed Quote and a free slot', async () => {
    const w = await world();
    const { alice, tradies } = w;
    const { job } = await highJobWithTwoQuotes(w);
    await expect(alice.bookSiteQuotes(job.jobId, [{ tradieId: tradies.finn.id, start: TUE_10AM.toISOString() }])).rejects.toThrow(/no confirmed Quote/);
    await expect(alice.bookSiteQuotes(job.jobId, [])).rejects.toThrow(/at least one/);
    await expect(alice.bookSiteQuotes(job.jobId, [{ tradieId: tradies.pete.id, start: '2020-01-01T09:00:00Z' }])).rejects.toThrow(/future/);
  });

  test('siteQuoteSlots offers up to three free hour-long slots per quoted Tradie', async () => {
    const w = await world();
    const { job } = await highJobWithTwoQuotes(w);
    const slots = await w.alice.siteQuoteSlots(job.jobId);
    expect(slots.map((s) => s.businessName)).toEqual(["Pete's Plumbing", 'Drip Doctors']);
    for (const s of slots) {
      expect(s.slots).toHaveLength(3);
      expect(Date.parse(s.slots[0]!.end) - Date.parse(s.slots[0]!.start)).toBe(HOUR);
    }
  });
});

describe('after the visits', () => {
  async function booked() {
    const w = await world();
    const ctx = await highJobWithTwoQuotes(w);
    await bookBoth(w, ctx.job);
    return { w, ...ctx };
  }

  test("a Tradie's price revises their Quote, keeping the initial price and time, and it must be confirmed again", async () => {
    const { w, job } = await booked();
    const { h, alice, tradies } = w;
    const request = await quoteRequestFor(w, job, tradies.pete);
    h.classifier.when('Revised price after the visit $380', { replyType: 'quote', relatedItem: `quote_request:${request.quoteRequestId}` });
    h.quoteReader.when('Revised price after the visit $380', { priceCents: 380_00 });
    await h.receive(tradies.pete.address, 'Revised price after the visit $380');

    const view = await jobView(w, job);
    const pete = view.quotes.find((q) => q.tradieId === tradies.pete.id)!;
    expect(pete).toMatchObject({ priceCents: 380_00, initialPriceCents: 300_00, confirmed: false });
    expect(pete.revisedAt).not.toBeNull();
    expect(view.quotes).toHaveLength(2);
    expect((await quoteRequestFor(w, job, tradies.pete)).status).toBe('quoted');
    expect(view.decision).toBe('check_quotes');
    expect((await alice.ticket(job.ticketId)).timeline.find((e) => e.kind === 'quote_revised')).toMatchObject({ fromCents: 300_00, toCents: 380_00 });

    // A second revision keeps the first initial price.
    await alice.confirmQuote(pete.quoteId);
    h.classifier.when('Final price $400', { replyType: 'quote', relatedItem: `quote_request:${request.quoteRequestId}` });
    h.quoteReader.when('Final price $400', { priceCents: 400_00 });
    await h.receive(tradies.pete.address, 'Final price $400');
    expect((await jobView(w, job)).quotes.find((q) => q.tradieId === tradies.pete.id)).toMatchObject({ priceCents: 400_00, initialPriceCents: 300_00 });
  });

  test('DONE on a Site Quote visit marks the visit done, not the Job, and a reminder follows if no revised price arrives', async () => {
    const { w, job } = await booked();
    const { h, tradies } = w;
    const visit = (await jobView(w, job)).siteQuotes.visits.find((v) => v.tradieId === tradies.pete.id)!;
    h.classifier.when('Been, my price stands', { replyType: 'done', relatedItem: `work_order:${visit.workOrderId}` });
    await h.receive(tradies.pete.address, 'Been, my price stands');

    expect(await jobView(w, job)).toMatchObject({ status: 'site_quoting', siteQuotes: { openVisits: 1 } });
    expect((await jobView(w, job)).siteQuotes.visits.find((v) => v.tradieId === tradies.pete.id)!.status).toBe('done');
    expect((await w.alice.ticket(job.ticketId)).timeline.map((e) => e.kind)).toContain('site_quote_done');
    expect(h.messenger.templatesTo(tradies.pete.address)).not.toContain('tradie.site_quote_reminder');

    await h.advance(49 * HOUR);
    expect(h.messenger.last(tradies.pete.address)).toMatchObject({ template: 'tradie.site_quote_reminder', data: { trade: 'plumbing' } });
  });

  test('the Property Manager marks visits done, and choosing is then offered', async () => {
    const { w, job } = await booked();
    const { alice } = w;
    expect((await jobView(w, job)).decision).toBeNull();

    for (const visit of (await jobView(w, job)).siteQuotes.visits) await alice.markSiteQuoteDone(visit.workOrderId);

    expect(await jobView(w, job)).toMatchObject({ status: 'site_quoting', decision: 'choose_quote' });
  });

  test('marking the Quotes final cancels remaining visits, tells the Tradies and returns the Job to quoting', async () => {
    const { w, job } = await booked();
    const { h, alice, tradies } = w;
    const [first] = (await jobView(w, job)).siteQuotes.visits;
    await alice.markSiteQuoteDone(first!.workOrderId);
    h.messenger.clear();

    await alice.markQuotesFinal(job.jobId);

    expect(await jobView(w, job)).toMatchObject({ status: 'quoting', siteQuotes: { openVisits: 0 }, decision: 'choose_quote' });
    expect(h.messenger.templatesTo(tradies.dana.address)).toEqual(['tradie.site_quote_cancelled']);
    expect(h.messenger.templatesTo(tradies.pete.address)).toEqual([]);
    expect((await jobView(w, job)).siteQuotes.visits.map((v) => v.status)).toEqual(['done']);
    await expect(alice.markQuotesFinal(job.jobId)).rejects.toThrow(/not getting Site Quotes/);
  });

  test("choosing a Quote cancels the other Tradies' visits and tells them", async () => {
    const { w, job, quotes } = await booked();
    const { h, alice, tradies } = w;
    h.messenger.clear();

    await alice.chooseQuote(quotes.find((q) => q.tradieId === tradies.pete.id)!.quoteId);

    const view = await jobView(w, job);
    expect(view.status).toBe('approved');
    expect(view.siteQuotes.visits.map((v) => [v.businessName, v.status])).toEqual([["Pete's Plumbing", 'active']]);
    expect(h.messenger.templatesTo(tradies.dana.address)).toEqual(['tradie.not_chosen']);
    // The cancelled slot is free again.
    expect(await w.h.app.asPropertyManager(w.ids.aliceId).then((a) => a.freeSlots(tradies.dana.id, { days: 7 }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ start: WED_10AM.toISOString() })]),
    );
  });
});
