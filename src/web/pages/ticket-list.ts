// Every Ticket at /tickets: open or closed, most urgent first and then oldest, so
// the worst repairs are dealt with first. The Ticket itself is at /tickets/:id.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { Urgency } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { badge, countStrip, emptyState, flashFrom, formatAge, humanise, linkButton, page, segmented, statusBadge, table, tabs, ticketCell, urgencyBadge, type Html } from '../ui.ts';

type TicketList = Awaited<ReturnType<PropertyManagerActions['tickets']>>;
type Status = 'open' | 'closed';
type Filters = { filter: 'mine' | 'all'; status: Status; urgency: Urgency | null };

const URGENCY_FILTERS: Urgency[] = ['urgent', 'high', 'routine'];

/** The list of Tickets under /tickets. */
export function ticketListPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    // The board by stage moved to the dashboard.
    if (c.req.query('view') === 'stage') return c.redirect(c.req.query('filter') === 'all' ? '/?filter=all#tickets' : '/#tickets', 302);
    const filters: Filters = {
      filter: c.req.query('filter') === 'all' ? 'all' : 'mine',
      status: c.req.query('status') === 'closed' ? 'closed' : 'open',
      urgency: URGENCY_FILTERS.find((u) => u === c.req.query('urgency')) ?? null,
    };
    // The list names each Property by its address; its id makes the address a link.
    const [list, properties] = await Promise.all([actions.tickets(filters), actions.properties()]);
    const propertyIds = new Map(properties.map((p) => [p.address, p.id]));
    const now = actions.now();
    return c.html(
      page({
        title: 'Tickets',
        pm,
        active: 'tickets',
        flash: flashFrom(c.req.url),
        shell: await shellInfo(c),
        subtitle: filters.urgency
          ? html`${humanise(filters.urgency)} ${filters.status} Tickets. <a class="link" href="${hrefFor({ ...filters, urgency: null })}">Show every Urgency</a>`
          : undefined,
        controls: segmented([
          { label: 'Mine', href: hrefFor({ ...filters, filter: 'mine' }), active: filters.filter === 'mine' },
          { label: 'All', href: hrefFor({ ...filters, filter: 'all' }), active: filters.filter === 'all' },
        ]),
        body: html`
          <div class="ticket-list-filters">
          ${tabs(
            [
              { label: 'Open', href: hrefFor({ ...filters, status: 'open' }), active: filters.status === 'open', count: list.counts.open },
              { label: 'Closed', href: hrefFor({ ...filters, status: 'closed' }), active: filters.status === 'closed', count: list.counts.closed },
            ],
            'Status',
          )}
          ${countStrip(
            URGENCY_FILTERS.map((urgency) => ({
              label: humanise(urgency),
              count: list.counts[urgency],
              href: hrefFor({ ...filters, urgency: filters.urgency === urgency ? null : urgency }),
            })),
          )}
          </div>
          ${ticketTable(list.tickets, propertyIds, filters, now)}
        `,
      }),
    );
  });

  return pages;
}

/** /tickets with the filters that differ from the defaults (Mine, open, every Urgency). */
function hrefFor(f: Filters): string {
  const params = new URLSearchParams();
  if (f.filter === 'all') params.set('filter', 'all');
  if (f.status === 'closed') params.set('status', 'closed');
  if (f.urgency) params.set('urgency', f.urgency);
  const query = params.toString();
  return query ? `/tickets?${query}` : '/tickets';
}

/**
 * Read as the docket is: the issue first (the row's link to the Ticket, with its
 * number quiet beside it and any unread messages), the address under it (a link to
 * the Property), then Urgency, the Jobs and their stages, and when it was reported.
 * On phones each row is a block: the issue, the address, then the badges.
 * The table is sorted most urgent first, then the earliest reported (its caption says so).
 */
function ticketTable(tickets: TicketList['tickets'], propertyIds: Map<string, number>, f: Filters, now: Date): Html {
  if (!tickets.length) {
    const what = `${f.urgency ? `${humanise(f.urgency)} ` : ''}${f.status === 'closed' ? 'closed' : 'open'}`;
    return emptyState(
      `No ${what} Tickets${f.filter === 'mine' ? ' on your Properties' : ''}. A Ticket opens when you confirm a Maintenance Request.`,
      f.filter === 'mine' ? linkButton('Show all Tickets', hrefFor({ ...f, filter: 'all' })) : linkButton('Review Maintenance Requests', '/requests?filter=all'),
    );
  }
  const all = f.filter === 'all';
  return table(
    ['Issue', 'Urgency', ...(all ? ['Property Manager'] : []), 'Jobs', 'Reported'],
    tickets.map((t) => {
      const propertyId = propertyIds.get(t.propertyAddress);
      return [
        ticketCell({
          ticketId: t.ticketId,
          issue: t.description,
          address: t.propertyAddress,
          propertyHref: propertyId === undefined ? undefined : `/properties/${propertyId}`,
          unread: t.unreadMessages,
        }),
        html`<span class="flex flex-wrap gap-1">${urgencyBadge(t.urgency)}${t.checkUrgency ? badge('Check urgency', 'warning') : ''}</span>`,
        ...(all ? [html`<span class="text-muted">${t.propertyManager}</span>`] : []),
        t.status === 'closed' ? statusBadge('closed') : jobsCell(t),
        html`<span class="text-muted whitespace-nowrap">${formatAge(t.reportedAt, now)}</span>`,
      ];
    }),
    { caption: `${f.status === 'closed' ? 'Closed' : 'Open'} Tickets, most urgent and oldest first`, stack: true },
  );
}

/**
 * An open Ticket's Jobs, one to a line: the Trade, then its stage. When no Job is open
 * any more the Ticket waits on the Property Manager to close it, and says so.
 */
function jobsCell(t: TicketList['tickets'][number]): Html {
  const readyToClose = t.jobs.length > 0 && t.jobs.every((j) => j.status === 'done' || j.status === 'cancelled');
  return html`<ul class="ticket-list-jobs" role="list">
      ${t.jobs.map((j) => html`<li><span class="ticket-list-trade">${humanise(j.trade)}</span> ${statusBadge(j.status, { job: true })}</li>`)}
    </ul>
    ${readyToClose ? html`<p class="ticket-list-close">Ready to close</p>` : ''}`;
}
