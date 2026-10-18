import { describe, expect, test } from 'vitest';
import { HOUR } from '../support/harness.ts';
import { upload } from '../support/photos.ts';
import { webWorld } from '../support/web.ts';
import { confirmedQuotes, jobView, KING_ST, STRANGER, TOM, tomsTapTicket, tradieQuotes, type World } from '../support/world.ts';

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
  return { cookie, issueId: match(await page(w, '/', cookie), /action="\/requests\/(\d+)\/confirm"/) };
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

describe('Maintenance Requests on the dashboard', () => {
  test('a waiting Maintenance Request shows its answers and flags, and confirming it opens the new Ticket', async () => {
    const w = await webWorld();
    const { cookie } = await tomsTapRequest(w);

    const dashboard = await page(w, '/', cookie);
    for (const text of ['The kitchen tap is dripping', '12 King St', 'No photos', 'Plumbing']) {
      expect(dashboard).toContain(text);
    }
    // On phones the decisions come first: they are first in the page, and the board is placed above them from 1024px.
    expect(dashboard.indexOf('id="decisions"')).toBeLessThan(dashboard.indexOf('id="tickets"'));
    const issueId = match(dashboard, /action="\/requests\/(\d+)\/confirm"/);

    const review = await page(w, `/requests/${issueId}`, cookie);
    for (const text of ['Tom Tran', 'Kitchen sink', 'Since Monday', 'Weekday mornings', KING_ST]) {
      expect(review).toContain(text);
    }

    const res = await w.post(`/requests/${issueId}/confirm`, {}, cookie);
    expect(res.status).toBe(303);
    const ticketId = match(res.headers.get('location')!, /^\/tickets\/(\d+)\?ok=/);

    const after = await page(w, '/', cookie);
    expect(after).toContain('No Maintenance Requests waiting for you.');
    expect(after).toContain(`href="/tickets/${ticketId}"`);
  });

  test('rejecting needs a reason for the Tenant', async () => {
    const w = await webWorld();
    const { cookie, issueId } = await tomsTapRequest(w);

    const refused = await w.post(`/requests/${issueId}/reject`, { reason: '  ' }, cookie);
    expect(refused.headers.get('location')).toMatch(/^\/\?error=/);
    expect(await follow(w, refused, cookie)).toContain('Give the Tenant a reason');

    const rejected = await w.post(`/requests/${issueId}/reject`, { reason: 'A new washer fixes this, see your lease' }, cookie);
    const after = await follow(w, rejected, cookie);
    expect(after).toContain('Rejected. The Tenant has been told why.');
    expect(after).toContain('No Maintenance Requests waiting for you.');
  });

  test('an action taken on the review page or Requests list goes back there, and anywhere else goes to the dashboard', async () => {
    const w = await webWorld();
    const { cookie, issueId } = await tomsTapRequest(w);

    const fromReview = await w.post(`/requests/${issueId}/reject`, { reason: '', return: `/requests/${issueId}` }, cookie);
    expect(fromReview.headers.get('location')).toMatch(new RegExp(`^/requests/${issueId}\\?error=`));
    const elsewhere = await w.post(`/requests/${issueId}/reject`, { reason: '', return: '//evil.example/requests' }, cookie);
    expect(elsewhere.headers.get('location')).toMatch(/^\/\?error=/);
    const sideways = await w.post(`/requests/${issueId}/reject`, { reason: '', return: '/requests/1/../../settings' }, cookie);
    expect(sideways.headers.get('location')).toMatch(/^\/\?error=/);

    const fromList = await w.post(`/requests/${issueId}/urgency`, { urgency: 'high', return: '/requests' }, cookie);
    expect(fromList.headers.get('location')).toMatch(/^\/requests\?ok=/);
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

    const dashboard = await page(w, '/', cookie);
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

describe('the count sentence and Needs you', () => {
  /** Alice's dashboard with one Routine Ticket to choose from and one High Ticket whose site quotes are to book. */
  async function quoteDecisions() {
    const w = await webWorld();
    const routine = await tomsTapTicket(w);
    await confirmedQuotes(w, routine, [
      [w.tradies.pete, 300_00],
      [w.tradies.dana, 340_00],
    ]);
    const high = await tomsTapTicket(w);
    await w.alice.changeUrgency({ ticketId: high.ticketId }, 'high');
    await confirmedQuotes(w, high, [
      [w.tradies.pete, 300_00],
      [w.tradies.dana, 340_00],
    ]);
    return { w, cookie: await w.signIn(), routine, high };
  }

  test('the sentence counts what needs the Property Manager, with singular wording for one', async () => {
    const { w, cookie } = await quoteDecisions();
    const dashboard = await page(w, '/', cookie);
    const sentence = match(dashboard, /<p class="count-sentence">([\s\S]*?)<\/p>/).replace(/<[^>]+>/g, '');
    expect(sentence).toContain('1 Quote to choose');
    expect(sentence).toContain('1 Site quote to book');
    expect(sentence).not.toMatch(/\b1 (Quotes|Site quotes|Alerts)/);
    expect(sentence).not.toContain('Open Tickets');
  });

  test('says so when nothing needs the Property Manager', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    expect(await page(w, '/', cookie)).toContain('Nothing needs you right now.');
  });

  test('Needs you leads the page and holds Quotes to choose and Book site quotes once each', async () => {
    const { w, cookie, routine, high } = await quoteDecisions();
    const dashboard = await page(w, '/', cookie);
    expect(dashboard.indexOf('id="decisions"')).toBeLessThan(dashboard.indexOf('id="tickets"'));
    expect(dashboard).toContain('class="needs-you"');
    expect(dashboard).toContain('Site quotes to book');
    expect(dashboard).toContain('Book site quotes');
    expect(dashboard).toContain('Choose a Quote');
    const needs = dashboard.slice(dashboard.indexOf('id="decisions"'), dashboard.indexOf('id="tickets"'));
    expect(needs).toContain(`href="/tickets/${high.ticketId}"`);
    expect(needs).toContain(`href="/tickets/${routine.ticketId}"`);
  });

  test('the board has a Site quotes lane and no inbox or Ticket list is repeated below it', async () => {
    const { w, cookie } = await quoteDecisions();
    const dashboard = await page(w, '/', cookie);
    expect(dashboard).toContain('Site quotes');
    expect(dashboard).toContain('class="board-lanes"');
    expect(dashboard.match(/id="inbox"/g) ?? []).toHaveLength(0);
    expect(dashboard.match(/All open Tickets/g) ?? []).toHaveLength(0);
    expect(dashboard.match(/id="tickets"/g)).toHaveLength(1);
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

/** The Ticket's docket in the board (the part of the page from Tickets by stage on), not its row in Needs you. */
function inBoard(page: string, ticketId: number) {
  const board = page.slice(page.indexOf('id="tickets"'));
  const at = board.indexOf(`href="/tickets/${ticketId}"`);
  return board.slice(at, board.indexOf('</a>', at));
}

describe('Tickets on the dashboard', () => {
  test('a Quoting docket says what the Property Manager has to do: check the Quotes in, then choose', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const cookie = await w.signIn();
    const docketOf = (page: string) => inBoard(page, job.ticketId);

    const board = await page(w, '/', cookie);
    expect(board).toContain('<h3 class="lane-title">Quoting</h3>');
    expect(board).toContain('href="/tickets"');
    expect(board).not.toContain('All open Tickets');
    const asked = docketOf(board);
    expect(asked).toContain('class="docket"');
    expect(asked).toContain('No Quote Requests yet');
    expect(asked.indexOf('The kitchen tap is dripping')).toBeLessThan(asked.indexOf(KING_ST.split(',')[0]!));

    await w.alice.sendQuoteRequests(job.jobId, [w.tradies.pete.id, w.tradies.dana.id]);
    await tradieQuotes(w, job, w.tradies.pete, '$150 Tuesday', { priceCents: 150_00 });
    await tradieQuotes(w, job, w.tradies.dana, '$180 Tuesday', { priceCents: 180_00 });
    const toCheck = docketOf(await page(w, '/', cookie));
    expect(toCheck).toContain('class="docket is-decision"');
    expect(toCheck).toContain('2 Quotes to check');

    for (const quote of (await jobView(w, job)).quotes) await w.alice.confirmQuote(quote.quoteId);
    const ready = docketOf(await page(w, '/', cookie));
    expect(ready).toContain('class="docket is-decision"');
    expect(ready).toContain('Ready to choose');
  });

  test("Bob's own list leaves out Alice's Tickets, and \"all\" shows them", async () => {
    const w = await webWorld();
    const { ticketId } = await tomsTapTicket(w);
    const bob = await w.signIn('bob@harbour.example');

    const mine = await page(w, '/', bob);
    expect(mine).not.toContain(`href="/tickets/${ticketId}"`);
    expect(mine).toContain('No open Tickets on your Properties.');

    const all = await page(w, '/?filter=all', bob);
    expect(all).toContain(`href="/tickets/${ticketId}"`);
    expect(all).toContain('href="/tickets?filter=all"');
  });
});

describe('the Agency inbox', () => {
  test('an unknown sender is linked to a Tenant, then the message is dismissed', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    await w.h.receive(STRANGER, 'Hi, this is Tom on my work phone');

    const inbox = await page(w, '/', cookie);
    expect(inbox).toContain('Unknown sender');
    expect(inbox).toContain(STRANGER);
    // The message shows once, in Needs your decision, with its actions on it.
    expect(inbox.match(/Hi, this is Tom on my work phone/g)).toHaveLength(1);
    const decisions = inbox.slice(inbox.indexOf('id="decisions"'), inbox.indexOf('</section>', inbox.indexOf('id="decisions"')));
    const itemId = match(decisions, /id="inbox-(\d+)"/);
    expect(decisions).toContain(`action="/inbox/${itemId}/link"`);
    expect(decisions).toContain(`action="/inbox/${itemId}/dismiss"`);
    expect(inbox).not.toContain('href="#inbox-');

    const unchosen = await w.post(`/inbox/${itemId}/link`, { personId: '' }, cookie);
    expect(await follow(w, unchosen, cookie)).toContain('Choose who sent this message');

    const linked = await follow(w, await w.post(`/inbox/${itemId}/link`, { personId: w.ids.tom }, cookie), cookie);
    expect(linked).toContain('Sender linked');
    // An unknown sender's message has no best guess to route with, so only Dismiss is offered.
    expect(linked).not.toContain('Route with best guess');
    expect(linked).not.toContain(`action="/inbox/${itemId}/link"`);

    const dismissed = await follow(w, await w.post(`/inbox/${itemId}/dismiss`, {}, cookie), cookie);
    expect(dismissed).toContain('Message dismissed');
    expect(dismissed).not.toContain(`id="inbox-${itemId}"`);
    expect(dismissed).not.toContain('Hi, this is Tom on my work phone');
  });
});

describe('the Next 7 days and Tradie profiles', () => {
  test("a booked visit shows on the dashboard and the Tradie's profile", async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    const cookie = await w.signIn();

    const week = await page(w, '/calendar?week=2026-10-14', cookie);
    expect(week).toContain('Week of Monday 12 October 2026');
    expect(week).toContain('/calendar?view=week&amp;date=2026-10-05');
    expect(week).toContain('/calendar?view=week&amp;date=2026-10-19');
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
