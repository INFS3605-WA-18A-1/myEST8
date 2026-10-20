// Dispatch: the Jobs waiting on the Property Manager to send them out (Tradies to ask
// for Quotes, or a Work Order to book once a Quote is approved) with the nearest
// Tradies of the right Trade, a map of the Agency's Properties (a house each, larger and
// redder by the worst Urgency among its open Tickets) and its Tradies (a wrench each),
// a side panel for the one picked, and the table of the same Properties. Who is booked
// when is the Schedule's (pages/calendar.ts).
//
// A map alone can't be used with a keyboard or a screen reader, so the table carries
// every fact the map does and every row picks its pin; the page works with JavaScript
// off, as the table and per-Property panels reached by their row's link (:target).
// static/dispatch-map.js adds the map: it reads the pin data from the
// JSON block this page writes, draws the MapLibre map with a marker for each pin and
// the Tradie search ring, and shows the panel of the pin or row picked.
//
// Opening the page never looks addresses up: a Property or Tradie is placed when it is
// added, and the ones the lookup missed are tried again only when the Property Manager
// asks, with the button shown while any are missing.

import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { distanceKm, nearest, TRADIE_SEARCH_RADIUS_KM } from '../../geo.ts';
import { ActionError, type Urgency } from '../../shared.ts';
import { addDays, dayOf, startOfDay } from '../../zoned-time.ts';
import { bookingCard, type Booking } from '../bookings.ts';
import type { WebEnv } from '../env.ts';
import { formAction, isoToLocal, list, localToIso, text } from '../forms.ts';
import { icon } from '../icons.ts';
import { shellInfo } from '../shell.ts';
import {
  badge,
  button,
  distanceChip,
  emptyState,
  entityLink,
  field,
  flashFrom,
  formatMoney,
  formatWhen,
  humanise,
  page,
  postButton,
  ratingChip,
  section,
  stat,
  statGroup,
  statusBadge,
  ticketCell,
  urgencyBadge,
  type Html,
} from '../ui.ts';
import { DEFAULT_VISIT_HOURS, visitMinutes } from './ticket.ts';

type Overview = Awaited<ReturnType<PropertyManagerActions['dispatch']>>;
type PropertyView = Overview['properties'][number];
type TradieView = Overview['tradies'][number];
type DispatchJob = PropertyView['openTickets'][number]['jobs'][number];

/** A Job waiting on dispatch, with the Ticket and Property it is for. */
type Waiting = { job: DispatchJob; ticket: PropertyView['openTickets'][number]; property: PropertyView };

/** How many Tradies a Job's card offers to ask for Quotes. */
const CANDIDATES_SHOWN = 6;

/**
 * The map's basemap: OpenFreeMap's Positron, a calm light grey vector style, so the pins carry the
 * colour. It is free and needs no key (https://openfreemap.org/quick_start/); MapLibre shows the
 * credit it requires ("OpenFreeMap © OpenMapTiles Data from OpenStreetMap") in the map's corner
 * from the style's own tile source. Never OpenStreetMap's own tile server, whose usage policy
 * is not for production apps.
 */
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/** How many days a Tradie's panel lists their bookings for, today first. */
const BOOKED_DAYS = 7;

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
    const [{ properties, tradies }, bookings, people] = await Promise.all([
      actions.dispatch(),
      actions.calendar({ from: startOfDay(today, timeZone).toISOString(), to: startOfDay(addDays(today, BOOKED_DAYS), timeZone).toISOString() }),
      actions.people('tradie'),
    ]);
    // A Tradie without a business address isn't missing from the map, just not on it.
    const missing = properties.some((p) => !p.location) || people.some((t) => t.businessAddress && !t.location);

    const ordered = [...properties].sort(
      (a, b) => (URGENCY_RANK[a.worstUrgency ?? ''] ?? 3) - (URGENCY_RANK[b.worstUrgency ?? ''] ?? 3) || a.address.localeCompare(b.address),
    );
    const waiting: Waiting[] = ordered.flatMap((property) =>
      property.openTickets.flatMap((ticket) => ticket.jobs.filter((job) => job.needs).map((job) => ({ job, ticket, property }))),
    );
    waiting.sort((a, b) => (URGENCY_RANK[a.ticket.urgency] ?? 3) - (URGENCY_RANK[b.ticket.urgency] ?? 3) || a.ticket.reportedAt.localeCompare(b.ticket.reportedAt));
    const needTradies = waiting.filter((w) => w.job.needs === 'tradies').length;
    const toBook = waiting.length - needTradies;
    const todayEnd = startOfDay(addDays(today, 1), timeZone).toISOString();
    const bookedToday = bookings.filter((b) => b.start < todayEnd).length;
    const urgentOpen = properties.reduce((n, p) => n + p.openTickets.filter((t) => t.urgency !== 'routine').length, 0);
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
          <section aria-label="At a glance" class="section">
            ${statGroup([
              stat({ label: 'Need Tradies', value: needTradies, hint: 'Jobs to ask for Quotes', tone: needTradies ? 'warning' : 'neutral' }),
              stat({ label: 'Ready to book', value: toBook, hint: 'Approved, no Work Order yet', tone: toBook ? 'warning' : 'neutral' }),
              stat({ label: 'High or Urgent', value: urgentOpen, hint: 'Open Tickets', tone: urgentOpen ? 'error' : 'neutral' }),
              stat({ label: 'Visits today', value: bookedToday, hint: 'Work Orders and Site Inspections' }),
            ])}
          </section>
          ${section({ title: 'To dispatch', id: 'to-dispatch', body: queue(waiting, tradies, timeZone) })}
          <div class="dispatch-board">
            ${mapSection()}
            ${panels(ordered, tradies, bookings, timeZone, tradiesPlaced > 0)}
          </div>
          ${section({ title: 'Properties', id: 'properties', body: propertyTable(ordered) })}
          ${pinIcons()}
          ${pinData(ordered, tradies)}
          <link rel="stylesheet" href="/assets/maplibre-gl.css" />
          <link rel="modulepreload" href="/assets/maplibre-gl.mjs" />
          <script type="module" src="/assets/dispatch-map.js"></script>
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

  // Asks the ticked Tradies for Quotes, as the Ticket page does.
  pages.post('/jobs/:jobId{[0-9]+}/quote-requests', (c) =>
    formAction(c, '/dispatch#to-dispatch', async (form) => {
      const tradieIds = [...new Set(list(form, 'tradieIds').map(Number))];
      await c.var.actions.sendQuoteRequests(Number(c.req.param('jobId')), tradieIds);
      const n = tradieIds.length;
      return { ok: `Quote ${n === 1 ? 'Request' : 'Requests'} sent to ${n} ${n === 1 ? 'Tradie' : 'Tradies'}`, redirect: '/dispatch#to-dispatch' };
    }),
  );

  // Books the approved Tradie, as the Ticket page does.
  pages.post('/jobs/:jobId{[0-9]+}/work-order', (c) =>
    formAction(c, '/dispatch#to-dispatch', async (form) => {
      const { timeZone } = c.var.actions.agency();
      const start = text(form, 'start');
      if (!start) throw new ActionError('invalid', 'Pick a start time');
      await c.var.actions.sendWorkOrder(Number(c.req.param('jobId')), { start: localToIso(start, timeZone), durationMinutes: visitMinutes(form) });
      return { ok: `Work Order sent for ${formatWhen(localToIso(start, timeZone), timeZone)}`, redirect: '/dispatch#to-dispatch' };
    }),
  );

  return pages;
}

/**
 * The Jobs waiting on dispatch, most urgent first: a card each with its Ticket, Property
 * and Trade, and what sends it on. A Job that needs Tradies lists those of its Trade not
 * asked yet, nearest first (nominated ones before), each with its distance and both
 * ratings, the nearest ticked; a Job ready to book offers the chosen Tradie's next free
 * times and a start time to send the Work Order for.
 */
function queue(waiting: Waiting[], tradies: TradieView[], timeZone: string): Html {
  if (!waiting.length) return emptyState('Nothing to dispatch. Every open Job has its Quote Requests out or its visit booked.');
  return html`<ul class="dispatch-queue" role="list">${waiting.map((w) => queueCard(w, tradies, timeZone))}</ul>`;
}

function queueCard({ job, ticket, property }: Waiting, tradies: TradieView[], timeZone: string): Html {
  const id = `dispatch-job-${job.jobId}`;
  return html`<li class="dispatch-card" id="${id}" aria-labelledby="${id}-title">
    <div class="dispatch-card-head">
      <div class="min-w-0">
        <p class="dispatch-card-kind">${job.needs === 'tradies' ? html`${icon('users-three', { size: 'size-4' })} Needs Tradies to quote` : html`${icon('calendar-plus', { size: 'size-4' })} Ready to book`}</p>
        <h3 id="${id}-title" class="dispatch-card-title"><a class="row-link" href="/tickets/${ticket.ticketId}">${ticket.description}</a> <span class="ticket-cell-number num">#${ticket.ticketId}</span></h3>
        <p class="dispatch-card-meta">
          ${urgencyBadge(ticket.urgency)} ${badge(humanise(job.trade), 'info')}
          <a class="entity-link entity-link-property" href="#panel-property-${property.propertyId}" data-select="property-${property.propertyId}">${icon('house-line', { size: 'size-4' })}<span>${property.address}</span></a>
        </p>
      </div>
    </div>
    ${job.needs === 'tradies' ? quoteRequestForm(job, property, tradies) : workOrderForm(job, timeZone)}
  </li>`;
}

function quoteRequestForm(job: DispatchJob, property: PropertyView, tradies: TradieView[]): Html {
  const located = new Map(tradies.map((t) => [t.tradieId, t.location]));
  const candidates = job.candidates
    .map((c) => {
      const at = located.get(c.tradieId);
      return { ...c, distance: property.location && at ? distanceKm(property.location, at) : null };
    })
    .sort((a, b) => Number(b.nominated) - Number(a.nominated) || (a.distance ?? Infinity) - (b.distance ?? Infinity))
    .slice(0, CANDIDATES_SHOWN);
  const ticked = Math.max(1, job.minimum);
  const asked = job.asked ? ` ${job.asked} asked so far.` : '';
  return html`<form method="post" action="/dispatch/jobs/${job.jobId}/quote-requests" class="dispatch-card-body">
    <fieldset class="min-w-0">
      <legend class="dispatch-card-legend">Ask for Quotes${asked} ${job.singleReason ?? (job.minimum > 1 ? `Tick at least ${job.minimum}.` : '')}</legend>
      <ul class="dispatch-candidates" role="list">
        ${candidates.map(
          (c, i) => html`<li>
            <label class="dispatch-candidate">
              <input type="checkbox" class="checkbox checkbox-primary checkbox-sm" name="tradieIds" value="${c.tradieId}" ${i < ticked ? 'checked' : ''} />
              <span class="dispatch-candidate-name">${c.businessName}</span>
            </label>
            <span class="metric-row">
              ${c.nominated ? badge('Nominated', 'success') : ''}
              ${c.distance === null ? html`<span class="metric is-empty">Distance unknown</span>` : distanceChip(c.distance)}
              ${ratingChip({ source: 'myEST8', rating: c.myEst8Rating.average, count: c.myEst8Rating.count })}
              ${ratingChip({ source: 'Google', rating: c.googleRating?.rating ?? null, count: c.googleRating?.reviewCount ?? 0, onGoogle: !!c.googleRating })}
              ${entityLink('tradie', 'Profile', `/tradies/${c.tradieId}`)}
            </span>
          </li>`,
        )}
      </ul>
    </fieldset>
    <div>${button('Send Quote Requests', { size: 'sm' })}</div>
  </form>`;
}

function workOrderForm(job: DispatchJob, timeZone: string): Html {
  const b = job.booking!;
  const id = `dispatch-job-${job.jobId}-start`;
  const first = b.proposedTime ?? b.freeSlots[0]?.start;
  return html`<form method="post" action="/dispatch/jobs/${job.jobId}/work-order" class="dispatch-card-body">
    <p class="dispatch-card-legend">
      ${entityLink('tradie', b.businessName, `/tradies/${b.tradieId}`)} approved at <strong class="num">${formatMoney(b.priceCents)}</strong>.
      Send the Work Order to book the visit; the Tenant and Property Owner are told the time.
    </p>
    ${b.freeSlots.length
      ? html`<p class="flex flex-wrap items-center gap-1 text-sm"><span class="text-muted">Free:</span>
          ${b.freeSlots.map((slot) => html`<button type="button" class="btn btn-outline btn-sm" data-fill="${id}" data-value="${isoToLocal(slot.start, timeZone)}">${formatWhen(slot.start, timeZone)}</button>`)}
        </p>`
      : html`<p class="text-sm text-muted">${b.businessName} has no free time in the next 7 days. Pick a start time.</p>`}
    <div class="ticket-inline-form">
      <div class="min-w-56 flex-1">
        ${field({ id, label: 'Start', name: 'start', type: 'datetime-local', required: true, value: first ? isoToLocal(first, timeZone) : '', hint: b.proposedTime ? "The Quote's proposed time." : undefined })}
      </div>
      <div class="w-32">${field({ id: `${id}-hours`, label: 'Length (hours)', name: 'hours', type: 'number', value: DEFAULT_VISIT_HOURS, step: '0.5', min: '0.5' })}</div>
      ${button('Send Work Order', { size: 'sm' })}
    </div>
  </form>`;
}

/** The two pin glyphs for static/dispatch-map.js to copy: a house for a Property, a wrench for a Tradie. */
function pinIcons(): Html {
  return html`<template id="dispatch-pin-icons">
    <span data-icon="property">${icon('house-line', { weight: 'fill', size: 'size-5' })}</span>
    <span data-icon="tradie">${icon('wrench', { weight: 'fill', size: 'size-4' })}</span>
  </template>`;
}

/**
 * The map. Each pin says what it is in its own shape (a house or a wrench), and a
 * Property's house grows and reddens with the worst Urgency among its open Tickets, so
 * no key is needed; each pin's name says the same in words. Without JavaScript the map's
 * place says so and points to the table; static/dispatch-map.js says the same when the map
 * can't run (no WebGL, or the basemap's style doesn't load).
 */
function mapSection(): Html {
  return html`<section class="dispatch-map-section" aria-labelledby="dispatch-map-title">
    <h2 id="dispatch-map-title" class="sr-only">Map of Properties and Tradies</h2>
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
  // With Jobs open, the Tradies who do their Trades: those are the ones to send.
  const trades = new Set(p.openTickets.flatMap((t) => t.jobs.map((j) => j.trade)));
  const fitting = trades.size ? tradies.filter((t) => t.trades.some((trade) => trades.has(trade))) : tradies;
  const near = p.location ? nearest(p.location, fitting, TRADIE_SEARCH_RADIUS_KM, NEAREST_TRADIES) : [];
  const tradesWords = [...trades].map((t) => humanise(t).toLowerCase()).join(' or ');
  return html`<section id="${id}" class="dispatch-panel" aria-labelledby="${id}-title" data-panel="property-${p.propertyId}">
    ${panelHead(id, p.address, html`<p class="dispatch-panel-meta">${p.suburb}${p.worstUrgency ? html` ${urgencyBadge(p.worstUrgency)}` : ''}</p>`)}
    <h3 class="dispatch-panel-heading">Open Tickets</h3>
    ${p.openTickets.length
      ? html`<ul class="dispatch-list">${p.openTickets.map((t) => html`<li>
          ${ticketCell({ ticketId: t.ticketId, issue: t.description })}
          <span class="dispatch-list-detail metric-row">${urgencyBadge(t.urgency)}
            ${t.jobs.map((j) =>
              j.needs
                ? html`<a class="dispatch-job-link" href="#dispatch-job-${j.jobId}">${humanise(j.trade)}: ${j.needs === 'tradies' ? 'needs Tradies' : 'ready to book'}</a>`
                : html`<span class="whitespace-nowrap">${humanise(j.trade)} ${statusBadge(j.status, { job: true })}</span>`,
            )}
          </span>
        </li>`)}</ul>`
      : html`<p class="text-muted">No open Tickets.</p>`}
    <h3 class="dispatch-panel-heading">Nearest Tradies, within ${TRADIE_SEARCH_RADIUS_KM} km${trades.size ? html`<span class="dispatch-panel-sub">who do ${tradesWords}</span>` : ''}</h3>
    ${!p.location
      ? html`<p class="text-muted">Address not found, so distances can't be worked out. Look up missing addresses tries it again.</p>`
      : near.length
        ? html`<ul class="dispatch-list">${near.map((t) => html`<li>
            <span class="dispatch-near">${entityLink('tradie', t.businessName, `/tradies/${t.tradieId}`)} ${distanceChip(t.distanceKm)}</span>
            <span class="dispatch-list-detail">${t.trades.map(humanise).join(', ')}</span>
            <span class="dispatch-list-detail">${ratings(t)}</span>
          </li>`)}</ul>`
        : html`<p class="text-muted">${anyTradieLocated ? `No Tradies${trades.size ? ` who do ${tradesWords}` : ''} work within ${TRADIE_SEARCH_RADIUS_KM} km of this Property.` : "No Tradie has a business address yet, so distances can't be worked out."}</p>`}
  </section>`;
}

function tradiePanel(t: TradieView, bookings: Booking[], timeZone: string): Html {
  const id = `panel-tradie-${t.tradieId}`;
  return html`<section id="${id}" class="dispatch-panel" aria-labelledby="${id}-title" data-panel="tradie-${t.tradieId}">
    ${panelHead(id, t.businessName, html`<p class="dispatch-panel-meta">${t.name}, ${t.trades.map(humanise).join(', ')}</p>`)}
    ${ratings(t)}
    ${t.location ? '' : html`<p class="text-muted">No business address yet, so this Tradie is not on the map.</p>`}
    <h3 class="dispatch-panel-heading">Booked</h3>
    ${bookings.length
      ? html`<ul class="booking-list">${bookings.map((b) => bookingCard(b, timeZone, { day: true, tradie: false }))}</ul>`
      : html`<p class="text-muted">Nothing booked in the next ${BOOKED_DAYS} days.</p>`}
    <p>${entityLink('tradie', 'Open the profile', `/tradies/${t.tradieId}`)}</p>
  </section>`;
}

/** Both ratings side by side, each in its own words and never combined. */
function ratings(t: TradieView): Html {
  const g = t.googleRating;
  return html`<span class="metric-row">
    ${ratingChip({ source: 'myEST8', rating: t.myEst8Rating.average, count: t.myEst8Rating.count })}
    ${ratingChip({ source: 'Google', rating: g?.rating ?? null, count: g?.reviewCount ?? 0, onGoogle: !!g })}
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
      ? html`<div class="table-frame dispatch-stack">
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
                  <td class="dispatch-tickets">
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
          <div class="table-frame dispatch-stack">
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
  return html`<th scope="row" class="dispatch-address">
    <a class="entity-link entity-link-property" href="#panel-property-${p.propertyId}" data-select="property-${p.propertyId}">${icon('house-line', { size: 'size-4' })}<span>${p.address}</span></a>
    ${p.location ? '' : html`<span class="dispatch-not-found">${badge('Address not found', 'warning')}</span>`}
  </th>`;
}

/**
 * The pins for static/dispatch-map.js as a JSON block (`<script type="application/json">`): the basemap
 * style's URL, the search radius, every Property with a location and every located Tradie. The JSON
 * is escaped so no address or name can close the script element or start a comment in it.
 */
function pinData(properties: PropertyView[], tradies: TradieView[]): Html {
  const data = {
    style: MAP_STYLE_URL,
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
