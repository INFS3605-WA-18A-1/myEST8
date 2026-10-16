import { describe, expect, test } from 'vitest';
import { confirmedQuotes, jobView, OLIVIA, TOM, tomsTapTicket, world } from './support/world.ts';

const TUE_9AM = new Date('2026-10-13T09:00:00+11:00');

describe('closing a Ticket', () => {
  test('a Ticket closes once every Job is done or cancelled, and the Tenant and Property Owner are told', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[tradies.pete, 150_00, TUE_9AM]]);
    await alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await alice.sendWorkOrder(job.jobId);
    const { workOrder } = await jobView(w, job);
    h.classifier.when('Done', { replyType: 'done', relatedItem: `work_order:${workOrder!.workOrderId}` });
    await h.receive(tradies.pete.address, 'Done');

    // A second Job, booked and then no longer needed.
    const second = { ticketId: job.ticketId, jobId: await alice.addJob(job.ticketId, 'plumbing') };
    const [secondQuote] = await confirmedQuotes(w, second, [[tradies.pete, 90_00, new Date('2026-10-14T09:00:00+11:00')]]);
    await alice.chooseQuote(secondQuote!.quoteId, 'Same plumber');
    await alice.sendWorkOrder(second.jobId);
    await expect(alice.closeTicket(job.ticketId)).rejects.toThrow(/done or cancelled/);

    await alice.cancelJob(second.jobId);
    expect(await alice.calendar({ from: '2026-10-14T00:00:00+11:00', to: '2026-10-15T00:00:00+11:00' })).toEqual([]);

    await alice.closeTicket(job.ticketId);

    expect(h.messenger.last(TOM)).toMatchObject({ template: 'tenant.ticket_closed' });
    expect(h.messenger.last(OLIVIA)).toMatchObject({ template: 'owner.ticket_closed', data: { description: 'The kitchen tap is dripping' } });
    expect((await alice.dashboard()).tickets).toEqual([]);
    const tracker = await h.tracker(h.messenger.to(TOM).find((m) => m.template === 'tenant.confirmed')!.data.trackerLink as string);
    expect(tracker.stages.map((s) => [s.stage, s.reached])).toEqual([
      ['reported', true],
      ['confirmed', true],
      ['getting_quotes', true],
      ['approved', true],
      ['booked', true],
      ['done', true],
      ['closed', true],
    ]);
    expect(JSON.stringify(tracker)).not.toMatch(/150|Cents|rating/i);
    expect((await alice.ticket(job.ticketId)).frequentIssues).toEqual([{ trade: 'plumbing', tickets: 1 }]);
    await expect(alice.addJob(job.ticketId, 'electrical')).rejects.toThrow(/closed/);
  });
});

describe('adding a Job', () => {
  test('needs a Trade from the list', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    await expect(w.alice.addJob(job.ticketId, 'plumber' as 'plumbing')).rejects.toThrow(/Choose a Trade/);
  });
});
