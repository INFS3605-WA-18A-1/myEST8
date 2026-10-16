import { describe, expect, test } from 'vitest';
import { stageOf, quotingDecision } from '../src/views.ts';
import { confirmedQuotes, jobView, tomsTapTicket, tradieQuotes, world, type World } from './support/world.ts';

const TUE_9AM = new Date('2026-10-13T09:00:00+11:00');

/** The open Ticket as the dashboard's board sees it. */
async function onBoard({ alice }: World, ticketId: number) {
  return (await alice.dashboard()).tickets.find((t) => t.ticketId === ticketId)!;
}

describe("the board's stages", () => {
  test("a Ticket sits in the lane of its least advanced open Job; cancelled Jobs don't count, and all done is Done", () => {
    expect(stageOf([{ status: 'scheduled' }, { status: 'quoting' }])).toBe('quoting');
    expect(stageOf([{ status: 'done' }, { status: 'approved' }])).toBe('approved');
    expect(stageOf([{ status: 'cancelled' }, { status: 'awaiting_owner' }])).toBe('awaiting_owner');
    expect(stageOf([{ status: 'done' }, { status: 'cancelled' }])).toBe('done');
    expect(stageOf([])).toBe('quoting');
  });

  test('a Ticket moves from Quoting to Ready to book to Booked, with its next visit, and a second Job pulls it back', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    expect(await onBoard(w, job.ticketId)).toMatchObject({ stage: 'quoting', trades: ['plumbing'], nextVisit: null });

    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    expect(await onBoard(w, job.ticketId)).toMatchObject({ stage: 'approved', quoting: null, decision: null });

    await w.alice.sendWorkOrder(job.jobId);
    expect(await onBoard(w, job.ticketId)).toMatchObject({ stage: 'scheduled', nextVisit: TUE_9AM.toISOString() });

    await w.alice.addJob(job.ticketId, 'electrical');
    expect(await onBoard(w, job.ticketId)).toMatchObject({
      stage: 'quoting',
      trades: ['plumbing', 'electrical'],
      quoting: { asked: 0, received: 0, confirmed: 0 },
      nextVisit: null,
    });
  });
});

describe('quoting on the board', () => {
  test('Quotes in but unconfirmed are to check; once two are confirmed the Property Manager chooses', async () => {
    const w = await world();
    const { alice, tradies } = w;
    const job = await tomsTapTicket(w);
    expect(await onBoard(w, job.ticketId)).toMatchObject({ quoting: { asked: 0, received: 0, confirmed: 0 }, decision: null });

    await alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.dana.id, tradies.nina.id]);
    expect(await onBoard(w, job.ticketId)).toMatchObject({ quoting: { asked: 3, received: 0, confirmed: 0 }, decision: null });

    await tradieQuotes(w, job, tradies.pete, '$150 Tuesday', { priceCents: 150_00 });
    await tradieQuotes(w, job, tradies.dana, '$180 Tuesday', { priceCents: 180_00 });
    expect(await onBoard(w, job.ticketId)).toMatchObject({ quoting: { asked: 3, received: 2, confirmed: 0 }, decision: 'check_quotes' });

    const [first, second] = (await jobView(w, job)).quotes;
    await alice.confirmQuote(first!.quoteId);
    expect(await onBoard(w, job.ticketId)).toMatchObject({ quoting: { received: 2, confirmed: 1 }, decision: 'check_quotes' });

    await alice.confirmQuote(second!.quoteId);
    expect(await onBoard(w, job.ticketId)).toMatchObject({ quoting: { asked: 3, received: 2, confirmed: 2 }, decision: 'choose_quote' });
  });

  test('one confirmed Quote with none left to check waits for more; MIN_QUOTES confirmed is ready', () => {
    expect(quotingDecision({ asked: 3, received: 1, confirmed: 1 })).toBeNull();
    expect(quotingDecision({ asked: 0, received: 0, confirmed: 0 })).toBeNull();
    expect(quotingDecision({ asked: 2, received: 2, confirmed: 2 })).toBe('choose_quote');
    expect(quotingDecision({ asked: 3, received: 3, confirmed: 2 })).toBe('check_quotes');
  });

  test('a declined Quote Request is no longer counted as asked', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    await w.alice.sendQuoteRequests(job.jobId, [w.tradies.pete.id, w.tradies.dana.id]);
    const request = (await jobView(w, job)).quoteRequests.find((r) => r.tradieId === w.tradies.dana.id)!;
    w.h.classifier.when('Sorry, too busy', { replyType: 'decline', relatedItem: `quote_request:${request.quoteRequestId}` });
    await w.h.receive(w.tradies.dana.address, 'Sorry, too busy');
    expect(await onBoard(w, job.ticketId)).toMatchObject({ quoting: { asked: 1, received: 0 } });
  });
});
