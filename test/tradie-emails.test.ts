// Tradie emails: a short opening, a details block, then buttons. The buttons post;
// opening the page changes nothing. Replying DONE or NO still does what it did.

import { describe, expect, test } from 'vitest';
import { HOUR } from './support/harness.ts';
import {
  confirmedQuotes,
  jobView,
  KING_ST,
  quoteRequestFor,
  quoteToken,
  TOM,
  tomsTapTicket,
  visitStarted,
  world,
} from './support/world.ts';

const sydney = (local: string) => new Date(`${local}+11:00`);
const TUE_9AM = sydney('2026-10-13T09:00:00');
const TUE_10AM = sydney('2026-10-13T10:00:00');
const THU_9AM = sydney('2026-10-15T09:00:00');

const ISSUE = 'Summary: The kitchen tap is dripping';

describe('emails to Tradies', () => {
  test('a Quote Request names the job and links to the quote page and a decline page', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    await w.alice.sendQuoteRequests(job.jobId, [w.tradies.pete.id, w.tradies.dana.id]);
    const link = `https://myest8.test/q/${await quoteToken(w, job, w.tradies.pete)}`;

    expect(w.h.messenger.last(w.tradies.pete.address)!.text).toBe(
      'Harbour Realty is asking for a quote. Give your Estimate (a ballpark from the description and photos), and say if you need to inspect before your Firm Quote.\n\n' +
        'Trade: Plumbing\n' +
        'Suburb: Newtown\n' +
        'Urgency: Routine\n' +
        `Issue: ${ISSUE}\n\n` +
        `Give your quote: ${link}\n\n` +
        `Can't take this job: ${link}/decline\n\n` +
        'Or reply with a ballpark price and earliest time, or NO to decline.',
    );

    await w.h.advance(48 * HOUR);
    const reminder = w.h.messenger.to(w.tradies.pete.address).find((m) => m.template === 'tradie.quote_reminder')!;
    expect(reminder.text).toBe(
      'Reminder from Harbour Realty: please give an Estimate for this job.\n\n' +
        'Trade: Plumbing\n' +
        'Suburb: Newtown\n' +
        'Urgency: Routine\n' +
        `Issue: ${ISSUE}\n\n` +
        `Give your quote: ${link}\n\n` +
        `Can't take this job: ${link}/decline\n\n` +
        'Or reply with a ballpark price and earliest time, or NO to decline.',
    );
  });

  test('declining from the link does what replying NO does, and reading the page does not', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    await w.alice.sendQuoteRequests(job.jobId, [w.tradies.pete.id, w.tradies.dana.id]);
    const pete = await quoteToken(w, job, w.tradies.pete);
    const dana = await quoteRequestFor(w, job, w.tradies.dana);

    expect((await quoteRequestFor(w, job, w.tradies.pete)).status).toBe('sent');
    await w.h.app.declineQuoteRequest(pete);

    w.h.classifier.when('No thanks', { replyType: 'decline', relatedItem: `quote_request:${dana.quoteRequestId}` });
    await w.h.receive(w.tradies.dana.address, 'No thanks');

    expect((await quoteRequestFor(w, job, w.tradies.pete)).status).toBe('declined');
    expect((await quoteRequestFor(w, job, w.tradies.dana)).status).toBe('declined');
    const declined = (await w.alice.ticket(job.ticketId)).timeline.filter((event) => event.kind === 'tradie_declined');
    expect(declined).toHaveLength(2);
  });

  test('an approved quote asks for visit times, with how long and when the Tenant is home', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00]]);
    w.h.messenger.clear();
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    const link = `https://myest8.test/q/${await quoteToken(w, job, w.tradies.pete)}`;

    expect(w.h.messenger.last(w.tradies.pete.address)!.text).toBe(
      'Harbour Realty has approved your quote for the plumbing job.\n\n' +
        `Address: ${KING_ST}\n` +
        'Length: 1 day\n' +
        'Tenant usually home: Weekday mornings\n\n' +
        `Offer visit times: ${link}`,
    );
  });

  test("when none of the times work, the next ask shows the Tenant's note", async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    const link = `https://myest8.test/q/${await quoteToken(w, job, w.tradies.pete)}`;
    await w.h.app.offerVisitTimes(await quoteToken(w, job, w.tradies.pete), [TUE_9AM.toISOString(), sydney('2026-10-14T13:00:00').toISOString()]);
    const offer = w.h.messenger.last(TOM)!.text.match(/\/v\/([^?\s]+)\?pick=/)![1]!;
    w.h.messenger.clear();

    await w.h.app.declineVisitTimes(offer, { availability: 'weekday_mornings', note: 'Sunday 10 am works' });

    expect(w.h.messenger.last(w.tradies.pete.address)!.text).toBe(
      "The Tenant can't make the times you offered for the plumbing job.\n\n" +
        `Address: ${KING_ST}\n` +
        'Length: 1 day\n' +
        'Tenant usually home: Weekday mornings\n' +
        "Tenant's note: Sunday 10 am works\n\n" +
        `Offer visit times: ${link}`,
    );
  });

  test('a Work Order names the visit and links to the job, marking it done, and another time', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    const link = `https://myest8.test/q/${await quoteToken(w, job, w.tradies.pete)}`;

    expect(w.h.messenger.last(w.tradies.pete.address)!.text).toBe(
      'Work order from Harbour Realty. The kitchen tap is dripping. Approved: your Firm Quote of $150.00.\n\n' +
        `Address: ${KING_ST}\n` +
        'When: Tue 13 Oct, 9:00 am\n' +
        'Length: 2 hours\n' +
        'Tenant: Tom Tran\n' +
        `Tenant contact: ${TOM}\n\n` +
        `View job: ${link}\n\n` +
        `Mark job done: ${link}/done\n\n` +
        `Need another time?: ${link}/another`,
    );
  });

  test('Mark job done does what replying DONE does', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    const token = await quoteToken(w, job, w.tradies.pete);

    await w.h.app.markTradieVisitDone(token, 'repair');
    expect(await jobView(w, job)).toMatchObject({ status: 'scheduled', workOrder: { status: 'active' } });
    expect(w.h.messenger.last(w.tradies.pete.address)!.template).toBe('tradie.done_too_early');

    visitStarted(w, TUE_9AM);
    w.h.messenger.clear();
    await w.h.app.markTradieVisitDone(token, 'repair');
    expect(await jobView(w, job)).toMatchObject({ status: 'done', workOrder: { status: 'done' } });
    expect(w.h.messenger.last(TOM)!.template).toBe('tenant.fixed_properly');
  });

  test('Need another time starts a new offer round and leaves the visit booked', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, THU_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    const token = await quoteToken(w, job, w.tradies.pete);
    w.h.messenger.clear();

    await w.h.app.tradieNeedsAnotherTime(token, 'repair');

    expect((await jobView(w, job)).workOrder).toMatchObject({ start: THU_9AM.toISOString(), rescheduleRequestedBy: 'tradie', status: 'active' });
    expect(w.h.messenger.last(w.tradies.pete.address)!.template).toBe('tradie.offer_new_times');
    expect(w.h.messenger.last(w.tradies.pete.address)!.text).toContain('The current visit stays booked until they pick one.');
  });

  test('a moved visit names the old time and the new one', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    const { workOrder } = await jobView(w, job);
    w.h.messenger.clear();
    await w.alice.acceptTime(workOrder!.workOrderId, THU_9AM.toISOString());
    const link = `https://myest8.test/q/${await quoteToken(w, job, w.tradies.pete)}`;

    expect(w.h.messenger.last(w.tradies.pete.address)!.text).toBe(
      'Your visit has moved.\n\n' +
        `Address: ${KING_ST}\n` +
        'Was: Tue 13 Oct, 9:00 am\n' +
        'Now: Thu 15 Oct, 9:00 am\n\n' +
        `View job: ${link}\n\n` +
        `Need another time?: ${link}/another`,
    );
  });

  test('a Site Inspection names the visit and links to it, marking it done, and another time', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    await w.alice.sendQuoteRequests(job.jobId, [w.tradies.pete.id, w.tradies.dana.id]);
    await w.h.app.submitEstimate(await quoteToken(w, job, w.tradies.dana), { priceCents: 300_00, needsInspection: true, calloutFeeCents: 80_00 });
    w.h.messenger.clear();
    await w.alice.bookInspection((await quoteRequestFor(w, job, w.tradies.dana)).quoteRequestId, { start: TUE_10AM.toISOString() });
    const link = `https://myest8.test/q/${await quoteToken(w, job, w.tradies.dana)}`;

    expect(w.h.messenger.last(w.tradies.dana.address)!.text).toBe(
      `Site Inspection for Harbour Realty: ${ISSUE}.\n\n` +
        `Address: ${KING_ST}\n` +
        'When: Tue 13 Oct, 10:00 am\n' +
        `Tenant contact: ${TOM}\n\n` +
        `View inspection: ${link}\n\n` +
        `Mark inspection done: ${link}/inspection-done\n\n` +
        `Need another time?: ${link}/inspection-another`,
    );

    await w.h.app.markTradieVisitDone(await quoteToken(w, job, w.tradies.dana), 'inspection');
    expect((await quoteRequestFor(w, job, w.tradies.dana)).inspection).toMatchObject({ status: 'active' });

    visitStarted(w, TUE_10AM);
    w.h.messenger.clear();
    await w.h.app.markTradieVisitDone(await quoteToken(w, job, w.tradies.dana), 'inspection');
    expect(await quoteRequestFor(w, job, w.tradies.dana)).toMatchObject({ status: 'inspected', inspection: { status: 'done' } });
    expect(w.h.messenger.last(w.tradies.dana.address)!.text).toBe(
      'Thanks for inspecting the plumbing job. Please give Harbour Realty your Firm Quote: your fixed price, the scope of work, how long it takes and the dates you can start.\n\n' +
        `Address: ${KING_ST}\n` +
        'Inspected on: Tue 13 Oct, 10:00 am\n' +
        `What's needed: ${ISSUE}\n\n` +
        `Give your Firm Quote: ${link}`,
    );

    await w.h.advance(49 * HOUR);
    const reminder = w.h.messenger.to(w.tradies.dana.address).filter((m) => m.template === 'tradie.firm_quote_reminder').at(-1)!;
    expect(reminder.text).toContain(`Address: ${KING_ST}`);
    expect(reminder.text).toContain('Inspected on: Tue 13 Oct, 10:00 am');
    expect(reminder.text).toContain(`What's needed: ${ISSUE}`);
    expect(reminder.text).toContain(`Give your Firm Quote: ${link}`);
  });
});
