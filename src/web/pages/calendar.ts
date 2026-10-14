// The shared calendar: every booked visit across the Agency, a week at a time and
// grouped by day in the Agency's time zone, so nobody double-books a Tradie. Mine
// shows the visits on the Property Manager's own Properties, All everyone's.
//
// From 1024 px the week is seven columns, where a day with bookings takes the room
// and an empty one stays narrow. Below that it is a list of days, and a run of empty
// days folds into one line ("Nothing booked Tue 13 – Wed 14").

import { Hono } from 'hono';
import { html } from 'hono/html';
import { addDays, dayOf, daysFrom, mondayOf, parseDay, startOfDay } from '../../zoned-time.ts';
import { bookingCard, bookingsByDay, dayRange, longDay, shortDay, type Booking } from '../bookings.ts';
import type { WebEnv } from '../env.ts';
import { COLLEAGUES_ONLY, shareButton, shareUrl } from '../share.ts';
import { shellInfo } from '../shell.ts';
import { badge, flashFrom, formatTime, formatWhen, linkButton, page, segmented, type Html } from '../ui.ts';

export type { Booking } from '../bookings.ts';

type Filter = 'mine' | 'all';

/** The shared calendar under /calendar. */
export function calendarPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const { timeZone } = actions.agency();
    const filter: Filter = c.req.query('filter') === 'all' ? 'all' : 'mine';
    const today = dayOf(actions.now(), timeZone);
    const monday = mondayOf(parseDay(c.req.query('week')) ?? today);
    const days = daysFrom(monday, 7);
    const every = await actions.calendar({ from: startOfDay(monday, timeZone).toISOString(), to: startOfDay(addDays(monday, 7), timeZone).toISOString() });
    const bookings = filter === 'mine' ? every.filter((b) => b.propertyManagerId === pm.id) : every;
    const hidden = every.length - bookings.length;
    const week = `${longDay(monday)} ${monday.slice(0, 4)}`;

    return c.html(
      page({
        title: 'Schedule',
        pm,
        active: 'schedule',
        shell: shellInfo(c),
        flash: flashFrom(c.req.url),
        subtitle: `Week of ${week}`,
        controls: segmented([
          { label: 'Mine', href: hrefFor(monday, 'mine'), active: filter === 'mine' },
          { label: 'All', href: hrefFor(monday, 'all'), active: filter === 'all' },
        ]),
        actions: html`${weekNav(monday, today, filter)}${shareButton({
          title: `Jobs booked, week of ${week}`,
          text: every.length
            ? `${every.length} ${every.length === 1 ? 'Job' : 'Jobs'} booked in the week of ${longDay(monday)} across the Agency.`
            : `Nothing booked yet in the week of ${longDay(monday)}.`,
          url: shareUrl(c, `/calendar?week=${monday}`),
          note: COLLEAGUES_ONLY,
        })}`,
        body: html`
          ${hidden
            ? html`<p class="text-sm text-muted">${hidden} more ${hidden === 1 ? 'visit' : 'visits'} this week on other Property Managers’ Properties. <a class="link" href="${hrefFor(monday, 'all')}">Show all</a></p>`
            : ''}
          ${weekList(days, bookingsByDay(bookings, monday, timeZone), today, timeZone, filter)}
        `,
      }),
    );
  });

  return pages;
}

/** "Tue 13 Oct, 9:00 am – 11:00 am": the start in full, then the end's time of day. */
export function timeRange(start: string, end: string, timeZone: string): Html {
  return html`<time datetime="${start}">${formatWhen(start, timeZone)}</time> – <time datetime="${end}">${formatTime(end, timeZone)}</time>`;
}

/**
 * The week as a list of days. Each run of empty days (today is never folded) is also
 * written as one line; the CSS shows that line below 1024 px and the empty days, narrow,
 * from 1024 px, so each screen reads one of the two.
 */
function weekList(days: string[], byDay: Map<string, Booking[]>, today: string, timeZone: string, filter: Filter): Html {
  const items: Html[] = [];
  let quiet: string[] = [];
  const flush = () => {
    if (quiet.length) {
      items.push(html`<li class="schedule-quiet">Nothing booked ${dayRange(quiet)}</li>`);
      items.push(...quiet.map((day) => dayItem(day, [], false, timeZone, filter)));
    }
    quiet = [];
  };
  for (const day of days) {
    const bookings = byDay.get(day) ?? [];
    if (!bookings.length && day !== today) {
      quiet.push(day);
      continue;
    }
    flush();
    items.push(dayItem(day, bookings, day === today, timeZone, filter));
  }
  flush();
  return html`<ol class="schedule-week" aria-label="The week, Monday to Sunday">${items}</ol>`;
}

/** One day: "Mon 12" (the month is in the page's subtitle), then its bookings or "Nothing booked". */
function dayItem(day: string, bookings: Booking[], isToday: boolean, timeZone: string, filter: Filter): Html {
  const classes = ['schedule-day', bookings.length ? 'is-booked' : 'is-empty', isToday ? 'is-today' : ''].join(' ');
  return html`<li class="${classes}" ${isToday ? html`aria-current="date"` : ''}>
    <h2 class="schedule-day-title">
      <time datetime="${day}"><span aria-hidden="true">${shortDay(day)}</span><span class="sr-only">${longDay(day)}</span></time>
      ${isToday ? badge('Today', 'info') : ''}
    </h2>
    ${bookings.length
      ? html`<ul class="booking-list">${bookings.map((b) => bookingCard(b, timeZone, { propertyManager: filter === 'all' }))}</ul>`
      : html`<p class="text-sm text-muted">Nothing booked</p>`}
  </li>`;
}

/** Previous, this week (only when another week is shown) and next, keeping Mine or All. */
function weekNav(monday: string, today: string, filter: Filter): Html {
  const thisWeek = mondayOf(today) === monday;
  return html`<nav aria-label="Weeks" class="flex flex-wrap items-center gap-2 text-sm">
    ${linkButton('Previous week', hrefFor(addDays(monday, -7), filter), { size: 'sm' })}
    ${thisWeek ? '' : linkButton('This week', hrefFor(null, filter), { size: 'sm', variant: 'ghost' })}
    ${linkButton('Next week', hrefFor(addDays(monday, 7), filter), { size: 'sm' })}
  </nav>`;
}

/** /calendar for a week (always by its date, so the link keeps showing that week) and filter; no week is this week. */
function hrefFor(monday: string | null, filter: Filter) {
  const params = new URLSearchParams();
  if (monday) params.set('week', monday);
  if (filter === 'all') params.set('filter', 'all');
  const query = params.toString();
  return query ? `/calendar?${query}` : '/calendar';
}
