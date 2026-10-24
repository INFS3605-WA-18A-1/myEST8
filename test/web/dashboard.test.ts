import { describe, expect, test } from 'vitest';
import { HOUR } from '../support/harness.ts';
import { upload } from '../support/photos.ts';
import { webWorld } from '../support/web.ts';
import { confirmedQuotes, firmQuote, inspectionBooked, jobView, KING_ST, quoteToken, STRANGER, TOM, tomsTapTicket, tradieQuotes, type World } from '../support/world.ts';

type Web = Awaited<ReturnType<typeof webWorld>>;

const TUE_9AM = new Date('2026-10-13T09:00:00+11:00');

/** Tom reports a dripping tap and answers every question; returns his photo upload link. */
async function tomReportsTap({ h }: World) {
  h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
  await h.receive(TOM, 'The kitchen tap is dripping');
  await h.answerAll(TOM, { location: 'Kitchen sink', started: 'Since Monday', worsening: 'no', availability: 'weekday_mornings' });
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

  test('an action taken on the review page or the Tickets list goes back there, and anywhere else goes to the dashboard', async () => {
    const w = await webWorld();
    const { cookie, issueId } = await tomsTapRequest(w);

    const fromReview = await w.post(`/requests/${issueId}/reject`, { reason: '', return: `/requests/${issueId}` }, cookie);
    expect(fromReview.headers.get('location')).toMatch(new RegExp(`^/requests/${issueId}\\?error=`));
    const elsewhere = await w.post(`/requests/${issueId}/reject`, { reason: '', return: '//evil.example/requests' }, cookie);
    expect(elsewhere.headers.get('location')).toMatch(/^\/\?error=/);
    const sideways = await w.post(`/requests/${issueId}/reject`, { reason: '', return: '/requests/1/../../settings' }, cookie);
    expect(sideways.headers.get('location')).toMatch(/^\/\?error=/);

    const fromList = await w.post(`/requests/${issueId}/urgency`, { urgency: 'high', return: '/tickets' }, cookie);
    expect(fromList.headers.get('location')).toMatch(/^\/tickets\?ok=/);
  });

  test('changing the Urgency to Urgent turns it into an Urgent Repair', async () => {
    const w = await webWorld();
    const { cookie, issueId } = await tomsTapRequest(w);

    const after = await follow(w, await w.post(`/requests/${issueId}/urgency`, { urgency: 'urgent' }, cookie), cookie);

    expect(after).toContain('Now an Urgent Repair');
    expect(after).toContain('No Maintenance Requests waiting for you.');
    expect(after).toContain('Awaiting receipt');
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

describe('the count strip and Needs your attention', () => {
  /** Alice's dashboard with one Ticket's Firm Quotes to choose from and another whose Tradie's Site Inspection is to book. */
  async function quoteDecisions() {
    const w = await webWorld();
    const routine = await tomsTapTicket(w);
    await confirmedQuotes(w, routine, [
      [w.tradies.pete, 300_00],
      [w.tradies.dana, 340_00],
    ]);
    const high = await tomsTapTicket(w);
    await w.alice.sendQuoteRequests(high.jobId, [w.tradies.pete.id, w.tradies.dana.id]);
    await w.h.app.submitEstimate(await quoteToken(w, high, w.tradies.dana), { priceCents: 340_00, needsInspection: true });
    await w.h.drain();
    return { w, cookie: await w.signIn(), routine, high };
  }

  test('the strip counts the Tickets waiting on a Quote decision, and links to the first of them', async () => {
    const { w, cookie } = await quoteDecisions();
    const dashboard = await page(w, '/', cookie);
    const strip = match(dashboard, /<ul class="count-strip">([\s\S]*?)<\/ul>/);
    expect(strip).toMatch(/<a href="#inspections" class="count-item is-attention"><span class="count-chip is-decision">2<\/span><span class="count-label">Tickets waiting on you<\/span>/);
    expect(strip).toContain('Open Tickets');
  });

  test('with nothing waiting every count is quiet', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const dashboard = await page(w, '/', cookie);
    expect(dashboard).not.toMatch(/count-item is-(attention|urgent)/);
    expect(dashboard).toContain('No Maintenance Requests waiting for you.');
  });

  test('Needs your attention leads the page and holds Quotes to choose and Site Inspections to book once each', async () => {
    const { w, cookie, routine, high } = await quoteDecisions();
    const dashboard = await page(w, '/', cookie);
    expect(dashboard.indexOf('id="decisions"')).toBeLessThan(dashboard.indexOf('id="tickets"'));
    expect(dashboard).toContain('Needs your attention');
    expect(dashboard).toContain('Site Inspections to book');
    expect(dashboard).toContain('Book a Site Inspection');
    expect(dashboard).toContain('Choose a Quote');
    const needs = dashboard.slice(dashboard.indexOf('id="decisions"'), dashboard.indexOf('id="tickets"'));
    expect(needs).toContain(`href="/tickets/${high.ticketId}"`);
    expect(needs).toContain(`href="/tickets/${routine.ticketId}"`);
  });

  test('the board has no Site quotes lane (each Tradie inspects within Quoting), and no inbox or Ticket list is repeated', async () => {
    const { w, cookie } = await quoteDecisions();
    const dashboard = await page(w, '/', cookie);
    expect(dashboard).not.toContain('<h3 class="lane-title">Site quotes</h3>');
    expect(dashboard).toContain('Site Inspection to book');
    expect(dashboard.match(/id="inbox"/g)).toHaveLength(1);
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

/** The Ticket's docket in the board (the part of the page from Tickets by stage on), not its row in Needs your attention. */
function inBoard(page: string, ticketId: number) {
  const board = page.slice(page.indexOf('id="tickets"'));
  const at = board.indexOf(`href="/tickets/${ticketId}"`);
  return board.slice(at, board.indexOf('</a>', at));
}

describe('Tickets on the dashboard', () => {
  test('a Quoting docket says what the Property Manager has to do: check the Estimates in, wait for Firm Quotes, then choose', async () => {
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
    const waiting = docketOf(await page(w, '/', cookie));
    expect(waiting).not.toContain('is-decision');
    expect(waiting).toContain('2 of 2 Estimates in');

    await firmQuote(w, job, w.tradies.pete, { priceCents: 150_00 });
    expect(docketOf(await page(w, '/', cookie))).toContain('2 of 2 Estimates in, 1 Firm Quote');
    await firmQuote(w, job, w.tradies.dana, { priceCents: 180_00 });
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
    // The message sits in the Inbox with its actions on it; on phones a brief row in Needs your attention points at it.
    const box = inbox.slice(inbox.indexOf('id="inbox"'), inbox.indexOf('</section>', inbox.indexOf('id="inbox"')));
    const itemId = match(box, /id="inbox-(\d+)"/);
    expect(box).toContain(`action="/inbox/${itemId}/link"`);
    expect(box).toContain(`action="/inbox/${itemId}/dismiss"`);
    expect(inbox).toMatch(/href="#inbox-(\d+)"[\s\S]*id="inbox-\1"/);

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

/** Books the chosen Tradie at `start` and sends the Work Order. */
async function bookVisit(w: Web, job: { ticketId: number; jobId: number }, start: Date) {
  const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, start]]);
  await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
  await w.alice.sendWorkOrder(job.jobId);
}

/** The Next 7 days section, from its heading through the end of that section. */
function nextSeven(board: string) {
  const start = board.indexOf('id="next-7-days"');
  if (start < 0) throw new Error('No Next 7 days section');
  return board.slice(start, board.indexOf('</section>', start));
}

/** The day chip linking to `href`, so its attributes and text are checked on their own. */
function dayChip(section: string, href: string): string {
  const needle = `href="${href.replaceAll('&', '&amp;')}"`;
  const at = section.indexOf(needle);
  if (at < 0) throw new Error(`No day chip links to ${href}`);
  const start = section.lastIndexOf('<a ', at);
  return section.slice(start, section.indexOf('</a>', at));
}

/** The Mine/All control, so its links are not confused with the day chips. */
function viewsNav(board: string) {
  const start = board.indexOf('aria-label="Views"');
  if (start < 0) throw new Error('No Mine/All control');
  return board.slice(start, board.indexOf('</nav>', start));
}

describe('picking a day in the Next 7 days', () => {
  // The harness clock starts at Thursday 8 October 2026, 9:00 am Sydney, and signing in does not move it.
  const DAYS = ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'];

  test('each day chip links to that day', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const strip = nextSeven(await page(w, '/', cookie));

    expect(strip.match(/class="day-chip/g)).toHaveLength(7);
    for (const day of DAYS) expect(strip).toContain(`href="/?day=${day}#next-7-days"`);
  });

  test("a day chip keeps the dashboard's other state", async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const strip = nextSeven(await page(w, '/?filter=all', cookie));

    for (const day of DAYS) expect(strip).toContain(`href="/?filter=all&amp;day=${day}#next-7-days"`);
  });

  /**
   * Two Tickets, so the clock stands at Monday 12 October 2026, 9:00 am.
   * Monday has a 2:00 pm visit and Tuesday a 9:00 am visit, both Pete's Plumbing at King St.
   */
  async function twoDays() {
    const w = await webWorld();
    const tuesday = await tomsTapTicket(w);
    const monday = await tomsTapTicket(w);
    await bookVisit(w, tuesday, TUE_9AM);
    await bookVisit(w, monday, new Date('2026-10-12T14:00:00+11:00'));
    return { w, cookie: await w.signIn(), tuesday, monday };
  }

  test("with no day, today is current and only today's visits are listed", async () => {
    const { cookie, tuesday, monday, w } = await twoDays();

    const strip = nextSeven(await page(w, '/', cookie));
    const todayChip = dayChip(strip, '/?day=2026-10-12#next-7-days');

    expect(todayChip).toContain('aria-current="date"');
    expect(todayChip).toContain('class="day-chip is-today"');
    expect(strip).toContain('2:00 pm');
    expect(strip).toContain(`href="/tickets/${monday.ticketId}"`);
    expect(strip).not.toContain('9:00 am');
    expect(strip).not.toContain(`href="/tickets/${tuesday.ticketId}"`);
  });

  test("a chosen day lists only that day's visits, each with its Tradie and Ticket", async () => {
    const { w, cookie, tuesday, monday } = await twoDays();

    const strip = nextSeven(await page(w, '/?day=2026-10-13', cookie));
    const chosenChip = dayChip(strip, '/?day=2026-10-13#next-7-days');
    const todayChip = dayChip(strip, '/?day=2026-10-12#next-7-days');

    expect(chosenChip).toContain('aria-current="date"');
    expect(chosenChip).toContain('class="day-chip"');
    expect(todayChip).toContain('class="day-chip is-today"');
    expect(todayChip).not.toContain('aria-current');
    expect(strip).toContain('9:00 am');
    expect(strip).toContain(`href="/tradies/${w.tradies.pete.id}"`);
    expect(strip).toContain(`href="/tickets/${tuesday.ticketId}"`);
    expect(strip).toContain('12 King St');
    expect(strip).not.toContain('2:00 pm');
    expect(strip).not.toContain(`href="/tickets/${monday.ticketId}"`);
    expect(strip).toContain('Tuesday 13 October');
  });

  test("today's chip says today when another day is chosen", async () => {
    const { w, cookie } = await twoDays();

    const strip = nextSeven(await page(w, '/?day=2026-10-13', cookie));

    expect(dayChip(strip, '/?day=2026-10-12#next-7-days')).toContain('<span class="sr-only">today</span>');
    expect(dayChip(strip, '/?day=2026-10-13#next-7-days')).not.toContain('today</span>');
  });

  test('Mine and All keep the chosen day, and Open calendar keeps All', async () => {
    const { w, cookie } = await twoDays();

    const mine = viewsNav(await page(w, '/?day=2026-10-13', cookie));
    expect(mine).toContain('href="/?day=2026-10-13#next-7-days"');
    expect(mine).toContain('href="/?filter=all&amp;day=2026-10-13#next-7-days"');

    const all = await page(w, '/?filter=all&day=2026-10-13', cookie);
    const allNav = viewsNav(all);
    expect(allNav).toContain('href="/?day=2026-10-13#next-7-days"');
    expect(allNav).toContain('href="/?filter=all&amp;day=2026-10-13#next-7-days"');
    expect(nextSeven(all)).toContain('href="/calendar?view=day&amp;date=2026-10-13&amp;filter=all"');
  });

  test('an empty day says nothing is booked and links to that day on the calendar', async () => {
    const { w, cookie } = await twoDays();

    const strip = nextSeven(await page(w, '/?day=2026-10-14', cookie));

    expect(strip).toContain('Wednesday 14 October');
    expect(strip).toContain('Nothing booked on Wednesday.');
    expect(strip).toContain('href="/calendar?view=day&amp;date=2026-10-14"');
    expect(strip).not.toContain('2:00 pm');
    expect(strip).not.toContain('9:00 am');
  });

  test('a day outside the next 7 days, or one that is not a date, falls back to today', async () => {
    const { w, cookie, monday } = await twoDays();

    for (const day of ['2026-10-11', '2026-10-19', 'nope', '2026-02-31', '']) {
      const strip = nextSeven(await page(w, `/?day=${encodeURIComponent(day)}`, cookie));
      expect(strip, day).toContain('Monday 12 October');
      expect(dayChip(strip, '/?day=2026-10-12#next-7-days'), day).toContain('aria-current="date"');
      expect(strip, day).toContain('2:00 pm');
      expect(strip, day).toContain(`href="/tickets/${monday.ticketId}"`);
      expect(strip, day).not.toContain('9:00 am');
    }
  });

  /**
   * Saturday 10 October 2026, 9:00 am, is where one Ticket leaves the clock.
   * The visit is Tuesday 13 October, 9:00 am to 11:00 am. 79 hours later is
   * 4:00 pm that Tuesday: 72 hours to 9:00 am, then 7 hours.
   */
  test('a visit earlier today that has ended is listed under today', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    await bookVisit(w, job, new Date('2026-10-13T09:00:00+11:00'));
    w.h.clock.advance(79 * HOUR);
    const cookie = await w.signIn();

    const strip = nextSeven(await page(w, '/', cookie));

    expect(strip).toContain('Tuesday 13 October');
    expect(strip).toContain('9:00 am');
    expect(strip).toContain('The kitchen tap is dripping');
    expect(strip).toContain(`href="/tickets/${job.ticketId}"`);
    expect(strip).toContain('aria-label="Has a visit"');
    expect(strip).not.toContain('Nothing booked on Tuesday.');
  });

  test('a Site Inspection is badged, and links to the Tradie and the Ticket', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    await w.alice.sendQuoteRequests(job.jobId, [w.tradies.pete.id, w.tradies.dana.id]);
    await inspectionBooked(w, job, w.tradies.dana, new Date('2026-10-13T10:00:00+11:00'));
    const cookie = await w.signIn();

    const strip = nextSeven(await page(w, '/?day=2026-10-13', cookie));

    expect(strip).toContain('Site inspection');
    expect(strip).toContain('10:00 am');
    expect(strip).toContain(`href="/tradies/${w.tradies.dana.id}"`);
    expect(strip).toContain(`href="/tickets/${job.ticketId}#job-${job.jobId}"`);
    expect(strip).toContain('12 King St');
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
    expect(week).toContain('12 – 18 October 2026');
    expect(week).toContain('/calendar?view=week&amp;date=2026-10-05');
    expect(week).toContain('/calendar?view=week&amp;date=2026-10-19');
    const booking = week.indexOf(`href="/tickets/${job.ticketId}"`);
    expect(week.indexOf('Tuesday 13 October')).toBeLessThan(booking);
    expect(week.indexOf('Wednesday 14 October')).toBeGreaterThan(booking);
    expect(week).toContain(`href="/tradies/${w.tradies.pete.id}"`);
    expect(week).toContain(KING_ST);
    expect(week).toContain('Plumbing');

    expect(await page(w, '/calendar?week=2026-10-19', cookie)).not.toContain(KING_ST);
    // Today is Saturday 10 October, so Tuesday's visit marks its chip and is not listed yet.
    const today = nextSeven(await page(w, '/', cookie));
    expect(today).toContain('datetime="2026-10-13"');
    expect(today).not.toContain(`href="/tickets/${job.ticketId}"`);

    const pete = await page(w, `/tradies/${w.tradies.pete.id}`, cookie);
    for (const text of ['Pete Park', 'myEST8 rating', '4.0', '4.8', '120 reviews', '$150.00', KING_ST]) expect(pete).toContain(text);
  });

  test('a visit later in the week marks its day chip, and is not listed on today', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    const cookie = await w.signIn();

    const strip = nextSeven(await page(w, '/', cookie));
    expect(strip).toContain('datetime="2026-10-13"');
    expect(strip).not.toContain(`href="/tickets/${job.ticketId}"`);
    expect(strip.match(/class="day-chip/g)).toHaveLength(7);
    expect(strip.match(/class="day-dot"/g)).toHaveLength(1);
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

describe('a safety risk on the dashboard', () => {
  test('names the risk and opens the Urgent Repair, whose timeline says why it went Urgent', async () => {
    const w = await webWorld();
    const text = 'I can smell gas in the kitchen';
    w.h.classifier.when(text, {
      messageClass: 'new_issue',
      relatedItem: 'none',
      urgency: 'routine',
      trade: 'plumbing',
      safety: ['risk', 0.95],
    });
    await w.h.receive(TOM, text);
    const cookie = await w.signIn();
    const id = (await w.alice.dashboard()).urgentRepairs[0]!.urgentRepairId;

    const dashboard = await page(w, '/', cookie);
    expect(dashboard).toContain(`Safety risk: ${text}`);
    expect(dashboard).toContain(`href="/reimbursements/${id}"`);
    expect(dashboard).toContain('Review the Urgent Repair');

    const reimbursement = await page(w, `/reimbursements/${id}`, cookie);
    expect(reimbursement).toContain('Classified as a safety risk');
    expect(reimbursement).toContain('95% sure');
  });
});
