import { describe, expect, test } from 'vitest';
import { confirmedQuotes, jobView, TOM, tomsTapTicket, world } from './support/world.ts';

const TUE_9AM = new Date('2026-10-13T09:00:00+11:00');

describe('completing a Job', () => {
  test('a Tradie replies "done", both ratings are recorded, and the next recommendation reflects them', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    // Flow Bros start with the lowest myEST8 rating of the plumbers.
    const [quote] = await confirmedQuotes(w, job, [[tradies.finn, 150_00, TUE_9AM]]);
    await alice.chooseQuote(quote!.quoteId, 'Only plumber free this week');
    await alice.sendWorkOrder(job.jobId);
    const { workOrder } = await jobView(w, job);

    h.classifier.when('All done, washer replaced', { replyType: 'done', relatedItem: `work_order:${workOrder!.workOrderId}` });
    await h.receive(tradies.finn.address, 'All done, washer replaced');

    expect(await jobView(w, job)).toMatchObject({ status: 'done', workOrder: { status: 'done' } });
    expect(h.messenger.last(TOM)).toMatchObject({
      template: 'tenant.fixed_properly',
      data: { trade: 'plumbing', tradieBusinessName: 'Flow Bros' },
    });
    expect((await alice.dashboard()).alerts).toMatchObject([{ kind: 'rating_due', jobId: job.jobId, businessName: 'Flow Bros' }]);

    await h.answer(TOM, '5', '5');
    await alice.rateTradie(job.jobId, 5);
    await expect(alice.rateTradie(job.jobId, 4)).rejects.toThrow(/already rated/);

    expect((await alice.dashboard()).alerts).toEqual([]);
    expect(await alice.tradie(tradies.finn.id)).toMatchObject({
      myEst8Rating: { average: 13 / 3, count: 3 },
      googleRating: { rating: 4.9 },
      ratings: [
        { source: 'tenant', score: 5, jobId: job.jobId },
        { source: 'property_manager', score: 5, jobId: job.jobId },
      ],
    });

    const nextJob = await alice.addJob(job.ticketId, 'plumbing');
    const { recommendations } = await jobView(w, { ticketId: job.ticketId, jobId: nextJob });
    expect(recommendations.slice(0, 3).map((r) => r.businessName)).toEqual(['Drip Doctors', 'Flow Bros', "Pete's Plumbing"]);
  });
});
