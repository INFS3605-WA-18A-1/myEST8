import { describe, expect, test } from 'vitest';
import { confirmedQuotes, jobView, KING_ST, OLIVIA, TOM, tomsTapTicket, visitStarted, world, type JobRef, type TradieRef, type World } from './support/world.ts';

const TUE_9AM = new Date('2026-10-13T09:00:00+11:00');
const SUMMARY = 'Summary: The kitchen tap is dripping';
const SCOPE = 'Replace the washer and reseat the tap';

/** The Tradie replies "done" once the Job's visit has started. */
async function tradieDone(w: World, job: JobRef, tradie: TradieRef, start: Date) {
  const { workOrder } = await jobView(w, job);
  w.h.classifier.when('Done', { replyType: 'done', relatedItem: `work_order:${workOrder!.workOrderId}` });
  visitStarted(w, start);
  await w.h.receive(tradie.address, 'Done');
}

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
    visitStarted(w, TUE_9AM);
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

    // The cancelled Job is not part of the story.
    const story = { trade: 'plumbing', tradieBusinessName: "Pete's Plumbing", doneOn: TUE_9AM.toISOString(), work: 'Replace the washer and reseat the tap' };
    expect(h.messenger.last(TOM)).toMatchObject({
      template: 'tenant.ticket_closed',
      data: { propertyAddress: KING_ST, summary: SUMMARY, jobs: [story] },
      text:
        `The plumbing repair at ${KING_ST} is complete, and we've closed it. The issue: ${SUMMARY}.\n\n` +
        "Pete's Plumbing did the plumbing work on Tue 13 Oct: Replace the washer and reseat the tap.\n\n" +
        'Thanks for your patience.',
    });
    // The Repair Cost is the Ticket's, as its page shows it: the cancelled Job's approved Quote still counts.
    expect((await alice.ticket(job.ticketId)).repairCostCents).toBe(240_00);
    expect(h.messenger.last(OLIVIA)).toMatchObject({
      template: 'owner.ticket_closed',
      data: { propertyAddress: KING_ST, summary: SUMMARY, jobs: [{ ...story, approvedCents: 150_00 }], repairCostCents: 240_00 },
      text:
        `The plumbing repair at ${KING_ST} is complete. The issue: ${SUMMARY}.\n\n` +
        "Pete's Plumbing did the plumbing work on Tue 13 Oct: Replace the washer and reseat the tap. Approved: $150.00.\n\n" +
        'Repair Cost: $240.00.',
    });
    // Only the Property Owner hears what it cost.
    expect(JSON.stringify(h.messenger.last(TOM))).not.toMatch(/Cents|\$/);
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

describe('the completion messages', () => {
  test('tell each done Job: the Tradie, the day, and the scope of work from the Firm Quote they were chosen for', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[tradies.pete, 150_00, TUE_9AM], [tradies.dana, 140_00]]);
    await alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await alice.sendWorkOrder(job.jobId);
    await tradieDone(w, job, tradies.pete, TUE_9AM);

    const story = { trade: 'plumbing', tradieBusinessName: "Pete's Plumbing", doneOn: TUE_9AM.toISOString(), work: SCOPE };
    expect(h.messenger.last(TOM)).toMatchObject({
      template: 'tenant.fixed_properly',
      data: story,
      text: `Pete's Plumbing has finished the plumbing job on Tue 13 Oct: ${SCOPE}. Was it fixed properly? Reply with a number from 1 (not at all) to 5 (perfectly).`,
    });
    expect(h.messenger.last(TOM)!.data).toEqual(story);

    await alice.closeTicket(job.ticketId);

    expect(h.messenger.last(TOM)!.data).toEqual({ propertyAddress: KING_ST, summary: SUMMARY, jobs: [story] });
    expect(h.messenger.last(OLIVIA)!.data).toEqual({ propertyAddress: KING_ST, summary: SUMMARY, jobs: [{ ...story, approvedCents: 150_00 }], repairCostCents: 150_00 });
  });

  test('a Ticket whose every Job was cancelled is still closed with the issue, and no Jobs', async () => {
    const w = await world();
    const { h, alice } = w;
    const job = await tomsTapTicket(w);
    await alice.cancelJob(job.jobId);

    await alice.closeTicket(job.ticketId);

    expect(h.messenger.last(TOM)!.text).toBe(`The repair at ${KING_ST} is complete, and we've closed it. The issue: ${SUMMARY}.\n\nThanks for your patience.`);
    expect(h.messenger.last(OLIVIA)!.data).toMatchObject({ jobs: [], repairCostCents: 0 });
  });
});

describe('adding a Job', () => {
  test('needs a Trade from the list', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    await expect(w.alice.addJob(job.ticketId, 'plumber' as 'plumbing')).rejects.toThrow(/Choose a Trade/);
  });
});
