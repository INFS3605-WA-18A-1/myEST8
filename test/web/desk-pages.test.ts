// The desk pages behind the rail's entries: Tickets (new Maintenance Requests and open
// Tickets), Archive and Approvals, read the way the Property Manager sees them, through the web app.

import { describe, expect, test } from 'vitest';
import type { Trade } from '../../src/shared.ts';
import { AGENCY_NUMBER, HOUR } from '../support/harness.ts';
import { visible, webWorld } from '../support/web.ts';
import { BELLA, confirmedQuotes, HANA, KING_ST, OCEAN_AVE, OLIVIA, OLIVIA_EMAIL, TOM } from '../support/world.ts';

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
async function report(w: Web, from: string, description: string, urgency: 'routine' | 'high' = 'routine', trade: Trade = 'plumbing') {
  w.h.classifier.when(description, { messageClass: 'new_issue', relatedItem: 'none', urgency, trade });
  await w.h.receive(from, description);
  await w.h.answerAll(from, { location: 'In the kitchen', started: 'Since Monday', worsening: 'no', availability: 'weekday_mornings' });
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

/** The part of the Tickets page from one section's heading to the next one's (or the end). */
function sectionOf(html: string, title: string) {
  const from = html.indexOf(`>${title}</h2>`);
  expect(from, title).toBeGreaterThan(-1);
  const next = html.indexOf('class="section-title"', from + title.length);
  return html.slice(from, next === -1 ? undefined : next);
}

/** The table row that links to Ticket `id`, or '' when there is none. */
const rowOf = (html: string, id: number) => html.split('<tr>').find((r) => r.includes(`href="/tickets/${id}"`)) ?? '';

/** The table row that links to Reimbursement Request `id`, or '' when there is none. */
const reimbursementRow = (html: string, id: number) => html.split('<tr>').find((r) => r.includes(`href="/reimbursements/${id}"`)) ?? '';

/** Follows a POST's redirect and returns the page it lands on. */
async function follow(w: Web, res: Response, cookie: string) {
  expect(res.status).toBe(303);
  const location = res.headers.get('location')!;
  return { html: await text(w, location.replace(/#.*/, ''), cookie), location };
}

/** Tom reports water through the ceiling, an Urgent Repair; returns its receipt link and id. */
async function burstPipe(w: Web) {
  w.h.classifier.when('Water is pouring through the ceiling', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'urgent', trade: 'plumbing' });
  await w.h.receive(TOM, 'Water is pouring through the ceiling');
  const link = w.h.messenger.last(TOM)!.data.receiptLink as string;
  return { link, id: (await w.alice.dashboard()).urgentRepairs[0]!.urgentRepairId };
}

describe('Tickets: new Maintenance Requests', () => {
  test('lists the Maintenance Requests waiting above the open Tickets, oldest first, each with Confirm and a link to its review', async () => {
    const w = await webWorld();
    await report(w, TOM, 'The kitchen tap is dripping');
    await w.h.advance(HOUR);
    await report(w, HANA, 'The bathroom fan is rattling');
    await w.h.advance(49 * HOUR);

    const html = await text(w, '/tickets');
    const requests = sectionOf(html, 'New Maintenance Requests');
    const readable = visible(requests);
    expect(readable.indexOf('The kitchen tap is dripping')).toBeGreaterThan(-1);
    expect(readable.indexOf('The kitchen tap is dripping')).toBeLessThan(readable.indexOf('The bathroom fan is rattling'));
    expect(readable).toContain(KING_ST);
    expect(html.indexOf('New Maintenance Requests')).toBeLessThan(html.indexOf('Open Tickets'));
    const { maintenanceRequests } = await w.alice.dashboard();
    for (const r of maintenanceRequests) {
      expect(requests).toContain(`href="/requests/${r.issueId}"`);
      expect(requests).toContain(`action="/requests/${r.issueId}/confirm"`);
    }
  });

  test('says so when nothing is waiting', async () => {
    const w = await webWorld();
    expect(visible(await text(w, '/tickets', await w.signIn()))).toContain('No Maintenance Requests waiting for you.');
  });

  test('the old Requests list sends the Property Manager to Tickets, keeping the filters', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const plain = await w.get('/requests', cookie);
    expect(plain.status).toBe(303);
    expect(plain.headers.get('location')).toBe('/tickets');
    const filtered = await w.get('/requests?filter=all&urgency=high', cookie);
    expect(filtered.status).toBe(303);
    expect(filtered.headers.get('location')).toBe('/tickets?filter=all&urgency=high');
  });
});

describe('Tickets: open Tickets', () => {
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
    const row = rowOf(html, ids.tap);
    const issue = row.indexOf('The kitchen tap is dripping');
    expect(issue).toBeGreaterThan(-1);
    expect(row.indexOf(`#${ids.tap}`)).toBeGreaterThan(issue);
    expect(row.indexOf(KING_ST)).toBeGreaterThan(issue);
    expect(row).toContain(`href="/properties/${w.ids.kingSt}"`);
  });

  test('a Ticket without photos shows the same quiet placeholder as a request without one', async () => {
    const w = await webWorld();
    const ids = await threeTickets(w);
    const row = rowOf(await text(w, '/tickets'), ids.tap);
    expect(row).toContain('class="issue-thumb-none"');
    expect(row).not.toContain('<img');
  });

  test('shows only the Property Manager’s own Tickets until All is chosen', async () => {
    const w = await webWorld();
    const ids = await threeTickets(w);

    const mine = await text(w, '/tickets');
    expect(mine).toContain(`href="/tickets/${ids.tap}"`);
    expect(mine).not.toContain(`href="/tickets/${ids.leak}"`);
  });

  test('leaves closed Tickets to the Archive, and sends the old closed tab there with its filters', async () => {
    const w = await webWorld();
    const ids = await threeTickets(w);
    await w.alice.cancelJob((await w.alice.ticket(ids.fan)).jobs[0]!.jobId);
    await w.alice.closeTicket(ids.fan);

    const html = await text(w, '/tickets?filter=all');
    expect(html).toContain(`href="/tickets/${ids.tap}"`);
    expect(html).not.toContain(`href="/tickets/${ids.fan}"`);
    expect(html).not.toContain('aria-label="Status"');

    const res = await w.get('/tickets?filter=all&status=closed&urgency=routine', await w.signIn());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/archive?filter=all&urgency=routine');
  });

  test('pairs each Job’s Trade with its stage, and says when an open Ticket is ready to close', async () => {
    const w = await webWorld();
    const ids = await threeTickets(w);
    await w.alice.cancelJob((await w.alice.ticket(ids.fan)).jobs[0]!.jobId);

    const html = await text(w, '/tickets?filter=all');
    // Each Job is its own item, its Trade then its stage.
    const jobsOf = (id: number) => [...rowOf(html, id).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => visible(m[1]!).trim());
    expect(jobsOf(ids.tap)).toEqual(['Plumbing Quoting']);
    expect(visible(rowOf(html, ids.tap))).not.toContain('Ready to close');
    expect(jobsOf(ids.fan)).toEqual(['Plumbing Cancelled']);
    expect(visible(rowOf(html, ids.fan))).toContain('Ready to close');
  });

  test('says so when there are none, with the way to every Property Manager’s', async () => {
    const w = await webWorld();
    const html = await text(w, '/tickets', await w.signIn());
    expect(visible(html)).toContain('No open Tickets on your Properties.');
    expect(html).toMatch(/href="\/tickets\?filter=all"[^>]*>\s*Show all Tickets/);
  });
});

describe('Tickets: the filter bar', () => {
  test('offers the Urgencies a Ticket can have, every Trade and the Agency’s Properties, keeping Mine or All', async () => {
    const w = await webWorld();
    const html = await text(w, '/tickets?filter=all');
    const start = html.indexOf('<form method="get"');
    const bar = html.slice(start, html.indexOf('</form>', start));
    expect(bar).toContain('action="/tickets"');
    expect(bar).toContain('name="filter" value="all"');
    const options = (name: string) => {
      const select = new RegExp(`<select name="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(bar)?.[1] ?? '';
      return [...select.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]);
    };
    expect(options('urgency')).toEqual([['', 'Any Urgency'], ['high', 'High'], ['routine', 'Routine']]);
    expect(options('trade')).toContainEqual(['pest_control', 'Pest control']);
    expect(options('trade')).toHaveLength(9);
    // By address: "12 King St" before "5/40 Ocean Ave".
    expect(options('property')).toEqual([['', 'Any Property'], [String(w.ids.kingSt), KING_ST], [String(w.ids.oceanAve), OCEAN_AVE]]);
  });

  test('Mine and All keep the filters', async () => {
    const w = await webWorld();
    const html = await text(w, '/tickets?urgency=high');
    expect(html).toContain('href="/tickets?filter=all&amp;urgency=high"');
  });

  test('narrows the new Maintenance Requests and the open Tickets alike, by Urgency, Trade and Property', async () => {
    const w = await webWorld();
    const ids = await threeTickets(w);
    await w.alice.setJobTrade((await w.alice.ticket(ids.fan)).jobs[0]!.jobId, 'electrical');
    await report(w, TOM, 'The oven will not heat', 'high', 'appliances');
    await report(w, BELLA, 'The front door lock sticks', 'routine', 'locksmith');
    await w.h.advance(49 * HOUR);

    const high = await text(w, '/tickets?filter=all&urgency=high');
    expect(high).toContain(`href="/tickets/${ids.leak}"`);
    expect(high).not.toContain(`href="/tickets/${ids.tap}"`);
    expect(visible(high)).toContain('The oven will not heat');
    expect(visible(high)).not.toContain('The front door lock sticks');

    const electrical = await text(w, '/tickets?filter=all&trade=electrical');
    expect(electrical).toContain(`href="/tickets/${ids.fan}"`);
    expect(electrical).not.toContain(`href="/tickets/${ids.tap}"`);
    expect(visible(electrical)).not.toContain('The oven will not heat');
    expect(visible(electrical)).toContain('No Maintenance Requests match these filters.');

    const locks = visible(await text(w, '/tickets?filter=all&trade=locksmith'));
    expect(locks).toContain('The front door lock sticks');
    expect(locks).toContain('No open Tickets match these filters.');

    const ocean = await text(w, `/tickets?filter=all&property=${w.ids.oceanAve}`);
    expect(ocean).toContain(`href="/tickets/${ids.leak}"`);
    expect(ocean).not.toContain(`href="/tickets/${ids.tap}"`);
    expect(visible(ocean)).toContain('The front door lock sticks');
    expect(visible(ocean)).not.toContain('The oven will not heat');

    // Mine still limits a Property filter to the Property Manager's own Properties.
    const notMine = await text(w, `/tickets?property=${w.ids.oceanAve}`);
    expect(notMine).not.toContain(`href="/tickets/${ids.leak}"`);
  });
});

describe('Archive', () => {
  /** The three Tickets, with the tap closed before the leak: the fan stays open. */
  async function twoClosed(w: Web) {
    const ids = await threeTickets(w);
    for (const id of [ids.tap, ids.leak]) {
      const actor = id === ids.leak ? w.bob : w.alice;
      await actor.cancelJob((await actor.ticket(id)).jobs[0]!.jobId);
      await actor.closeTicket(id);
      await w.h.advance(HOUR);
    }
    return ids;
  }

  test('lists closed Tickets, the most recently closed first, and no open ones', async () => {
    const w = await webWorld();
    const ids = await twoClosed(w);

    const html = await text(w, '/archive?filter=all');
    const leak = html.indexOf(`href="/tickets/${ids.leak}"`);
    const tap = html.indexOf(`href="/tickets/${ids.tap}"`);
    expect(leak).toBeGreaterThan(-1);
    expect(tap).toBeGreaterThan(leak);
    expect(html).not.toContain(`href="/tickets/${ids.fan}"`);
    expect(visible(rowOf(html, ids.tap))).toMatch(/Plumbing Cancelled/);
    expect(visible(rowOf(html, ids.tap))).toMatch(/Closed/);
    expect(rowOf(html, ids.tap)).toContain('queue-thumb');
  });

  test('shows the Property Manager’s own until All is chosen, and takes the same filters', async () => {
    const w = await webWorld();
    const ids = await twoClosed(w);

    const mine = await text(w, '/archive');
    expect(mine).toContain(`href="/tickets/${ids.tap}"`);
    expect(mine).not.toContain(`href="/tickets/${ids.leak}"`);
    expect(mine).toContain('action="/archive"');

    const high = await text(w, '/archive?filter=all&urgency=high');
    expect(high).toContain(`href="/tickets/${ids.leak}"`);
    expect(high).not.toContain(`href="/tickets/${ids.tap}"`);
  });

  test('says so when nothing is closed yet', async () => {
    const w = await webWorld();
    const html = await text(w, '/archive', await w.signIn());
    expect(visible(html)).toContain('No closed Tickets on your Properties yet.');
    expect(html).toMatch(/href="\/archive\?filter=all"[^>]*>\s*Show all closed Tickets/);
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
    expect(visible(after)).toContain('Nothing is waiting on a Property Owner, and no Reimbursement Requests are open.');
    expect(after).toMatch(/href="\/approvals\?filter=all"[^>]*>\s*Show all approvals/);
    expect(visible(after)).not.toContain('Waiting on a Property Owner');
    expect(railCount(after, '/approvals')).toBeNull();
  });

  test('lists every Reimbursement Request not yet reimbursed, the ones to review first, each opening its page', async () => {
    const w = await webWorld();
    const { id: waiting } = await burstPipe(w);
    w.h.classifier.when('The front door lock is broken and will not close', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'urgent', trade: 'locksmith' });
    await w.h.receive(HANA, 'The front door lock is broken and will not close');
    const link = w.h.messenger.last(HANA)!.data.receiptLink as string;
    const received = (await w.alice.dashboard()).urgentRepairs.find((u) => u.urgentRepairId !== waiting)!.urgentRepairId;
    await w.h.upload(link, [{ filename: 'receipt.pdf', contentType: 'application/pdf', content: new Uint8Array([1]) }], { amountCents: 1200_00 });

    const html = await text(w, '/approvals');
    const readable = visible(html);
    for (const expected of ['Reimbursement Requests', 'Water is pouring through the ceiling', 'Tom Tran', 'Olivia Owens', KING_ST, 'Awaiting receipt', 'Awaiting your review', '$1,200.00', 'Over the $1,000.00 limit']) {
      expect(readable).toContain(expected);
    }
    expect(readable).not.toContain('Urgent Repairs waiting on a receipt');
    expect(html).toContain(`href="/properties/${w.ids.kingSt}"`);
    // The one to review first, though reported later.
    expect(html.indexOf(`href="/reimbursements/${received}"`)).toBeGreaterThan(0);
    expect(html.indexOf(`href="/reimbursements/${received}"`)).toBeLessThan(html.indexOf(`href="/reimbursements/${waiting}"`));
    expect(html).toMatch(/<a href="#reimbursements" class="count-link[^"]*">1 Reimbursement Request to review<\/a>/);
    // The rail counts the one to review.
    expect(railCount(html, '/approvals')).toBe('1');
    // Only the list with rows is shown.
    expect(readable).not.toContain('Waiting on a Property Owner');

    await w.alice.forwardReimbursement(received);
    await w.alice.markReimbursed(received);
    const after = await text(w, '/approvals');
    expect(after).not.toContain(`href="/reimbursements/${received}"`);
    expect(after).toContain(`href="/reimbursements/${waiting}"`);
    expect(railCount(after, '/approvals')).toBeNull();
  });

  test('forwards an awaiting Reimbursement Request from its row, then marks it reimbursed there', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const { link, id } = await burstPipe(w);
    await w.h.upload(link, [{ filename: 'receipt.pdf', contentType: 'application/pdf', content: new Uint8Array([1]) }], { amountCents: 450_00 });

    const before = await text(w, '/approvals', cookie);
    const row = reimbursementRow(before, id);
    expect(row).toContain('Awaiting your review');
    expect(row).toContain(`action="/reimbursements/${id}/forward?from=approvals"`);
    expect(row).toContain('value="450.00"');
    expect(row).toContain('Forward to Owner');
    expect(row).not.toContain('Mark reimbursed');

    const { html: forwarded, location } = await follow(w, await w.post(`/reimbursements/${id}/forward?from=approvals`, { amount: '$430' }, cookie), cookie);
    expect(location).toContain('/approvals');
    expect(visible(forwarded)).toContain('Forwarded to Olivia Owens, the Property Owner, with you copied in.');
    const forwardedRow = reimbursementRow(forwarded, id);
    expect(forwardedRow).toContain('With Property Owner');
    expect(forwardedRow).toContain('Mark reimbursed');
    expect(forwardedRow).not.toContain('/forward');
    expect(w.h.messenger.to(OLIVIA_EMAIL)).toMatchObject([
      { template: 'owner.urgent_repair_receipt', cc: ['alice@harbour.example'], attachments: ['receipt.pdf'], data: { amountCents: 430_00 } },
    ]);

    const { html: done } = await follow(w, await w.post(`/reimbursements/${id}/reimbursed?from=approvals`, {}, cookie), cookie);
    expect(visible(done)).toContain('Marked reimbursed. Tom Tran has been told.');
    expect(reimbursementRow(done, id)).toBe('');
    expect(w.h.messenger.last(TOM)!.template).toBe('tenant.reimbursed');
  });

  test('refuses to forward from the row without an amount, or when the Property Owner cannot be reached, and keeps it for review', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const { link, id } = await burstPipe(w);
    await w.h.upload(link, [{ filename: 'receipt.pdf', contentType: 'application/pdf', content: new Uint8Array([1]) }]);

    const blank = await follow(w, await w.post(`/reimbursements/${id}/forward?from=approvals`, { amount: '' }, cookie), cookie);
    expect(visible(blank.html)).toContain('Enter the amount on the receipt');
    expect(reimbursementRow(blank.html, id)).toContain('Awaiting your review');
    expect(w.h.messenger.to(OLIVIA_EMAIL)).toEqual([]);

    // Olivia has only her mobile left, and the Agency has no SMS channel to text it on.
    await w.alice.editOwner(w.ids.olivia, { name: 'Olivia Owens', mobile: OLIVIA });
    await w.alice.disconnectServerSms(AGENCY_NUMBER);
    const unreachable = await follow(w, await w.post(`/reimbursements/${id}/forward?from=approvals`, { amount: '450' }, cookie), cookie);
    expect(visible(unreachable.html)).toContain("Couldn't send the message: no SMS channel is connected and they have no email address.");
    expect(visible(unreachable.html)).toContain('Awaiting your review');
    expect(reimbursementRow(unreachable.html, id)).toContain('Forward to Owner');
    expect(w.h.messenger.to(OLIVIA_EMAIL)).toEqual([]);
  });
});
