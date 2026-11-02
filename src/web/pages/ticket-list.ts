// The live work at /tickets: the new Maintenance Requests waiting to be confirmed, then
// the open Tickets, most urgent first and then oldest, so the worst repairs are dealt
// with first. One filter bar (Urgency, Trade, Property) narrows both. Closed Tickets are
// in the Archive, which shares this page's controls and table. The Ticket itself is at /tickets/:id.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { TRADES, URGENCIES } from '../../shared.ts';
import { STAGES, stageOf, type ListOptions, type Stage } from '../../views.ts';
import type { WebEnv } from '../env.ts';
import { icon } from '../icons.ts';
import { listFilterOf, listFilterQuery, type ListFilter } from '../list-filter.ts';
import { requestFlags } from '../request-checks.ts';
import { shellInfo } from '../shell.ts';
import { badge, emptyState, filterBar, flashFrom, formatAge, formatDay, humanise, linkButton, page, postButton, section, segmented, statusBadge, table, ticketCell, urgencyBadge, type Html } from '../ui.ts';
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
    const [requests, everyOpen, properties] = await Promise.all([actions.requests(listOptions(f)), actions.tickets(listOptions(f)), actions.properties()]);
    const now = actions.now();
    const stage = STAGES.find((s) => s === c.req.query('stage'));
    const open = stage ? everyOpen.filter((t) => stageOf(t.jobs) === stage) : everyOpen;
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
          <div class="tickets-page">
            ${stageBar(everyOpen, f, stage, properties)}
            ${section({ title: 'New Maintenance Requests', id: 'requests', actions: requests.length ? html`${countBadge(requests.length)}<span class="tk-section-note">Waiting for you to confirm</span>` : undefined, body: requestList(byUrgency(requests), now, f) })}
            ${section({
              title: 'Open Tickets',
              id: 'open',
              actions: html`${countBadge(open.length)}${open.length ? html`<span class="tk-section-note">Most urgent first, then oldest</span>` : ''}`,
              body: open.length
                ? html`${ticketCards(open, now)}${stageLegend()}`
                : emptyState(
                    filtered(f) || stage
                      ? `No open Tickets match these filters${f.scope === 'mine' ? ' on your Properties' : ''}.`
                      : `No open Tickets${f.scope === 'mine' ? ' on your Properties' : ''}. A Ticket opens when you confirm a Maintenance Request.`,
                    stage || filtered(f)
                      ? linkButton('Clear filters', `/tickets${listFilterQuery({ scope: f.scope })}`)
                      : f.scope === 'mine'
                        ? linkButton('Show all Tickets', `/tickets${listFilterQuery({ ...f, scope: 'all' })}`)
                        : undefined,
                  ),
            })}
          </div>
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
function issueThumb(photos: { fileId: number }[]): Html {
  return photos[0]
    ? html`<img src="/files/${photos[0].fileId}" alt="Photo of the issue" width="56" height="56" loading="lazy" />`
    : html`<span class="issue-thumb-none" aria-hidden="true">${icon('image', { size: 'size-6' })}</span>`;
}

/** The stage names the Property Manager reads on the Tickets page (a Ticket whose Jobs are all done waits on them to close it). */
const STAGE_TITLE: Record<Stage, string> = {
  quoting: 'Quoting',
  awaiting_owner: 'With Property Owner',
  approved: 'Ready to book',
  scheduled: 'Booked',
  done: 'Done · ready to close',
};
const STAGE_TAB: Record<Stage, string> = { ...STAGE_TITLE, done: 'Ready to close' };

/**
 * One bar over the Tickets: the stage tabs (All open, then each stage that has a Ticket, with
 * its count) and the Urgency, Trade and Property selects. The tabs are links that keep the
 * other filters; the selects keep the chosen tab.
 */
function stageBar(open: ListedTicket[], f: ListFilter, stage: Stage | undefined, properties: Property[]): Html {
  const counts = STAGES.map((s) => open.filter((t) => stageOf(t.jobs) === s).length);
  const href = (s?: Stage) => {
    const q = listFilterQuery(f);
    return `/tickets${s ? `${q ? `${q}&` : '?'}stage=${s}` : q}`;
  };
  const tab = (label: string, count: number, to: string, active: boolean, ready = false) =>
    html`<a href="${to}" class="tk-tab${ready ? ' is-ready' : ''}" ${active ? html`aria-current="page"` : ''}>${label}<span class="tk-tab-count num">${count}</span></a>`;
  return html`<div class="tk-bar">
    <nav class="tk-tabs" aria-label="Stage">
      ${tab('All open', open.length, href(), !stage)}
      ${STAGES.map((s, i) => (counts[i] || s === stage ? tab(STAGE_TAB[s], counts[i]!, href(s), s === stage, s === 'done') : ''))}
    </nav>
    ${filterBar({
      action: '/tickets',
      filter: f,
      hidden: { stage },
      compact: true,
      urgencies: URGENCIES.filter((u) => u !== 'urgent').map((u) => ({ value: u, label: humanise(u) })),
      trades: TRADES.map((t) => ({ value: t, label: humanise(t) })),
      properties: propertyOptions(properties),
    })}
    ${stage || filtered(f) ? html`<a class="link tk-clear" href="/tickets${listFilterQuery({ scope: f.scope })}">Clear</a>` : ''}
  </div>`;
}

/** Up to three of an issue's photos as small squares, then "+n" for the rest; a quiet placeholder with none. */
function photoStrip(photos: { fileId: number; metadata?: string }[]): Html {
  if (!photos.length) return html`<span class="tk-photos"><span class="issue-thumb-none" aria-hidden="true">${icon('image', { size: 'size-6' })}</span></span>`;
  const shown = photos.slice(0, 3);
  return html`<span class="tk-photos">
    ${shown.map((p) => html`<span class="tk-photo"><img src="/files/${p.fileId}" alt="Photo of the issue" width="64" height="64" loading="lazy" />${p.metadata === 'flagged' ? html`<span class="tk-photo-flag">Flagged</span>` : ''}</span>`)}
    ${photos.length > shown.length ? html`<span class="tk-photo tk-photo-more num">+${photos.length - shown.length}</span>` : ''}
  </span>`;
}

/** Each request is a card: its photos, its Summary, the address, its badges, who reported it and when, with Review and Confirm. */
function requestList(requests: MaintenanceRequest[], now: Date, f: ListFilter): Html {
  if (!requests.length) {
    if (filtered(f)) return emptyState('No Maintenance Requests match these filters.');
    return emptyState(
      'No Maintenance Requests waiting for you. A Tenant’s report lands here once its photos are in, or after 48 hours without them.',
      f.scope === 'all' ? undefined : linkButton('Show all Maintenance Requests', '/tickets?filter=all'),
    );
  }
  return html`<div class="request-list grid gap-3">
    ${requests.map(
      (r) => html`<article class="tk-request">
        ${photoStrip(r.photos)}
        <div class="tk-request-main">
          <a href="/requests/${r.issueId}" class="tk-request-title">${r.summary?.trim() || r.description}</a>
          <p class="tk-request-address">${icon('map-pin', { size: 'size-4' })}${r.propertyAddress}</p>
          <div class="tk-request-badges">${urgencyBadge(r.urgency)}${badge(humanise(r.trade))}${requestFlags(r).map((flag) => badge(flag.label, flag.tone))}</div>
          <p class="tk-request-meta">${r.tenantName} · ${formatAge(r.reportedAt, now)}</p>
        </div>
        <div class="tk-request-actions">
          ${linkButton('Review', `/requests/${r.issueId}`, { variant: 'secondary', size: 'sm' })}${postButton(`/requests/${r.issueId}/confirm`, 'Confirm', { size: 'sm' })}
        </div>
      </article>`,
    )}
  </div>`;
}

/** Open Tickets as a grid of cards, in the order given. */
function ticketCards(tickets: ListedTicket[], now: Date): Html {
  return html`<ul class="tk-grid" role="list" aria-label="Open Tickets, most urgent and oldest first">
    ${tickets.map((t) => {
      const stage = stageOf(t.jobs);
      const reached = STAGES.indexOf(stage);
      const readyToClose = t.jobs.length > 0 && t.jobs.every((j) => j.status === 'done' || j.status === 'cancelled');
      const trades = [...new Set(t.jobs.map((j) => humanise(j.trade)))];
      return html`<li class="tk-card${readyToClose ? ' is-ready' : ''}">
        <a href="/tickets/${t.ticketId}" class="tk-card-photo" aria-label="Open Ticket #${t.ticketId}">${t.photos[0] ? html`<img src="/files/${t.photos[0].fileId}" alt="Photo of the issue" loading="lazy" />` : html`<span class="issue-thumb-none" aria-hidden="true">${icon('image', { size: 'size-8' })}</span>`}</a>
        <div class="tk-card-head">
          <span class="tk-card-number num">Ticket #${t.ticketId}</span>
          ${t.unreadMessages ? html`<span class="ticket-cell-unread"><span class="unread-dot" aria-hidden="true"></span>${t.unreadMessages} unread</span>` : ''}
          <span class="tk-card-urgency">${urgencyBadge(t.urgency)}${t.checkUrgency ? badge('Check urgency', 'warning') : ''}</span>
        </div>
        <dl class="tk-facts">
          <div><dt>Trade</dt><dd>${trades.length ? trades.join(', ') : '—'}</dd></div>
          <div><dt>Reported</dt><dd>${formatAge(t.reportedAt, now)}</dd></div>
        </dl>
        <a href="/tickets/${t.ticketId}" class="tk-card-issue">${t.description}</a>
        <p class="tk-card-address">${icon('map-pin', { size: 'size-4' })}<a href="/properties/${t.propertyId}">${t.propertyAddress}</a></p>
        <div class="tk-stage">
          <span class="tk-stage-label">Stage</span>
          <span class="stage-segs" aria-hidden="true">${STAGES.map((s, i) => html`<i class="${i <= reached ? `on stage-${stage}` : ''}"></i>`)}</span>
          <span class="tk-stage-name">${STAGE_TITLE[stage]}</span>
        </div>
        <div class="tk-card-actions">
          ${linkButton('View ticket', `/tickets/${t.ticketId}`, { variant: 'secondary', size: 'sm' })}
          ${readyToClose ? postButton(`/tickets/${t.ticketId}/close`, 'Close ticket', { size: 'sm', confirm: 'Close this Ticket? The Tenant and Property Owner will be told.' }) : ''}
        </div>
      </li>`;
    })}
  </ul>`;
}

/** The five stages in order, so the bar on each card reads the same way. */
function stageLegend(): Html {
  return html`<p class="tk-legend"><span class="tk-legend-label">Stages</span>${STAGES.map((s) => html`<span class="tk-legend-item"><i class="stage-${s}"></i>${STAGE_TAB[s] === 'Ready to close' ? 'Done' : STAGE_TAB[s]}</span>`)}</p>`;
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
