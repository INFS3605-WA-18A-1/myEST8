// The desk pages behind the rail's entries: Requests, Tickets and Approvals, read the
// way the Property Manager sees them, through the web app.

import { describe, expect, test } from 'vitest';
import { HOUR } from '../support/harness.ts';
import { visible, webWorld } from '../support/web.ts';
import { BELLA, confirmedQuotes, HANA, KING_ST, OCEAN_AVE, OLIVIA, TOM } from '../support/world.ts';

type Web = Awaited<ReturnType<typeof webWorld>>;

/** The page as the Property Manager sees it; signs in afresh, as the scenarios move the clock past a session's life. */
async function text(w: Web, path: string, cookie?: string) {
  const res = await w.get(path, cookie ?? (await w.signIn()));
  expect(res.status, path).toBe(200);
  return res.text();
}

/** The count badge beside one rail link, or null when it has none. */
function railCount(html: string, href: string) {
  const link = new RegExp(`<a href="${href}" class="rail-link"[^>]*>((?:(?!</a>)[\\s\\S])*)</a>`).exec(html);
  return /rail-count num">(\d+)</.exec(link?.[1] ?? '')?.[1] ?? null;
}

/** A Tenant reports `description` and answers every question; with no photos it becomes a Maintenance Request after 48 hours. */
async function report(w: Web, from: string, description: string, urgency: 'routine' | 'high' = 'routine') {
  w.h.classifier.when(description, { messageClass: 'new_issue', relatedItem: 'none', urgency, trade: 'plumbing' });
  await w.h.receive(from, description);
  await w.h.answer(from, 'In the kitchen');
  await w.h.answer(from, 'Since Monday');
  await w.h.answer(from, 'No', 'no');
  await w.h.answer(from, 'Mornings', 'weekday_mornings');
}

/** Confirms every Maintenance Request waiting, oldest first, and returns the new Tickets' ids in that order. */
async function confirmAll(w: Web) {
  const ids: number[] = [];
  for (const r of (await w.bob.dashboard({ filter: 'all' })).maintenanceRequests) ids.push(await w.alice.confirmMaintenanceRequest(r.issueId));
  return ids;
}

/** Three Tickets reported an hour apart: Tom's routine tap, Hana's routine fan, and Bella's high ceiling leak (Bob's Property). */
async function threeTickets(w: Web) {
  await report(w, TOM, 'The kitchen tap is dripping');
  await w.h.advance(HOUR);
  await report(w, HANA, 'The bathroom fan is rattling');
  await w.h.advance(HOUR);
  await report(w, BELLA, 'The ceiling has a slow leak', 'high');
  await w.h.advance(49 * HOUR);
  const [tap, fan, leak] = await confirmAll(w);
  return { tap: tap!, fan: fan!, leak: leak! };
}

/** Tom's Ticket has a Quote of $650 chosen on a $500 Max Repair Cost, so Olivia must approve; Hana's request is still waiting for review. */
async function busyDesk(w: Web) {
  await report(w, TOM, 'The kitchen tap is dripping');
  await report(w, HANA, 'The bathroom fan is rattling');
  await w.h.advance(49 * HOUR);
  const [first] = (await w.alice.dashboard()).maintenanceRequests;
  const ticketId = await w.alice.confirmMaintenanceRequest(first!.issueId);
  const jobId = (await w.alice.ticket(ticketId)).jobs[0]!.jobId;
  const [quote] = await confirmedQuotes(w, { ticketId, jobId }, [
    [w.tradies.dana, 650_00],
    [w.tradies.pete, 700_00],
  ]);
  await w.alice.chooseQuote(quote!.quoteId);
  return { ticketId, jobId };
}

describe('Requests', () => {
  test('lists the Maintenance Requests waiting for the Property Manager, oldest first, each linking to its review', async () => {
    const w = await webWorld();
    await report(w, TOM, 'The kitchen tap is dripping');
    await w.h.advance(HOUR);
    await report(w, HANA, 'The bathroom fan is rattling');
    await w.h.advance(49 * HOUR);

    const html = await text(w, '/requests');
    const readable = visible(html);
    expect(readable.indexOf('The kitchen tap is dripping')).toBeGreaterThan(-1);
    expect(readable.indexOf('The kitchen tap is dripping')).toBeLessThan(readable.indexOf('The bathroom fan is rattling'));
    expect(readable).toContain(KING_ST);
    const { maintenanceRequests } = await w.alice.dashboard();
    for (const r of maintenanceRequests) expect(html).toContain(`href="/requests/${r.issueId}"`);
  });

  test('says so when nothing is waiting', async () => {
    const w = await webWorld();
    expect(visible(await text(w, '/requests', await w.signIn()))).toContain('No Maintenance Requests waiting for you.');
  });
});

describe('Tickets', () => {
  test('lists open Tickets by urgency, then by when they were reported, each linking to its page', async () => {
    const w = await webWorld();
    const ids = await threeTickets(w);

    const html = await text(w, '/tickets?filter=all');
    const order = [`/tickets/${ids.leak}"`, `/tickets/${ids.tap}"`, `/tickets/${ids.fan}"`].map((href) => html.indexOf(`href="${href}`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(visible(html)).toContain(OCEAN_AVE);
  });

  test('reads each row issue first, then the address linking to the Property, with the number quiet after the issue', async () => {
    const w = await webWorld();
    const ids = await threeTickets(w);

    const html = await text(w, '/tickets');
    const row = html.split('<tr>').find((r) => r.includes(`href="/tickets/${ids.tap}"`)) ?? '';
    const issue = row.indexOf('The kitchen tap is dripping');
    expect(issue).toBeGreaterThan(-1);
    expect(row.indexOf(`#${ids.tap}`)).toBeGreaterThan(issue);
    expect(row.indexOf(KING_ST)).toBeGreaterThan(issue);
    expect(row).toContain(`href="/properties/${w.ids.kingSt}"`);
  });

  test('shows only the Property Manager’s own Tickets until All is chosen', async () => {
    const w = await webWorld();
    const ids = await threeTickets(w);

    const mine = await text(w, '/tickets');
    expect(mine).toContain(`href="/tickets/${ids.tap}"`);
    expect(mine).not.toContain(`href="/tickets/${ids.leak}"`);
  });

  test('filters by urgency and by whether the Ticket is open or closed, with counts', async () => {
    const w = await webWorld();
    const ids = await threeTickets(w);
    const fan = (await w.alice.ticket(ids.fan)).jobs[0]!.jobId;
    await w.alice.cancelJob(fan);
    await w.alice.closeTicket(ids.fan);

    const high = await text(w, '/tickets?filter=all&urgency=high');
    expect(high).toContain(`href="/tickets/${ids.leak}"`);
    expect(high).not.toContain(`href="/tickets/${ids.tap}"`);

    const closed = await text(w, '/tickets?filter=all&status=closed');
    expect(closed).toContain(`href="/tickets/${ids.fan}"`);
    expect(closed).not.toContain(`href="/tickets/${ids.tap}"`);

    const open = visible(await text(w, '/tickets?filter=all'));
    expect(open).toMatch(/Open 2/);
    expect(open).toMatch(/Closed 1/);
    expect(open).toMatch(/1 High/);
    expect(open).toMatch(/1 Routine/);
  });

  test('pairs each Job’s Trade with its stage, and says when an open Ticket is ready to close', async () => {
    const w = await webWorld();
    const ids = await threeTickets(w);
    await w.alice.cancelJob((await w.alice.ticket(ids.fan)).jobs[0]!.jobId);

    const html = await text(w, '/tickets?filter=all');
    const rowOf = (id: number) => html.split('<tr>').find((r) => r.includes(`href="/tickets/${id}"`)) ?? '';
    // Each Job is its own item, its Trade then its stage.
    const jobsOf = (id: number) => [...rowOf(id).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => visible(m[1]!).trim());
    expect(jobsOf(ids.tap)).toEqual(['Plumbing Quoting']);
    expect(visible(rowOf(ids.tap))).not.toContain('Ready to close');
    expect(jobsOf(ids.fan)).toEqual(['Plumbing Cancelled']);
    expect(visible(rowOf(ids.fan))).toContain('Ready to close');
  });

  test('says so when there are none, with the way to every Property Manager’s', async () => {
    const w = await webWorld();
    const html = await text(w, '/tickets', await w.signIn());
    expect(visible(html)).toContain('No open Tickets on your Properties.');
    expect(html).toMatch(/href="\/tickets\?filter=all"[^>]*>\s*Show all Tickets/);
  });
});

describe('Approvals', () => {
  test('lists the Tickets waiting on a Property Owner with the Property, the Owner, the amount over the limit and the reminder', async () => {
    const w = await webWorld();
    const { ticketId } = await busyDesk(w);

    const html = await text(w, '/approvals');
    const readable = visible(html);
    expect(html).toContain(`href="/tickets/${ticketId}"`);
    for (const expected of [KING_ST, 'Olivia Owens', '$650.00', '$500.00', '$150.00', 'Reminder not due yet']) expect(readable).toContain(expected);
    // A Quote with the Property Owner waits on them, not the Property Manager: a quiet count, not Wattle.
    expect(html).toMatch(/<a href="#owners" class="count-link">1 Quote waiting on a Property Owner<\/a>/);

    await w.h.advance(25 * HOUR);
    expect(visible(await text(w, '/approvals'))).toContain('Reminder sent');
  });

  test('lists only Tickets that went over the Max Repair Cost, and drops one once the Property Owner answers', async () => {
    const w = await webWorld();
    const { ticketId, jobId } = await busyDesk(w);
    // A second Ticket whose Quote stays within the limit is never waiting on an Owner.
    await report(w, TOM, 'The back door will not lock');
    await w.h.advance(49 * HOUR);
    const [request] = (await w.alice.dashboard()).maintenanceRequests.filter((r) => r.description === 'The back door will not lock');
    const cheapTicket = await w.alice.confirmMaintenanceRequest(request!.issueId);
    const cheapJob = (await w.alice.ticket(cheapTicket)).jobs[0]!.jobId;
    const [cheap] = await confirmedQuotes(w, { ticketId: cheapTicket, jobId: cheapJob }, [
      [w.tradies.finn, 200_00],
      [w.tradies.nina, 250_00],
    ]);
    await w.alice.chooseQuote(cheap!.quoteId);

    const html = await text(w, '/approvals');
    expect(html).toContain(`href="/tickets/${ticketId}"`);
    expect(html).not.toContain(`href="/tickets/${cheapTicket}"`);

    const { approval } = (await w.alice.ticket(ticketId)).jobs.find((j) => j.jobId === jobId)!;
    w.h.classifier.when('YES go ahead', { replyType: 'approval_answer', answer: 'yes', relatedItem: `approval:${approval!.approvalId}` });
    await w.h.receive(OLIVIA, 'YES go ahead');
    const after = await text(w, '/approvals');
    expect(after).not.toContain(`href="/tickets/${ticketId}"`);
    expect(visible(after)).toContain('Nothing is waiting on a Property Owner or a receipt.');
    expect(after).toMatch(/href="\/approvals\?filter=all"[^>]*>\s*Show all approvals/);
    expect(visible(after)).not.toContain('Waiting on a Property Owner');
    expect(railCount(after, '/approvals')).toBeNull();
  });

  test('also lists Urgent Repairs waiting on a receipt', async () => {
    const w = await webWorld();
    w.h.classifier.when('Water is pouring through the ceiling', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'urgent', trade: 'plumbing' });
    await w.h.receive(TOM, 'Water is pouring through the ceiling');

    const html = await text(w, '/approvals');
    const readable = visible(html);
    for (const expected of ['Urgent Repairs waiting on a receipt', 'Water is pouring through the ceiling', 'Tom Tran', 'Olivia Owens', KING_ST]) {
      expect(readable).toContain(expected);
    }
    expect(html).toContain(`href="/properties/${w.ids.kingSt}"`);
    // Only the list with rows is shown.
    expect(readable).not.toContain('Waiting on a Property Owner');
  });
});

