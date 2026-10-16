import { describe, expect, test } from 'vitest';
import { visible, webWorld } from '../support/web.ts';
import { confirmedQuotes, jobView, TOM, tomsTapTicket } from '../support/world.ts';

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

describe('Schedule: the week', () => {
  test('a booking shows under its short day with what the visit is for, the Tradie, the street and suburb, and how it stands', async () => {
    const w = await webWorld();
    const job = await bookedTap(w);
    const cookie = await w.signIn();

    const html = await page(w, '/calendar?week=2026-10-14', cookie);

    expect(visible(html)).toContain('Week of Monday 12 October 2026');
    const days = week(html);
    const text = visible(days);
    // The month is in the subtitle, so a day is "Tue 13"; screen readers hear the whole date.
    expect(days).toContain('<span aria-hidden="true">Tue 13</span><span class="sr-only">Tuesday 13 October</span>');
    expect(days).toMatch(new RegExp(`<a class="booking-issue" href="/tickets/${job.ticketId}">.*The kitchen tap is dripping`));
    expect(days).toContain(`href="/tradies/${w.tradies.pete.id}"`);
    expect(text).toContain('9:00 am – 11:00 am');
    expect(text).toContain('12 King St, Newtown');
    expect(text).not.toContain('NSW 2042');
    expect(text).toContain('Not confirmed yet');
    // Empty days fold into one line for phones; the wide screen shows them as narrow columns instead.
    expect(text).toContain('Nothing booked Mon 12');
    expect(text).toContain('Nothing booked Wed 14 – Sun 18');
    expect(days.indexOf('Tuesday 13 October')).toBeLessThan(days.indexOf(`/tickets/${job.ticketId}`));
    expect(days.indexOf('Wednesday 14 October')).toBeGreaterThan(days.indexOf(`/tickets/${job.ticketId}`));
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
    expect(mine).toContain('<a href="/calendar?week=2026-10-12" class="segmented-item" aria-current="page">Mine</a>');
    expect(week(mine)).not.toContain(`/tickets/${job.ticketId}`);
    expect(visible(mine)).toContain('1 more visit this week on other Property Managers’ Properties. Show all');
    expect(mine).toContain('href="/calendar?week=2026-10-12&amp;filter=all"');

    const all = await page(w, '/calendar?week=2026-10-12&filter=all', bob);
    expect(week(all)).toContain(`/tickets/${job.ticketId}`);
    // In All, each visit names whose Property it is, and the week links keep All.
    expect(visible(week(all))).toContain('Property Manager: Alice Archer');
    expect(all).toContain('href="/calendar?week=2026-10-19&amp;filter=all"');
    expect(visible(all)).not.toContain('more visit');
  });

  test("the share link is the week, whoever's view it is shared from", async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const html = await page(w, '/calendar?week=2026-10-19&filter=all', cookie);

    expect(html).toContain('http://localhost/calendar?week=2026-10-19');
    expect(html).not.toContain('http://localhost/calendar?week=2026-10-19&amp;filter');
  });
});
