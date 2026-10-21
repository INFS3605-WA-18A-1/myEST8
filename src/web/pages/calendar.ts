// The shared calendar: every booked visit across the Agency, so nobody double-books a
// Tradie, by Day, Week or Month in the Agency's time zone. Mine shows the visits on the
// Property Manager's own Properties, All everyone's.
//
// The toolbar is one row: Today, the previous and next arrows, and the period as the
// title, with Day / Week / Month and Mine / All on the right. Week is an hour-by-hour
// grid, Monday to Sunday, each day a small weekday over a large date. A visit sits on
// its time; visits that overlap fold into one "N Jobs booked" block that opens that
// Day. Day is the same grid for one day, with overlapping visits side by side in lanes
// that scroll sideways when a busy day needs more room. Month is a table of days, each
// with up to two visits or "N Jobs booked". src/web/schedule-layout.ts works out where
// everything goes. A current-time line is drawn on today from the Agency's clock.
//
// Under 768 px the Week is a list of days instead, where a run of empty days folds into
// one line ("Nothing booked Tue 13 – Wed 14"). Every visit on the grid is a list item
// whose link names its time, what it is for and the Tradie, so the grid reads as text.

import { Hono } from 'hono';
import { html } from 'hono/html';
import { addDays, dayOf, daysFrom, mondayOf, parseDay, startOfDay, wallClock } from '../../zoned-time.ts';
import { bookingCard, bookingFlags, bookingsByDay, dayRange, longDay, shortDay, ticketHref, visitKind, visitWords, type Booking } from '../bookings.ts';
import type { WebEnv } from '../env.ts';
import { icon } from '../icons.ts';
import { layoutDay, hourRange, minuteOfDay, type DayLayout, type HourRange } from '../schedule-layout.ts';
import { COLLEAGUES_ONLY, shareButton, shareUrl } from '../share.ts';
import { shellInfo } from '../shell.ts';
import { badge, clip, flashFrom, formatTime, formatWhen, linkButton, page, segmented, tabs, type Html } from '../ui.ts';

export type { Booking } from '../bookings.ts';

type Filter = 'mine' | 'all';
type View = 'day' | 'week' | 'month';
const VIEWS: View[] = ['day', 'week', 'month'];

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
  /** "Tuesday 13 October", "12 – 18 October 2026", "October 2026". */
  label: string;
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
    const tradies = await actions.people('tradie');
    const every = await actions.calendar({ from: startOfDay(first, timeZone).toISOString(), to: startOfDay(addDays(days.at(-1)!, 1), timeZone).toISOString() });
    const bookings = filter === 'mine' ? every.filter((b) => b.propertyManagerId === pm.id) : every;
    const hidden = every.length - bookings.length;
    const byDay = bookingsByDay(bookings, first, timeZone);
    const ctx: Ctx = { timeZone, filter, meId: pm.id, today, now: actions.now() };
    const free = days.includes(today) ? freeToday(tradies, every, today, timeZone) : null;
    const focus = days.includes(today) ? today : first;

    return c.html(
      page({
        title: 'Schedule',
        pm,
        active: 'schedule',
        shell: shellInfo(c),
        flash: flashFrom(c.req.url),
        body: html`
          ${scheduleToolbar(
            period,
            filter,
            focus,
            shareButton({ ...shareWords(period, every.length), url: shareUrl(c, hrefFor(view, first, 'mine')), note: COLLEAGUES_ONLY }),
          )}
          ${summary(
            bookings,
            pm.id,
            period.noun,
            hidden ? html`${hidden} more ${hidden === 1 ? 'visit' : 'visits'} ${period.noun} on other Property Managers’ Properties. <a class="link" href="${hrefFor(view, first, 'all')}">Show all</a>` : '',
            free,
          )}
          ${view === 'day' ? dayView(first, byDay.get(first) ?? [], ctx) : view === 'week' ? weekView(days, byDay, ctx) : monthView(period, byDay, ctx)}
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
    return { view, first: date, days: [date], prev: addDays(date, -1), next: addDays(date, 1), label: longDay(date), noun: 'on this day', current: date === today };
  }
  if (view === 'week') {
    const monday = mondayOf(date);
    const days = daysFrom(monday, 7);
    return { view, first: monday, days, prev: addDays(monday, -7), next: addDays(monday, 7), label: weekTitle(days), noun: 'this week', current: mondayOf(today) === monday };
  }
  const first = `${date.slice(0, 7)}-01`;
  const next = `${addDays(first, 32).slice(0, 7)}-01`;
  const days: string[] = [];
  for (let d = first; d < next; d = addDays(d, 1)) days.push(d);
  return { view, first, days, prev: `${addDays(first, -1).slice(0, 7)}-01`, next, label: monthName(first), noun: 'this month', current: today.slice(0, 7) === first.slice(0, 7) };
}

/** "October 2026" */
function monthName(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${day}T00:00:00Z`));
}

/** "12 – 18 October 2026", or "26 October – 1 November 2026" when the week crosses a month. */
function weekTitle(days: string[]): string {
  const first = days[0]!;
  const last = days.at(-1)!;
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  return sameMonth ? `${Number(first.slice(8))} – ${dayAndMonth(last, true)}` : `${dayAndMonth(first)} – ${dayAndMonth(last, true)}`;
}

/** "18 October", or "18 October 2026" with the year. */
function dayAndMonth(day: string, year = false): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: year ? 'numeric' : undefined }).format(new Date(`${day}T00:00:00Z`));
}

/** The share panel's words for the period shown. */
function shareWords(p: Period, count: number): { title: string; text: string } {
  const when = p.view === 'day' ? `on ${longDay(p.first)}` : p.view === 'week' ? `in the week of ${longDay(p.first)}` : `in ${monthName(p.first)}`;
  return {
    title: `Jobs booked, ${p.label}`,
    text: count ? `${jobsBooked(count)} ${when} across the Agency.` : `Nothing booked yet ${when}.`,
  };
}

/**
 * The period in one line: how many visits are booked, then how they stand. A reschedule
 * request on the Property Manager's own Property waits on them, so it carries the
 * Wattle stripe; a colleague's only stands out. `more` says what Mine leaves out; `free`
 * lists the Tradies free today, when today is shown.
 */
function summary(bookings: Booking[], meId: number, noun: string, more: Html | '', free: string[] | null): Html {
  const reschedules = bookings.filter((b) => b.visit === 'reschedule_requested');
  const mine = reschedules.filter((b) => b.propertyManagerId === meId).length;
  const others = reschedules.length - mine;
  const unconfirmed = bookings.filter((b) => b.visit === 'not_confirmed').length;
  return html`<div class="schedule-summary">
    <p class="schedule-tally">
      <span class="schedule-count num">${bookings.length ? `${plural(bookings.length, 'visit', 'visits')} booked` : `Nothing booked ${noun}`}</span>
      ${mine ? html`<span class="schedule-flag is-decision">${plural(mine, 'reschedule request', 'reschedule requests')} waiting on you</span>` : ''}
      ${others ? html`<span class="schedule-flag is-reschedule">${plural(others, 'reschedule', 'reschedules')} requested</span>` : ''}
      ${unconfirmed ? html`<span class="schedule-flag">${unconfirmed} not confirmed yet</span>` : ''}
    </p>
    ${more ? html`<p class="schedule-more">${more}</p>` : ''}
    ${free?.length ? html`<details class="schedule-free"><summary class="schedule-free-label">Free today (${free.length})</summary><ul class="schedule-free-list">${free.map((n) => html`<li>${n}</li>`)}</ul></details>` : ''}
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
  return html`<a class="schedule-date" href="${hrefFor('day', day, ctx.filter)}" ${isToday ? html`aria-current="date"` : ''}>
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
 * each minute. Absent when today is not on this grid, or the clock is outside
 * the hours shown. `header` is the Week's row of dates, which the Day grid has not.
 */
function nowLine(range: HourRange, todayIndex: number, ctx: Ctx, header: boolean): Html | '' {
  if (todayIndex < 0) return '';
  const clock = wallClock(ctx.now, ctx.timeZone);
  const mins = clock.hour * 60 + clock.minute;
  const start = range.first * 60;
  if (mins < start || mins >= range.last * 60) return '';
  const into = mins - start;
  const row = Math.floor(into / 15) + (header ? 2 : 1);
  // The gutter is column 1 and Monday is column 2, so Thursday (index 3) ends at column 6.
  const column = header ? `1 / ${todayIndex + 3}` : '1 / -1';
  return html`<div class="schedule-now${header ? '' : ' is-day'}" data-schedule-now data-zone="${ctx.timeZone}" data-first="${range.first}" data-last="${range.last}" data-header="${header ? '1' : '0'}" style="grid-row: ${row}; grid-column: ${column}; --now-frac: ${(into % 15) / 15}" aria-hidden="true"><span class="schedule-now-dot"></span><span class="schedule-now-line"></span></div>`;
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
  return html`<li class="${classes}" ${isToday ? html`aria-current="date"` : ''}>
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
 * A visit on the grid: a rounded block, the time and the issue in bold, then the
 * Tradie. `rows` is how many quarter-hours it spans; an hour or less is one line.
 * The colour comes from bookingFlags and visitKind.
 */
function visitBlock(b: Booking, style: string, rows: number, ctx: Ctx): Html {
  const kind = visitKind(b);
  const words = visitWords(b);
  const flags = [rows <= 4 ? 'is-short' : '', ...bookingFlags(b, b.propertyManagerId === ctx.meId)].filter(Boolean).join(' ');
  return html`<li class="schedule-block ${flags}" style="${style}">
    <a class="schedule-block-link" href="${ticketHref(b)}" aria-label="${blockName(b, ctx)}">
      <span class="schedule-block-time num"><time datetime="${b.start}">${formatTime(b.start, ctx.timeZone)}</time><span class="schedule-block-end"> – <time datetime="${b.end}">${formatTime(b.end, ctx.timeZone)}</time></span></span>
      ${kind ? html`<span class="schedule-marker">${kind}</span>` : ''}
      <span class="schedule-block-issue">${clip(b.issue, { lines: 2 })}</span>
      <span class="schedule-block-tradie">${b.businessName}</span>
      ${words ? html`<span class="schedule-block-meta">${words}</span>` : ''}
    </a>
  </li>`;
}

/** Visits that overlap, as one block over their time that opens the Day they are on. */
function clusterBlock(day: string, bookings: Booking[], style: string, ctx: Ctx): Html {
  const start = bookings.reduce((a, b) => (a.start <= b.start ? a : b)).start;
  const end = bookings.reduce((a, b) => (a.end >= b.end ? a : b)).end;
  const flags = new Set(bookings.flatMap((b) => bookingFlags(b, b.propertyManagerId === ctx.meId)).filter((f) => f === 'is-reschedule' || f === 'is-decision'));
  return html`<li class="schedule-block is-cluster ${[...flags].join(' ')}" style="${style}">
    <a class="schedule-block-link" href="${hrefFor('day', day, ctx.filter)}">
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
              return visitBlock(p.item, `grid-row: ${p.rowStart} / ${p.rowEnd}; grid-column: ${from} / ${to}`, p.rowEnd - p.rowStart, ctx);
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
  const dayHref = hrefFor('day', day, ctx.filter);
  const number = html`<a class="schedule-mday-num num" href="${dayHref}"${isToday ? html` aria-current="date"` : ''}><span aria-hidden="true">${Number(day.slice(8))}</span><span class="sr-only">${longDay(day)}</span></a>`;
  const current = isToday ? html` aria-current="date"` : '';
  if (!bookings?.length) return html`<td class="${classes}"${current}>${number}</td>`;
  const overlaps = layoutDay(bookings, day, ctx.timeZone).clusters.some((cl) => cl.items.length > 1);
  const folded = overlaps || bookings.length > MONTH_CHIPS;
  const sorted = [...bookings].sort((a, b) => a.start.localeCompare(b.start));
  return html`<td class="${classes}"${current}>
    ${number}
    ${folded
      ? ''
      : html`<ul class="schedule-chips">
          ${sorted.map(
            (b) => html`<li class="schedule-chip ${bookingFlags(b, b.propertyManagerId === ctx.meId).join(' ')}">
              <a href="${ticketHref(b)}" title="${formatTime(b.start, ctx.timeZone)}, ${b.issue}, ${b.businessName}"><span class="num">${formatTime(b.start, ctx.timeZone)}</span> ${b.issue}<span class="sr-only">, ${b.businessName}</span></a>
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
  return html`<li class="${classes}" ${isToday ? html`aria-current="date"` : ''}>
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

/** The Agency's Tradies with no visit starting or running today (the calendar returns all Agency visits, not only Mine). */
function freeToday(tradies: { id: number; name: string; businessName: string | null }[], every: Booking[], today: string, timeZone: string): string[] {
  const busy = new Set(every.filter((b) => dayOf(b.start, timeZone) <= today && dayOf(new Date(Date.parse(b.end) - 1).toISOString(), timeZone) >= today).map((b) => b.tradieId));
  return tradies.filter((t) => !busy.has(t.id)).map((t) => t.businessName ?? t.name);
}

/**
 * One row: Today, the previous and next arrows, and the period as the title. The view
 * switch and Mine or All sit on the right. On a phone the switch and filter wrap to a
 * second row. Today is always there, outlined, even when this period is already today.
 */
function scheduleToolbar(p: Period, filter: Filter, focus: string, share: Html): Html {
  const unit = p.view === 'day' ? 'day' : p.view === 'week' ? 'week' : 'month';
  return html`<div class="schedule-toolbar">
    <nav class="schedule-nav" aria-label="${unit === 'day' ? 'Days' : unit === 'week' ? 'Weeks' : 'Months'}">
      ${linkButton('Today', hrefFor(p.view, null, filter), { size: 'sm' })}
      <a class="btn btn-ghost btn-sm btn-square" href="${hrefFor(p.view, p.prev, filter)}" aria-label="Previous ${unit}">${icon('caret-left', { size: 'size-4' })}</a>
      <a class="btn btn-ghost btn-sm btn-square" href="${hrefFor(p.view, p.next, filter)}" aria-label="Next ${unit}">${icon('caret-right', { size: 'size-4' })}</a>
      <p class="schedule-period">${p.label}</p>
    </nav>
    <div class="schedule-toolbar-end">
      ${tabs(
        VIEWS.map((v) => ({ label: v === 'day' ? 'Day' : v === 'week' ? 'Week' : 'Month', href: hrefFor(v, focus, filter), active: v === p.view })),
        'Calendar views',
      )}
      ${segmented([
        { label: 'Mine', href: hrefFor(p.view, p.first, 'mine'), active: filter === 'mine' },
        { label: 'All', href: hrefFor(p.view, p.first, 'all'), active: filter === 'all' },
      ])}
      ${share}
    </div>
  </div>`;
}

/**
 * /calendar for a view on a date (always by its date, so the link keeps showing that
 * period; no date is today's) and filter. The plain /calendar is this week, Mine.
 */
function hrefFor(view: View, date: string | null, filter: Filter) {
  const params = new URLSearchParams();
  if (date || view !== 'week') params.set('view', view);
  if (date) params.set('date', date);
  if (filter === 'all') params.set('filter', 'all');
  const query = params.toString();
  return query ? `/calendar?${query}` : '/calendar';
}
