// Booked visits as the Schedule and Dispatch show them: one card for a booking, the
// words for how its visit stands, and the calendar days they fall on. The days are
// the Agency's (src/zoned-time.ts); the words for a day are written here.

import { html } from 'hono/html';
import type { PropertyManagerActions } from '../app.ts';
import { dayOf } from '../zoned-time.ts';
import { badge, clip, formatDay, formatTime, type Html } from './ui.ts';

/** One booking as the core's calendar returns it. */
export type Booking = Awaited<ReturnType<PropertyManagerActions['calendar']>>[number];

/**
 * What a visit that isn't the repair itself is for, by its kind: the Tradie's Site
 * Inspection before a Firm Quote. Read loosely, so the older name for the kind reads the same.
 */
const VISIT_KINDS: Record<string, string> = { inspection: 'Site inspection' };

/** "Site inspection" for a visit that isn't the repair, or null for the repair itself. */
export function visitKind(b: Pick<Booking, 'kind'>): string | null {
  return VISIT_KINDS[b.kind as string] ?? null;
}

/** The Ticket a booking is for; a Site Inspection lands on its Job. */
export function ticketHref(b: Booking): string {
  return `/tickets/${b.ticketId}${visitKind(b) ? `#job-${b.jobId}` : ''}`;
}

/**
 * One booking, read in the order a Property Manager reads it: the time, what the visit
 * is for (the issue, up to two lines, linking to the Ticket), the Tradie's business
 * (linking to the profile), the street and suburb, then how the visit stands. Names
 * and addresses wrap rather than cut. `day` puts the day before the time, for a list
 * that isn't grouped by day; `tradie: false` leaves the Tradie out where the row
 * already names them; `propertyManager` names whose Property it is. `decision` marks a
 * reschedule request that waits on the Property Manager looking (it is on their own
 * Property) with the Wattle stripe; anyone else's request keeps the warning stripe.
 * `style` places the card on the Schedule's time grid.
 */
export function bookingCard(b: Booking, timeZone: string, o: { day?: boolean; tradie?: boolean; propertyManager?: boolean; decision?: boolean; style?: string } = {}): Html {
  const note = visitNote(b);
  const kind = visitKind(b);
  const classes = ['booking', ...bookingFlags(b, o.decision)].join(' ');
  return html`<li class="${classes}" ${o.style ? html`style="${o.style}"` : ''}>
    ${kind ? html`<p class="booking-kind">${badge(kind, 'info', { outline: true })}</p>` : ''}
    <p class="booking-time num">${o.day ? html`${formatDay(b.start, timeZone)}, ` : ''}<time datetime="${b.start}">${formatTime(b.start, timeZone)}</time> – <time datetime="${b.end}">${formatTime(b.end, timeZone)}</time></p>
    <a class="booking-issue" href="${ticketHref(b)}">${clip(b.issue, { lines: 2 })}</a>
    ${o.tradie === false ? '' : html`<a class="booking-tradie" href="/tradies/${b.tradieId}">${b.businessName}</a>`}
    <p class="booking-place" title="${b.propertyAddress}">${placeOf(b)}</p>
    ${o.propertyManager ? html`<p class="booking-meta"><span class="sr-only">Property Manager: </span>${b.propertyManager}</p>` : ''}
    ${note}
  </li>`;
}

/** The classes for how a visit stands: a Site Inspection, a reschedule request (`decision` when it waits on this Property Manager), done. */
export function bookingFlags(b: Booking, decision = false): string[] {
  const reschedule = b.visit === 'reschedule_requested';
  return [visitKind(b) ? 'is-inspection' : '', reschedule ? 'is-reschedule' : '', reschedule && decision ? 'is-decision' : '', b.visit === 'done' ? 'is-done' : ''].filter(Boolean);
}

/** How the visit stands in a word or two, or null when it is confirmed: for places with no room for visitNote's link. */
export function visitWords(b: Booking): string | null {
  switch (b.visit) {
    case 'done':
      return 'Done';
    case 'reschedule_requested':
      return 'Reschedule requested';
    case 'not_confirmed':
      return 'Not confirmed yet';
    case 'confirmed':
      return null;
  }
}

/**
 * How the visit stands, in words: Done, Not confirmed yet, or Reschedule requested in
 * the warning tone, linking to the Ticket where new times are suggested. A confirmed
 * visit needs no word.
 */
function visitNote(b: Booking): Html | '' {
  switch (b.visit) {
    case 'done':
      return html`<p class="booking-meta">Done</p>`;
    case 'reschedule_requested':
      return html`<p class="booking-meta"><a class="booking-reschedule" href="/tickets/${b.ticketId}?suggest=${b.workOrderId}">Reschedule requested</a></p>`;
    case 'not_confirmed':
      return html`<p class="booking-meta">Not confirmed yet</p>`;
    case 'confirmed':
      return '';
  }
}

/** "12 King St, Newtown": the street, then the suburb (the address's postcode and state are noise here). */
function placeOf(b: Booking): string {
  const street = streetOf(b.propertyAddress);
  return b.suburb && street !== b.propertyAddress ? `${street}, ${b.suburb}` : b.propertyAddress;
}

/** The street part of an address: everything before its first comma. */
export function streetOf(address: string): string {
  return address.split(',')[0]!.trim();
}

/** Bookings by the Agency day they start on; one that started before `first` shows on `first`. */
export function bookingsByDay(bookings: Booking[], first: string, timeZone: string): Map<string, Booking[]> {
  const byDay = new Map<string, Booking[]>();
  for (const b of bookings) {
    const start = dayOf(b.start, timeZone);
    const day = start < first ? first : start;
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }
  return byDay;
}

/** "Mon 12" for a day under a heading that names its month; with `month`, "Mon 12 Oct". */
export function shortDay(day: string, o: { month?: boolean } = {}): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: o.month ? 'short' : undefined }).format(dateOf(day));
}

/** "Monday 12 October" */
export function longDay(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(dateOf(day));
}

/** "Tue 13 – Wed 14" for a run of days, or "Tue 13" for one; with `month` the last day carries it. */
export function dayRange(days: string[], o: { month?: boolean } = {}): string {
  const first = days[0] ?? '';
  const last = days.at(-1) ?? first;
  return first === last ? shortDay(first, o) : `${shortDay(first)} – ${shortDay(last, o)}`;
}

function dateOf(day: string) {
  return new Date(`${day}T00:00:00Z`);
}
