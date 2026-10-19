// The live work at /tickets: the new Maintenance Requests waiting to be confirmed, then
// the open Tickets, most urgent first and then oldest, so the worst repairs are dealt
// with first. One filter bar (Urgency, Trade, Property) narrows both. Closed Tickets are
// in the Archive, which shares this page's controls and table. The Ticket itself is at /tickets/:id.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { TRADES, URGENCIES } from '../../shared.ts';
import type { ListOptions } from '../../views.ts';
import type { WebEnv } from '../env.ts';
import { icon } from '../icons.ts';
import { listFilterOf, listFilterQuery, type ListFilter } from '../list-filter.ts';
import { requestFlags } from '../request-checks.ts';
import { shellInfo } from '../shell.ts';
import { badge, emptyState, filterBar, flashFrom, formatAge, formatDay, humanise, linkButton, page, postButton, queueRow, section, segmented, statusBadge, table, ticketCell, urgencyBadge, type Html } from '../ui.ts';
import { propertyOptions } from './onboarding-forms.ts';
import { byUrgency } from './requests.ts';

type MaintenanceRequest = Awaited<ReturnType<PropertyManagerActions['requests']>>[number];
type ListedTicket = Awaited<ReturnType<PropertyManagerActions['tickets']>>[number];
type Property = Awaited<ReturnType<PropertyManagerActions['properties']>>[number];

/** The list of new Maintenance Requests and open Tickets under /tickets. */
export function ticketListPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    // The board by stage moved to the dashboard.
    if (c.req.query('view') === 'stage') return c.redirect(c.req.query('filter') === 'all' ? '/?filter=all#tickets' : '/#tickets', 302);
    // Closed Tickets moved to the Archive, filters and all.
    if (c.req.query('status') === 'closed') {
      const params = new URL(c.req.url).searchParams;
      params.delete('status');
      return c.redirect(`/archive${params.size ? `?${params}` : ''}`, 303);
    }
    const f = listFilterOf(c);
    const [requests, open, properties] = await Promise.all([actions.requests(listOptions(f)), actions.tickets(listOptions(f)), actions.properties()]);
    const now = actions.now();
    return c.html(
      page({
        title: 'Tickets',
        pm,
        active: 'tickets',
        flash: flashFrom(c.req.url),
        shell: await shellInfo(c),
        subtitle: 'New Maintenance Requests waiting for you to confirm, then the open Tickets.',
        controls: scopeControl('/tickets', f),
        body: html`
          ${listFilterBar('/tickets', f, properties)}
          ${section({ title: 'New Maintenance Requests', id: 'requests', actions: countBadge(requests.length), body: requestList(byUrgency(requests), now, f) })}
          ${section({
            title: 'Open Tickets',
            id: 'open',
            actions: countBadge(open.length),
            body: open.length
              ? ticketTable(open, { all: f.scope === 'all', now })
              : emptyState(
                  filtered(f)
                    ? `No open Tickets match these filters${f.scope === 'mine' ? ' on your Properties' : ''}.`
                    : `No open Tickets${f.scope === 'mine' ? ' on your Properties' : ''}. A Ticket opens when you confirm a Maintenance Request.`,
                  f.scope === 'mine' ? linkButton('Show all Tickets', `/tickets${listFilterQuery({ ...f, scope: 'all' })}`) : undefined,
                ),
          })}
        `,
      }),
    );
  });

  return pages;
}

/** What the views read from a list's filter: Mine or All, and any Urgency, Trade and Property. */
export function listOptions(f: ListFilter): ListOptions {
  return { filter: f.scope, urgency: f.urgency, trade: f.trade, propertyId: f.propertyId };
}

/** Whether any of the filter bar's filters is set (Mine or All aside). */
export const filtered = (f: ListFilter) => Boolean(f.urgency || f.trade || f.propertyId);

/** Mine/All for a list at `path`, keeping its other filters. */
export function scopeControl(path: string, f: ListFilter): Html {
  return segmented([
    { label: 'Mine', href: `${path}${listFilterQuery({ ...f, scope: 'mine' })}`, active: f.scope === 'mine' },
    { label: 'All', href: `${path}${listFilterQuery({ ...f, scope: 'all' })}`, active: f.scope === 'all' },
  ]);
}

/**
 * The filter bar for a list at `path`: the Urgencies a Ticket can have (an Urgent issue
 * is an Urgent Repair, never a Maintenance Request or Ticket), every Trade, and the Agency's Properties.
 */
export function listFilterBar(path: string, f: ListFilter, properties: Property[]): Html {
  return filterBar({
    action: path,
    filter: f,
    urgencies: URGENCIES.filter((u) => u !== 'urgent').map((u) => ({ value: u, label: humanise(u) })),
    trades: TRADES.map((t) => ({ value: t, label: humanise(t) })),
    properties: propertyOptions(properties),
  });
}

/** A section's count, or nothing at none. */
export function countBadge(count: number) {
  return count ? badge(String(count)) : undefined;
}

/**
 * The issue's first photo, 56px and cropped square, or a quiet placeholder when there is
 * none: the same in a request's row and a Ticket's, so the lists read alike.
 */
export function issueThumb(photos: { fileId: number }[]): Html {
  return photos[0]
    ? html`<img src="/files/${photos[0].fileId}" alt="Photo of the issue" width="56" height="56" loading="lazy" />`
    : html`<span class="issue-thumb-none" aria-hidden="true">${icon('image', { size: 'size-6' })}</span>`;
}

/** Each request leads with its Summary, then the address, its badges, who reported it and when, with Confirm or Review. */
function requestList(requests: MaintenanceRequest[], now: Date, f: ListFilter): Html {
  if (!requests.length) {
    if (filtered(f)) return emptyState('No Maintenance Requests match these filters.');
    return emptyState(
      'No Maintenance Requests waiting for you. A Tenant’s report lands here once its photos are in, or after 48 hours without them.',
      f.scope === 'all' ? undefined : linkButton('Show all Maintenance Requests', '/tickets?filter=all'),
    );
  }
  return html`<div class="request-list grid gap-2">
    ${requests.map((r) =>
      queueRow({
        href: `/requests/${r.issueId}`,
        thumb: issueThumb(r.photos),
        title: r.summary?.trim() || r.description,
        detail: r.propertyAddress,
        badges: [urgencyBadge(r.urgency), badge(humanise(r.trade)), ...requestFlags(r).map((flag) => badge(flag.label, flag.tone))],
        meta: `${r.tenantName}, ${formatAge(r.reportedAt, now)}`,
        decision: true,
        actions: html`${postButton(`/requests/${r.issueId}/confirm`, 'Confirm', { size: 'sm' })}${linkButton('Review', `/requests/${r.issueId}`, { variant: 'secondary', size: 'sm' })}`,
      }),
    )}
  </div>`;
}

/**
 * Read as the docket is: the issue's photo and the issue (the row's link to the Ticket,
 * with its number quiet beside it and any unread messages), the address under it (a
 * link to the Property), then Urgency, the Jobs and their stages, and when it was
 * reported. With `closed` (the Archive) the last column is when it was closed, in the
 * Agency's time zone. On phones each row is a block: the issue, the address, then the badges.
 */
export function ticketTable(tickets: ListedTicket[], o: { all: boolean; now: Date; closed?: { timeZone: string } }): Html {
  const closed = o.closed;
  return table(
    ['Issue', 'Urgency', ...(o.all ? ['Property Manager'] : []), 'Jobs', closed ? 'Closed' : 'Reported'],
    tickets.map((t) => [
      html`<div class="ticket-list-issue">
        <div class="queue-thumb">${issueThumb(t.photos)}</div>
        ${ticketCell({ ticketId: t.ticketId, issue: t.description, address: t.propertyAddress, propertyHref: `/properties/${t.propertyId}`, unread: t.unreadMessages })}
      </div>`,
      html`<span class="flex flex-wrap gap-1">${urgencyBadge(t.urgency)}${t.checkUrgency ? badge('Check urgency', 'warning') : ''}</span>`,
      ...(o.all ? [html`<span class="text-muted">${t.propertyManager}</span>`] : []),
      jobsCell(t, !closed),
      closed
        ? html`<span class="text-muted whitespace-nowrap">Closed ${formatDay(t.closedAt, closed.timeZone)}</span>`
        : html`<span class="text-muted whitespace-nowrap">${formatAge(t.reportedAt, o.now)}</span>`,
    ]),
    { caption: closed ? 'Closed Tickets, most recently closed first' : 'Open Tickets, most urgent and oldest first', stack: true },
  );
}

/**
 * A Ticket's Jobs, one to a line: the Trade, then its stage. When no Job of an open
 * Ticket is open any more it waits on the Property Manager to close it, and says so.
 */
function jobsCell(t: ListedTicket, open: boolean): Html {
  const readyToClose = open && t.jobs.length > 0 && t.jobs.every((j) => j.status === 'done' || j.status === 'cancelled');
  return html`<ul class="ticket-list-jobs" role="list">
      ${t.jobs.map((j) => html`<li><span class="ticket-list-trade">${humanise(j.trade)}</span> ${statusBadge(j.status, { job: true })}</li>`)}
    </ul>
    ${readyToClose ? html`<p class="ticket-list-close">Ready to close</p>` : ''}`;
}
