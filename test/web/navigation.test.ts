// The signed-in rail and the pages behind its entries: Requests, Tickets, Approvals,
// Schedule, Properties, Tradies and Settings. Each is read the way the Property
// Manager sees it, through the web app.

import { describe, expect, test } from 'vitest';
import { HOUR } from '../support/harness.ts';
import { visible, webWorld } from '../support/web.ts';
import { BELLA, confirmedQuotes, HANA, KING_ST, OCEAN_AVE, OLIVIA, TOM } from '../support/world.ts';

type Web = Awaited<ReturnType<typeof webWorld>>;

const RAIL = ['/', '/dispatch', '/requests', '/tickets', '/approvals', '/schedule', '/properties', '/tradies', '/settings'];

/** The page as the Property Manager sees it; signs in afresh, as the scenarios move the clock past a session's life. */
async function text(w: Web, path: string, cookie?: string) {
  const res = await w.get(path, cookie ?? (await w.signIn()));
  expect(res.status, path).toBe(200);
  return res.text();
}

/** The rail's links (the demo's Phone simulator excluded), in order. */
function railLinks(html: string) {
  return [...html.matchAll(/<a href="([^"]+)" class="rail-link"/g)].map((m) => m[1]);
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

describe('the rail', () => {
  test('lists every place in order on every signed-in page, with counts for Requests and Approvals', async () => {
    const w = await webWorld();
    const { ticketId } = await busyDesk(w);

    const paths = ['/', '/dispatch', '/requests', '/tickets', '/approvals', '/calendar', '/properties', '/tradies', '/settings', '/setup', `/tickets/${ticketId}`, `/tradies/${w.ids.pete}`];
    for (const path of paths) {
      const html = await text(w, path);
      expect(railLinks(html), path).toEqual(RAIL);
      expect(railCount(html, '/requests'), path).toBe('1');
      expect(railCount(html, '/approvals'), path).toBe('1');
      expect(railCount(html, '/tickets'), path).toBeNull();
    }
  });

  test('shows no count when nothing is waiting', async () => {
    const w = await webWorld();
    const html = await text(w, '/', await w.signIn());
    expect(railLinks(html)).toEqual(RAIL);
    expect(railCount(html, '/requests')).toBeNull();
    expect(railCount(html, '/approvals')).toBeNull();
  });

  test('marks the current place with aria-current on each page', async () => {
    const w = await webWorld();
    const current = (html: string) => [...html.matchAll(/<a href="([^"]+)" class="rail-link[^"]*" aria-current="page"/g)].map((m) => m[1]);
    const expected: Record<string, string> = {
      '/': '/',
      '/dispatch': '/dispatch',
      '/requests': '/requests',
      '/tickets': '/tickets',
      '/approvals': '/approvals',
      '/calendar': '/schedule',
      '/properties': '/properties',
      '/tradies': '/tradies',
      '/settings': '/settings',
      '/setup': '/settings',
    };
    for (const [path, href] of Object.entries(expected)) expect(current(await text(w, path)), path).toEqual([href]);
  });

  test('keeps the Ticket and Tradie pages under their own entries', async () => {
    const w = await webWorld();
    const ids = await threeTickets(w);
    const current = (html: string) => [...html.matchAll(/<a href="([^"]+)" class="rail-link[^"]*" aria-current="page"/g)].map((m) => m[1]);
    expect(current(await text(w, `/tickets/${ids.tap}`))).toEqual(['/tickets']);
    expect(current(await text(w, `/tradies/${w.ids.pete}`))).toEqual(['/tradies']);
  });
});

describe('signed out', () => {
  test('every new page sends a visitor to sign in', async () => {
    const w = await webWorld();
    for (const path of ['/requests', '/tickets', '/approvals', '/schedule', '/properties', `/properties/${w.ids.kingSt}`, '/tradies', '/settings']) {
      const res = await w.get(path);
      expect(res.status, path).toBe(303);
      expect(res.headers.get('location'), path).toBe(`/login?next=${encodeURIComponent(path)}`);
    }
  });
});

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

  test('says so when there are none', async () => {
    const w = await webWorld();
    expect(visible(await text(w, '/tickets', await w.signIn()))).toContain('No open Tickets on your Properties.');
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

describe('Schedule', () => {
  test('/schedule leads to the calendar, keeping the week', async () => {
    const w = await webWorld();
    const res = await w.get('/schedule?week=2026-10-19', await w.signIn());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/calendar?week=2026-10-19');
    expect(await text(w, '/calendar?week=2026-10-19')).toContain('Week of');
  });
});

describe('Properties', () => {
  test('lists every Property with its Owner, Max Repair Cost, Tenants and open Tickets, and links to Add a Property', async () => {
    const w = await webWorld();
    const { ticketId } = await busyDesk(w);

    const html = await text(w, '/properties');
    const readable = visible(html);
    for (const expected of [KING_ST, OCEAN_AVE, 'Olivia Owens', 'Oscar Ortiz', '$500.00', '$800.00', 'Tom Tran', 'Hana Ho', 'Bella Bui']) expect(readable).toContain(expected);
    expect(html).toContain(`href="/properties/${w.ids.kingSt}"`);
    expect(html).toContain(`href="/properties/${w.ids.oceanAve}"`);
    expect(html).toMatch(/href="\/setup#properties"/);
    expect(ticketId).toBeGreaterThan(0);
  });

  test('a Property’s page shows its Owner, Max Repair Cost, Tenants, nominated Tradies, frequent issues and open Tickets', async () => {
    const w = await webWorld();
    const { ticketId } = await busyDesk(w);

    const html = await text(w, `/properties/${w.ids.kingSt}`);
    const readable = visible(html);
    for (const expected of [KING_ST, 'Olivia Owens', '$500.00', 'Tom Tran', 'Hana Ho', "Nina's Plumbing", 'Sparky Sam', 'Plumbing', 'The kitchen tap is dripping']) {
      expect(readable).toContain(expected);
    }
    expect(html).toContain(`href="/tradies/${w.ids.nina}"`);
    expect(html).toContain(`href="/tickets/${ticketId}"`);
    expect(readable).toContain('Since 1 Jan 2025');
    // The open Tickets come first, then the Max Repair Cost.
    expect(readable.indexOf('Open Tickets')).toBeLessThan(readable.indexOf('Max Repair Cost'));
    expect(readable).toContain('No closed Tickets yet.');
  });

  test('a Property’s page keeps its closed Tickets as its history', async () => {
    const w = await webWorld();
    const { ticketId, jobId } = await busyDesk(w);
    await w.alice.cancelJob(jobId);
    await w.alice.closeTicket(ticketId);

    const html = await text(w, `/properties/${w.ids.kingSt}`);
    const closed = html.slice(html.indexOf('aria-label="Closed Tickets"'));
    expect(closed).toContain(`href="/tickets/${ticketId}"`);
    expect(visible(closed)).toContain('The kitchen tap is dripping');
  });

  test('is not found for a Property that is not the Agency’s', async () => {
    const w = await webWorld();
    const sam = await w.signUp();
    await w.connectEmail(sam);
    expect((await w.get(`/properties/${w.ids.kingSt}`, sam)).status).toBe(404);
    expect(visible(await text(w, '/properties', sam))).not.toContain(KING_ST);
  });
});

describe('Tradies', () => {
  test('lists the Tradies with the myEST8 rating beside the Google rating and the number of previous Quotes', async () => {
    const w = await webWorld();
    await busyDesk(w);

    const html = await text(w, '/tradies');
    const readable = visible(html);
    for (const expected of ["Pete's Plumbing", 'Drip Doctors', 'Sparky Sam', 'Not on Google', '4.8', 'myEST8 rating', 'Google rating', 'Previous Quotes']) {
      expect(readable).toContain(expected);
    }
    expect(html).toContain(`href="/tradies/${w.ids.pete}"`);

    const row = (name: string) => visible(html.split('<tr>').find((r) => r.includes(name)) ?? '');
    expect(row('Drip Doctors')).toMatch(/5\.0.*Not on Google.*1/);
    expect(row('Sparky Sam')).toMatch(/0\s*$/);
  });

  test('filters by Trade', async () => {
    const w = await webWorld();

    const electrical = await text(w, '/tradies?trade=electrical');
    expect(electrical).toContain('Sparky Sam');
    expect(electrical).not.toContain("Pete&#39;s Plumbing");
    expect(electrical).not.toContain("Pete's Plumbing");

    const plumbing = visible(await text(w, '/tradies?trade=plumbing'));
    expect(plumbing).toContain("Pete's Plumbing");
    expect(plumbing).not.toContain('Sparky Sam');
  });

  test('a Tradie’s page leads back to Tradies, and says which Ticket each previous Quote was for and whether it was chosen', async () => {
    const w = await webWorld();
    const { ticketId } = await busyDesk(w);

    const html = await text(w, `/tradies/${w.ids.dana}`);
    expect(html).toContain('href="/tradies"');
    const quotes = html.slice(html.indexOf('aria-label="Previous Quotes"'));
    expect(quotes).toContain(`href="/tickets/${ticketId}"`);
    expect(visible(quotes)).toContain('The kitchen tap is dripping');
    expect(visible(quotes)).toContain('Not decided yet');
    for (const group of ['From Property Managers', 'From Tenants']) expect(visible(html)).toContain(group);
  });

  test('applies the Trade filter as soon as one is picked, keeping the Filter button for when JavaScript is off', async () => {
    const w = await webWorld();
    const html = await text(w, '/tradies');
    expect(html).toMatch(/<form method="get" action="\/tradies"[^>]*data-autosubmit/);
    expect(visible(html)).toContain('Filter');
  });

  test('lists only the Agency’s own Tradies', async () => {
    const w = await webWorld();
    const sam = await w.signUp();
    await w.connectEmail(sam);
    expect(visible(await text(w, '/tradies', sam))).not.toContain("Pete's Plumbing");
  });
});

describe('Settings', () => {
  test('shows the Agency, and tabs into Channels, Team and Import in Setup', async () => {
    const w = await webWorld();

    const agency = await text(w, '/settings');
    const readable = visible(agency);
    for (const expected of ['Harbour Realty', 'Australia/Sydney', 'Agency', 'Channels', 'Team', 'Import']) expect(readable).toContain(expected);
    expect(agency).toContain('href="/settings?tab=channels"');
    for (const anchor of ['#properties', '#tradies', '#tenants', '#people']) expect(agency).toContain(`href="/setup${anchor}"`);
    expect(agency).not.toContain('Open Setup');

    const channels = await text(w, '/settings?tab=channels');
    expect(channels).toContain('href="/setup#channels"');
    expect(visible(channels)).toContain('inbox@harbour.example');

    const team = await text(w, '/settings?tab=team');
    expect(visible(team)).toContain('Alice Archer');
    expect(visible(team)).toContain('Bob Baker');
    expect(team).toContain('href="/welcome/team"');

    const imports = await text(w, '/settings?tab=import');
    for (const anchor of ['#properties', '#tradies', '#tenants', '#people']) expect(imports).toContain(`href="/setup${anchor}"`);
  });
});
