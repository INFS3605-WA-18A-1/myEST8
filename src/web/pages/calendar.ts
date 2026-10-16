// The Schedule: every booked visit across the Agency, a week at a time and
// grouped by day in the Agency's time zone, so nobody double-books a Tradie.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { Trade } from '../../shared.ts';
import { wallClock, zonedInstant } from '../../zoned-time.ts';
import type { WebEnv } from '../env.ts';
import { COLLEAGUES_ONLY, shareButton, shareUrl } from '../share.ts';
import { shellInfo } from '../shell.ts';
import { emptyState, flashFrom, formatWhen, humanise, linkButton, page, type Html } from '../ui.ts';

/** One booking as the calendar returns it. */
export type Booking = Awaited<ReturnType<PropertyManagerActions['calendar']>>[number];

type Day = { year: number; month: number; day: number };

/** The Schedule, mounted at /calendar (and for now at /dispatch). */
export function calendarPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const { timeZone } = actions.agency();
    const today = wallClock(actions.now(), timeZone);
    const monday = mondayOf(parseDay(c.req.query('week')) ?? today);
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const bookings = await actions.calendar({ from: startOf(monday, timeZone), to: startOf(addDays(monday, 7), timeZone) });
    const trades = await bookingTrades(actions, bookings);
    const byDay = groupByDay(bookings, monday, timeZone);

    return c.html(
      page({
        title: 'Schedule',
        pm,
        active: 'schedule',
        shell: await shellInfo(c),
        flash: flashFrom(c.req.url),
        subtitle: `Week of ${dateLabel(monday)} ${monday.year}`,
        actions: html`${weekNav(monday, today)}${shareButton({
          title: `Jobs booked, week of ${dateLabel(monday)} ${monday.year}`,
          text: bookings.length
            ? `${bookings.length} ${bookings.length === 1 ? 'Job' : 'Jobs'} booked in the week of ${dateLabel(monday)} across the Agency.`
            : `Nothing booked yet in the week of ${dateLabel(monday)}.`,
          url: shareUrl(c, `/dispatch?week=${key(monday)}`),
          note: COLLEAGUES_ONLY,
        })}`,
        body: html`
          <div class="schedule-week grid gap-3 lg:min-h-[calc(100dvh-12rem)] lg:[grid-template-columns:var(--cols)]" style="--cols:${days.map((d) => ((byDay.get(key(d))?.length ?? 0) ? 'minmax(0,1fr)' : 'minmax(0,0.5fr)')).join(' ')}">
            ${days.map((day) => dayColumn(day, byDay.get(key(day)) ?? [], key(day) === key(today), timeZone, trades))}
          </div>
        `,
      }),
    );
  });

  return pages;
}

/**
 * The Trade of each booked Job. Bookings don't carry their Trade, so it comes from
 * the Jobs already known (`known`), or else from each booking's Ticket.
 */
export async function bookingTrades(actions: PropertyManagerActions, bookings: Booking[], known: { jobId: number; trade: Trade }[] = []) {
  const trades = new Map(known.map((j) => [j.jobId, j.trade]));
  const ticketIds = new Set(bookings.filter((b) => !trades.has(b.jobId)).map((b) => b.ticketId));
  for (const ticketId of ticketIds) for (const job of (await actions.ticket(ticketId)).jobs) trades.set(job.jobId, job.trade);
  return trades;
}

/**
 * One booking as a compact block: the time range, the Tradie's business name (linked
 * to the profile), the address, the Trade and the Property Manager's initials. The
 * whole block links to the Ticket. A reschedule request or a Done visit says so in words.
 */
export function bookingItem(booking: Booking, timeZone: string, trade?: Trade): Html {
  const done = booking.status === 'done';
  const reschedule = booking.rescheduleRequestedBy;
  const range = `${timeOf(booking.start, timeZone)} – ${timeOf(booking.end, timeZone)}`;
  const full = [
    range,
    booking.businessName,
    trade ? humanise(trade) : '',
    booking.propertyAddress,
    `Property Manager: ${booking.propertyManager}`,
    done ? 'Done' : reschedule ? `Reschedule requested by ${reschedule}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return html`<li class="relative min-w-0 rounded border border-line bg-surface p-2 text-sm ${reschedule && !done ? 'border-l-4 border-l-high' : ''} ${done ? 'text-muted' : ''}">
    <a href="/tickets/${booking.ticketId}" class="absolute inset-0 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action" title="${full}"><span class="sr-only">Open Ticket: ${full}</span></a>
    <p class="num font-medium leading-snug"><time datetime="${booking.start}">${timeOf(booking.start, timeZone)}</time> – <time datetime="${booking.end}">${timeOf(booking.end, timeZone)}</time></p>
    <p class="relative z-10 min-w-0"><a class="link block" href="/tradies/${booking.tradieId}" title="${booking.businessName}">${booking.businessName}</a></p>
    <p class="text-muted">${booking.propertyAddress}</p>
    <p class="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted">
      ${trade ? html`<span class="min-w-0 truncate" title="Trade: ${humanise(trade)}">${humanise(trade)}</span>` : ''}
      <span class="ml-auto shrink-0" title="Property Manager: ${booking.propertyManager}"><span class="sr-only">Property Manager: </span>${initialsOf(booking.propertyManager)}</span>
    </p>
    ${done
      ? html`<p class="mt-1 text-xs">Done</p>`
      : reschedule
        ? html`<p class="mt-1 text-xs font-semibold text-high">Reschedule requested</p>`
        : booking.visitConfirmed
          ? ''
          : html`<p class="mt-1 text-xs text-muted">Not confirmed yet</p>`}
  </li>`;
}

/** "Tue 13 Oct, 9:00 am – 11:00 am": the start in full, then the end's time of day. */
export function timeRange(start: string, end: string, timeZone: string): Html {
  return html`<time datetime="${start}">${formatWhen(start, timeZone)}</time> – <time datetime="${end}">${timeOf(end, timeZone)}</time>`;
}

/** A list of bookings, or a line saying there are none. */
export function bookingList(bookings: Booking[], timeZone: string, trades: Map<number, Trade>, empty: string): Html {
  if (!bookings.length) return emptyState(empty);
  return html`<ul class="bookings grid gap-2">${bookings.map((b) => bookingItem(b, timeZone, trades.get(b.jobId)))}</ul>`;
}

/** Previous, this week (only when another week is shown) and next. */
function weekNav(monday: Day, today: Day): Html {
  const thisWeek = key(mondayOf(today)) === key(monday);
  return html`<nav aria-label="Weeks" class="flex flex-wrap items-center gap-2 text-sm">
    ${linkButton('Previous week', `/dispatch?week=${key(addDays(monday, -7))}`, { size: 'sm' })}
    ${thisWeek ? '' : linkButton('This week', '/dispatch', { size: 'sm', variant: 'ghost' })}
    ${linkButton('Next week', `/dispatch?week=${key(addDays(monday, 7))}`, { size: 'sm' })}
  </nav>`;
}

/** One day: its date, then its bookings or "Nothing booked". Today is marked once, in words. */
function dayColumn(day: Day, bookings: Booking[], isToday: boolean, timeZone: string, trades: Map<number, Trade>): Html {
  const label = shortDay(day);
  return html`<section aria-label="${dayLabel(day)}" class="flex min-w-0 flex-col gap-2 rounded-lg border border-line p-2 ${isToday ? 'bg-page' : 'bg-surface'}">
    <div class="flex flex-wrap items-baseline gap-x-2">
      <h2 class="section-title">${label}</h2>
      ${isToday ? html`<span class="text-xs font-semibold text-action">Today</span>` : ''}
    </div>
    ${bookings.length
      ? html`<ul class="grid gap-2">${bookings.map((b) => bookingItem(b, timeZone, trades.get(b.jobId)))}</ul>`
      : html`<p class="text-sm text-muted">Nothing booked</p>`}
  </section>`;
}

/** "12 Oct" */
function dateLabel(d: Day) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(Date.UTC(d.year, d.month - 1, d.day)));
}

/** "Mon 12 Oct" */
function shortDay(d: Day) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(Date.UTC(d.year, d.month - 1, d.day)));
}

/** Bookings by the day they start on in the Agency's time zone; one that started before the week shows on its first day. */
function groupByDay(bookings: Booking[], monday: Day, timeZone: string) {
  const byDay = new Map<string, Booking[]>();
  for (const booking of bookings) {
    const startKey = key(wallClock(new Date(booking.start), timeZone));
    const dayKey = startKey < key(monday) ? key(monday) : startKey;
    byDay.set(dayKey, [...(byDay.get(dayKey) ?? []), booking]);
  }
  return byDay;
}

function parseDay(value: string | undefined): Day | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const day = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return key(addDays(day, 0)) === key(day) ? day : null;
}

function addDays(d: Day, days: number): Day {
  const at = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
}

function mondayOf(d: Day): Day {
  const weekday = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
  return addDays(d, -((weekday + 6) % 7));
}

function startOf(d: Day, timeZone: string) {
  return zonedInstant(timeZone, d.year, d.month, d.day).toISOString();
}

function key(d: Day) {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/** "Monday 12 October" */
function dayLabel(d: Day) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(Date.UTC(d.year, d.month - 1, d.day)),
  );
}

/** "9:00 am", for a time range whose day is shown by its column. The space before am/pm never breaks. */
function timeOf(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(/ (am|pm)$/i, ' $1');
}

/** "Alice Archer" -> "AA" */
function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}
