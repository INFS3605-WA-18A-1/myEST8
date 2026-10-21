import { describe, expect, test } from 'vitest';
import { visible, webWorld } from '../support/web.ts';
import { HOUR } from '../support/harness.ts';
import { confirmedQuotes, HANA, inspectionBooked, jobView, TOM, tomsTapTicket } from '../support/world.ts';

type Web = Awaited<ReturnType<typeof webWorld>>;

const TUE_9AM = new Date('2026-10-13T09:00:00+11:00');

/** Alice books Pete for Tom's tap on Tuesday 13 October at 9 am. Now is Saturday 10 October. */
async function bookedTap(w: Web) {
  const job = await tomsTapTicket(w);
  const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
  await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
  await w.alice.sendWorkOrder(job.jobId);
  return job;
}

/**
 * A busy Tuesday 13 October on Alice's King St: Pete fixes Tom's tap from 9 to 11 and Dana
 * Hana's fan from 10 to 12, so the two overlap. Now is Saturday 10 October.
 */
async function busyTuesday(w: Web) {
  const report = async (from: string, description: string) => {
    w.h.classifier.when(description, { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await w.h.receive(from, description);
    for (const [answer, value] of [['In the kitchen'], ['Since Monday'], ['No', 'no'], ['Mornings', 'weekday_mornings']] as const) await w.h.answer(from, answer, value);
  };
  await report(TOM, 'The kitchen tap is dripping');
  await report(HANA, 'The bathroom fan is rattling');
  await w.h.advance(49 * HOUR);
  const jobs = [];
  for (const [r, tradie, start] of [
    ['The kitchen tap is dripping', w.tradies.pete, TUE_9AM],
    ['The bathroom fan is rattling', w.tradies.dana, new Date('2026-10-13T10:00:00+11:00')],
  ] as const) {
    const request = (await w.alice.dashboard()).maintenanceRequests.find((m) => m.description === r)!;
    const ticketId = await w.alice.confirmMaintenanceRequest(request.issueId);
    const job = { ticketId, jobId: (await w.alice.ticket(ticketId)).jobs[0]!.jobId };
    const quote = (await confirmedQuotes(w, job, [[tradie, 150_00, start]])).find((q) => q.tradieId === tradie.id)!;
    await w.alice.chooseQuote(quote.quoteId, 'Free that morning');
    await w.alice.sendWorkOrder(job.jobId);
    jobs.push(job);
  }
  return { tap: jobs[0]!, fan: jobs[1]! };
}

/** The hour-by-hour grid (the Week's from 768px, or the Day's), without the page around it. */
function grid(html: string, view: 'week' | 'day' = 'week') {
  const start = html.indexOf(`class="schedule-scroll is-${view}"`);
  expect(start, `no ${view} grid on the page`).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</main>', start));
}

/** One day's column on the Week's grid. */
function column(html: string, day: string) {
  const g = grid(html);
  const at = g.indexOf(`<time datetime="${day}">`);
  expect(at, `no column for ${day}`).toBeGreaterThan(-1);
  const start = g.lastIndexOf('<li class="schedule-col', at);
  const end = g.indexOf('<li class="schedule-col', start + 1);
  return g.slice(start, end === -1 ? undefined : end);
}

async function page(w: Web, path: string, cookie: string) {
  const res = await w.get(path, cookie);
  expect(res.status).toBe(200);
  return res.text();
}

/** The week's list of days, without the page around it. */
function week(html: string) {
  const start = html.indexOf('class="schedule-week"');
  expect(start, 'no week on the page').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</ol>', start));
}

/** The summary over the calendar. */
function summaryOf(html: string) {
  const start = html.indexOf('class="schedule-summary"');
  expect(start, 'no summary on the page').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</div>', start));
}

describe('Schedule: the week', () => {
  test('a booking shows under its short day with what the visit is for, the Tradie, the street and suburb, and how it stands', async () => {
    const w = await webWorld();
    const job = await bookedTap(w);
    const cookie = await w.signIn();

    const html = await page(w, '/calendar?week=2026-10-14', cookie);

    expect(visible(html)).toContain('12 – 18 October 2026');
    const days = week(html);
    const text = visible(days);
    // The month is in the subtitle, so a day is "Tue 13"; screen readers hear the whole date.
    const weekday = days.indexOf('aria-hidden="true">Tue</span>');
    const numeral = days.indexOf('class="schedule-num num" aria-hidden="true">13</span>');
    const long = days.indexOf('<span class="sr-only">Tuesday 13 October</span>');
    expect(weekday).toBeGreaterThan(-1);
    expect(numeral).toBeGreaterThan(weekday);
    expect(long).toBeGreaterThan(numeral);
    expect(days).toMatch(new RegExp(`<a class="booking-issue" href="/tickets/${job.ticketId}">.*The kitchen tap is dripping`));
    expect(days).toContain(`href="/tradies/${w.tradies.pete.id}"`);
    expect(text).toContain('9:00 am – 11:00 am');
    expect(text).toContain('12 King St, Newtown');
    expect(text).not.toContain('NSW 2042');
    expect(text).toContain('Not confirmed yet');
    // Empty days fold into one line; from 768px the time grid shows every day instead.
    expect(text).toContain('Nothing booked Mon 12');
    expect(text).toContain('Nothing booked Wed 14 – Sun 18');
    expect(days.indexOf('Tuesday 13 October')).toBeLessThan(days.indexOf(`/tickets/${job.ticketId}`));
    expect(days.indexOf('Nothing booked Wed 14')).toBeGreaterThan(days.indexOf(`/tickets/${job.ticketId}`));
  });

  test('a reschedule request says so and links to the Ticket where new times are suggested', async () => {
    const w = await webWorld();
    const job = await bookedTap(w);
    await w.h.answer(TOM, 'I have work on Tuesday, can we do another day?', 'reschedule');
    const { workOrder } = await jobView(w, job);
    const cookie = await w.signIn();

    const days = week(await page(w, '/calendar?week=2026-10-12', cookie));

    expect(days).toContain(`<a class="booking-reschedule" href="/tickets/${job.ticketId}?suggest=${workOrder!.workOrderId}">Reschedule requested</a>`);
    expect(days).toContain('booking is-reschedule');
  });

  test('the week says at a glance how many visits are booked and how many reschedule requests wait', async () => {
    const w = await webWorld();
    await bookedTap(w);
    await w.h.answer(TOM, 'I have work on Tuesday, can we do another day?', 'reschedule');
    const cookie = await w.signIn();

    const html = await page(w, '/calendar?week=2026-10-12', cookie);

    const summary = visible(summaryOf(html));
    expect(summary).toContain('1 visit booked');
    expect(summary).toContain('1 reschedule request waiting on you');
    // Each day with visits says how many, beside its name.
    expect(visible(week(html))).toMatch(/Tue 13 Tuesday 13 October 1 visit/);
  });

  test("a reschedule request on your own Property is your decision; on a colleague's it only stands out", async () => {
    const w = await webWorld();
    await bookedTap(w);
    await w.h.answer(TOM, 'I have work on Tuesday, can we do another day?', 'reschedule');

    const alice = await page(w, '/calendar?week=2026-10-12', await w.signIn());
    expect(week(alice)).toContain('booking is-reschedule is-decision');

    const bob = await page(w, '/calendar?week=2026-10-12&filter=all', await w.signIn('bob@harbour.example'));
    expect(week(bob)).toContain('booking is-reschedule');
    expect(week(bob)).not.toContain('is-decision');
    // Bob's summary counts the request, but it isn't waiting on him.
    expect(visible(bob)).toContain('1 reschedule requested');
    expect(visible(bob)).not.toContain('waiting on you');
  });

  test('today is marked and never folded away, even when nothing is booked', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const days = week(await page(w, '/calendar', cookie));

    expect(days).toContain('aria-current="date"');
    // Now is Thursday 8 October.
    expect(visible(days)).toMatch(/Thu 8 Thursday 8 October Today Nothing booked/);
    expect(visible(days)).toContain('Nothing booked Mon 5 – Wed 7');
    expect(visible(days)).toContain('Nothing booked Fri 9 – Sun 11');
  });
});

describe('Schedule: Mine and All', () => {
  test("Mine shows the visits on the Property Manager's own Properties, and says how many more All has", async () => {
    const w = await webWorld();
    const job = await bookedTap(w);
    const bob = await w.signIn('bob@harbour.example');

    const mine = await page(w, '/calendar?week=2026-10-12', bob);
    expect(mine).toContain('<a href="/calendar?view=week&amp;date=2026-10-12" class="segmented-item" aria-current="page">Mine</a>');
    expect(week(mine)).not.toContain(`/tickets/${job.ticketId}`);
    expect(visible(mine)).toContain('1 more visit this week on other Property Managers’ Properties. Show all');
    expect(mine).toContain('href="/calendar?view=week&amp;date=2026-10-12&amp;filter=all"');

    const all = await page(w, '/calendar?week=2026-10-12&filter=all', bob);
    expect(week(all)).toContain(`/tickets/${job.ticketId}`);
    // In All, each visit names whose Property it is, and the week links keep All.
    expect(visible(week(all))).toContain('Property Manager: Alice Archer');
    expect(all).toContain('href="/calendar?view=week&amp;date=2026-10-19&amp;filter=all"');
    expect(visible(all)).not.toContain('more visit');
  });

  test("the share link is the week, whoever's view it is shared from", async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const html = await page(w, '/calendar?week=2026-10-19&filter=all', cookie);

    expect(html).toContain('http://localhost/calendar?view=week&amp;date=2026-10-19"');
    expect(html).not.toContain('http://localhost/calendar?view=week&amp;date=2026-10-19&amp;filter');
  });
});

describe('Schedule: Site Inspections and who is free', () => {
  test('a Site Inspection carries a Site inspection badge and links to the Job on the Ticket', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    await w.alice.sendQuoteRequests(job.jobId, [w.tradies.pete.id, w.tradies.dana.id]);
    await inspectionBooked(w, job, w.tradies.pete, TUE_9AM);
    const cookie = await w.signIn();

    const html = week(await page(w, '/calendar?week=2026-10-14', cookie));

    expect(visible(html)).toContain('Site inspection');
    expect(html).toContain('is-outline');
    expect(html).toContain(`href="/tickets/${job.ticketId}#job-${job.jobId}"`);
  });

  test('the summary lists the Tradies with no booking as Free today, when today is shown', async () => {
    const w = await webWorld();
    await bookedTap(w);
    const cookie = await w.signIn();

    const free = visible(summaryOf(await page(w, '/calendar', cookie)));
    // Now is Saturday 10 October; Pete's visit is on Tuesday, so every Tradie is free today.
    expect(free).toContain('Free today (6)');
    expect(free).toContain("Pete's Plumbing");

    expect(visible(summaryOf(await page(w, '/calendar?view=week&date=2026-10-19', cookie)))).not.toContain('Free today');
  });
});

describe('Schedule: the Week as a time grid', () => {
  test('each visit sits on its day and its time, on 15-minute rows from 7 am, as a link naming the time, the issue and the Tradie', async () => {
    const w = await webWorld();
    const job = await bookedTap(w);
    const cookie = await w.signIn();

    const html = await page(w, '/calendar?view=week&date=2026-10-12', cookie);

    const g = grid(html);
    expect(g).toContain('role="region"');
    expect(g).toContain('tabindex="0"');
    // 7 am to 7 pm is 48 quarter hours; the hour lines are decoration.
    expect(g).toContain('--slots: 48; --cols: 7');
    expect(g).toContain('<div class="schedule-hours" aria-hidden="true">');
    expect(visible(g.slice(g.indexOf('>') + 1))).toMatch(/^ ?7 am 8 am 9 am .* 6 pm Mon 12/);
    const tue = column(html, '2026-10-13');
    // 9 am is 8 quarter hours after 7 am, so line 9; 11 am is line 17.
    expect(tue).toContain('style="grid-row: 9 / 17"');
    expect(tue).toMatch(new RegExp(`<a class="schedule-block-link" href="/tickets/${job.ticketId}">`));
    expect(visible(tue)).toContain("9:00 am – 11:00 am The kitchen tap is dripping Pete's Plumbing Not confirmed yet");
    // Each day's name opens its Day.
    expect(tue).toContain('href="/calendar?view=day&amp;date=2026-10-13"');
    expect(visible(column(html, '2026-10-14'))).toContain('Nothing booked');
  });

  test('visits that overlap fold into one block over their time, saying how many, that opens the Day', async () => {
    const w = await webWorld();
    const { tap, fan } = await busyTuesday(w);
    const cookie = await w.signIn();

    const tue = column(await page(w, '/calendar?view=week&date=2026-10-12&filter=all', cookie), '2026-10-13');

    expect(tue).toContain('class="schedule-block is-cluster');
    // 9 am to noon.
    expect(tue).toContain('style="grid-row: 9 / 21"');
    expect(visible(tue)).toContain('2 Jobs booked 9:00 am – 12:00 pm');
    expect(tue).toContain('href="/calendar?view=day&amp;date=2026-10-13&amp;filter=all"');
    expect(tue).not.toContain(`/tickets/${tap.ticketId}`);
    expect(tue).not.toContain(`/tickets/${fan.ticketId}`);
  });

  test('the hours grow to take in a visit outside 7 am to 7 pm, the same for every day of the week', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, new Date('2026-10-13T06:30:00+11:00')]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Early start');
    await w.alice.sendWorkOrder(job.jobId);
    const cookie = await w.signIn();

    const html = await page(w, '/calendar?view=week&date=2026-10-12', cookie);

    // 6 am to 7 pm; 6:30 is two quarter hours in.
    expect(grid(html)).toContain('--slots: 52; --cols: 7');
    expect(column(html, '2026-10-13')).toContain('style="grid-row: 3 / 11"');
  });
});

describe('Schedule: the Day', () => {
  test('visits at the same time sit side by side in lanes, full cards, inside a frame that scrolls sideways', async () => {
    const w = await webWorld();
    const { tap, fan } = await busyTuesday(w);
    const cookie = await w.signIn();

    const html = await page(w, '/calendar?view=day&date=2026-10-13', cookie);

    expect(visible(html)).toContain('Tuesday 13 October');
    expect(visible(html)).toContain('2 visits booked');
    const g = grid(html, 'day');
    expect(g).toMatch(/role="region" aria-label="Tuesday 13 October, hour by hour\. Visits at the same time sit side by side: scroll sideways to see them all\." tabindex="0"/);
    expect(g).toContain('--slots: 48; --cols: 2');
    // Pete from 9 to 11 in the first lane, Dana from 10 to noon in the second.
    expect(g).toContain('style="grid-row: 9 / 17; grid-column: 1 / 2"');
    expect(g).toContain('style="grid-row: 13 / 21; grid-column: 2 / 3"');
    expect(g.indexOf(`/tickets/${tap.ticketId}`)).toBeLessThan(g.indexOf(`/tickets/${fan.ticketId}`));
    const text = visible(g);
    expect(text).toContain("The kitchen tap is dripping Pete's Plumbing 12 King St, Newtown");
    expect(text).toContain('The bathroom fan is rattling Drip Doctors');
  });

  test('a visit alone at its time takes the whole width, and an empty day says so', async () => {
    const w = await webWorld();
    await bookedTap(w);
    const cookie = await w.signIn();

    expect(grid(await page(w, '/calendar?view=day&date=2026-10-13', cookie), 'day')).toContain('style="grid-row: 9 / 17; grid-column: 1 / 2"');
    expect(visible(await page(w, '/calendar?view=day&date=2026-10-14', cookie))).toContain('Nothing booked on Wednesday 14 October.');
  });

  test('steps a day at a time, and Today comes back to today', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const html = await page(w, '/calendar?view=day&date=2026-10-13&filter=all', cookie);

    expect(html).toContain('href="/calendar?view=day&amp;date=2026-10-12&amp;filter=all"');
    expect(html).toContain('href="/calendar?view=day&amp;date=2026-10-14&amp;filter=all"');
    expect(html).toMatch(/href="\/calendar\?view=day&amp;filter=all"[^>]*>Today</);
  });
});

describe('Schedule: the Month', () => {
  test('a table of weeks from Monday, the days either side muted, each day opening its Day', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const html = await page(w, '/calendar?view=month&date=2026-10-20', cookie);

    expect(visible(html)).toContain('October 2026');
    const month = html.slice(html.indexOf('<table class="schedule-month">'), html.indexOf('</table>'));
    expect(month).toContain('<abbr title="Monday">Mon</abbr>');
    // October 2026 starts on a Thursday and ends on a Saturday: 28 September to 1 November, five weeks.
    expect(month.match(/<tr>/g)).toHaveLength(6);
    expect(month).toContain('<td class="schedule-mday is-outside"><a class="schedule-mday-num num" href="/calendar?view=day&amp;date=2026-09-28">');
    expect(month).toContain('href="/calendar?view=day&amp;date=2026-11-01"');
    // Now is Thursday 8 October.
    expect(month).toMatch(/<td class="schedule-mday is-today" aria-current="date">/);
    expect(month).toContain('<span class="sr-only">Thursday 8 October</span>');
    expect(html).toContain('href="/calendar?view=month&amp;date=2026-09-01"');
    expect(html).toContain('href="/calendar?view=month&amp;date=2026-11-01"');
  });

  test('a day lists its visits up to two; overlapping ones fold into "N Jobs booked", opening the Day', async () => {
    const w = await webWorld();
    const { tap } = await busyTuesday(w);
    const cookie = await w.signIn();

    const html = await page(w, '/calendar?view=month&date=2026-10-01', cookie);

    const tue = html.slice(html.indexOf('date=2026-10-13'), html.indexOf('date=2026-10-14'));
    expect(visible(tue)).toContain('2 Jobs booked');
    expect(tue).toContain('class="schedule-mday-more "');
    expect(tue).not.toContain(`/tickets/${tap.ticketId}`);
  });

  test('a day with one visit lists it, linking to its Ticket', async () => {
    const w = await webWorld();
    const job = await bookedTap(w);
    const cookie = await w.signIn();

    const html = await page(w, '/calendar?view=month', cookie);

    const tue = html.slice(html.indexOf('date=2026-10-13'), html.indexOf('date=2026-10-14'));
    expect(tue).toContain(`<a href="/tickets/${job.ticketId}"`);
    expect(visible(tue)).toContain("9:00 am The kitchen tap is dripping , Pete's Plumbing");
    // Phones show only how many.
    expect(tue).toContain('class="schedule-mday-more is-phone-only"');
  });
});

/** The toolbar over the calendar, without the summary and the grid. */
function toolbar(html: string) {
  const start = html.indexOf('class="schedule-toolbar"');
  expect(start, 'no toolbar on the page').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('class="schedule-summary"', start));
}

describe('Schedule: the toolbar', () => {
  test('Today, the previous and next arrows, and the period title, for each view', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    // Thursday 8 October is this week, so the week of the 20th is not, and Today leaves it.
    const week = toolbar(await page(w, '/calendar?view=week&date=2026-10-20', cookie));
    expect(week).toMatch(/class="btn btn-outline btn-sm"[^>]*>Today</);
    expect(week).toContain('aria-label="Previous week"');
    expect(week).toContain('aria-label="Next week"');
    expect(week).toContain('href="/calendar?view=week&amp;date=2026-10-12"');
    expect(week).toContain('href="/calendar?view=week&amp;date=2026-10-26"');
    expect(visible(week)).toContain('19 – 25 October 2026');
    expect(week).toMatch(/href="\/calendar"[^>]*>Today</);

    // A week that crosses a month names both months.
    const across = toolbar(await page(w, '/calendar?view=week&date=2026-11-01', cookie));
    expect(visible(across)).toContain('26 October – 1 November 2026');

    const day = toolbar(await page(w, '/calendar?view=day&date=2026-10-23&filter=all', cookie));
    expect(day).toContain('aria-label="Previous day"');
    expect(day).toContain('aria-label="Next day"');
    expect(visible(day)).toContain('Friday 23 October');
    expect(day).toMatch(/href="\/calendar\?view=day&amp;filter=all"[^>]*>Today</);

    const month = toolbar(await page(w, '/calendar?view=month&date=2026-11-02', cookie));
    expect(month).toContain('aria-label="Previous month"');
    expect(month).toContain('aria-label="Next month"');
    expect(visible(month)).toContain('November 2026');

    // Today stays on the toolbar when the period shown is already this one.
    const current = toolbar(await page(w, '/calendar', cookie));
    expect(current).toMatch(/class="btn btn-outline btn-sm"[^>]*>Today</);
    expect(visible(current)).toContain('5 – 11 October 2026');
  });
});

describe("Schedule: today's column", () => {
  test("today's column and its date are marked", async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    // Now is Thursday 8 October, in the week of Monday 5 October.
    const thu = column(await page(w, '/calendar', cookie), '2026-10-08');
    expect(thu).toMatch(/<li class="schedule-col is-today[^"]*" aria-current="date"/);
    expect(thu).toMatch(/<a [^>]*aria-current="date"/);
    // The weekday is small and the date stands on its own, so today can wear the circle.
    expect(thu).toContain('aria-hidden="true">Thu</span>');
    expect(thu).toContain('class="schedule-num num" aria-hidden="true">8</span>');
    expect(thu).toContain('<span class="sr-only">Thursday 8 October</span>');

    const other = column(await page(w, '/calendar?view=week&date=2026-10-12', cookie), '2026-10-13');
    expect(other).not.toContain('aria-current="date"');
  });
});

describe('Schedule: the current time', () => {
  test('a current-time line is drawn on today and left off other weeks', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    // Thursday 8 October 2026, 9:00 am. The week grid starts at 7 am under a heading
    // row, so 9:00 is grid row 10. Thursday is the fourth day: the line runs from
    // the gutter through that column, grid columns 1 to 6.
    const today = grid(await page(w, '/calendar', cookie));
    expect(today).toContain('class="schedule-now"');
    expect(today).toContain('grid-row: 10');
    expect(today).toContain('grid-column: 1 / 6');

    const other = grid(await page(w, '/calendar?view=week&date=2026-10-12', cookie));
    expect(other).not.toContain('schedule-now');
  });
});

describe('Schedule: views and links', () => {
  test('Day, Week and Month tabs keep the date in view and Mine or All', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const html = await page(w, '/calendar?view=week&date=2026-10-21&filter=all', cookie);

    const tabsAt = html.indexOf('aria-label="Calendar views"');
    expect(tabsAt).toBeGreaterThan(-1);
    const nav = html.slice(tabsAt, html.indexOf('</nav>', tabsAt));
    expect(nav).toContain('href="/calendar?view=day&amp;date=2026-10-19&amp;filter=all"');
    expect(nav).toMatch(/href="\/calendar\?view=week&amp;date=2026-10-19&amp;filter=all" class="tab[^"]*tab-active[^"]*" aria-current="page"/);
    expect(nav).toContain('href="/calendar?view=month&amp;date=2026-10-19&amp;filter=all"');
  });

  test('the older ?week= link still opens that week', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const html = await page(w, '/calendar?week=2026-10-21', cookie);

    expect(visible(html)).toContain('19 – 25 October 2026');
    expect(html).toContain('href="/calendar?view=week&amp;date=2026-10-12"');
  });
});
