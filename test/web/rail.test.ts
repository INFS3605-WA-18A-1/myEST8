// The signed-in rail: its places, counts and current item on every page.

import { describe, expect, test } from 'vitest';
import type { DemoControls } from '../../src/demo/controls.ts';
import { HOUR } from '../support/harness.ts';
import { visible, webWorld } from '../support/web.ts';
import { BELLA, confirmedQuotes, HANA, KING_ST, OCEAN_AVE, OLIVIA, TOM } from '../support/world.ts';

type Web = Awaited<ReturnType<typeof webWorld>>;

const RAIL = ['/', '/dispatch', '/requests', '/tickets', '/approvals', '/calendar', '/properties', '/tradies', '/settings'];

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

const noDemo = (): DemoControls => ({
  contacts: async () => [],
  outbox: async () => [],
  inbound: async () => [],
  sendAs: async () => {},
  advance: async () => {},
  now: () => new Date(),
});

describe('the rail', () => {
  test('links to the Phone simulator on every signed-in page only when the app runs as the demo', async () => {
    const paths = ['/', '/requests', '/tickets', '/properties', '/tradies', '/settings', '/setup', '/dispatch', '/calendar', '/approvals'];
    const live = await webWorld();
    const cookie = await live.signIn();
    for (const path of paths) expect(await text(live, path, cookie), path).not.toContain('href="/demo"');
    const demo = await webWorld({ demo: noDemo() });
    const demoCookie = await demo.signIn();
    for (const path of paths) expect(await text(demo, path, demoCookie), path).toContain('href="/demo"');
  });

  test('lists every place in order on every signed-in page, with counts for Requests and Approvals', async () => {
    const w = await webWorld();
    const { ticketId } = await busyDesk(w);

    const paths = ['/', '/requests', '/tickets', '/approvals', '/calendar', '/properties', '/tradies', '/settings', '/setup', `/tickets/${ticketId}`, `/tradies/${w.ids.pete}`];
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
            '/requests': '/requests',
      '/tickets': '/tickets',
      '/approvals': '/approvals',
      '/calendar': '/calendar',
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
    for (const path of ['/requests', '/tickets', '/approvals', '/calendar', '/properties', `/properties/${w.ids.kingSt}`, '/tradies', '/settings']) {
      const res = await w.get(path);
      expect(res.status, path).toBe(303);
      expect(res.headers.get('location'), path).toBe(`/login?next=${encodeURIComponent(path)}`);
    }
  });
});

