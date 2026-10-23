import { describe, expect, test } from 'vitest';
import { confirmedQuotes, jobView, KING_ST, NINA, PETE, QUICK_PIPES, TOM, tomsTapTicket, visitStarted, world } from './support/world.ts';
import { AGENCY_NUMBER } from './support/harness.ts';

// Nina's Plumbing is a plumber, and one of the two Nominated Tradies of King St.

describe('removing a Tradie', () => {
  test('stamps when they left, and takes them out of the lists, the recommendations, Dispatch and Nominated Tradies', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const nina = w.tradies.nina.id;
    const tradieIds = async () => ({
      people: (await w.alice.people('tradie')).map((t) => t.id),
      directory: (await w.alice.tradieDirectory()).map((t) => t.tradieId),
      dispatch: (await w.alice.dispatch()).tradies.map((t) => t.tradieId),
      recommended: (await jobView(w, job)).recommendations.map((r) => r.tradieId),
      nominated: (await w.alice.property(w.ids.kingSt)).nominatedTradies.map((t) => t.tradieId),
    });
    const before = await tradieIds();
    for (const ids of Object.values(before)) expect(ids).toContain(nina);
    expect(before.nominated).toEqual([nina, w.ids.sam]);

    expect(await w.alice.removeTradie(nina)).toBe("Nina's Plumbing");

    const after = await tradieIds();
    for (const ids of Object.values(after)) expect(ids).not.toContain(nina);
    expect(after.nominated).toEqual([w.ids.sam]);
    // The other Tradies stay: four plumbers are left to recommend.
    expect(after.recommended).toHaveLength(4);
    expect(after.people).toHaveLength(5);
    // Tom's Ticket took two days from 9:00 am on Thursday 8 October, so 9:00 am on Saturday 10 October in Sydney.
    expect(await w.alice.tradie(nina)).toMatchObject({ businessName: "Nina's Plumbing", removedAt: '2026-10-09T22:00:00.000Z' });
  });

  test('keeps their past Quotes and ratings on the Ticket and on their own profile', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, new Date('2026-10-13T09:00:00+11:00')]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    const { workOrder } = await jobView(w, job);
    w.h.classifier.when('All done', { replyType: 'done', relatedItem: `work_order:${workOrder!.workOrderId}` });
    visitStarted(w, workOrder!.start);
    await w.h.receive(PETE, 'All done');
    await w.alice.rateTradie(job.jobId, 3);
    await w.h.answer(TOM, '5', '5');

    expect(await w.alice.removeTradie(w.ids.pete)).toBe("Pete's Plumbing");

    const quotes = (await jobView(w, job)).quotes;
    expect(quotes.find((q) => q.tradieId === w.ids.pete && q.stage === 'firm')).toMatchObject({ businessName: "Pete's Plumbing", priceCents: 150_00, status: 'approved' });
    const profile = await w.alice.tradie(w.ids.pete);
    expect(profile.previousQuotes).toMatchObject([{ ticketId: job.ticketId, priceCents: 150_00, outcome: 'chosen' }]);
    expect(profile.ratings.map((r) => [r.source, r.score])).toEqual([['property_manager', 3], ['tenant', 5]]);
    // Starting rating 4, with the 3 and the 5.
    expect(profile.myEst8Rating).toEqual({ average: 4, count: 3 });
  });
});

describe('after a Tradie is removed', () => {
  test("their mobile and email no longer reach the Agency as them, and can be given to someone else", async () => {
    const w = await world();
    await w.alice.removeTradie(w.ids.nina);
    await w.alice.removeTradie(w.ids.quick);

    await w.h.receive(NINA, 'Can I get paid for last week?');
    await w.h.receive(QUICK_PIPES, 'Sorry, we cannot take that job');

    const inbox = (await w.alice.dashboard()).inbox;
    expect(inbox).toMatchObject([
      { reason: 'unknown_sender', from: NINA, personName: null },
      { reason: 'unknown_sender', from: QUICK_PIPES, personName: null },
    ]);
    expect(w.h.messenger.sent).toEqual([]);

    await w.alice.addTradie({ name: 'Nick Nguyen', businessName: 'Nick Nguyen Plumbing', mobile: NINA, trades: ['plumbing'], startingRating: 3, notOnGoogle: true });
  });
});

describe('a removed Tradie is not offered or placed', () => {
  test('a stale Ask for Quotes form that still ticks them is refused', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    await w.alice.removeTradie(w.ids.nina);

    await expect(w.alice.sendQuoteRequests(job.jobId, [w.ids.nina, w.ids.pete])).rejects.toThrow("Nina's Plumbing has been removed from the Agency");
    expect((await jobView(w, job)).quoteRequests).toEqual([]);
  });

  test('with SMS off, a removed Tradie is still refused, while one nobody can reach is skipped', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    await w.alice.disconnectServerSms(AGENCY_NUMBER);
    await w.alice.removeTradie(w.ids.nina);

    await expect(w.alice.sendQuoteRequests(job.jobId, [w.ids.nina, w.ids.quick])).rejects.toThrow("Nina's Plumbing has been removed from the Agency");
    expect(await w.alice.sendQuoteRequests(job.jobId, [w.ids.pete, w.ids.quick])).toMatchObject({ sent: 1, unreached: [{ tradie: "Pete's Plumbing" }] });
  });

  test("the map's lookup of missing addresses skips them", async () => {
    const w = await world();
    for (const id of [w.ids.nina, w.ids.pete]) await w.alice.setTradieAddress(id, `${id} Depot Rd, Marrickville NSW 2204`);
    await w.alice.removeTradie(w.ids.nina);
    for (const id of [w.ids.nina, w.ids.pete]) w.h.geocoder.locations.set(`${id} Depot Rd, Marrickville NSW 2204`, { lat: -33.906, lng: 151.158 });

    expect(await w.alice.geocodeMissing()).toBe(1);
    expect((await w.alice.tradie(w.ids.pete)).located).toBe(true);
    expect((await w.alice.tradie(w.ids.nina)).located).toBe(false);
  });
});

describe('importing Tradies after one is removed', () => {
  const sheet = (rows: string) => ({ filename: 'tradies.csv', contentType: 'text/csv', content: new TextEncoder().encode(`Company,Contact,Mobile,Services\n${rows}`) });

  test('a sheet row for a removed Tradie is a new Tradie, while one for a current Tradie is a duplicate', async () => {
    const w = await world();
    await w.alice.removeTradie(w.ids.nina);
    const { token } = await w.alice.importSheet(
      'tradies',
      sheet(`Nina's Plumbing,Nina Nguyen,${NINA},Plumber\nPete's Plumbing,Pete Park,0412 000 009,Plumber\n`),
    );

    const [nina, pete] = (await w.alice.importPreview(token)).rows;
    expect(nina).toMatchObject({ status: 'ready', included: true });
    expect(pete).toMatchObject({ status: 'duplicate', duplicateOf: "Pete's Plumbing" });
    expect(await w.alice.confirmImport(token, {})).toMatchObject({ added: 1 });
    const ninas = (await w.alice.people('tradie')).filter((t) => t.businessName === "Nina's Plumbing");
    expect(ninas).toMatchObject([{ mobile: NINA }]);
    expect(ninas[0]!.id).not.toBe(w.ids.nina);
  });
});

describe('removing a Tradie with work in progress', () => {
  const TUE_9AM = new Date('2026-10-13T09:00:00+11:00');

  /** What the refusal says. */
  async function refusal(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('Expected the action to be refused');
  }

  test('is refused while they have an open Quote Request, and allowed once the Job is cancelled', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    await w.alice.sendQuoteRequests(job.jobId, [w.ids.pete, w.ids.dana]);

    expect(await refusal(w.alice.removeTradie(w.ids.pete))).toBe(
      `Pete's Plumbing has an open Quote Request for plumbing at ${KING_ST}. Choose a Quote or cancel the Job first.`,
    );
    expect((await w.alice.people('tradie')).map((t) => t.id)).toContain(w.ids.pete);
    expect((await w.alice.tradie(w.ids.pete)).removedAt).toBeNull();
    // Finn wasn't asked, so nothing holds him.
    expect(await w.alice.removeTradie(w.ids.finn)).toBe('Flow Bros');

    await w.alice.cancelJob(job.jobId);
    expect(await w.alice.removeTradie(w.ids.pete)).toBe("Pete's Plumbing");
  });

  test('is refused while their Quote waits on the Property Owner, and for the Tradies held up behind it', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const [dana] = await confirmedQuotes(w, job, [
      [w.tradies.dana, 650_00],
      [w.tradies.pete, 700_00],
    ]);
    // 650.00 is over King St's Max Repair Cost of 500.00.
    await w.alice.chooseQuote(dana!.quoteId);

    expect(await refusal(w.alice.removeTradie(w.ids.dana))).toBe(
      `Drip Doctors has a Quote waiting on the Property Owner for plumbing at ${KING_ST}. Wait for their decision first.`,
    );
    // Pete's Quote is still open: the Owner may decline Dana's.
    expect(await refusal(w.alice.removeTradie(w.ids.pete))).toBe(
      `Pete's Plumbing has an open Quote Request for plumbing at ${KING_ST}. Choose a Quote or cancel the Job first.`,
    );
  });

  test('is refused while their approved Quote has no visit booked yet, naming the Job, and allowed once the Job is cancelled', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.nina, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Nominated Tradie');

    // The Job is Ready to book: removing Nina would leave it with nobody to book.
    expect(await refusal(w.alice.removeTradie(w.ids.nina))).toBe(
      `Nina's Plumbing has an approved Quote for plumbing at ${KING_ST} with no visit booked yet. Book the visit or cancel the Job first.`,
    );
    expect((await w.alice.tradie(w.ids.nina)).removedAt).toBeNull();

    await w.alice.cancelJob(job.jobId);
    expect(await w.alice.removeTradie(w.ids.nina)).toBe("Nina's Plumbing");
  });

  test('is refused while they have a visit booked, and allowed once the Job is cancelled', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.nina, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Nominated Tradie');
    await w.alice.sendWorkOrder(job.jobId, { start: TUE_9AM.toISOString() });

    expect(await refusal(w.alice.removeTradie(w.ids.nina))).toBe("Nina's Plumbing has a visit booked on Tuesday 13 October at 9 am. Cancel or finish it first.");

    await w.alice.cancelJob(job.jobId);
    expect(await w.alice.removeTradie(w.ids.nina)).toBe("Nina's Plumbing");
  });

  test('counts a visit earlier today that has not been marked done, and says the minutes when there are some', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const tuesdayHalfPast9 = new Date('2026-10-13T09:30:00+11:00');
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.nina, 150_00, tuesdayHalfPast9]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Nominated Tradie');
    await w.alice.sendWorkOrder(job.jobId, { start: tuesdayHalfPast9.toISOString() });
    await w.h.advance(new Date('2026-10-13T15:00:00+11:00').getTime() - w.h.clock.now().getTime());

    expect(await refusal(w.alice.removeTradie(w.ids.nina))).toBe("Nina's Plumbing has a visit booked on Tuesday 13 October at 9:30 am. Cancel or finish it first.");
  });

  test("is not found for another Agency's Tradie or for someone who isn't a Tradie, and refused for one already removed", async () => {
    const w = await world();
    const other = await w.h.app.setup.createAgency({ name: 'Other Realty', timeZone: 'Australia/Sydney' });
    const olga = w.h.as(await w.h.app.setup.addPropertyManager(other, { name: 'Olga Other', email: 'olga@other.example', password: 'other-password' }));

    expect(await refusal(olga.removeTradie(w.ids.nina))).toMatch(/not found/);
    expect(await refusal(w.alice.removeTradie(w.ids.tom))).toMatch(/not found/);
    expect((await w.alice.tradie(w.ids.nina)).removedAt).toBeNull();

    await w.alice.removeTradie(w.ids.nina);
    expect(await refusal(w.alice.removeTradie(w.ids.nina))).toBe("Nina's Plumbing has already been removed");
  });
});
