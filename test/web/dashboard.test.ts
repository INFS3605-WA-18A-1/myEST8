import { describe, expect, test } from 'vitest';
import { HOUR } from '../support/harness.ts';
import { upload } from '../support/photos.ts';
import { webWorld } from '../support/web.ts';
import { confirmedQuotes, KING_ST, STRANGER, TOM, tomsTapTicket, type World } from '../support/world.ts';

type Web = Awaited<ReturnType<typeof webWorld>>;

const TUE_9AM = new Date('2026-10-13T09:00:00+11:00');

/** Tom reports a dripping tap and answers every question; returns his photo upload link. */
async function tomReportsTap({ h }: World) {
  h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
  await h.receive(TOM, 'The kitchen tap is dripping');
  await h.answer(TOM, 'Kitchen sink');
  await h.answer(TOM, 'Since Monday');
  await h.answer(TOM, 'No', 'no');
  await h.answer(TOM, 'Mornings', 'weekday_mornings');
  return h.messenger.last(TOM)!.data.uploadLink as string;
}

/**
 * Tom's tap, with no photos, reaches the Property Manager as a Maintenance Request
 * after 48 hours. Signs Alice in once the time has passed; returns her cookie and the request's id.
 */
async function tomsTapRequest(w: Web) {
  await tomReportsTap(w);
  await w.h.advance(48 * HOUR);
  const cookie = await w.signIn();
  return { cookie, issueId: match(await page(w, '/requests', cookie), /action="\/requests\/(\d+)\/confirm"/) };
}

async function page(w: Web, path: string, cookie: string) {
  const res = await w.get(path, cookie);
  expect(res.status).toBe(200);
  return res.text();
}

/** Follows a form's redirect and returns the page it lands on. */
async function follow(w: Web, res: Response, cookie: string) {
  expect(res.status).toBe(303);
  return page(w, res.headers.get('location')!, cookie);
}

function match(text: string, pattern: RegExp) {
  const found = pattern.exec(text);
  if (!found) throw new Error(`Nothing matches ${pattern}`);
  return found[1]!;
}

describe('Maintenance Requests page', () => {
  test('a waiting Maintenance Request shows its answers and flags, and confirming it opens the new Ticket', async () => {
    const w = await webWorld();
    const { cookie } = await tomsTapRequest(w);

    const dashboard = await page(w, '/requests', cookie);
    for (const text of ['The kitchen tap is dripping', KING_ST, 'No photos', 'Plumbing']) {
      expect(dashboard).toContain(text);
    }
    const issueId = match(dashboard, /action="\/requests\/(\d+)\/confirm"/);

    const review = await page(w, `/requests/${issueId}`, cookie);
    for (const text of ['Tom Tran', 'Kitchen sink', 'Since Monday', 'Weekday mornings', KING_ST]) {
      expect(review).toContain(text);
    }

    const res = await w.post(`/requests/${issueId}/confirm`, {}, cookie);
    expect(res.status).toBe(303);
    const ticketId = match(res.headers.get('location')!, /^\/tickets\/(\d+)\?ok=/);

    expect(await page(w, '/requests', cookie)).toContain('No Maintenance Requests waiting for you.');
    expect(await page(w, '/tickets', cookie)).toContain(`href="/tickets/${ticketId}"`);
  });

  test('rejecting needs a reason for the Tenant', async () => {
    const w = await webWorld();
    const { cookie, issueId } = await tomsTapRequest(w);

    const refused = await w.post(`/requests/${issueId}/reject`, { reason: '  ' }, cookie);
    expect(refused.headers.get('location')).toMatch(/^\/requests\?error=/);
    expect(await follow(w, refused, cookie)).toContain('Give the Tenant a reason');

    const rejected = await w.post(`/requests/${issueId}/reject`, { reason: 'A new washer fixes this, see your lease' }, cookie);
    const after = await follow(w, rejected, cookie);
    expect(after).toContain('Rejected. The Tenant has been told why.');
    expect(after).toContain('No Maintenance Requests waiting for you.');
  });

  test('changing the Urgency to Urgent turns it into an Urgent Repair', async () => {
    const w = await webWorld();
    const { cookie, issueId } = await tomsTapRequest(w);

    const after = await follow(w, await w.post(`/requests/${issueId}/urgency`, { urgency: 'urgent' }, cookie), cookie);

    expect(after).toContain('Now an Urgent Repair');
    expect(after).toContain('No Maintenance Requests waiting for you.');
    expect(after).toContain('Waiting for receipt');
  });

  test("a Tenant's photo is shown with its checks and served only to signed-in Property Managers", async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    await w.h.upload(await tomReportsTap(w), [upload('tap.jpg')]);

    const dashboard = await page(w, '/requests', cookie);
    const fileId = match(dashboard, /src="\/files\/(\d+)"/);

    const review = await page(w, `/requests/${match(dashboard, /href="\/requests\/(\d+)"/)}`, cookie);
    expect(review).toContain('No metadata');
    expect(review).toContain('Photos match the description');

    const photo = await w.get(`/files/${fileId}`, cookie);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/jpeg');
    expect(photo.headers.get('content-disposition')).toBe('inline');
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(upload('tap.jpg').content);

    expect((await w.get('/files/99999', cookie)).status).toBe(404);
    expect((await w.get(`/files/${fileId}`)).status).toBe(303);
  });
});

describe('Maintenance Request review', () => {
  test('an unknown Maintenance Request is not found', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const res = await w.get('/requests/99999', cookie);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('There is no Maintenance Request waiting for you with that number.');
  });
});

describe('Tickets page', () => {
  test('a Ticket with a Job being quoted sits in the Quoting lane', async () => {
    const w = await webWorld();
    const { ticketId } = await tomsTapTicket(w);
    const cookie = await w.signIn();

    const board = await page(w, '/tickets?view=stage', cookie);
    const start = board.indexOf('<h3 class="lane-title">Quoting</h3>');
    const next = board.indexOf('<h3 class="lane-title">With Property Owner</h3>', start);
    expect(start).toBeGreaterThan(-1);
    expect(board.slice(start, next)).toContain(`href="/tickets/${ticketId}" class="docket"`);
  });

  test("Bob's own list leaves out Alice's Tickets, and \"all\" shows them", async () => {
    const w = await webWorld();
    const { ticketId } = await tomsTapTicket(w);
    const bob = await w.signIn('bob@harbour.example');

    const mine = await page(w, '/tickets', bob);
    expect(mine).not.toContain(`href="/tickets/${ticketId}"`);
    expect(mine).toContain('No open Tickets on your Properties.');

    const all = await page(w, '/tickets?filter=all', bob);
    expect(all).toContain(`href="/tickets/${ticketId}"`);
    expect(all).toContain('Alice Archer');
  });
});

describe('the Agency inbox', () => {
  test('an unknown sender is linked to a Tenant, then the message is dismissed', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    await w.h.receive(STRANGER, 'Hi, this is Tom on my work phone');

    const inbox = await page(w, '/requests', cookie);
    expect(inbox).toContain('Unknown sender');
    expect(inbox).toContain(STRANGER);
    expect(inbox).toContain('Hi, this is Tom on my work phone');
    const itemId = match(inbox, /action="\/inbox\/(\d+)\/link"/);

    const unchosen = await w.post(`/inbox/${itemId}/link`, { personId: '' }, cookie);
    expect(await follow(w, unchosen, cookie)).toContain('Choose who sent this message');

    const linked = await follow(w, await w.post(`/inbox/${itemId}/link`, { personId: w.ids.tom }, cookie), cookie);
    expect(linked).toContain('Sender linked');
    // An unknown sender's message has no best guess to route with, so only Dismiss is offered.
    expect(linked).not.toContain('Route with best guess');
    expect(linked).not.toContain(`action="/inbox/${itemId}/link"`);

    const dismissed = await follow(w, await w.post(`/inbox/${itemId}/dismiss`, {}, cookie), cookie);
    expect(dismissed).toContain('Message dismissed');
    expect(dismissed).toContain('The inbox is empty.');
  });
});

describe('the calendar and Tradie profiles', () => {
  test("a booked visit shows on its day in the calendar, the dashboard and the Tradie's profile", async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    const cookie = await w.signIn();

    const week = await page(w, '/calendar?week=2026-10-14', cookie);
    expect(week).toContain('Week of Monday 12 October 2026');
    expect(week).toContain('/calendar?week=2026-10-05');
    expect(week).toContain('/calendar?week=2026-10-19');
    const booking = week.indexOf(`href="/tickets/${job.ticketId}"`);
    expect(week.indexOf('Tuesday 13 October')).toBeLessThan(booking);
    expect(week.indexOf('Wednesday 14 October')).toBeGreaterThan(booking);
    expect(week).toContain(`href="/tradies/${w.tradies.pete.id}"`);
    expect(week).toContain(KING_ST);
    expect(week).toContain('Plumbing');

    expect(await page(w, '/calendar?week=2026-10-19', cookie)).not.toContain(KING_ST);
    expect(await page(w, '/', cookie)).toContain(`href="/tradies/${w.tradies.pete.id}"`);

    const pete = await page(w, `/tradies/${w.tradies.pete.id}`, cookie);
    for (const text of ['Pete Park', 'myEST8 rating', '4.0', '4.8', '120 reviews', '$150.00', KING_ST]) expect(pete).toContain(text);
  });

  test('the Next 7 days strip shows a visit booked within a week of today, with its Tradie and Ticket', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    const cookie = await w.signIn();

    const board = await page(w, '/', cookie);
    const start = board.indexOf('id="next-7-days"');
    expect(start).toBeGreaterThan(-1);
    const strip = board.slice(start, board.indexOf('</section>', start));
    expect(strip).toContain('Tue 13 Oct');
    expect(strip).toContain(`href="/tradies/${w.tradies.pete.id}"`);
    expect(strip).toContain(`href="/tickets/${job.ticketId}"`);
    expect(strip).toContain('12 King St');
    expect(strip).toContain('Nothing booked Wed 14 – Fri 16 Oct');
  });

  test('a Tradie not on Google says so, and an unknown Tradie is not found', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const dana = await page(w, `/tradies/${w.tradies.dana.id}`, cookie);
    expect(dana).toContain('Drip Doctors');
    expect(dana).toContain('Not on Google');
    expect(dana).toContain('5.0');

    expect((await w.get('/tradies/99999', cookie)).status).toBe(404);
  });
});
