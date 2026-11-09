// Closed Tickets at /archive, the most recently closed first (or oldest first), with the
// same Mine/All, Trade and Property filters as Tickets plus a search box and a date range.
// Each row is read as the docket is: the issue, how it ended, and when. Rows are grouped by
// the month they were closed, and the list grows by "Show more" so it stays short.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { TRADES } from '../../shared.ts';
import { wallClock } from '../../zoned-time.ts';
import type { WebEnv } from '../env.ts';
import { icon } from '../icons.ts';
import { listFilterOf, listFilterQuery, type ListFilter } from '../list-filter.ts';
import { shellInfo } from '../shell.ts';
import { badge, clip, emptyState, entityLink, flashFrom, formatAge, formatDay, humanise, linkButton, optionTags, page, section, urgencyBadge, type Html, type Option } from '../ui.ts';
import { propertyOptions } from './onboarding-forms.ts';
import { countBadge, filtered, issueThumb, listOptions, scopeControl } from './ticket-list.ts';

type ClosedTicket = Awaited<ReturnType<PropertyManagerActions['tickets']>>[number];
type Property = Awaited<ReturnType<PropertyManagerActions['properties']>>[number];

/** How many Tickets show at first, and how many more each "Show more" adds. */
const PAGE_SIZE = 20;
const DAY = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const RANGES = [
  { value: 'all', label: 'Any time' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'year', label: 'This year' },
] as const;
const SORTS = [
  { value: 'recent', label: 'Recently closed' },
  { value: 'oldest', label: 'Oldest closed' },
] as const;
type Range = (typeof RANGES)[number]['value'];
type Sort = (typeof SORTS)[number]['value'];

/** What the Archive reads from its query beyond the shared list filter. */
type ArchiveView = { q: string; tenantId?: number; range: Range; sort: Sort; limit: number };

function archiveViewOf(query: (name: string) => string | undefined): ArchiveView {
  const limit = Number(query('limit'));
  const tenant = query('tenant') ?? '';
  return {
    q: (query('q') ?? '').trim().slice(0, 100),
    ...(/^[1-9]\d*$/.test(tenant) && { tenantId: Number(tenant) }),
    range: RANGES.find((r) => r.value === query('range'))?.value ?? 'all',
    sort: SORTS.find((s) => s.value === query('sort'))?.value ?? 'recent',
    limit: Number.isInteger(limit) && limit > PAGE_SIZE ? Math.min(limit, 1000) : PAGE_SIZE,
  };
}

/** A link's query string: the shared filter, then whatever of the Archive's own is not at its default. */
function archiveQuery(f: ListFilter, v: Partial<ArchiveView>): string {
  const params = new URLSearchParams(listFilterQuery(f));
  if (v.q) params.set('q', v.q);
  if (v.tenantId) params.set('tenant', String(v.tenantId));
  if (v.range && v.range !== 'all') params.set('range', v.range);
  if (v.sort && v.sort !== 'recent') params.set('sort', v.sort);
  if (v.limit && v.limit > PAGE_SIZE) params.set('limit', String(v.limit));
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Whether a search or date range narrows the list, beyond the shared filters. */
const narrowed = (v: ArchiveView) => Boolean(v.q || v.tenantId || v.range !== 'all');

/** The Tickets closed within `range` of `now`, in the Agency's time zone for "This year". */
function inRange(t: ClosedTicket, range: Range, now: Date, timeZone: string): boolean {
  if (range === 'all') return true;
  if (!t.closedAt) return false;
  if (range === 'year') return wallClock(new Date(t.closedAt), timeZone).year === wallClock(now, timeZone).year;
  return now.getTime() - new Date(t.closedAt).getTime() <= Number(range) * DAY;
}

/** The Tenants who raised the given Tickets, by name, each with how many of them are theirs. */
function tenantOptions(tickets: ClosedTicket[]): Option[] {
  const byId = new Map<number, { name: string; count: number }>();
  for (const t of tickets) byId.set(t.tenantId, { name: t.tenantName, count: (byId.get(t.tenantId)?.count ?? 0) + 1 });
  return [...byId]
    .sort(([aId, a], [bId, b]) => a.name.localeCompare(b.name) || aId - bId)
    .map(([id, t]) => ({ value: String(id), label: `${t.name} (${t.count})` }));
}

/** Whether every word typed is in the Ticket's issue, address or Trades, or is its number ("5" or "#5"). */
function matches(t: ClosedTicket, q: string): boolean {
  if (!q) return true;
  const haystack = [t.description, t.propertyAddress, ...t.jobs.map((j) => humanise(j.trade))].join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word) || word.replace(/^#/, '') === String(t.ticketId));
}

export function archivePages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const f = listFilterOf(c);
    const v = archiveViewOf((name) => c.req.query(name));
    const timeZone = actions.agency().timeZone;
    const now = actions.now();
    const [everyClosed, properties] = await Promise.all([actions.tickets({ ...listOptions(f), status: 'closed' }), actions.properties()]);
    // The Tenant list counts what the other filters leave, so each number is what choosing that Tenant would show.
    const beforeTenant = everyClosed.filter((t) => inRange(t, v.range, now, timeZone) && matches(t, v.q));
    const closed = v.tenantId ? beforeTenant.filter((t) => t.tenantId === v.tenantId) : beforeTenant;
    if (v.sort === 'oldest') closed.reverse();
    const shown = closed.slice(0, v.limit);
    const mine = f.scope === 'mine';
    const clearHref = `/archive${listFilterQuery({ scope: f.scope })}`;

    const body = shown.length
      ? html`${closedList(shown, { all: !mine, now, timeZone })}
          <div class="ar-more">
            <p class="ar-more-count">Showing ${shown.length} of ${closed.length}</p>
            ${closed.length > shown.length ? linkButton('Show more', `/archive${archiveQuery(f, { ...v, limit: v.limit + PAGE_SIZE })}#closed`, { variant: 'secondary', size: 'sm' }) : ''}
          </div>`
      : emptyState(
          filtered(f) || narrowed(v)
            ? `No closed Tickets match these filters${mine ? ' on your Properties' : ''}.`
            : `No closed Tickets${mine ? ' on your Properties' : ''} yet. A Ticket comes here once you close it.`,
          filtered(f) || narrowed(v)
            ? linkButton('Clear filters', clearHref)
            : mine
              ? linkButton('Show all closed Tickets', `/archive${listFilterQuery({ ...f, scope: 'all' })}`)
              : undefined,
        );

    return c.html(
      page({
        title: 'Archive',
        pm,
        active: 'archive',
        flash: flashFrom(c.req.url),
        shell: await shellInfo(c),
        subtitle: 'Closed Tickets, how each ended and when.',
        controls: scopeControl('/archive', f),
        body: html`<div class="archive-page">
          ${archiveBar(f, v, propertyOptions(properties), tenantOptions(beforeTenant), filtered(f) || narrowed(v) ? clearHref : undefined)}
          ${section({
            title: 'Closed Tickets',
            id: 'closed',
            actions: html`${countBadge(closed.length)}${closed.length ? html`<span class="tk-section-note">${SORTS.find((s) => s.value === v.sort)!.label} first</span>` : ''}`,
            body,
          })}
        </div>`,
      }),
    );
  });

  return pages;
}

/**
 * One bar over the list, in the Tickets page's look: a search box, then the Trade, Property, Tenant,
 * date range and sort selects. A GET form that keeps Mine/All; app.js applies it as a select
 * changes or the search is committed, and the Apply button is for pages without it.
 * Urgency is not a filter here: it matters little once a Ticket is closed.
 */
function archiveBar(f: ListFilter, v: ArchiveView, properties: Option[], tenants: Option[], clearHref: string | undefined): Html {
  const select = (name: string, label: string, all: string | undefined, options: readonly Option[], value: string | undefined, search = false) =>
    html`<label class="filter-bar-field${search ? ' filter-bar-search' : ''}"><span class="filter-bar-label">${label}</span>
      <select name="${name}" class="select select-sm" ${search ? 'data-combobox' : ''}>
        ${all ? html`<option value="">${all}</option>` : ''}
        ${optionTags([...options], value ?? '')}
      </select></label>`;
  return html`<form method="get" action="/archive" class="tk-bar ar-bar" data-autosubmit role="search" aria-label="Search and filter closed Tickets">
    ${f.scope === 'all' ? html`<input type="hidden" name="filter" value="all" />` : ''}
    ${f.urgency ? html`<input type="hidden" name="urgency" value="${f.urgency}" />` : ''}
    <label class="ar-search">
      ${icon('magnifying-glass', { size: 'size-4' })}
      <span class="sr-only">Search closed Tickets</span>
      <input type="search" name="q" value="${v.q}" class="input input-sm" placeholder="Search by issue, address or Ticket number" maxlength="100" autocomplete="off" />
    </label>
    <div class="filter-bar is-compact">
      ${select('trade', 'Trade', 'Any Trade', TRADES.map((t) => ({ value: t, label: humanise(t) })), f.trade)}
      ${select('property', 'Property', 'Any Property', properties, f.propertyId ? String(f.propertyId) : undefined, true)}
      ${select('tenant', 'Tenant', 'Any Tenant', tenants, v.tenantId ? String(v.tenantId) : undefined, true)}
      ${select('range', 'Closed', undefined, RANGES, v.range)}
      ${select('sort', 'Sort', undefined, SORTS, v.sort)}
      <button type="submit" class="btn btn-sm filter-bar-apply">Apply</button>
      ${clearHref ? html`<a class="link tk-clear" href="${clearHref}">Clear</a>` : ''}
    </div>
  </form>`;
}

/** How a closed Ticket ended: Done when any Job was, Cancelled when every Job was, else just Closed. */
function outcomeOf(t: ClosedTicket): { badge: Html; note: string } {
  const done = t.jobs.filter((j) => j.status === 'done').length;
  const cancelled = t.jobs.filter((j) => j.status === 'cancelled').length;
  if (done) return { badge: badge('Done', 'success'), note: cancelled ? `${cancelled} of ${t.jobs.length} Jobs cancelled` : '' };
  if (cancelled) return { badge: badge('Cancelled', 'neutral'), note: cancelled > 1 ? `${cancelled} Jobs cancelled` : '' };
  return { badge: badge('Closed', 'neutral'), note: '' };
}

/** The month a Ticket was closed in, as its group's heading: "This month" or "October 2026". */
function monthOf(t: ClosedTicket, now: Date, timeZone: string): string {
  if (!t.closedAt) return 'Closed earlier';
  const at = wallClock(new Date(t.closedAt), timeZone);
  const today = wallClock(now, timeZone);
  return at.year === today.year && at.month === today.month ? 'This month' : `${MONTHS[at.month - 1]} ${at.year}`;
}

/** Tickets under a heading for the month they were closed in, in the order given. */
function closedList(tickets: ClosedTicket[], o: { all: boolean; now: Date; timeZone: string }): Html {
  const groups: { label: string; tickets: ClosedTicket[] }[] = [];
  for (const t of tickets) {
    const label = monthOf(t, o.now, o.timeZone);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.tickets.push(t);
    else groups.push({ label, tickets: [t] });
  }
  return html`<div class="ar-list" aria-label="Closed Tickets">
    ${groups.map(
      (g) => html`<section class="ar-group">
        <h3 class="ar-month">${g.label}<span class="ar-month-count num">${g.tickets.length}</span></h3>
        <ul role="list" class="ar-rows">
          ${g.tickets.map((t) => closedRow(t, o))}
        </ul>
      </section>`,
    )}
  </div>`;
}

/**
 * One closed Ticket: its photo; "Ticket #5", its Trades and, only when it was High or Urgent, its Urgency;
 * the issue (two lines at most) as the row's link; the address; how it ended;
 * and when it was closed. The whole row is the link to the Ticket.
 */
function closedRow(t: ClosedTicket, o: { all: boolean; now: Date; timeZone: string }): Html {
  const outcome = outcomeOf(t);
  const trades = [...new Set(t.jobs.map((j) => humanise(j.trade)))].join(', ');
  return html`<li class="ar-row">
    <div class="queue-thumb ar-thumb">${issueThumb(t.photos)}</div>
    <div class="ar-main">
      <p class="ar-head">
        <span class="ar-number num">Ticket #${t.ticketId}</span>
        ${trades ? html`<span class="ar-trade">${trades}</span>` : ''}
        ${t.urgency !== 'routine' ? urgencyBadge(t.urgency) : ''}
        ${t.unreadMessages ? html`<span class="ticket-cell-unread"><span class="unread-dot" aria-hidden="true"></span>${t.unreadMessages} unread</span>` : ''}
      </p>
      <a href="/tickets/${t.ticketId}" class="ar-issue">${clip(t.description, { lines: 2 })}</a>
      <p class="ar-address">${entityLink('property', t.propertyAddress, `/properties/${t.propertyId}`)}${o.all ? html`<span class="ar-manager">${t.propertyManager}</span>` : ''}</p>
    </div>
    <div class="ar-outcome">${outcome.badge}${outcome.note ? html`<span class="ar-note">${outcome.note}</span>` : ''}</div>
    <div class="ar-closed">
      <span class="ar-ago">${formatAge(t.closedAt, o.now)}</span>
      <span class="ar-date">${formatDay(t.closedAt, o.timeZone)}</span>
    </div>
    <span class="ar-chevron" aria-hidden="true">${icon('caret-right', { size: 'size-5' })}</span>
  </li>`;
}
