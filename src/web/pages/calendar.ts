// The shared calendar: every booked visit across the Agency, a week at a time and
// grouped by day in the Agency's time zone, so nobody double-books a Tradie.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { Trade } from '../../shared.ts';
import { wallClock, zonedInstant } from '../../zoned-time.ts';
import type { WebEnv } from '../env.ts';
import { badge, emptyState, flashFrom, formatWhen, humanise, linkButton, page, sectionHeader, type Html } from '../ui.ts';

/** One booking as the calendar returns it. */
export type Booking = ReturnType<PropertyManagerActions['calendar']>[number];

type Day = { year: number; month: number; day: number };

/** The shared calendar under /calendar. */
export function calendarPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', (c) => {
    const { actions, pm } = c.var;
    const { timeZone } = actions.agency();
    const today = wallClock(actions.now(), timeZone);
    const monday = mondayOf(parseDay(c.req.query('week')) ?? today);
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const bookings = actions.calendar({ from: startOf(monday, timeZone), to: startOf(addDays(monday, 7), timeZone) });
    const trades = bookingTrades(actions, bookings);
    const byDay = groupByDay(bookings, monday, timeZone);

    return c.html(
      page({
        title: 'Calendar',
        pm,
        active: 'calendar',
        flash: flashFrom(c.req.url),
        body: html`
          ${weekNav(monday, today)}
          <div class="calendar-week grid gap-3 lg:grid-cols-7">
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
export function bookingTrades(actions: PropertyManagerActions, bookings: Booking[], known: { jobId: number; trade: Trade }[] = []) {
  const trades = new Map(known.map((j) => [j.jobId, j.trade]));
  const ticketIds = new Set(bookings.filter((b) => !trades.has(b.jobId)).map((b) => b.ticketId));
  for (const ticketId of ticketIds) for (const job of actions.ticket(ticketId).jobs) trades.set(job.jobId, job.trade);
  return trades;
}

/** One booking: when, which Tradie and Trade, where, whose Property, any reschedule request, and its Ticket. */
export function bookingItem(booking: Booking, timeZone: string, trade?: Trade): Html {
  return html`<li class="booking card card-border bg-base-100 p-3">
    <p><strong>${timeRange(booking.start, booking.end, timeZone)}</strong></p>
    <p><a class="link" href="/tradies/${booking.tradieId}">${booking.businessName}</a>${trade ? html` · ${humanise(trade)}` : ''}</p>
    <p>${booking.propertyAddress}</p>
    <p class="text-sm opacity-70">Property Manager: ${booking.propertyManager}</p>
    <p>
      ${booking.status === 'done' ? badge('Done', 'success') : booking.visitConfirmed ? badge('Visit confirmed', 'success') : badge('Visit not confirmed yet')}
      ${booking.rescheduleRequestedBy ? badge(`${booking.rescheduleRequestedBy === 'tenant' ? 'Tenant' : 'Tradie'} asked for another time`, 'warning') : ''}
    </p>
    <p><a class="link" href="/tickets/${booking.ticketId}">Open Ticket</a></p>
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

function weekNav(monday: Day, today: Day): Html {
  const thisWeek = key(mondayOf(today)) === key(monday);
  return html`<nav aria-label="Weeks" class="flex flex-wrap items-center gap-2 mb-4">
    ${linkButton('← Previous week', `/calendar?week=${key(addDays(monday, -7))}`, { size: 'sm' })}
    ${thisWeek ? '' : linkButton('This week', '/calendar', { size: 'sm', variant: 'ghost' })}
    ${linkButton('Next week →', `/calendar?week=${key(addDays(monday, 7))}`, { size: 'sm' })}
    <span class="font-semibold">Week of ${dayLabel(monday)} ${monday.year}</span>
  </nav>`;
}

function dayColumn(day: Day, bookings: Booking[], isToday: boolean, timeZone: string, trades: Map<number, Trade>): Html {
  return html`<section aria-label="${dayLabel(day)}">
    ${sectionHeader(dayLabel(day), isToday ? badge('Today', 'info') : undefined)}
    ${bookingList(bookings, timeZone, trades, 'Nothing booked')}
  </section>`;
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

/** "11:00 am", for the end of a time range whose start shows the day. */
function timeOf(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}
