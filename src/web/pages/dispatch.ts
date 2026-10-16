// Dispatch: a map of the Agency's Properties (a pin each, by the worst Urgency among
// its open Tickets) and of its Tradies, a side panel for the one picked, the table of
// the same Properties and the Tradie schedule.
//
// A map alone can't be used with a keyboard or a screen reader, so the table carries
// every fact the map does and every row picks its pin; the page works with JavaScript
// off, as the table, per-Property panels reached by their row's link (:target) and
// the schedule. static/dispatch-map.js adds the map: it reads the pin data from the
// JSON block this page writes, draws Leaflet markers and the Tradie search ring, and
// shows the panel of the pin or row picked.
//
// Opening the page never looks addresses up: a Property or Tradie is placed when it is
// added, and the ones the lookup missed are tried again only when the Property Manager
// asks, with the button shown while any are missing.

import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { nearest, TRADIE_SEARCH_RADIUS_KM } from '../../geo.ts';
import type { Urgency } from '../../shared.ts';
import { addDays, dayOf, daysFrom, startOfDay } from '../../zoned-time.ts';
import { bookingCard, bookingsByDay, shortDay, type Booking } from '../bookings.ts';
import type { WebEnv } from '../env.ts';
import { formAction } from '../forms.ts';
import { MAP_TILES } from '../map-config.ts';
import { shellInfo } from '../shell.ts';
import { badge, emptyState, flashFrom, humanise, page, postButton, section, ticketCell, urgencyBadge, type Html } from '../ui.ts';

type Overview = Awaited<ReturnType<PropertyManagerActions['dispatch']>>;
type PropertyView = Overview['properties'][number];
type TradieView = Overview['tradies'][number];

/** How many days the Tradie schedule shows, today first. */
const SCHEDULE_DAYS = 7;

/** How many nearest Tradies a Property's panel lists. */
const NEAREST_TRADIES = 5;

const URGENCY_RANK: Record<string, number> = { urgent: 0, high: 1, routine: 2 };

/** Dispatch under /dispatch. */
export function dispatchPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const { timeZone } = actions.agency();
    const today = dayOf(actions.now(), timeZone);
    const days = daysFrom(today, SCHEDULE_DAYS);
    const [{ properties, tradies }, bookings, people] = await Promise.all([
      actions.dispatch(),
      actions.calendar({ from: startOfDay(today, timeZone).toISOString(), to: startOfDay(addDays(today, SCHEDULE_DAYS), timeZone).toISOString() }),
      actions.people('tradie'),
    ]);
    // A Tradie without a business address isn't missing from the map, just not on it.
    const missing = properties.some((p) => !p.location) || people.some((t) => t.businessAddress && !t.location);

    const ordered = [...properties].sort(
      (a, b) => (URGENCY_RANK[a.worstUrgency ?? ''] ?? 3) - (URGENCY_RANK[b.worstUrgency ?? ''] ?? 3) || a.address.localeCompare(b.address),
    );
    const placed = properties.filter((p) => p.location).length;
    const tradiesPlaced = tradies.filter((t) => t.location).length;
    const count = (n: number, total: number, noun: string) => `${n === total ? n : `${n} of ${total}`} ${noun}`;
    const subtitle = `${[count(placed, properties.length, properties.length === 1 ? 'Property' : 'Properties'), tradies.length ? count(tradiesPlaced, tradies.length, tradies.length === 1 ? 'Tradie' : 'Tradies') : ''].filter(Boolean).join(' and ')} on the map`;

    return c.html(
      page({
        title: 'Dispatch',
        pm,
        active: 'dispatch',
        shell: shellInfo(c),
        flash: flashFrom(c.req.url),
        subtitle,
        actions: missing ? postButton('/dispatch/addresses', 'Look up missing addresses', { size: 'sm' }) : undefined,
        body: html`
          <div class="dispatch-board">
            ${mapSection()}
            ${panels(ordered, tradies, bookings, timeZone, tradiesPlaced > 0)}
          </div>
          ${section({ title: 'Properties', id: 'properties', body: propertyTable(ordered) })}
          ${section({ title: 'Tradie schedule', id: 'tradie-schedule', body: scheduleTable(tradies, bookings, days, timeZone) })}
          ${pinData(ordered, tradies)}
          <link rel="stylesheet" href="/assets/leaflet.css" />
          <link rel="stylesheet" href="/assets/MarkerCluster.css" />
          <script src="/assets/leaflet.js" defer></script>
          <script src="/assets/leaflet.markercluster.js" defer></script>
          <script src="/assets/dispatch-map.js" defer></script>
        `,
      }),
    );
  });

  // Tries the lookup again for the Properties and Tradies the map couldn't place.
  pages.post('/addresses', (c) =>
    formAction(c, '/dispatch', async () => {
      const placed = await c.var.actions.geocodeMissing();
      return {
        ok: placed
          ? `Found ${placed} ${placed === 1 ? 'address' : 'addresses'} and put ${placed === 1 ? 'it' : 'them'} on the map`
          : 'No more addresses found. Check the ones marked Address not found.',
      };
    }),
  );

  return pages;
}

/** The map and its legend. Without JavaScript the map's place says so and points to the table. */
function mapSection(): Html {
  return html`<section class="dispatch-map-section" aria-labelledby="dispatch-map-title">
    <h2 id="dispatch-map-title" class="sr-only">Map of Properties and Tradies</h2>
    <ul class="dispatch-legend" aria-label="Pin key" data-map-legend>
      <li data-pin="urgent"><span data-pin-sample aria-hidden="true"></span>Urgent</li>
      <li data-pin="high"><span data-pin-sample aria-hidden="true"></span>High</li>
      <li data-pin="routine"><span data-pin-sample aria-hidden="true"></span>Routine</li>
      <li data-pin="none"><span data-pin-sample aria-hidden="true"></span>No open Tickets</li>
      <li data-pin="tradie"><span data-pin-sample aria-hidden="true"></span>Tradie</li>
    </ul>
    <div id="dispatch-map" class="dispatch-map" role="region" aria-label="Map. Each pin is a Property or a Tradie: Tab to a pin and press Enter to open its details.">
      <p class="dispatch-map-fallback">The map needs JavaScript. The table below lists the same Properties, each with its Tickets and urgency.</p>
    </div>
  </section>`;
}

/**
 * The side column: a hint, then one panel per Property and per Tradie. Only the one picked
 * shows. With JavaScript the map and the table pick it; without, a row's link does (:target).
 */
function panels(properties: PropertyView[], tradies: TradieView[], bookings: Booking[], timeZone: string, anyTradieLocated: boolean): Html {
  return html`<aside id="dispatch-side" class="dispatch-side" aria-label="Details">
    <p class="dispatch-panel-empty">Pick a Property or a Tradie on the map, or a Property in the table, to see its Tickets and the nearest Tradies.</p>
    ${properties.map((p) => propertyPanel(p, tradies, anyTradieLocated))}
    ${tradies.map((t) => tradiePanel(t, bookings.filter((b) => b.tradieId === t.tradieId), timeZone))}
  </aside>`;
}

function panelHead(id: string, title: string, extra?: Html): Html {
  return html`<div class="dispatch-panel-head">
    <h2 id="${id}-title" class="section-title" tabindex="-1">${title}</h2>
    <button type="button" class="btn btn-ghost btn-sm" data-dispatch-clear hidden>Close</button>
  </div>
  ${extra ?? ''}`;
}

function propertyPanel(p: PropertyView, tradies: TradieView[], anyTradieLocated: boolean): Html {
  const id = `panel-property-${p.propertyId}`;
  const near = p.location ? nearest(p.location, tradies, TRADIE_SEARCH_RADIUS_KM, NEAREST_TRADIES) : [];
  return html`<section id="${id}" class="dispatch-panel" aria-labelledby="${id}-title" data-panel="property-${p.propertyId}">
    ${panelHead(id, p.address, html`<p class="dispatch-panel-meta">${p.suburb}${p.worstUrgency ? html` ${urgencyBadge(p.worstUrgency)}` : ''}</p>`)}
    <h3 class="dispatch-panel-heading">Open Tickets</h3>
    ${p.openTickets.length
      ? html`<ul class="dispatch-list">${p.openTickets.map((t) => html`<li>
          ${ticketCell({ ticketId: t.ticketId, issue: t.description })}
          <span class="dispatch-list-detail">${urgencyBadge(t.urgency)}</span>
        </li>`)}</ul>`
      : html`<p class="text-muted">No open Tickets.</p>`}
    <h3 class="dispatch-panel-heading">Nearest Tradies, within ${TRADIE_SEARCH_RADIUS_KM} km</h3>
    ${!p.location
      ? html`<p class="text-muted">Address not found, so distances can't be worked out. Look up missing addresses tries it again.</p>`
      : near.length
        ? html`<ul class="dispatch-list">${near.map((t) => html`<li>
            <a class="link" href="/tradies/${t.tradieId}">${t.businessName}</a> <span class="num">${t.distanceKm.toFixed(1)} km</span>
            <span class="dispatch-list-detail">${t.trades.map(humanise).join(', ')}</span>
            <span class="dispatch-list-detail">${ratings(t)}</span>
          </li>`)}</ul>`
        : html`<p class="text-muted">${anyTradieLocated ? `No Tradies work within ${TRADIE_SEARCH_RADIUS_KM} km of this Property.` : "No Tradie has a business address yet, so distances can't be worked out."}</p>`}
  </section>`;
}

function tradiePanel(t: TradieView, bookings: Booking[], timeZone: string): Html {
  const id = `panel-tradie-${t.tradieId}`;
  return html`<section id="${id}" class="dispatch-panel" aria-labelledby="${id}-title" data-panel="tradie-${t.tradieId}">
    ${panelHead(id, t.businessName, html`<p class="dispatch-panel-meta">${t.name}, ${t.trades.map(humanise).join(', ')}</p>`)}
    <p>${ratings(t)}</p>
    ${t.location ? '' : html`<p class="text-muted">No business address yet, so this Tradie is not on the map.</p>`}
    <h3 class="dispatch-panel-heading">Booked</h3>
    ${bookings.length
      ? html`<ul class="booking-list">${bookings.map((b) => bookingCard(b, timeZone, { day: true, tradie: false }))}</ul>`
      : html`<p class="text-muted">Nothing booked in the next ${SCHEDULE_DAYS} days.</p>`}
    <p><a class="link" href="/tradies/${t.tradieId}">Open the profile</a></p>
  </section>`;
}

/** Both ratings side by side, each in its own words and never combined: "myEST8 4.0 (3 ratings)" and "Google 4.8 (120 reviews)". */
function ratings(t: TradieView): Html {
  const { average, count } = t.myEst8Rating;
  const g = t.googleRating;
  return html`<span class="dispatch-ratings">
    <span>myEST8 <span class="num font-medium">${average.toFixed(1)}</span> <span class="num">(${count} ${count === 1 ? 'rating' : 'ratings'})</span></span>
    <span>${!g
      ? 'Not on Google'
      : g.rating === null
        ? 'Google: no rating yet'
        : html`Google <span class="num font-medium">${g.rating.toFixed(1)}</span> <span class="num">(${g.reviewCount ?? 0} reviews)</span>`}</span>
  </span>`;
}

/**
 * The Properties with open Tickets, the most urgent first: the address (the link that
 * picks it), suburb, each open Ticket by its issue, and the worst Urgency. The ones with
 * nothing open fold into a disclosure under them.
 */
function propertyTable(properties: PropertyView[]): Html {
  if (!properties.length) return emptyState('No Properties yet. Add one in Settings and it will appear here.');
  const open = properties.filter((p) => p.openTickets.length);
  const quiet = properties.filter((p) => !p.openTickets.length);
  return html`${open.length
      ? html`<div class="table-frame">
          <table class="table table-sm">
            <caption class="sr-only">Properties with open Tickets, the most urgent first. The link in each row opens its details beside the map.</caption>
            <thead>
              <tr>
                <th scope="col">Address</th>
                <th scope="col">Suburb</th>
                <th scope="col">Open Tickets</th>
                <th scope="col">Worst urgency</th>
              </tr>
            </thead>
            <tbody>
              ${open.map(
                (p) => html`<tr data-row="property-${p.propertyId}">
                  ${addressCell(p)}
                  <td>${p.suburb}</td>
                  <td class="min-w-64">
                    <ul class="dispatch-list">${p.openTickets.map((t) => html`<li>${ticketCell({ ticketId: t.ticketId, issue: t.description })}</li>`)}</ul>
                  </td>
                  <td>${p.worstUrgency ? urgencyBadge(p.worstUrgency) : ''}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>`
      : emptyState('No open Tickets at any Property.')}
    ${quiet.length
      ? html`<details class="dispatch-more">
          <summary class="cursor-pointer text-sm font-medium text-action">Show the ${quiet.length} ${quiet.length === 1 ? 'Property' : 'Properties'} with no open Tickets</summary>
          <div class="table-frame">
            <table class="table table-sm">
              <caption class="sr-only">Properties with no open Tickets. The link in each row opens its details beside the map.</caption>
              <thead>
                <tr>
                  <th scope="col">Address</th>
                  <th scope="col">Suburb</th>
                </tr>
              </thead>
              <tbody>
                ${quiet.map((p) => html`<tr data-row="property-${p.propertyId}">${addressCell(p)}<td>${p.suburb}</td></tr>`)}
              </tbody>
            </table>
          </div>
        </details>`
      : ''}`;
}

function addressCell(p: PropertyView): Html {
  return html`<th scope="row" class="min-w-48">
    <a class="link" href="#panel-property-${p.propertyId}" data-select="property-${p.propertyId}">${p.address}</a>
    ${p.location ? '' : html`<span class="dispatch-not-found">${badge('Address not found', 'warning')}</span>`}
  </th>`;
}

/**
 * Each Tradie's visits over the next days, from the same bookings the calendar shows: no
 * routes, just who is where and when. Only the Tradies with a booking are listed; every
 * Tradie, the free ones too, is in a disclosure under them.
 */
function scheduleTable(tradies: TradieView[], bookings: Booking[], days: string[], timeZone: string): Html {
  if (!tradies.length) return emptyState('No Tradies yet. Add one in Settings and their bookings will appear here.');
  const byDay = bookingsByDay(bookings, days[0]!, timeZone);
  const sorted = [...tradies].sort((a, b) => a.businessName.localeCompare(b.businessName));
  const booked = sorted.filter((t) => bookings.some((b) => b.tradieId === t.tradieId));
  const grid = (rows: TradieView[], caption: string) => html`<div class="table-frame">
    <table class="table table-sm dispatch-schedule">
      <caption class="sr-only">${caption}</caption>
      <thead>
        <tr>
          <th scope="col">Tradie</th>
          ${days.map((d, i) => html`<th scope="col">${i === 0 ? html`Today<span class="dispatch-day">${shortDay(d, { month: true })}</span>` : shortDay(d, { month: true })}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${rows.map(
          (t) => html`<tr>
            <th scope="row" class="min-w-40"><a class="link" href="/tradies/${t.tradieId}">${t.businessName}</a><span class="dispatch-day">${t.trades.map(humanise).join(', ')}</span></th>
            ${days.map((d) => {
              const visits = (byDay.get(d) ?? []).filter((b) => b.tradieId === t.tradieId);
              return visits.length
                ? html`<td class="has-visits"><ul class="booking-list">${visits.map((b) => bookingCard(b, timeZone, { tradie: false }))}</ul></td>`
                : html`<td><span class="sr-only">Nothing booked</span></td>`;
            })}
          </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
  return html`${booked.length
      ? grid(booked, `The Tradies with bookings, today and the next ${SCHEDULE_DAYS - 1} days`)
      : emptyState(`No Tradie is booked in the next ${SCHEDULE_DAYS} days.`)}
    <details class="dispatch-more">
      <summary class="cursor-pointer text-sm font-medium text-action">Show all ${tradies.length} ${tradies.length === 1 ? 'Tradie' : 'Tradies'}</summary>
      ${grid(sorted, `Bookings for every Tradie, today and the next ${SCHEDULE_DAYS - 1} days`)}
    </details>`;
}

/**
 * The pins for static/dispatch-map.js as a JSON block (`<script type="application/json">`): the tile
 * source, the search radius, every Property with a location and every located Tradie. The JSON
 * is escaped so no address or name can close the script element or start a comment in it.
 */
function pinData(properties: PropertyView[], tradies: TradieView[]): Html {
  const data = {
    tiles: MAP_TILES,
    radiusKm: TRADIE_SEARCH_RADIUS_KM,
    properties: properties.flatMap((p) =>
      p.location
        ? [{ key: `property-${p.propertyId}`, id: p.propertyId, address: p.address, suburb: p.suburb, lat: p.location.lat, lng: p.location.lng, urgency: p.worstUrgency satisfies Urgency | null, openTickets: p.openTickets.length }]
        : [],
    ),
    tradies: tradies.flatMap((t) => (t.location ? [{ key: `tradie-${t.tradieId}`, id: t.tradieId, name: t.businessName, lat: t.location.lat, lng: t.location.lng, trades: t.trades }] : [])),
  };
  const json = JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return html`<script type="application/json" id="dispatch-data">${raw(json)}</script>`;
}
