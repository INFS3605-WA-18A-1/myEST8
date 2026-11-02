// The shared calendar: every booked visit across the Agency, so nobody double-books a
// Tradie, by Day, Week or Month in the Agency's time zone. Mine shows the visits on the
// Property Manager's own Properties, All everyone's.
//
// The page is one white card. Beside the title sit the Tradie, Property and Status
// filters; Mine / All and Share are in the page header. On the left (a Paper rail) are a
// small month, Showing and Visits, the Visit types boxes and the Tradies; in the middle
// the toolbar (Today, Day / Week / Month, the period and its arrows) over the grid; on
// the right the Picked visit panel, which app.js fills when a visit is clicked. Week is
// an hour-by-hour grid, Monday to Sunday, each day a small weekday over a large date. A
// visit sits on its time; visits that overlap fold into one "N Jobs booked" block that
// opens that Day. Day is the same grid for one day, with overlapping visits side by side
// in lanes that scroll sideways when a busy day needs more room. Month is a table of
// days, each with up to two visits or "N Jobs booked". src/web/schedule-layout.ts works
// out where everything goes. A current-time line is drawn on today from the Agency's clock.
//
// Under 768 px the Week is a list of days instead, where a run of empty days folds into
// one line ("Nothing booked Tue 13 – Wed 14"). Every visit on the grid is a list item
// whose link names its time, what it is for and the Tradie, so the grid reads as text.
// The rail sits left of the grid from 1024 px and under it below that. The Picked visit
// panel opens from 1280 px, and is always shown from 1600 px; below 1280 px a visit is a
// link to its Ticket.

import { Hono } from 'hono';
import { html } from 'hono/html';
import { TRADES, type Trade } from '../../shared.ts';
import { addDays, dayOf, daysFrom, mondayOf, parseDay, startOfDay, wallClock } from '../../zoned-time.ts';
import { bookingCard, bookingFlags, bookingsByDay, dayRange, longDay, shortDay, standingIcon, streetOf, tradeIcon, ticketHref, visitKind, visitWords, type Booking } from '../bookings.ts';
import type { WebEnv } from '../env.ts';
import { icon } from '../icons.ts';
import { layoutDay, hourRange, minuteOfDay, type DayLayout, type HourRange } from '../schedule-layout.ts';
import { COLLEAGUES_ONLY, shareButton, shareUrl } from '../share.ts';
import { shellInfo } from '../shell.ts';
import { badge, clip, flashFrom, formatTime, formatWhen, humanise, linkButton, page, segmented, tabs, type Html } from '../ui.ts';

export type { Booking } from '../bookings.ts';

type Filter = 'mine' | 'all';
type View = 'day' | 'week' | 'month';
const VIEWS: View[] = ['day', 'week', 'month'];

/** The filters beside the title: a Tradie, a Property, how the visit stands. */
interface Query {
  tradie: number | null;
  property: number | null;
  status: Booking['visit'] | null;
}
const STATUSES = [
  ['confirmed', 'Booked'],
  ['not_confirmed', 'Not confirmed yet'],
  ['reschedule_requested', 'Reschedule requested'],
  ['done', 'Done'],
] as const;

/** How many visits a Month day lists before it says "N Jobs booked" instead. */
const MONTH_CHIPS = 2;

/** The days a view shows, and the words and links around them. */
interface Period {
  view: View;
  /** The first day: the day itself, the Monday, or the 1st of the month. */
  first: string;
  days: string[];
  prev: string;
  next: string;
  /** "Tuesday 13 October 2026", "12 – 18 October 2026", "October 2026". */
  label: string;
  /** "Mon 2 Nov", "2 – 8 Nov", "Nov 2026": the period in a tile. */
  short: string;
  /** How the summary speaks of it: "on this day", "this week", "this month". */
  noun: string;
  current: boolean;
}

/** The shared calendar under /calendar. */
export function calendarPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const { timeZone } = actions.agency();
    const filter: Filter = c.req.query('filter') === 'all' ? 'all' : 'mine';
    const today = dayOf(actions.now(), timeZone);
    // ?week= is the older link to a week: it still opens that week.
    const legacyWeek = parseDay(c.req.query('week'));
    const view: View = VIEWS.find((v) => v === c.req.query('view')) ?? 'week';
    const period = periodOf(view, parseDay(c.req.query('date')) ?? legacyWeek ?? today, today);
    const { first, days } = period;
    const q: Query = {
      tradie: Number(c.req.query('tradie')) || null,
      property: Number(c.req.query('property')) || null,
      status: STATUSES.find(([v]) => v === c.req.query('status'))?.[0] ?? null,
    };
    const every = await actions.calendar({ from: startOfDay(first, timeZone).toISOString(), to: startOfDay(addDays(days.at(-1)!, 1), timeZone).toISOString() });
    const scoped = filter === 'mine' ? every.filter((b) => b.propertyManagerId === pm.id) : every;
    const bookings = scoped.filter((b) => (!q.tradie || b.tradieId === q.tradie) && (!q.property || b.propertyId === q.property) && (!q.status || b.visit === q.status));
    const hidden = every.length - scoped.length;
    const byDay = bookingsByDay(bookings, first, timeZone);
    const ctx: Ctx = { timeZone, filter, meId: pm.id, today, now: actions.now(), q };
    const directory = await actions.tradieDirectory();
    const focus = days.includes(today) ? today : first;
    // The small month: the one around the middle of the period, with a dot on each day that has a visit.
    const anchor = days.includes(today) ? today : days[Math.floor(days.length / 2)]!;
    const monthFirst = `${anchor.slice(0, 7)}-01`;
    const monthNext = `${addDays(monthFirst, 32).slice(0, 7)}-01`;
    const monthEvery = view === 'month' ? every : await actions.calendar({ from: startOfDay(monthFirst, timeZone).toISOString(), to: startOfDay(monthNext, timeZone).toISOString() });
    const visitDays = new Set((filter === 'mine' ? monthEvery.filter((b) => b.propertyManagerId === pm.id) : monthEvery).map((b) => dayOf(b.start, timeZone)));
    const properties = [...new Map(scoped.map((b) => [b.propertyId, streetOf(b.propertyAddress)])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'en'));

    return c.html(
      page({
        title: 'Schedule',
        pm,
        active: 'schedule',
        shell: shellInfo(c),
        flash: flashFrom(c.req.url),
        titleExtra: filterForm(period, filter, q, directory, properties),
        controls: html`${segmented(
            [
              { label: 'Mine', href: hrefFor(view, first, 'mine', q), active: filter === 'mine' },
              { label: 'All', href: hrefFor(view, first, 'all', q), active: filter === 'all' },
            ],
            'Whose visits',
          )}
          ${shareButton({ ...shareWords(period, every.length), url: shareUrl(c, hrefFor(view, first, 'mine')), note: COLLEAGUES_ONLY })}`,
        body: html`
          <div class="schedule-shell" data-schedule-shell>
            <div class="schedule-rail">
              ${miniMonth(monthFirst, period, visitDays, ctx)}
              <dl class="schedule-stats">
                <div class="schedule-stat is-showing"><dt>Showing</dt><dd>${period.short}</dd></div>
                <div class="schedule-stat"><dt>Visits</dt><dd class="num">${bookings.length} booked</dd></div>
              </dl>
              ${visitTypes()}
              ${tradieList(directory, every, bookings, period, today, ctx)}
            </div>
            <div class="schedule-center">
              ${scheduleToolbar(period, filter, focus, q)}
              ${summary(
                bookings,
                pm.id,
                hidden ? html`${hidden} more ${hidden === 1 ? 'visit' : 'visits'} ${period.noun} on other Property Managers’ Properties. <a class="link" href="${hrefFor(view, first, 'all', q)}">Show all</a>` : '',
              )}
              <div class="schedule-main" id="schedule" tabindex="-1">${view === 'day' ? dayView(first, byDay.get(first) ?? [], ctx) : view === 'week' ? weekView(days, byDay, ctx) : monthView(period, byDay, ctx)}</div>
            </div>
            ${pickPanel(bookings, directory, ctx)}
          </div>
        `,
      }),
    );
  });

  return pages;
}

/** What every part of the page needs to know. */
interface Ctx {
  timeZone: string;
  filter: Filter;
  meId: number;
  today: string;
  now: Date;
  q: Query;
}

/** "Tue 13 Oct, 9:00 am – 11:00 am": the start in full, then the end's time of day. */
export function timeRange(start: string, end: string, timeZone: string): Html {
  return html`<time datetime="${start}">${formatWhen(start, timeZone)}</time> – <time datetime="${end}">${formatTime(end, timeZone)}</time>`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const jobsBooked = (n: number) => `${plural(n, 'Job', 'Jobs')} booked`;

/** The days a view shows around `date`, and the days before and after it. */
function periodOf(view: View, date: string, today: string): Period {
  if (view === 'day') {
    return { view, first: date, days: [date], prev: addDays(date, -1), next: addDays(date, 1), label: dayTitle(date), short: shortDay(date, { month: true }), noun: 'on this day', current: date === today };
  }
  if (view === 'week') {
    const monday = mondayOf(date);
    const days = daysFrom(monday, 7);
    return { view, first: monday, days, prev: addDays(monday, -7), next: addDays(monday, 7), label: weekTitle(days), short: `${Number(days[0]!.slice(8))} – ${Number(days.at(-1)!.slice(8))} ${monthShort(days.at(-1)!)}`, noun: 'this week', current: mondayOf(today) === monday };
  }
  const first = `${date.slice(0, 7)}-01`;
  const next = `${addDays(first, 32).slice(0, 7)}-01`;
  const days: string[] = [];
  for (let d = first; d < next; d = addDays(d, 1)) days.push(d);
  return { view, first, days, prev: `${addDays(first, -1).slice(0, 7)}-01`, next, label: monthName(first), short: `${monthShort(first)} ${first.slice(0, 4)}`, noun: 'this month', current: today.slice(0, 7) === first.slice(0, 7) };
}

/** "Nov" */
function monthShort(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short' }).format(new Date(`${day}T00:00:00Z`));
}

/** "October 2026" */
function monthName(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${day}T00:00:00Z`));
}

/** "12 – 18 October 2026", "26 October – 1 November 2026", or "28 December 2026 – 3 January 2027" when the years differ. */
function weekTitle(days: string[]): string {
  const first = days[0]!;
  const last = days.at(-1)!;
  if (first.slice(0, 4) !== last.slice(0, 4)) return `${dayAndMonth(first, true)} – ${dayAndMonth(last, true)}`;
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  return sameMonth ? `${Number(first.slice(8))} – ${dayAndMonth(last, true)}` : `${dayAndMonth(first)} – ${dayAndMonth(last, true)}`;
}

/** "Tuesday 13 October 2026". The Day title and its share text name the year; a weekday in the grid does not. */
function dayTitle(day: string): string {
  return `${longDay(day)} ${day.slice(0, 4)}`;
}

/** "18 October", or "18 October 2026" with the year. */
function dayAndMonth(day: string, year = false): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: year ? 'numeric' : undefined }).format(new Date(`${day}T00:00:00Z`));
}

/** The share panel's words for the period shown. */
function shareWords(p: Period, count: number): { title: string; text: string } {
  const when = p.view === 'day' ? `on ${p.label}` : p.view === 'week' ? `in the week of ${longDay(p.first)}` : `in ${monthName(p.first)}`;
  return {
    title: `Jobs booked, ${p.label}`,
    text: count ? `${jobsBooked(count)} ${when} across the Agency.` : `Nothing booked yet ${when}.`,
  };
}

/**
 * The flags over the grid: how the visits stand, when any need a look. A reschedule
 * request on the Property Manager's own Property waits on them, so it carries the
 * Wattle stripe; a colleague's only stands out. `more` says what Mine leaves out.
 */
function summary(bookings: Booking[], meId: number, more: Html | ''): Html | '' {
  const reschedules = bookings.filter((b) => b.visit === 'reschedule_requested');
  const mine = reschedules.filter((b) => b.propertyManagerId === meId).length;
  const others = reschedules.length - mine;
  const unconfirmed = bookings.filter((b) => b.visit === 'not_confirmed').length;
  if (!mine && !others && !unconfirmed && !more) return '';
  return html`<div class="schedule-summary">
    <p class="schedule-tally">
      ${mine ? html`<span class="schedule-flag is-decision">${plural(mine, 'reschedule request', 'reschedule requests')} waiting on you</span>` : ''}
      ${others ? html`<span class="schedule-flag is-reschedule">${plural(others, 'reschedule', 'reschedules')} requested</span>` : ''}
      ${unconfirmed ? html`<span class="schedule-flag">${unconfirmed} not confirmed yet</span>` : ''}
    </p>
    ${more ? html`<p class="schedule-more">${more}</p>` : ''}
  </div>`;
}

/** "Mon", for the small weekday over a date. */
function weekdayOf(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${day}T00:00:00Z`));
}

/** Saturday or Sunday, which sit on Paper. */
function weekend(day: string): boolean {
  const n = new Date(`${day}T00:00:00Z`).getUTCDay();
  return n === 0 || n === 6;
}

/**
 * A day's heading: the weekday small, the date large, the full date for a screen
 * reader. Today's date is marked, so the Harbour circle has something to sit on.
 */
function dateLink(day: string, ctx: Ctx): Html {
  const isToday = day === ctx.today;
  return html`<a class="schedule-date" href="${hrefFor('day', day, ctx.filter, ctx.q)}" ${isToday ? html`aria-current="date"` : ''}>
    <time datetime="${day}">
      <span class="schedule-weekday" aria-hidden="true">${weekdayOf(day)}</span>
      <span class="schedule-num num" aria-hidden="true">${Number(day.slice(8))}</span>
      <span class="sr-only">${longDay(day)}</span>
    </time>
  </a>`;
}

/**
 * The current-time line across today's column, with its dot in the gutter. Placed
 * from the Agency's clock, so it is there with no JavaScript; app.js moves it
 * each minute from `data-now` (this instant, epoch ms) and hides it once `data-today`
 * has passed. Absent only when today is not on this grid. Outside the hours shown
 * it is still rendered, hidden, so it can appear when the hours begin without a
 * reload. `header` is the Week's row of dates, which the Day grid has not.
 */
function nowLine(range: HourRange, todayIndex: number, ctx: Ctx, header: boolean): Html | '' {
  if (todayIndex < 0) return '';
  const clock = wallClock(ctx.now, ctx.timeZone);
  const mins = clock.hour * 60 + clock.minute;
  const start = range.first * 60;
  const outside = mins < start || mins >= range.last * 60;
  const into = outside ? 0 : mins - start;
  const row = Math.floor(into / 15) + (header ? 2 : 1);
  // The gutter is column 1 and Monday is column 2, so Thursday (index 3) ends at column 6.
  const column = header ? `1 / ${todayIndex + 3}` : '1 / -1';
  return html`<div class="schedule-now${header ? '' : ' is-day'}"${outside ? html` hidden` : ''} data-schedule-now data-now="${String(ctx.now.getTime())}" data-today="${ctx.today}" data-zone="${ctx.timeZone}" data-first="${range.first}" data-last="${range.last}" data-header="${header ? '1' : '0'}" style="grid-row: ${row}; grid-column: ${column}; --now-frac: ${outside ? 0 : (into % 15) / 15}" aria-hidden="true"><span class="schedule-now-dot"></span><span class="schedule-now-line"></span></div>`;
}

/** "7 am", "12 pm" */
function hourName(hour: number): string {
  return `${hour % 12 || 12} ${hour < 12 || hour === 24 ? 'am' : 'pm'}`;
}

/**
 * The hour the grid opens on: an hour before the first visit, or 7 am when the
 * period has none, kept inside the hours on show. app.js scrolls the frame to the
 * hour marked data-schedule-open.
 */
function anchorHour(range: HourRange, spans: { from: number }[]): number {
  const target = spans.length ? Math.floor((Math.min(...spans.map((s) => s.from)) - 60) / 60) : 7;
  return Math.min(range.last - 1, Math.max(range.first, target));
}

/** The hour lines and their times down the left: decoration, since every visit names its own time. Half-hours are the fainter rules. */
function hourLines(range: HourRange, anchor: number): Html {
  const hours = Array.from({ length: range.last - range.first }, (_, i) => range.first + i);
  return html`<div class="schedule-hours" aria-hidden="true">
    ${hours.map(
      (h, i) =>
        html`<span class="schedule-hour" style="grid-row: ${i * 4 + 1} / span 4"${h === anchor ? ' data-schedule-open' : ''}><span class="schedule-hour-label">${hourName(h)}</span></span><span class="schedule-half" style="grid-row: ${i * 4 + 3}"></span>`,
    )}
  </div>`;
}

/**
 * The Week: the time grid from 768 px, the list of days under it. Both are written; the
 * CSS shows the one that suits the screen, so each screen reads one of the two.
 */
function weekView(days: string[], byDay: Map<string, Booking[]>, ctx: Ctx): Html {
  const spans = days.flatMap((d) => (byDay.get(d) ?? []).map((b) => ({ from: minuteOfDay(b.start, d, ctx.timeZone), to: minuteOfDay(b.end, d, ctx.timeZone) })));
  const range = hourRange(spans);
  const layouts = days.map((d) => ({ day: d, bookings: byDay.get(d) ?? [], layout: layoutDay(byDay.get(d) ?? [], d, ctx.timeZone, range) }));
  const rows = layouts[0]!.layout.rows;
  return html`${weekList(days, byDay, ctx)}
    <div class="schedule-scroll is-week" role="region" aria-label="The week, hour by hour" tabindex="0">
      <div class="schedule-grid is-week" style="--slots: ${rows}; --cols: 7">
        ${hourLines(range, anchorHour(range, spans))}
        <ol class="schedule-cols" aria-label="The week, Monday to Sunday">
          ${layouts.map(({ day, bookings, layout }) => weekColumn(day, bookings.length, layout, ctx))}
        </ol>
        ${nowLine(range, days.indexOf(ctx.today), ctx, true)}
      </div>
    </div>`;
}

/** One day of the Week's grid: its name (opening the Day), then its visits on their times, an overlap as one block. */
function weekColumn(day: string, count: number, layout: DayLayout<Booking>, ctx: Ctx): Html {
  const isToday = day === ctx.today;
  const classes = ['schedule-col', isToday ? 'is-today' : '', weekend(day) ? 'is-weekend' : ''].filter(Boolean).join(' ');
  return html`<li class="${classes}">
    <h2 class="schedule-col-title">${dateLink(day, ctx)}</h2>
    ${count
      ? html`<ol class="schedule-slots">
          ${layout.clusters.map((cl) => {
            const style = `grid-row: ${cl.rowStart} / ${cl.rowEnd}`;
            return cl.items.length > 1 ? clusterBlock(day, cl.items.map((p) => p.item), style, ctx) : visitBlock(cl.items[0]!.item, style, cl.rowEnd - cl.rowStart, ctx);
          })}
        </ol>`
      : html`<p class="sr-only">Nothing booked</p>`}
  </li>`;
}

/** "9:00 am – 11:00 am, The kitchen tap is dripping, Pete's Plumbing". The link's name, in full, even when a short visit shows one line. */
function blockName(b: Booking, ctx: Ctx): string {
  const time = `${formatTime(b.start, ctx.timeZone)} – ${formatTime(b.end, ctx.timeZone)}`;
  return [time, visitKind(b), b.issue, b.businessName, visitWords(b)].filter((part) => part).join(', ');
}

/**
 * A visit on the Week's grid: a rounded block, the time and the issue in bold, then the
 * Tradie. `rows` is how many quarter-hours it spans; an hour or less is one line.
 * The colour comes from bookingFlags and visitKind. The Day uses dayBlock, which has room
 * for the address and the links a Week column does not.
 */
function visitBlock(b: Booking, style: string, rows: number, ctx: Ctx): Html {
  const kind = visitKind(b);
  const words = visitWords(b);
  const flags = [rows <= 4 ? 'is-short' : '', ...bookingFlags(b, b.propertyManagerId === ctx.meId)].filter(Boolean).join(' ');
  return html`<li class="schedule-block ${flags}" style="${style}" ${pickData(b)}>
    <a class="schedule-block-link" href="${ticketHref(b)}" aria-label="${blockName(b, ctx)}">
      <span class="schedule-block-time num">${tradeIcon(b.trade)}<time datetime="${b.start}">${formatTime(b.start, ctx.timeZone)}</time><span class="schedule-block-end"> – <time datetime="${b.end}">${formatTime(b.end, ctx.timeZone)}</time></span></span>
      ${kind ? html`<span class="schedule-marker">${kind}</span>` : ''}
      <span class="schedule-block-issue">${clip(b.issue, { lines: 2 })}</span>
      <span class="schedule-block-tradie">${b.businessName}</span>
      ${words ? html`<span class="schedule-block-meta">${words}</span>` : ''}
    </a>
  </li>`;
}

/** "12 King St, Newtown": the street, then the suburb. The state and postcode are noise here. */
function placeLine(b: Booking): string {
  const street = streetOf(b.propertyAddress);
  return b.suburb && street !== b.propertyAddress ? `${street}, ${b.suburb}` : b.propertyAddress;
}

/**
 * A visit on the Day. The lane is wide enough for what the Week's block leaves out:
 * the street and suburb, the Tradie's profile, the Property Manager when All is on,
 * and Reschedule requested as a link to the suggested times. The issue's name still
 * reads the whole visit, including the address, when the card is clipped.
 */
function dayBlock(b: Booking, style: string, ctx: Ctx): Html {
  const kind = visitKind(b);
  const place = placeLine(b);
  const flags = bookingFlags(b, b.propertyManagerId === ctx.meId).join(' ');
  const time = `${formatTime(b.start, ctx.timeZone)} – ${formatTime(b.end, ctx.timeZone)}`;
  const name = [time, kind, b.issue, b.businessName, place, visitWords(b)].filter((part) => part).join(', ');
  return html`<li class="schedule-block ${flags}" style="${style}" ${pickData(b)}>
    <div class="schedule-block-link">
      <span class="schedule-block-time num">${tradeIcon(b.trade)}<time datetime="${b.start}">${formatTime(b.start, ctx.timeZone)}</time><span class="schedule-block-end"> – <time datetime="${b.end}">${formatTime(b.end, ctx.timeZone)}</time></span></span>
      ${kind ? html`<span class="schedule-marker">${kind}</span>` : ''}
      <a class="schedule-block-issue" href="${ticketHref(b)}" aria-label="${name}">${clip(b.issue, { lines: 2 })}</a>
      <a class="schedule-block-tradie" href="/tradies/${b.tradieId}">${b.businessName}</a>
      <span class="schedule-block-place">${place}</span>
      ${ctx.filter === 'all' ? html`<span class="schedule-block-meta"><span class="sr-only">Property Manager: </span>${b.propertyManager}</span>` : ''}
      ${dayStatus(b)}
    </div>
  </li>`;
}

/** How the visit stands on the Day, where there is room for the reschedule link. */
function dayStatus(b: Booking): Html | '' {
  switch (b.visit) {
    case 'done':
      return html`<span class="schedule-block-meta">Done</span>`;
    case 'reschedule_requested':
      return html`<a class="booking-reschedule" href="/tickets/${b.ticketId}?suggest=${b.workOrderId}">Reschedule requested</a>`;
    case 'not_confirmed':
      return html`<span class="schedule-block-meta">Not confirmed yet</span>`;
    case 'confirmed':
      return '';
  }
}

/** Visits that overlap, as one block over their time that opens the Day they are on. */
function clusterBlock(day: string, bookings: Booking[], style: string, ctx: Ctx): Html {
  const start = bookings.reduce((a, b) => (a.start <= b.start ? a : b)).start;
  const end = bookings.reduce((a, b) => (a.end >= b.end ? a : b)).end;
  const flags = new Set(bookings.flatMap((b) => bookingFlags(b, b.propertyManagerId === ctx.meId)).filter((f) => f === 'is-reschedule' || f === 'is-decision'));
  return html`<li class="schedule-block is-cluster ${[...flags].join(' ')}" style="${style}">
    <a class="schedule-block-link" href="${hrefFor('day', day, ctx.filter, ctx.q)}">
      <span class="schedule-block-count">${jobsBooked(bookings.length)}</span>
      <span class="schedule-block-time num"><time datetime="${start}">${formatTime(start, ctx.timeZone)}</time> – <time datetime="${end}">${formatTime(end, ctx.timeZone)}</time></span>
      <span class="sr-only">at the same time. Open the day to see them side by side.</span>
    </a>
  </li>`;
}

/**
 * The Day: one time grid with a lane for each visit running at once, each lane at
 * least 14rem, so a busy day scrolls sideways inside its frame rather than squeezing
 * the cards. A visit alone at its time takes every lane's width.
 */
function dayView(day: string, bookings: Booking[], ctx: Ctx): Html {
  const layout = layoutDay(bookings, day, ctx.timeZone);
  const lanes = layout.lanes;
  return html`${bookings.length ? '' : html`<p class="schedule-empty sr-only">Nothing booked on ${longDay(day)}.</p>`}
    <div class="schedule-scroll is-day${weekend(day) ? ' is-weekend' : ''}" role="region" aria-label="${longDay(day)}, hour by hour. Visits at the same time sit side by side: scroll sideways to see them all." tabindex="0">
      <div class="schedule-grid is-day" style="--slots: ${layout.rows}; --cols: ${lanes}">
        ${hourLines(layout.range, anchorHour(layout.range, layout.clusters))}
        <ol class="schedule-lanes" aria-label="Visits on ${longDay(day)}, in time order">
          ${layout.clusters.flatMap((cl) =>
            cl.items.map((p) => {
              const from = Math.floor((p.lane * lanes) / cl.lanes) + 1;
              const to = Math.floor(((p.lane + 1) * lanes) / cl.lanes) + 1;
              return dayBlock(p.item, `grid-row: ${p.rowStart} / ${p.rowEnd}; grid-column: ${from} / ${to}`, ctx);
            }),
          )}
        </ol>
        ${nowLine(layout.range, day === ctx.today ? 0 : -1, ctx, false)}
      </div>
    </div>`;
}

/**
 * The Month: a table of weeks, Monday to Sunday, the days of the months either side
 * muted. A day lists up to two visits; with more, or any that overlap, it says "N Jobs
 * booked" and opens the Day. On phones a day says only how many.
 */
function monthView(p: Period, byDay: Map<string, Booking[]>, ctx: Ctx): Html {
  const start = mondayOf(p.first);
  const end = addDays(mondayOf(p.days.at(-1)!), 7);
  const weeks: string[][] = [];
  for (let d = start; d < end; d = addDays(d, 7)) weeks.push(daysFrom(d, 7));
  const inMonth = (d: string) => d.slice(0, 7) === p.first.slice(0, 7);
  return html`<div class="table-frame schedule-month-frame">
    <table class="schedule-month">
      <caption class="sr-only">${p.label}, a week to a row from Monday to Sunday. Each day links to its Day view.</caption>
      <thead>
        <tr>
          ${weeks[0]!.map((d) => html`<th scope="col"><abbr title="${new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${d}T00:00:00Z`))}">${shortDay(d).split(' ')[0]}</abbr></th>`)}
        </tr>
      </thead>
      <tbody>
        ${weeks.map((week) => html`<tr>${week.map((d) => monthDay(d, inMonth(d) ? (byDay.get(d) ?? []) : null, ctx))}</tr>`)}
      </tbody>
    </table>
  </div>`;
}

/** One day of the Month; `bookings` is null for a day of the month either side. */
function monthDay(day: string, bookings: Booking[] | null, ctx: Ctx): Html {
  const isToday = day === ctx.today;
  const classes = ['schedule-mday', bookings === null ? 'is-outside' : '', bookings?.length ? 'is-booked' : '', isToday ? 'is-today' : ''].filter(Boolean).join(' ');
  const dayHref = hrefFor('day', day, ctx.filter, ctx.q);
  const number = html`<a class="schedule-mday-num num" href="${dayHref}"${isToday ? html` aria-current="date"` : ''}><span aria-hidden="true">${Number(day.slice(8))}</span><span class="sr-only">${longDay(day)}</span></a>`;
  if (!bookings?.length) return html`<td class="${classes}">${number}</td>`;
  const overlaps = layoutDay(bookings, day, ctx.timeZone).clusters.some((cl) => cl.items.length > 1);
  const folded = overlaps || bookings.length > MONTH_CHIPS;
  const sorted = [...bookings].sort((a, b) => a.start.localeCompare(b.start));
  return html`<td class="${classes}">
    ${number}
    ${folded
      ? ''
      : html`<ul class="schedule-chips">
          ${sorted.map(
            (b) => html`<li class="schedule-chip ${bookingFlags(b, b.propertyManagerId === ctx.meId).join(' ')}" ${pickData(b)}>
              <a href="${ticketHref(b)}" title="${formatTime(b.start, ctx.timeZone)}, ${b.issue}, ${b.businessName}">
                <span class="schedule-chip-head">${tradeIcon(b.trade)}<span class="num">${formatTime(b.start, ctx.timeZone)}</span></span>
                <span class="schedule-chip-issue">${b.issue}</span>
                <span class="schedule-chip-tradie"><span class="schedule-chip-name">${b.businessName}</span>${standingIcon(b.visit)}</span>
              </a>
            </li>`,
          )}
        </ul>`}
    <a class="schedule-mday-more ${folded ? '' : 'is-phone-only'}" href="${dayHref}"><span class="num">${bookings.length}</span> <span class="schedule-mday-words">${bookings.length === 1 ? 'Job' : 'Jobs'} booked</span></a>
  </td>`;
}

/**
 * The Week under 768 px, as a list of days. Each run of empty days (today is never
 * folded) is one line.
 */
function weekList(days: string[], byDay: Map<string, Booking[]>, ctx: Ctx): Html {
  const items: Html[] = [];
  let quiet: string[] = [];
  const flush = () => {
    if (quiet.length) items.push(html`<li class="schedule-quiet">Nothing booked ${dayRange(quiet)}</li>`);
    quiet = [];
  };
  for (const day of days) {
    const bookings = byDay.get(day) ?? [];
    if (!bookings.length && day !== ctx.today) {
      quiet.push(day);
      continue;
    }
    flush();
    items.push(dayItem(day, bookings, ctx));
  }
  flush();
  return html`<ol class="schedule-week" aria-label="The week, Monday to Sunday">${items}</ol>`;
}

/** One day: "Mon 12" and how many visits, then its bookings or "Nothing booked". */
function dayItem(day: string, bookings: Booking[], ctx: Ctx): Html {
  const isToday = day === ctx.today;
  const classes = ['schedule-day', bookings.length ? 'is-booked' : 'is-empty', isToday ? 'is-today' : ''].join(' ');
  return html`<li class="${classes}">
    <h2 class="schedule-day-title">
      ${dateLink(day, ctx)}
      ${isToday ? badge('Today', 'info') : ''}
      ${bookings.length ? html`<span class="schedule-day-count num">${plural(bookings.length, 'visit', 'visits')}</span>` : ''}
    </h2>
    ${bookings.length
      ? html`<ul class="booking-list">${bookings.map((b) => bookingCard(b, ctx.timeZone, { propertyManager: ctx.filter === 'all', decision: b.propertyManagerId === ctx.meId }))}</ul>`
      : html`<p class="text-sm text-muted">Nothing booked</p>`}
  </li>`;
}

/** What a block carries so the Picked visit panel and the Visit types boxes can find it. */
function pickData(b: Booking): Html {
  return html`data-pick="${b.workOrderId}" data-type="${visitKind(b) ? 'inspection' : 'work-order'}" data-state="${b.visit}"`;
}

/**
 * The bar inside the Schedule card: Today, Day / Week / Month, and the period with
 * its previous and next arrows. Mine / All and Share sit in the page header, the
 * filters beside the title. On a phone the bar wraps to a second row. Today is
 * always there, outlined, even when this period is already today.
 */
function scheduleToolbar(p: Period, filter: Filter, focus: string, q: Query): Html {
  const unit = p.view === 'day' ? 'day' : p.view === 'week' ? 'week' : 'month';
  return html`<div class="schedule-toolbar">
    <div class="schedule-toolbar-start">
      ${linkButton('Today', hrefFor(p.view, null, filter, q), { size: 'sm' })}
      ${tabs(
        VIEWS.map((v) => ({ label: v === 'day' ? 'Day' : v === 'week' ? 'Week' : 'Month', href: hrefFor(v, focus, filter, q), active: v === p.view })),
        'Calendar views',
      )}
    </div>
    <nav class="schedule-nav" aria-label="${unit === 'day' ? 'Days' : unit === 'week' ? 'Weeks' : 'Months'}">
      <a class="btn btn-ghost btn-sm btn-square" href="${hrefFor(p.view, p.prev, filter, q)}" aria-label="Previous ${unit}">${icon('caret-left', { size: 'size-4' })}</a>
      <h2 class="schedule-period">${p.label}</h2>
      <a class="btn btn-ghost btn-sm btn-square" href="${hrefFor(p.view, p.next, filter, q)}" aria-label="Next ${unit}">${icon('caret-right', { size: 'size-4' })}</a>
    </nav>
  </div>`;
}

/**
 * Beside the title: Tradie, Property and Status. A GET form that keeps the view, the
 * date and Mine / All, and applies when one changes (app.js); the Apply button is for
 * a page without it.
 */
function filterForm(p: Period, filter: Filter, q: Query, tradies: DirectoryTradie[], properties: [number, string][]): Html {
  const select = (name: string, label: string, all: string, options: [string | number, string][], value: string | number | null) => html`<label class="schedule-filter">
    <span class="sr-only">${label}</span>
    <select name="${name}" class="select select-sm" aria-label="${label}">
      <option value="">${all}</option>
      ${options.map(([v, text]) => html`<option value="${v}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${text}</option>`)}
    </select>
  </label>`;
  const names: [number, string][] = tradies.map((t) => [t.tradieId, t.businessName ?? t.name]);
  names.sort((a, b) => a[1].localeCompare(b[1], 'en'));
  return html`<form method="get" action="/calendar" class="schedule-filters" data-autosubmit role="search" aria-label="Filter the schedule">
    <input type="hidden" name="view" value="${p.view}" />
    <input type="hidden" name="date" value="${p.first}" />
    ${filter === 'all' ? html`<input type="hidden" name="filter" value="all" />` : ''}
    ${select('tradie', 'Tradie', 'Tradie', names, q.tradie)}
    ${select('property', 'Property', 'Property', properties, q.property)}
    ${select('status', 'Status', 'Status', STATUSES.map(([v, text]) => [v, text]), q.status)}
    <button type="submit" class="btn btn-sm filter-bar-apply">Apply</button>
    ${q.tradie || q.property || q.status ? html`<a class="link schedule-clear" href="${hrefFor(p.view, p.first, filter)}">Clear</a>` : ''}
  </form>`;
}

/**
 * A small month on the left: each day links to its Day, the days in the period on show
 * are tinted, and a dot marks a day with a visit. Monday first, like the grid.
 */
function miniMonth(monthFirst: string, p: Period, visitDays: Set<string>, ctx: Ctx): Html {
  const start = mondayOf(monthFirst);
  const end = addDays(mondayOf(addDays(monthFirst, 32).slice(0, 7) + '-01'), 0);
  const cells: string[] = [];
  for (let d = start; d < end || cells.length % 7; d = addDays(d, 1)) cells.push(d);
  const previous = `${addDays(monthFirst, -1).slice(0, 7)}-15`;
  const next = `${addDays(monthFirst, 32).slice(0, 7)}-15`;
  const shown = new Set(p.days);
  return html`<section class="schedule-mini" aria-labelledby="mini-title">
    <header class="schedule-mini-head">
      <h2 id="mini-title">${monthName(monthFirst)}</h2>
      <span class="schedule-mini-nav">
        <a class="schedule-mini-arrow" href="${hrefFor(p.view, previous, ctx.filter, ctx.q)}" aria-label="Previous month">${icon('arrow-left', { size: 'size-4' })}</a>
        <a class="schedule-mini-arrow" href="${hrefFor(p.view, next, ctx.filter, ctx.q)}" aria-label="Next month">${icon('arrow-right', { size: 'size-4' })}</a>
      </span>
    </header>
    <ol class="schedule-mini-days">
      ${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((w) => html`<li class="schedule-mini-week" aria-hidden="true">${w}</li>`)}
      ${cells.map((d) => {
        const classes = ['schedule-mini-day', d.slice(0, 7) !== monthFirst.slice(0, 7) ? 'is-outside' : '', d === ctx.today ? 'is-today' : '', shown.has(d) ? 'is-shown' : '', visitDays.has(d) ? 'has-visits' : ''].filter(Boolean).join(' ');
        return html`<li><a class="${classes}" href="${hrefFor('day', d, ctx.filter, ctx.q)}" ${d === ctx.today ? html`aria-current="date"` : ''}><span aria-hidden="true">${Number(d.slice(8))}</span><span class="sr-only">${longDay(d)}${visitDays.has(d) ? ', has visits' : ''}</span></a></li>`;
      })}
    </ol>
  </section>`;
}

/**
 * The boxes under the month: which kinds of visit the grid shows. They work in the
 * browser (app.js hides the blocks); a box with no script behind it would be a
 * promise, so the whole group is hidden until app.js unhides it.
 */
function visitTypes(): Html {
  const box = (key: string, label: string, swatch: string) => html`<label class="schedule-type"><input type="checkbox" data-hide-key="${key}" checked /><span class="schedule-swatch ${swatch}" aria-hidden="true"></span>${label}</label>`;
  return html`<section class="schedule-types" aria-labelledby="types-title" data-needs-script hidden>
    <h2 id="types-title">Visit types</h2>
    <label class="schedule-type"><input type="checkbox" data-hide-all checked />Select all</label>
    ${box('work-order', 'Work Orders', 'is-work')}
    ${box('inspection', 'Site Inspections', 'is-inspection')}
    ${box('not_confirmed', 'Not confirmed yet', 'is-unconfirmed')}
    ${box('reschedule_requested', 'Reschedule requested', 'is-reschedule')}
  </section>`;
}

/** What `tradieDirectory` gives the panels. They only need a few of its fields. */
type DirectoryTradie = {
  tradieId: number;
  name: string;
  businessName: string | null;
  trades: Trade[];
  myEst8Rating: { average: number; count: number };
};

/** "Drip Doctors" is DD; a single word gives its first two letters. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, 2)
      .map((word) => word.replace(/^[^A-Za-z0-9]+/, '')[0] ?? '')
      .join('')
      .toUpperCase();
  }
  return (words[0] ?? name).slice(0, 2).toUpperCase();
}

/**
 * The Agency's Tradies on the left: initials, the business name, how many visits they
 * have in the period shown, and a Free tag when they have none today (the calendar
 * returns all Agency visits, not only Mine). Each is a link that filters the grid to
 * that Tradie; the one filtered to links back to all. Busy Tradies first.
 */
function tradieList(tradies: DirectoryTradie[], every: Booking[], shown: Booking[], p: Period, today: string, ctx: Ctx): Html {
  const todayOn = p.days.includes(today);
  const busyToday = new Set(every.filter((b) => dayOf(b.start, ctx.timeZone) <= today && dayOf(new Date(Date.parse(b.end) - 1).toISOString(), ctx.timeZone) >= today).map((b) => b.tradieId));
  const entries = tradies
    .map((t) => ({ id: t.tradieId, name: t.businessName ?? t.name, count: shown.filter((b) => b.tradieId === t.tradieId).length, free: todayOn && !busyToday.has(t.tradieId), trades: t.trades }))
    .sort((a, b) => Number(a.free) - Number(b.free) || a.name.localeCompare(b.name, 'en'));
  const when = p.view === 'day' ? (p.current ? 'today' : 'that day') : p.noun;
  return html`<section class="schedule-tradies" aria-labelledby="tradies-title">
    <h2 id="tradies-title">Tradies${todayOn && tradies.length ? html` <span class="num">(${entries.filter((e) => e.free).length} free today)</span>` : ''}</h2>
    ${entries.length
      ? html`<ul class="schedule-tradie-list">
          ${entries.map((e) => {
            const on = ctx.q.tradie === e.id;
            return html`<li><a class="schedule-tradie${on ? ' is-on' : ''}" href="${hrefFor(p.view, p.first, ctx.filter, { ...ctx.q, tradie: on ? null : e.id })}" ${on ? html`aria-current="true"` : ''}>
              <span class="tradie-initials" aria-hidden="true">${initials(e.name)}</span>
              <span class="schedule-tradie-text"><span class="schedule-tradie-name">${e.name}</span><span class="schedule-tradie-sub">${e.count ? plural(e.count, 'visit', 'visits') : 'No visits'} ${when}</span></span>
              ${e.free ? html`<span class="schedule-free-tag">Free</span>` : ''}
            </a></li>`;
          })}
        </ul>`
      : html`<p class="schedule-free-note">No Tradies yet. <a class="link" href="/tradies/new">Add a Tradie</a></p>`}
  </section>`;
}

/** How long a visit lasts: "30m", "2h", "1h 30m". */
function lasting(start: string, end: string): string {
  const mins = Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ') || '0m';
}

/**
 * The Picked visit panel on the right. Every visit on the page has its details written
 * here, hidden; app.js shows the one picked on the grid. With no script the panel stays
 * hidden and each block is still a link to its Ticket.
 */
function pickPanel(bookings: Booking[], directory: DirectoryTradie[], ctx: Ctx): Html {
  return html`<aside class="schedule-pick" aria-label="Picked visit" data-pick-panel hidden>
    <header class="schedule-pick-head">
      <h2><span class="schedule-pick-dot" aria-hidden="true"></span>Picked visit</h2>
      <button type="button" class="schedule-pick-close" data-pick-close aria-label="Close" hidden>${icon('x', { size: 'size-4' })}</button>
    </header>
    <p class="schedule-pick-empty" data-pick-empty>Pick a visit on the grid to see it here.</p>
    ${bookings.map((b) => pickCard(b, directory.find((t) => t.tradieId === b.tradieId), ctx))}
  </aside>`;
}

/** One visit's details: how it stands, what for, when, who, where, and the way to its Ticket. */
function pickCard(b: Booking, tradie: DirectoryTradie | undefined, ctx: Ctx): Html {
  const kind = visitKind(b);
  const standing = STATUSES.find(([v]) => v === b.visit)![1];
  const rating = tradie?.myEst8Rating;
  const trades = tradie ? [...tradie.trades].sort((x, y) => TRADES.indexOf(x) - TRADES.indexOf(y)).map((t) => humanise(t)).join(', ') : humanise(b.trade);
  return html`<article class="schedule-pick-card" data-pick-card="${b.workOrderId}" hidden>
    <div class="schedule-pick-top">
      <p class="schedule-pick-status ${bookingFlags(b, b.propertyManagerId === ctx.meId).join(' ')} is-${b.visit}">${standing}</p>
      <h3 class="schedule-pick-title">${b.issue}</h3>
      <p class="schedule-pick-sub">${kind ?? 'Work Order'} · Ticket #${b.ticketId}</p>
    </div>
    <div class="schedule-pick-when">
      <p>${icon('clock', { size: 'size-4' })}<span class="num"><time datetime="${b.start}">${formatTime(b.start, ctx.timeZone)}</time> – <time datetime="${b.end}">${formatTime(b.end, ctx.timeZone)}</time></span><span class="schedule-pick-len num">${lasting(b.start, b.end)}</span></p>
      <p>${icon('calendar-blank', { size: 'size-4' })}<span>${dayTitle(dayOf(b.start, ctx.timeZone))}</span></p>
      ${b.visit === 'reschedule_requested' ? html`<a class="btn btn-sm btn-secondary schedule-pick-act" href="/tickets/${b.ticketId}?suggest=${b.workOrderId}">Suggest new times</a>` : ''}
    </div>
    <div class="schedule-pick-who">
      <p class="schedule-pick-label">Tradie</p>
      <p class="schedule-pick-tradie"><span class="tradie-initials" aria-hidden="true">${initials(b.businessName)}</span><span><a class="tradie-name" href="/tradies/${b.tradieId}">${b.businessName}</a><span class="schedule-pick-sub">${trades}${rating ? html` · <span class="num">★ ${rating.average.toFixed(1)} (${rating.count})</span>` : ''}</span></span></p>
    </div>
    <dl class="schedule-pick-facts">
      <div><dt>Property</dt><dd><a class="link" href="/properties/${b.propertyId}">${placeLine(b)}</a></dd></div>
      ${ctx.filter === 'all' ? html`<div><dt>Property Manager</dt><dd>${b.propertyManager}</dd></div>` : ''}
      <div><dt>Job</dt><dd>${humanise(b.trade)} · ${kind ?? 'Work Order'}</dd></div>
      <div><dt>Time zone</dt><dd>${ctx.timeZone.replace(/_/g, ' ')}</dd></div>
    </dl>
    <a class="btn btn-primary schedule-pick-open" href="${ticketHref(b)}">Open Ticket #${b.ticketId}</a>
  </article>`;
}

/**
 * /calendar for a view on a date (always by its date, so the link keeps showing that
 * period; no date is today's), filter and the Tradie, Property and Status filters.
 * The plain /calendar is this week, Mine.
 */
function hrefFor(view: View, date: string | null, filter: Filter, q?: Query) {
  const params = new URLSearchParams();
  if (date || view !== 'week') params.set('view', view);
  if (date) params.set('date', date);
  if (filter === 'all') params.set('filter', 'all');
  if (q?.tradie) params.set('tradie', String(q.tradie));
  if (q?.property) params.set('property', String(q.property));
  if (q?.status) params.set('status', q.status);
  const query = params.toString();
  return query ? `/calendar?${query}` : '/calendar';
}
