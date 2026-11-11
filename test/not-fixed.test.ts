import { describe, expect, test } from 'vitest';
import { all } from '../src/db.ts';
import { confirmedQuotes, jobView, TOM, tomsTapTicket, visitStarted, world, type JobRef, type World } from './support/world.ts';

const TUE_9AM = new Date('2026-10-13T09:00:00+11:00');
const DAY = 24 * 3_600_000;

/** Tom's tap Ticket with Flow Bros' plumbing Job done: Tom has just been asked how well it was fixed. */
async function doneTap(w: World): Promise<JobRef> {
  const { h, alice, tradies } = w;
  const job = await tomsTapTicket(w);
  const [quote] = await confirmedQuotes(w, job, [[tradies.finn, 150_00, TUE_9AM]]);
  await alice.chooseQuote(quote!.quoteId, 'Only plumber free this week');
  await alice.sendWorkOrder(job.jobId);
  const { workOrder } = await jobView(w, job);
  h.classifier.when('All done, washer replaced', { replyType: 'done', relatedItem: `work_order:${workOrder!.workOrderId}` });
  visitStarted(w, TUE_9AM);
  await h.receive(tradies.finn.address, 'All done, washer replaced');
  expect(await jobView(w, job)).toMatchObject({ status: 'done' });
  return job;
}

/** Tom texts `text`, read as `messageClass` about `relatedItem`: a routine plumbing message that answers no question. */
async function tomSays(w: World, text: string, messageClass: string, relatedItem: string, more: Record<string, string> = {}) {
  w.h.classifier.when(text, {
    messageClass,
    relatedItem,
    urgency: 'routine',
    safety: 'no_risk',
    trade: 'plumbing',
    updateType: 'general',
    'answer:fix_rating': 'not_an_answer',
    'answer:guided': 'not_an_answer',
    'answer:visit': 'not_an_answer',
    ...more,
  });
  await w.h.receive(TOM, text);
}

async function inbox(w: World) {
  return (await w.alice.dashboard()).inbox;
}

async function issueCount(w: World) {
  return (await all(w.h.db, 'SELECT id FROM issues')).length;
}

describe('a Tenant says a finished repair is not fixed', () => {
  test('a low fix rating waits in the Inbox as Not fixed, and one press adds a redo Job to the same Ticket', async () => {
    const w = await world();
    const job = await doneTap(w);

    await w.h.answer(TOM, '2 - still drips a bit', '2');

    expect(w.h.messenger.last(TOM)).toMatchObject({ template: 'tenant.not_fixed_received', data: { trade: 'plumbing' } });
    const [item] = await inbox(w);
    expect(item).toMatchObject({
      reason: 'not_fixed',
      ticket: { ticketId: job.ticketId, closed: false, redo: { jobId: job.jobId, trade: 'plumbing', tradieBusinessName: 'Flow Bros', inProgress: false } },
    });
    // The rating still counts, and the message is on the Ticket for the Property Manager.
    expect((await w.alice.ticket(job.ticketId)).timeline.map((e) => e.kind)).toContain('tenant_rated');
    expect((await w.alice.ticket(job.ticketId)).messages.find((m) => m.text === '2 - still drips a bit')).toMatchObject({ unread: true });

    const added = await w.alice.reworkFromInbox(item!.itemId);

    expect(added).toMatchObject({ ticketId: job.ticketId, reopened: false });
    const ticket = await w.alice.ticket(job.ticketId);
    expect(ticket.jobs.map((j) => ({ status: j.status, trade: j.trade, reworkOf: j.reworkOf }))).toEqual([
      { status: 'done', trade: 'plumbing', reworkOf: null },
      { status: 'quoting', trade: 'plumbing', reworkOf: job.jobId },
    ]);
    expect(await inbox(w)).toEqual([]);
    await expect(w.alice.reworkFromInbox(item!.itemId)).rejects.toThrow(/not found/i);
  });

  test('a good fix rating is only a rating', async () => {
    const w = await world();
    await doneTap(w);

    await w.h.answer(TOM, '4', '4');

    expect(await inbox(w)).toEqual([]);
    expect(w.h.messenger.templatesTo(TOM)).not.toContain('tenant.not_fixed_received');
  });

  test('the same problem back after the Ticket closed reopens that Ticket instead of starting a new one', async () => {
    const w = await world();
    const job = await doneTap(w);
    await w.h.answer(TOM, '5', '5');
    await w.alice.closeTicket(job.ticketId);
    const before = await issueCount(w);
    await w.h.advance(10 * DAY);

    await tomSays(w, 'The kitchen tap is dripping again', 'new_issue', `ticket:${job.ticketId}`);

    expect(await issueCount(w)).toBe(before);
    expect((await w.alice.dashboard()).maintenanceRequests).toEqual([]);
    const [item] = await inbox(w);
    expect(item).toMatchObject({ reason: 'not_fixed', ticket: { ticketId: job.ticketId, closed: true, redo: { jobId: job.jobId } } });

    expect(await w.alice.reworkFromInbox(item!.itemId)).toMatchObject({ ticketId: job.ticketId, reopened: true });
    const ticket = await w.alice.ticket(job.ticketId);
    expect(ticket.status).toBe('open');
    expect(ticket.timeline.map((e) => e.kind)).toEqual(expect.arrayContaining(['closed', 'reopened', 'job_added']));
  });

  test('a second "not fixed" while one waits is only logged, and one while the redo is under way adds nothing', async () => {
    const w = await world();
    const job = await doneTap(w);
    await w.h.answer(TOM, '1', '1');

    await tomSays(w, 'Hello? Still dripping', 'not_fixed', `job:${job.jobId}`);

    expect(await inbox(w)).toHaveLength(1);
    expect((await w.alice.ticket(job.ticketId)).messages.find((m) => m.text === 'Hello? Still dripping')).toMatchObject({ unread: true });
    expect(w.h.messenger.templatesTo(TOM).filter((t) => t === 'tenant.not_fixed_received')).toHaveLength(1);

    const [item] = await inbox(w);
    const { jobId: redoId } = await w.alice.reworkFromInbox(item!.itemId);
    await tomSays(w, 'Any news on the tap?', 'not_fixed', `job:${job.jobId}`);

    expect(await inbox(w)).toEqual([]);
    expect((await w.alice.ticket(job.ticketId)).jobs.map((j) => j.jobId)).toEqual([job.jobId, redoId]);
    await expect(w.alice.redoTicket(job.ticketId)).rejects.toThrow(/already has a Job under way/);
  });

  test('"not fixed" before the Job is done is an ordinary update on the Ticket', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);

    await tomSays(w, 'Tap still dripping, when is someone coming?', 'not_fixed', `ticket:${job.ticketId}`);

    expect(await inbox(w)).toEqual([]);
    expect((await w.alice.ticket(job.ticketId)).messages.find((m) => m.text === 'Tap still dripping, when is someone coming?')).toMatchObject({ unread: true });
  });

  test('an urgent "it is back" takes the Urgent Repair way, as a new report would', async () => {
    const w = await world();
    const job = await doneTap(w);
    await w.h.answer(TOM, '5', '5');

    await tomSays(w, 'The pipe under the sink burst, water everywhere', 'not_fixed', `job:${job.jobId}`, { urgency: 'urgent' });

    expect(await inbox(w)).toEqual([]);
    expect(w.h.messenger.templatesTo(TOM)).toContain('tenant.urgent_repair_reminder');
  });

  test('a message about a closed Ticket that is not a complaint waits in the Inbox', async () => {
    const w = await world();
    const job = await doneTap(w);
    await w.h.answer(TOM, '5', '5');
    await w.alice.closeTicket(job.ticketId);

    await tomSays(w, 'Thanks for sorting the tap!', 'update', `ticket:${job.ticketId}`);

    expect(await inbox(w)).toMatchObject([{ reason: 'closed_ticket', ticket: { ticketId: job.ticketId, closed: true } }]);
  });

  test('a Ticket closed more than 60 days ago is not offered: the problem back is a new issue', async () => {
    const w = await world();
    const job = await doneTap(w);
    await w.h.answer(TOM, '5', '5');
    await w.alice.closeTicket(job.ticketId);
    await w.h.advance(61 * DAY);

    await tomSays(w, 'The kitchen tap is dripping once more', 'new_issue', 'none');

    const offered = (w.h.classifier.calls.at(-1)!.state as { openItems: { ref: string }[] }).openItems;
    expect(offered.map((i) => i.ref)).not.toContain(`ticket:${job.ticketId}`);
    expect(await inbox(w)).toEqual([]);
    expect(w.h.messenger.templatesTo(TOM)).toContain('tenant.acknowledgement');
  });

  test('the Ticket page redoes the latest done Job, reopening a closed Ticket', async () => {
    const w = await world();
    const job = await doneTap(w);
    await w.h.answer(TOM, '5', '5');
    await w.alice.closeTicket(job.ticketId);

    expect(await w.alice.redoTicket(job.ticketId)).toMatchObject({ ticketId: job.ticketId, reopened: true });
    const ticket = await w.alice.ticket(job.ticketId);
    expect(ticket.status).toBe('open');
    expect(ticket.jobs.at(-1)).toMatchObject({ status: 'quoting', reworkOf: job.jobId });
  });
});
