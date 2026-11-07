// The Profiles page: one white card under the title. Its top band holds the search, Mine /
// All and Add profile. Below, one household per Property on the left (the Property's photo,
// its Owner and people, how many Tickets are open and the worst Urgency, and the open
// Tickets behind a Ticket history toggle), and on the right the Tradies and the people
// linked to no Property. Mine is this Property Manager's Properties; Tradies are the
// Agency's either way. The chips in the header are the lists for each kind of profile.
// Adding anyone starts from the menu, on that profile's own page.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { icon } from '../icons.ts';
import { badge, emptyState, humanise, linkButton, page, segmented, urgencyBadge, type Html } from '../ui.ts';

type Overview = Awaited<ReturnType<PropertyManagerActions['profilesOverview']>>;
type Household = Overview['households'][number];
type TradieGroup = Overview['tradies'][number];
type TradieRow = TradieGroup['tradies'][number];
type Unlinked = Overview['unlinked'];
type Counts = Overview['counts'];
type Filter = 'mine' | 'all';

const ADD: { label: string; href: string }[] = [
  { label: 'Property', href: '/properties/new' },
  { label: 'Tenant', href: '/tenants/new' },
  { label: 'Property Owner', href: '/owners/new' },
  { label: 'Building Manager', href: '/building-managers/new' },
  { label: 'Tradie', href: '/tradies/new' },
];

/** Profiles under /profiles. */
export function profilePages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const filter: Filter = c.req.query('filter') === 'all' ? 'all' : 'mine';
    const q = (c.req.query('q') ?? '').trim();
    const overview = await actions.profilesOverview({ filter });
    const households = q ? overview.households.filter((household) => householdMatches(household, q)) : overview.households;
    const tradies = q ? overview.tradies.map((group) => ({ ...group, tradies: group.tradies.filter((tradie) => tradieMatches(tradie, q)) })).filter((group) => group.tradies.length) : overview.tradies;
    const unlinked = q ? filterUnlinked(overview.unlinked, q) : overview.unlinked;
    const counts = q ? countsOf(households, tradies, unlinked) : overview.counts;
    const { timeZone } = actions.agency();
    return c.html(
      page({
        title: 'Profiles',
        pm,
        active: 'profiles',
        shell: shellInfo(c),
        subtitle: summary(counts, filter, q),
        controls: profileChips(counts, filter, q),
        body: html`<div class="profiles-card">
          <div class="profiles-toolbar">
            ${search(filter, q)}
            <div class="profiles-toolbar-end">
              ${segmented(
                [
                  { label: 'Mine', href: hrefFor('mine', q), active: filter === 'mine' },
                  { label: 'All', href: hrefFor('all', q), active: filter === 'all' },
                ],
                'Whose Properties',
              )}
              ${addMenu()}
            </div>
          </div>
          <div class="profiles-board">
            <div class="profiles-main">${householdsBlock(households, q, filter, timeZone)}</div>
            <aside class="profiles-side" aria-label="Tradies and people without a Property">
              ${tradiesBlock(tradies, q, filter)}
              ${unlinkedBlock(unlinked)}
            </aside>
          </div>
        </div>`,
      }),
    );
  });

  return pages;
}

function hrefFor(filter: Filter, q: string): string {
  const params = new URLSearchParams();
  if (filter === 'all') params.set('filter', 'all');
  if (q) params.set('q', q);
  const query = params.toString();
  return query ? `/profiles?${query}` : '/profiles';
}

/**
 * Search: one field with a magnifier, sent with Enter (a form with one text field submits
 * without a button). While a search is on, a Clear link puts the whole page back.
 */
function search(filter: Filter, q: string): Html {
  return html`<form method="get" action="/profiles" class="profiles-search" role="search">
    <label class="profiles-search-field">
      <span class="sr-only">Search Profiles</span>
      ${icon('magnifying-glass', { size: 'size-4' })}
      <input type="search" name="q" value="${q}" placeholder="Address, name or Trade" autocomplete="off" />
    </label>
    ${filter === 'all' ? html`<input type="hidden" name="filter" value="all" />` : ''}
    ${q ? html`<a class="btn btn-ghost btn-sm" href="${hrefFor(filter, '')}">Clear</a>` : ''}
  </form>`;
}

/** Add profile: one control, a plus and a chevron, opening the same disclosure as the user menu. */
function addMenu(): Html {
  return html`<details class="add-menu" data-menu>
    <summary class="btn btn-primary btn-sm add-menu-button">
      <span class="add-menu-label">${icon('plus', { size: 'size-4' })}Add profile</span>
      <span class="add-menu-caret">${icon('caret-down', { size: 'size-4' })}</span>
    </summary>
    <nav class="add-menu-panel" aria-label="Add profile">
      ${ADD.map((item) => html`<a href="${item.href}">${item.label}</a>`)}
    </nav>
  </details>`;
}

/** The kinds of profile as chips beside the title: each opens its list; All is this page. */
function profileChips(counts: Counts, filter: Filter, q: string): Html {
  const chip = (label: string, href: string, n: number | null, active = false) => html`<a class="profiles-chip${active ? ' is-active' : ''}" href="${href}" ${active ? html`aria-current="page"` : ''}>${label}${n ? html` <span class="num">${n}</span>` : ''}</a>`;
  return html`<nav class="profiles-chips" aria-label="Profile types">
    ${chip('All', hrefFor(filter, q), null, true)}
    ${chip('Properties', '/properties', counts.properties)}
    ${chip('Tenants', filter === 'all' ? '/tenants?filter=all' : '/tenants', counts.tenants)}
    ${chip('Property Owners', '/owners', counts.owners)}
    ${chip('Tradies', '/tradies', counts.tradies)}
    ${chip('Building Managers', '/building-managers', counts.buildingManagers)}
  </nav>`;
}

function householdsBlock(households: Household[], q: string, filter: Filter, timeZone: string): Html {
  const open = households.reduce((sum, household) => sum + household.openTickets, 0);
  // An Owner of several Properties is counted once.
  const waiting = [...new Map(households.map((household) => [household.owner.id, household.owner.approvalsWaiting])).values()].reduce((sum, n) => sum + n, 0);
  const note = [open ? `${open} open ${open === 1 ? 'Ticket' : 'Tickets'}` : '', waiting ? `${waiting} ${waiting === 1 ? 'approval' : 'approvals'} waiting` : ''].filter(Boolean).join(' · ');
  return html`<section class="profiles-households" aria-labelledby="profiles-households">
    <div class="profiles-head">
      <h2 class="profiles-title" id="profiles-households">Households${households.length ? html` <span class="num">${households.length}</span>` : ''}</h2>
      ${note ? html`<p class="profiles-note num">${note}</p>` : ''}
    </div>
    ${households.length
      ? html`<div class="household-list">${households.map((household) => householdCard(household, timeZone))}</div>`
      : q
        ? emptyState('No households match that search.', linkButton('Clear search', hrefFor(filter, ''), { variant: 'ghost', size: 'sm' }))
        : filter === 'mine'
          ? emptyState('No Properties of yours yet. Add a Property to start a household.', html`${linkButton('Add a Property', '/properties/new', { variant: 'primary' })}${linkButton('Show all', hrefFor('all', q), { variant: 'ghost' })}`)
          : emptyState('No Properties yet. Add a Property to start a household.', linkButton('Add a Property', '/properties/new', { variant: 'primary' }))}
  </section>`;
}

/** The suburb, when the address line does not already say it. */
function suburbOf(household: Household): Html {
  if (!household.suburb || household.address.toLowerCase().includes(household.suburb.toLowerCase())) return html``;
  return html` <span class="household-suburb">${household.suburb}</span>`;
}

/** "Kevin He" is KH; a single name gives its first two letters. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 2).map((word) => word[0] ?? '').join('').toUpperCase();
  return (words[0] ?? name).slice(0, 2).toUpperCase();
}

/** "29 Oct", in the Agency's time zone. */
function shortDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).format(new Date(iso));
}

/**
 * One household. On the left the Property's photo, the one found for its address (or a
 * link to add one when it has none); beside it the Owner and any approvals waiting, the
 * address, and the Tenants and Building Manager; then two tiles, how many Tickets are open
 * and the worst Urgency, and an arrow to the Property. A Ticket history toggle under them
 * opens the open Tickets, each a row to its Ticket. On a phone the photo is a band on top.
 */
function householdCard(household: Household, timeZone: string): Html {
  const waiting = household.owner.approvalsWaiting;
  return html`<article class="household">
    ${householdPhoto(household)}
    <div class="household-main">
      <p class="household-owner">
        <span class="household-role">Owner</span>
        <a href="/owners/${household.owner.id}">${household.owner.name}</a>
        ${waiting ? html`<a class="household-waiting" href="/approvals">${waiting === 1 ? '1 approval waiting' : `${waiting} approvals waiting`}</a>` : ''}
      </p>
      <h3 class="household-address"><a href="/properties/${household.propertyId}">${household.address}</a>${suburbOf(household)}</h3>
      <ul class="household-people">
        ${household.tenants.length
          ? household.tenants.map(
              (tenant) => html`<li>
                <div class="household-person">
                  <span class="household-avatar" aria-hidden="true">${initials(tenant.name)}</span>
                  <a href="/tenants/${tenant.id}">${tenant.name}</a>
                  ${tenant.openTickets ? html`<span class="household-count">${tenant.openTickets === 1 ? '1 open Ticket' : `${tenant.openTickets} open Tickets`}</span>` : ''}
                  ${tenant.concern ? badge('Concern', 'warning') : ''}
                </div>
              </li>`,
            )
          : html`<li class="is-quiet"><div class="household-person"><span class="household-avatar is-empty" aria-hidden="true">${icon('plus', { size: 'size-3' })}</span><span>No Tenants yet</span></div></li>`}
      </ul>
      ${household.buildingManager
        ? html`<p class="household-manager"><span class="household-role">Building Manager</span> <a href="/building-managers/${household.buildingManager.id}">${household.buildingManager.name}</a></p>`
        : ''}
      ${household.tenants.length ? '' : html`<div class="household-add"><a class="btn btn-primary btn-sm" href="/tenants/new">${icon('plus', { size: 'size-4' })}Add a Tenant</a></div>`}
      ${household.tickets.length ? '' : html`<p class="household-calm">No open Tickets</p>`}
    </div>
    ${householdTiles(household)}
    ${householdHistory(household, timeZone)}
  </article>`;
}

/**
 * The Property's photo, found for its address when it was added, or the one a Property
 * Manager uploaded. Decorative: the address is already the heading. Width and height are
 * the street-photo frame; the card's CSS crops it. With no photo the slot is a dashed link
 * to where one is added.
 */
function householdPhoto(household: Household): Html {
  if (!household.photoUrl) {
    return html`<a class="household-photo-slot is-empty" href="/properties/${household.propertyId}#photo">${icon('camera', { size: 'size-5' })}<span>Add a photo</span></a>`;
  }
  return html`<a class="household-photo-slot" href="/properties/${household.propertyId}" tabindex="-1" aria-hidden="true">
    <img class="household-photo" src="${household.photoUrl}" alt="" width="640" height="400" loading="lazy" decoding="async" />
  </a>`;
}

const WORST_WORDS: Record<string, string> = { urgent: 'Most urgent', high: 'Worst urgency', routine: 'Worst urgency' };

/** How many Tickets are open and the worst Urgency among them, then the way into the Property. */
function householdTiles(household: Household): Html {
  const worst = household.worstUrgency;
  return html`<div class="household-status">
    <div class="household-tile">
      <p class="household-tile-value num">${household.openTickets}</p>
      <p class="household-tile-label">${household.openTickets === 1 ? 'Open Ticket' : 'Open Tickets'}</p>
    </div>
    <div class="household-tile is-${worst ?? 'clear'}">
      <p class="household-tile-value">${worst ? humanise(worst) : 'Clear'}</p>
      <p class="household-tile-label">${worst ? WORST_WORDS[worst] : 'Nothing to fix'}</p>
    </div>
    <a class="household-go" href="/properties/${household.propertyId}" aria-label="Open ${household.address}">${icon('caret-right', { size: 'size-4' })}</a>
  </div>`;
}

/**
 * The open Tickets behind a toggle, High first: the number, its words, its Urgency and the
 * day it was reported, each row a link to the Ticket. None open: no toggle.
 */
function householdHistory(household: Household, timeZone: string): Html {
  if (!household.tickets.length) return html``;
  const n = household.tickets.length;
  return html`<details class="household-history">
    <summary class="household-history-toggle">${icon('clock-counter-clockwise', { size: 'size-4' })}<span>Ticket history</span><span class="household-history-count num">${n} open</span>${icon('caret-down', { size: 'size-3.5' })}</summary>
    <div class="household-history-panel">
      <div class="household-history-head">
        <span class="household-history-title">Open Tickets</span>
        <a class="link" href="/tickets">Open all ${n} in Tickets</a>
      </div>
      <ul aria-label="Open Tickets">
        ${household.tickets.map(
          (ticket) => html`<li>
            <a class="household-ticket" href="/tickets/${ticket.id}" title="${ticket.title}">
              <span class="household-ticket-id num">#${ticket.id}</span><span class="household-ticket-title">${ticket.title}</span>${urgencyBadge(ticket.urgency)}<span class="household-ticket-date num">${shortDate(ticket.reportedAt, timeZone)}</span>${icon('caret-right', { size: 'size-4' })}
            </a>
          </li>`,
        )}
      </ul>
    </div>
  </details>`;
}

function tradiesBlock(groups: TradieGroup[], q: string, filter: Filter): Html {
  const rows = groups.flatMap((group) => group.tradies);
  return html`<section class="profiles-tradies" aria-labelledby="profiles-tradies">
    <div class="profiles-head">
      <h2 class="profiles-title" id="profiles-tradies">Tradies${rows.length ? html` <span class="num">${rows.length}</span>` : ''}</h2>
      <a class="link profiles-seeall" href="/tradies">See all<span class="sr-only"> Tradies</span></a>
    </div>
    ${rows.length ? html`<p class="tradies-note">By their first Trade, with their myEST8 rating.</p>` : ''}
    ${rows.length
      ? html`<ul class="tradie-rows">
          ${rows.map(tradieRow)}
        </ul>
        <a class="tradie-add" href="/tradies/new">${icon('plus', { size: 'size-4' })}Add a Tradie</a>`
      : q
        ? emptyState('No Tradies match that search.', linkButton('Clear search', hrefFor(filter, ''), { variant: 'ghost', size: 'sm' }))
        : emptyState('No Tradies yet. Add a Tradie to send them work.', linkButton('Add a Tradie', '/tradies/new', { variant: 'primary' }))}
  </section>`;
}

function tradieRow(tradie: TradieRow): Html {
  const noun = tradie.myEst8Rating.count === 1 ? 'rating' : 'ratings';
  const jobs = tradie.openJobs ? html`<span class="tradie-jobs">${tradie.openJobs === 1 ? '1 open Job' : `${tradie.openJobs} open Jobs`}</span>` : '';
  const offMap = tradie.onMap ? '' : badge('Not on the map', 'warning');
  return html`<li>
    <span class="tradie-avatar" aria-hidden="true">${initials(tradie.businessName)}</span>
    <span class="tradie-text">
      <a href="/tradies/${tradie.id}" title="${tradie.businessName}">${tradie.businessName}</a>
      <span class="tradie-trades">${tradie.trades.map((trade) => humanise(trade)).join(', ')}</span>
      ${jobs || offMap ? html`<span class="tradie-extra">${jobs}${offMap}</span>` : ''}
    </span>
    <span class="tradie-rating"><span class="sr-only">myEST8</span>${icon('star', { weight: 'fill', size: 'size-3.5' })}<strong class="num">${tradie.myEst8Rating.average.toFixed(1)}</strong><span class="num" aria-hidden="true">(${tradie.myEst8Rating.count})</span><span class="sr-only">from ${tradie.myEst8Rating.count} ${noun}</span></span>
  </li>`;
}

function unlinkedBlock(unlinked: Unlinked): Html {
  const any = unlinked.tenants.length + unlinked.owners.length + unlinked.buildingManagers.length;
  if (!any) return html``;
  const group = (title: string, people: { id: number; name: string }[], href: (id: number) => string) =>
    people.length
      ? html`<section aria-label="${title}">
          <h3 class="unlinked-title">${title}</h3>
          <ul class="unlinked-list">${people.map((person) => html`<li><a href="${href(person.id)}"><span class="household-avatar" aria-hidden="true">${initials(person.name)}</span>${person.name}</a></li>`)}</ul>
        </section>`
      : '';
  return html`<section class="profiles-unlinked" aria-labelledby="profiles-unlinked">
    <h2 class="profiles-title" id="profiles-unlinked">Not linked to a Property</h2>
    ${group('Former Tenants', unlinked.tenants, (id) => `/tenants/${id}`)}
    ${group('Property Owners', unlinked.owners, (id) => `/owners/${id}`)}
    ${group('Building Managers', unlinked.buildingManagers, (id) => `/building-managers/${id}`)}
  </section>`;
}

/** The sentence under the title. Each count links to its list, except while a search is on, when the numbers are matches. */
function summary(counts: Counts, filter: Filter, q: string): Html | string {
  const items = [
    countItem(counts.properties, 'Property', 'Properties', '/properties'),
    countItem(counts.tenants, 'Tenant', 'Tenants', filter === 'all' ? '/tenants?filter=all' : '/tenants'),
    countItem(counts.owners, 'Property Owner', 'Property Owners', '/owners'),
    countItem(counts.buildingManagers, 'Building Manager', 'Building Managers', '/building-managers'),
    countItem(counts.tradies, 'Tradie', 'Tradies', '/tradies'),
  ].filter((item): item is CountItem => item !== null);
  if (q) return items.length ? `Matching “${q}”: ${sentence(items.map((item) => item.label))}` : `Nothing matches “${q}”`;
  if (!items.length) return '';
  const parts = items.map((item, i) => {
    const sep = i === 0 ? '' : i === items.length - 1 ? ' and ' : ', ';
    return html`${sep}<a href="${item.href}">${item.label}</a>`;
  });
  return html`${parts}`;
}

type CountItem = { label: string; href: string };

function countItem(n: number, one: string, many: string, href: string): CountItem | null {
  if (n <= 0) return null;
  return { label: `${n} ${n === 1 ? one : many}`, href };
}

function sentence(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

function countsOf(households: Household[], groups: TradieGroup[], unlinked: Unlinked): Counts {
  const owners = new Set<number>([...households.map((household) => household.owner.id), ...unlinked.owners.map((owner) => owner.id)]);
  const managers = new Set<number>([
    ...households.flatMap((household) => (household.buildingManager ? [household.buildingManager.id] : [])),
    ...unlinked.buildingManagers.map((manager) => manager.id),
  ]);
  return {
    properties: households.length,
    tenants: households.reduce((sum, household) => sum + household.tenants.length, 0) + unlinked.tenants.length,
    owners: owners.size,
    buildingManagers: managers.size,
    tradies: groups.reduce((sum, group) => sum + group.tradies.length, 0),
  };
}

function householdMatches(household: Household, q: string): boolean {
  const names = [household.address, household.suburb, household.owner.name, household.buildingManager?.name ?? '', ...household.tenants.map((tenant) => tenant.name)];
  return names.some((name) => includes(name, q));
}

function tradieMatches(tradie: TradieRow, q: string): boolean {
  return includes(tradie.businessName, q) || includes(tradie.name, q) || tradie.trades.some((trade) => includes(trade, q) || includes(humanise(trade), q));
}

function filterUnlinked(unlinked: Unlinked, q: string): Unlinked {
  const keep = (people: { id: number; name: string }[]) => people.filter((person) => includes(person.name, q));
  return { tenants: keep(unlinked.tenants), owners: keep(unlinked.owners), buildingManagers: keep(unlinked.buildingManagers) };
}

function includes(value: string, q: string): boolean {
  return value.toLowerCase().includes(q.toLowerCase());
}
