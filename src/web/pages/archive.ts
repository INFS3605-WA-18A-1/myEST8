// Closed Tickets at /archive, the most recently closed first (or oldest first). A search box
// (issue, address, Trade, Tenant, Property Manager or Ticket number) sits over tabs for how
// each Ticket ended (All, Done, Cancelled) and the Trade, Urgency, Property, Tenant and date
// filters; each filter that is on shows as a chip that takes it off again. Each row is read as
// the docket is: the issue, how it ended, and when. Rows are grouped by the month they were
// closed, and the list grows by "Show more" so it stays short. With app.js the list refreshes
// in place as you type or pick a filter (form[data-live]); without it the form submits.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { TRADES, type Urgency } from '../../shared.ts';
import { wallClock } from '../../zoned-time.ts';
import type { WebEnv } from '../env.ts';
import { icon } from '../icons.ts';
import { listFilterOf, listFilterQuery, type ListFilter } from '../list-filter.ts';
import { shellInfo } from '../shell.ts';
import { badge, clip, emptyState, entityLink, flashFrom, formatAge, formatDay, humanise, linkButton, optionTags, page, section, urgencyBadge, type Html, type Option } from '../ui.ts';
import { propertyOptions } from './onboarding-forms.ts';
import { countBadge, filtered, issueThumb, listOptions, scopeControl } from './ticket-list.ts';

type ClosedTicket = Awaited<ReturnType<PropertyManagerActions['tickets']>>[number];

/** How many Tickets show at first, and how many more each "Show more" adds. */
const PAGE_SIZE = 20;
const DAY = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const RANGES = [
  { value: 'all', label: 'Any time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Choose dates' },
] as const;
const SORTS = [
  { value: 'recent', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
] as const;
const OUTCOMES = [
  { value: 'all', label: 'All' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;
/** Urgent issues never become Tickets, so a closed Ticket was High or Routine. */
const URGENCY_OPTIONS: Option[] = (['high', 'routine'] as const satisfies readonly Urgency[]).map((u) => ({ value: u, label: humanise(u) }));
type Range = (typeof RANGES)[number]['value'];
type Sort = (typeof SORTS)[number]['value'];
type Outcome = (typeof OUTCOMES)[number]['value'];

/** What the Archive reads from its query beyond the shared list filter. `from` and `to` are days (YYYY-MM-DD), for "Choose dates". */
type ArchiveView = { q: string; tenantId?: number; range: Range; from?: string; to?: string; outcome: Outcome; sort: Sort; limit: number };

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

function archiveViewOf(query: (name: string) => string | undefined): ArchiveView {
  const limit = Number(query('limit'));
  const tenant = query('tenant') ?? '';
  const range = RANGES.find((r) => r.value === query('range'))?.value ?? 'all';
  let from = range === 'custom' && isDay(query('from') ?? '') ? query('from') : undefined;
  let to = range === 'custom' && isDay(query('to') ?? '') ? query('to') : undefined;
  // Dates typed the wrong way round still mean the days between them.
  if (from && to && from > to) [from, to] = [to, from];
  return {
    q: (query('q') ?? '').trim().slice(0, 100),
    ...(/^[1-9]\d*$/.test(tenant) && { tenantId: Number(tenant) }),
    range,
    ...(from && { from }),
    ...(to && { to }),
    outcome: OUTCOMES.find((o) => o.value === query('outcome'))?.value ?? 'all',
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
  if (v.range === 'custom' && v.from) params.set('from', v.from);
  if (v.range === 'custom' && v.to) params.set('to', v.to);
  if (v.outcome && v.outcome !== 'all') params.set('outcome', v.outcome);
  if (v.sort && v.sort !== 'recent') params.set('sort', v.sort);
  if (v.limit && v.limit > PAGE_SIZE) params.set('limit', String(v.limit));
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Whether a search, Tenant, date range or outcome narrows the list, beyond the shared filters. */
const narrowed = (v: ArchiveView) => Boolean(v.q || v.tenantId || v.range !== 'all' || v.outcome !== 'all');

/** The day a Ticket was closed in the Agency's time zone, as YYYY-MM-DD. */
function closedDay(t: ClosedTicket, timeZone: string): string | null {
  if (!t.closedAt) return null;
  const at = wallClock(new Date(t.closedAt), timeZone);
  return `${at.year}-${String(at.month).padStart(2, '0')}-${String(at.day).padStart(2, '0')}`;
}

/** The Tickets closed within the view's range of `now`, in the Agency's time zone for "This year" and chosen dates. */
function inRange(t: ClosedTicket, v: ArchiveView, now: Date, timeZone: string): boolean {
  if (v.range === 'all') return true;
  if (!t.closedAt) return false;
  if (v.range === 'year') return wallClock(new Date(t.closedAt), timeZone).year === wallClock(now, timeZone).year;
  if (v.range === 'custom') {
    const day = closedDay(t, timeZone)!;
    return (!v.from || day >= v.from) && (!v.to || day <= v.to);
  }
  return now.getTime() - new Date(t.closedAt).getTime() <= Number(v.range) * DAY;
}

/** The Tenants who raised the given Tickets, by name, each with how many of them are theirs. */
function tenantOptions(tickets: ClosedTicket[]): Option[] {
  const byId = new Map<number, { name: string; count: number }>();
  for (const t of tickets) byId.set(t.tenantId, { name: t.tenantName, count: (byId.get(t.tenantId)?.count ?? 0) + 1 });
  return [...byId]
    .sort(([aId, a], [bId, b]) => a.name.localeCompare(b.name) || aId - bId)
    .map(([id, t]) => ({ value: String(id), label: `${t.name} (${t.count})` }));
}

/** Whether every word typed is in the Ticket's issue, address, Trades, Tenant or Property Manager, or is its number ("5" or "#5"). */
function matches(t: ClosedTicket, q: string): boolean {
  if (!q) return true;
  const haystack = [t.description, t.propertyAddress, t.tenantName, t.propertyManager, ...t.jobs.map((j) => humanise(j.trade))].join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word) || word.replace(/^#/, '') === String(t.ticketId));
}

/** How a closed Ticket ended, as the outcome tabs count it: Done when any Job was, Cancelled when every Job was. */
function endedAs(t: ClosedTicket): 'done' | 'cancelled' | 'closed' {
  if (t.jobs.some((j) => j.status === 'done')) return 'done';
  if (t.jobs.length && t.jobs.every((j) => j.status === 'cancelled')) return 'cancelled';
  return 'closed';
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
    // The Tenant list and the outcome tabs count what the other filters leave, so each number is what choosing it would show.
    const beforeTenant = everyClosed.filter((t) => inRange(t, v, now, timeZone) && matches(t, v.q) && (v.outcome === 'all' || endedAs(t) === v.outcome));
    const beforeOutcome = everyClosed.filter((t) => inRange(t, v, now, timeZone) && matches(t, v.q) && (!v.tenantId || t.tenantId === v.tenantId));
    const closed = v.tenantId ? beforeTenant.filter((t) => t.tenantId === v.tenantId) : beforeTenant;
    if (v.sort === 'oldest') closed.reverse();
    const shown = closed.slice(0, v.limit);
    const mine = f.scope === 'mine';
    const clearHref = `/archive${listFilterQuery({ scope: f.scope })}`;
    const outcomeCounts: Record<Outcome, number> = {
      all: beforeOutcome.length,
      done: beforeOutcome.filter((t) => endedAs(t) === 'done').length,
      cancelled: beforeOutcome.filter((t) => endedAs(t) === 'cancelled').length,
    };
    const propertyChoices = propertyOptions(properties);
    const tenantChoices = tenantOptions(beforeTenant);

    const body = shown.length
      ? html`${closedList(shown, { all: !mine, now, timeZone })}
          <div class="ar-more">
            <p class="ar-more-count">Showing ${shown.length} of ${closed.length}</p>
            ${closed.length > shown.length ? linkButton('Show more', `/archive${archiveQuery(f, { ...v, limit: v.limit + PAGE_SIZE })}#closed`, { variant: 'secondary', size: 'sm' }) : ''}
          </div>`
      : emptyState(
          filtered(f) || narrowed(v)
            ? v.q && !filtered(f) && !narrowed({ ...v, q: '' })
              ? `No closed Tickets match “${v.q}”${mine ? ' on your Properties' : ''}. Try fewer words, or search by Ticket number.`
              : `No closed Tickets match these filters${mine ? ' on your Properties' : ''}.`
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
        controls: scopeControl('/archive', f),
        body: html`<div class="archive-page">
          ${archiveBar(f, v, {
            properties: propertyChoices,
            tenants: tenantChoices,
            outcomeCounts,
            chips: activeChips(f, v, propertyChoices, tenantChoices),
            clearHref: filtered(f) || narrowed(v) ? clearHref : undefined,
          })}
          <div id="ar-results" data-live-region>
            ${section({
              title: 'Closed Tickets',
              id: 'closed',
              actions: countBadge(closed.length),
              body,
            })}
          </div>
        </div>`,
      }),
    );
  });

  return pages;
}

type Chip = { label: string; href: string };

/** One chip per filter that is on (the outcome has its tabs), each linking to the list without it. */
function activeChips(f: ListFilter, v: ArchiveView, properties: Option[], tenants: Option[]): Chip[] {
  const href = (lf: ListFilter, lv: ArchiveView) => `/archive${archiveQuery(lf, { ...lv, limit: PAGE_SIZE })}`;
  const chips: Chip[] = [];
  if (v.q) chips.push({ label: `“${v.q}”`, href: href(f, { ...v, q: '' }) });
  if (f.trade) chips.push({ label: humanise(f.trade), href: href({ ...f, trade: undefined }, v) });
  if (f.urgency) chips.push({ label: humanise(f.urgency), href: href({ ...f, urgency: undefined }, v) });
  if (f.propertyId) {
    const label = properties.find((p) => p.value === String(f.propertyId))?.label ?? 'Property';
    chips.push({ label, href: href({ ...f, propertyId: undefined }, v) });
  }
  if (v.tenantId) {
    // The Tenant's option carries their count ("Hana Ho (2)"); the chip is just the name.
    const label = tenants.find((t) => t.value === String(v.tenantId))?.label.replace(/\s\(\d+\)$/, '') ?? 'Tenant';
    chips.push({ label, href: href(f, { ...v, tenantId: undefined }) });
  }
  if (v.range !== 'all') {
    const label =
      v.range === 'custom'
        ? v.from && v.to
          ? `${dayLabel(v.from)} – ${dayLabel(v.to)}`
          : v.from
            ? `From ${dayLabel(v.from)}`
            : v.to
              ? `Until ${dayLabel(v.to)}`
              : 'Any dates'
        : RANGES.find((r) => r.value === v.range)!.label;
    chips.push({ label, href: href(f, { ...v, range: 'all', from: undefined, to: undefined }) });
  }
  return chips;
}

/** "2026-11-03" as "3 Nov 2026". */
function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS[m! - 1]!.slice(0, 3)} ${y}`;
}

/**
 * The bar over the list, in the Tickets page's look. Its first line is the search and the sort.
 * Under it, tabs for how the Tickets ended (each with its count), the Trade, Urgency, Property,
 * Tenant and date selects (two date boxes when "Choose dates" is picked), then a chip for each
 * filter that is on. A GET form that keeps Mine/All. With app.js (form[data-live]) a select or tab
 * applies at once and the search a moment after typing stops, swapping in the new list and
 * controls (#ar-controls, #ar-results) so the search box keeps its focus; the Apply button shows
 * only on pages without JavaScript.
 */
function archiveBar(
  f: ListFilter,
  v: ArchiveView,
  o: { properties: Option[]; tenants: Option[]; outcomeCounts: Record<Outcome, number>; chips: Chip[]; clearHref: string | undefined },
): Html {
  const select = (name: string, label: string, all: string | undefined, options: readonly Option[], value: string | undefined, search = false) =>
    html`<label class="filter-bar-field${search ? ' filter-bar-search' : ''}"><span class="filter-bar-label">${label}</span>
      <select name="${name}" class="select select-sm" ${search ? 'data-combobox' : ''}>
        ${all ? html`<option value="">${all}</option>` : ''}
        ${optionTags([...options], value ?? '')}
      </select></label>`;
  const date = (name: 'from' | 'to', label: string, value: string | undefined) =>
    html`<label class="ar-date-field"><span class="ar-date-label">${label}</span><input type="date" name="${name}" value="${value ?? ''}" class="input input-sm" /></label>`;
  return html`<form method="get" action="/archive" class="tk-bar ar-bar" data-live role="search" aria-label="Search and filter closed Tickets">
    ${f.scope === 'all' ? html`<input type="hidden" name="filter" value="all" />` : ''}
    <div class="ar-bar-top">
      <label class="ar-search">
        ${icon('magnifying-glass', { size: 'size-4' })}
        <span class="sr-only">Search closed Tickets</span>
        <input type="search" name="q" value="${v.q}" class="input" placeholder="Search issue, address, Tenant or Ticket number" maxlength="100" autocomplete="off" data-live-search />
      </label>
      <div class="filter-bar is-compact ar-sort">${select('sort', 'Sort', undefined, SORTS, v.sort)}</div>
    </div>
    <div id="ar-controls" class="ar-controls" data-live-region>
      <div class="ar-filters">
        <fieldset class="tk-tabs ar-outcomes">
          <legend class="sr-only">How it ended</legend>
          ${OUTCOMES.map(
            (x) => html`<label class="tk-tab ar-outcome-tab">
              <input type="radio" name="outcome" value="${x.value === 'all' ? '' : x.value}" class="sr-only" ${v.outcome === x.value ? 'checked' : ''} />${x.label}<span class="tk-tab-count num">${o.outcomeCounts[x.value]}</span>
            </label>`,
          )}
        </fieldset>
        <div class="filter-bar is-compact ar-selects">
          ${select('trade', 'Trade', 'Any Trade', TRADES.map((t) => ({ value: t, label: humanise(t) })), f.trade)}
          ${select('urgency', 'Urgency', 'Any Urgency', URGENCY_OPTIONS, f.urgency)}
          ${select('property', 'Property', 'Any Property', o.properties, f.propertyId ? String(f.propertyId) : undefined, true)}
          ${select('tenant', 'Tenant', 'Any Tenant', o.tenants, v.tenantId ? String(v.tenantId) : undefined, true)}
          ${select('range', 'Closed', undefined, RANGES, v.range)}
          <button type="submit" class="btn btn-sm filter-bar-apply">Apply</button>
        </div>
      </div>
      ${v.range === 'custom' ? html`<div class="ar-dates">${date('from', 'Closed from', v.from)}${date('to', 'to', v.to)}</div>` : ''}
      ${o.chips.length
        ? html`<ul class="ar-chips" role="list" aria-label="Filters on">
            ${o.chips.map((chip) => html`<li><a class="ar-chip" href="${chip.href}" data-live-link>${chip.label}${icon('x', { size: 'size-3.5' })}<span class="sr-only"> (remove this filter)</span></a></li>`)}
            ${o.clearHref && o.chips.length > 1 ? html`<li><a class="link ar-clear" href="${o.clearHref}" data-live-link>Clear all</a></li>` : ''}
          </ul>`
        : ''}
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
