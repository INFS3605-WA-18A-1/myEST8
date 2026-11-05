// The Profiles page: one household per Property, Tradies in their own box, and the
// people linked to no Property. Mine is this Property Manager's Properties; Tradies
// are the Agency's either way. Adding anyone starts from the menu, on that profile's
// own page.

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
    return c.html(
      page({
        title: 'Profiles',
        pm,
        active: 'profiles',
        shell: shellInfo(c),
        subtitle: summary(counts, filter, q),
        controls: html`${search(filter, q)}${segmented(
          [
            { label: 'Mine', href: hrefFor('mine', q), active: filter === 'mine' },
            { label: 'All', href: hrefFor('all', q), active: filter === 'all' },
          ],
          'Whose Properties',
        )}${addMenu()}`,
        body: html`<div class="profiles-board">
          <div class="profiles-main">
            ${householdsBlock(households, q, filter)}
            ${unlinkedBlock(unlinked)}
          </div>
          ${tradiesBlock(tradies, q, filter)}
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

function householdsBlock(households: Household[], q: string, filter: Filter): Html {
  return html`<section class="profiles-households" aria-labelledby="profiles-households">
    <h2 class="section-title" id="profiles-households">Households</h2>
    ${households.length
      ? html`<div class="household-list">${households.map(householdCard)}</div>`
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

/** How many open Tickets a household lists before it sends you to the Property for the rest. */
const TICKETS_SHOWN = 3;

/**
 * One household: the Owner's tab on the card's top edge, then two columns. On the left
 * the address with its Tenants hanging off it and the Building Manager; on the right
 * what is wrong there, the open Tickets, High first. On a phone the Tickets follow the people.
 * A Property photo, when there is one, sits on the card's right edge (a band along the
 * bottom on a phone). No photo leaves the card as it is.
 */
function householdCard(household: Household): Html {
  const waiting = household.owner.approvalsWaiting;
  return html`<article class="household">
    <p class="household-owner">
      <span class="household-role">Owner</span>
      <a href="/owners/${household.owner.id}">${household.owner.name}</a>
      ${waiting ? html`<a class="household-waiting" href="/approvals">${waiting === 1 ? '1 approval waiting' : `${waiting} approvals waiting`}</a>` : ''}
    </p>
    <div class="household-body">
      <div class="household-place">
        <h3 class="household-address"><a href="/properties/${household.propertyId}">${household.address}</a>${suburbOf(household)}</h3>
        <ul class="household-people">
          ${household.tenants.length
            ? household.tenants.map(
                (tenant) => html`<li>
                  <div class="household-person">
                    <a href="/tenants/${tenant.id}">${tenant.name}</a>
                    ${tenant.openTickets ? html`<span class="household-count">${tenant.openTickets === 1 ? '1 open Ticket' : `${tenant.openTickets} open Tickets`}</span>` : ''}
                    ${tenant.concern ? badge('Concern', 'warning') : ''}
                  </div>
                </li>`,
              )
            : html`<li class="is-quiet"><div class="household-person"><span>No Tenants</span> ${linkButton('Add a Tenant', '/tenants/new', { variant: 'ghost', size: 'sm' })}</div></li>`}
        </ul>
        ${household.buildingManager
          ? html`<p class="household-manager"><span class="household-role">Building Manager</span> <a href="/building-managers/${household.buildingManager.id}">${household.buildingManager.name}</a></p>`
          : ''}
      </div>
      ${householdTickets(household)}
    </div>
    ${householdPhoto(household)}
  </article>`;
}

/**
 * The Property's photo, flush with the card. Decorative: the address is already the heading.
 * Width and height are the street-photo frame; the card's CSS crops it with object-fit.
 */
function householdPhoto(household: Household): Html {
  if (!household.photoUrl) return html``;
  return html`<div class="household-photo-slot">
    <img class="household-photo" src="${household.photoUrl}" alt="" width="640" height="400" loading="lazy" decoding="async" />
  </div>`;
}

/** The household's open Tickets, each a row to the Ticket with its Urgency; one quiet line when there are none. */
function householdTickets(household: Household): Html {
  if (!household.tickets.length) return html`<p class="household-calm">No open Tickets</p>`;
  const more = household.tickets.length - TICKETS_SHOWN;
  return html`<div class="household-tickets">
    <ul aria-label="Open Tickets">
      ${household.tickets.slice(0, TICKETS_SHOWN).map(
        (ticket) => html`<li>
          <a class="household-ticket" href="/tickets/${ticket.id}" title="${ticket.title}">
            ${icon('ticket', { size: 'size-4' })}<span class="household-ticket-title">${ticket.title}</span>${urgencyBadge(ticket.urgency)}
          </a>
        </li>`,
      )}
    </ul>
    ${more > 0 ? html`<a class="household-more" href="/properties/${household.propertyId}">${more === 1 ? '1 more open Ticket' : `${more} more open Tickets`}</a>` : ''}
  </div>`;
}

function tradiesBlock(groups: TradieGroup[], q: string, filter: Filter): Html {
  return html`<div class="profiles-tradies">
    <section class="section" aria-labelledby="profiles-tradies">
      <div class="section-head">
        <h2 class="section-title" id="profiles-tradies">Tradies</h2>
        <div class="section-actions">${linkButton('See all Tradies', '/tradies', { variant: 'ghost', size: 'sm' })}</div>
      </div>
      <div class="section-body">
        ${groups.length ? html`<p class="tradies-note">By their first Trade, with their myEST8 rating.</p>` : ''}
        ${groups.length
          ? groups.map(
              (group) => html`<section class="tradie-group" aria-label="${humanise(group.trade)}">
                <h3 class="tradie-group-title">${humanise(group.trade)}</h3>
                <ul class="tradie-rows">
                  ${group.tradies.map(tradieRow)}
                </ul>
              </section>`,
            )
          : q
            ? emptyState('No Tradies match that search.', linkButton('Clear search', hrefFor(filter, ''), { variant: 'ghost', size: 'sm' }))
            : emptyState('No Tradies yet. Add a Tradie to send them work.', linkButton('Add a Tradie', '/tradies/new', { variant: 'primary' }))}
      </div>
    </section>
  </div>`;
}

function tradieRow(tradie: TradieRow): Html {
  const noun = tradie.myEst8Rating.count === 1 ? 'rating' : 'ratings';
  const jobs = tradie.openJobs ? html`<span class="tradie-jobs">${tradie.openJobs === 1 ? '1 open Job' : `${tradie.openJobs} open Jobs`}</span>` : '';
  const offMap = tradie.onMap ? '' : badge('Not on the map', 'warning');
  return html`<li>
    <a href="/tradies/${tradie.id}" title="${tradie.businessName}">${tradie.businessName}</a>
    <span class="tradie-rating"><span class="sr-only">myEST8</span>${icon('star', { weight: 'fill', size: 'size-3.5' })}<strong class="num">${tradie.myEst8Rating.average.toFixed(1)}</strong><span class="num" aria-hidden="true">(${tradie.myEst8Rating.count})</span><span class="sr-only">from ${tradie.myEst8Rating.count} ${noun}</span></span>
    ${jobs || offMap ? html`<span class="tradie-extra">${jobs}${offMap}</span>` : ''}
  </li>`;
}

function unlinkedBlock(unlinked: Unlinked): Html {
  const any = unlinked.tenants.length + unlinked.owners.length + unlinked.buildingManagers.length;
  if (!any) return html``;
  const group = (title: string, people: { id: number; name: string }[], href: (id: number) => string) =>
    people.length
      ? html`<section aria-label="${title}">
          <h3 class="unlinked-title">${title}</h3>
          <ul class="unlinked-list">${people.map((person) => html`<li><a href="${href(person.id)}">${person.name}</a></li>`)}</ul>
        </section>`
      : '';
  return html`<section class="section profiles-unlinked" aria-labelledby="profiles-unlinked">
    <div class="section-head"><h2 class="section-title" id="profiles-unlinked">Not linked to a Property</h2></div>
    <div class="section-body">
      ${group('Former Tenants', unlinked.tenants, (id) => `/tenants/${id}`)}
      ${group('Property Owners', unlinked.owners, (id) => `/owners/${id}`)}
      ${group('Building Managers', unlinked.buildingManagers, (id) => `/building-managers/${id}`)}
    </div>
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
