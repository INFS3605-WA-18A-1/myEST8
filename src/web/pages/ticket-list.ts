// Tickets under /tickets: every open Ticket as a list, or by stage on a board.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { badge, docket, emptyState, flashFrom, formatWhen, humanise, lane, page, section, segmented, statusBadge, table, urgencyBadge, type Html } from '../ui.ts';
import { ageOf, streetOf } from './requests.ts';

type Dashboard = Awaited<ReturnType<PropertyManagerActions['dashboard']>>;
type TicketSummary = Dashboard['tickets'][number];
type Filter = 'mine' | 'all';
type Stage = 'quoting' | 'awaiting_owner' | 'approved' | 'scheduled' | 'done';

/** The board's lanes in workflow order. Each lane's key is the Job status that puts a Ticket in it. */
const STAGES: [Stage, string][] = [
  ['quoting', 'Quoting'],
  ['awaiting_owner', 'With Property Owner'],
  ['approved', 'Ready to book'],
  ['scheduled', 'Booked'],
  ['done', 'Done'],
];

/** Tickets under /tickets. */
export function ticketListPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const filter: Filter = c.req.query('filter') === 'all' ? 'all' : 'mine';
    const byStage = c.req.query('view') === 'stage';
    const view = await actions.dashboard({ filter });
    const { timeZone } = actions.agency();
    const now = actions.now();
    const href = (f: Filter, stage: boolean) => {
      const params = [...(f === 'all' ? ['filter=all'] : []), ...(stage ? ['view=stage'] : [])];
      return `/tickets${params.length ? `?${params.join('&')}` : ''}`;
    };
    return c.html(
      page({
        title: 'Tickets',
        pm,
        active: 'tickets',
        flash: flashFrom(c.req.url),
        shell: await shellInfo(c),
        controls: segmented([
          { label: 'Mine', href: href('mine', byStage), active: filter === 'mine' },
          { label: 'All', href: href('all', byStage), active: filter === 'all' },
        ]),
        body: html`
          <div class="flex flex-wrap items-center justify-between gap-2">
            ${segmented([
              { label: 'List', href: href(filter, false), active: !byStage },
              { label: 'By stage', href: href(filter, true), active: byStage },
            ])}
          </div>
          ${byStage
            ? section({ title: 'Tickets by stage', id: 'tickets-by-stage', body: board(await boardOf(actions, view.tickets), now, filter) })
            : section({ title: 'Open Tickets', id: 'open-tickets', body: ticketsTable(view.tickets, filter, timeZone) })}
        `,
      }),
    );
  });

  return pages;
}

function ticketsTable(tickets: TicketSummary[], filter: Filter, timeZone: string): Html {
  if (!tickets.length) {
    return emptyState(filter === 'mine' ? 'No open Tickets on your Properties. Confirmed Maintenance Requests appear here.' : 'No open Tickets. Confirmed Maintenance Requests appear here.');
  }
  const headers = ['Property', ...(filter === 'all' ? ['Property Manager'] : []), 'Issue', 'Urgency', 'Jobs', 'Unread', 'Reported'];
  return table(
    headers,
    tickets.map((t) => [
      html`<a class="link font-medium" href="/tickets/${t.ticketId}">${t.propertyAddress}</a>`,
      ...(filter === 'all' ? [html`${t.propertyManager}`] : []),
      html`${t.description}`,
      html`${urgencyBadge(t.urgency)} ${t.checkUrgency ? badge('Check urgency', 'warning') : ''}`,
      html`${t.jobs.map((j) => html`<span class="whitespace-nowrap">${humanise(j.trade)} ${statusBadge(j.status)}</span> `)}`,
      html`${t.unreadMessages ? badge(`${t.unreadMessages} unread`, 'info') : '0'}`,
      html`${formatWhen(t.reportedAt, timeZone)}`,
    ]),
    { caption: 'Open Tickets, most urgent and oldest first' },
  );
}

/** A Ticket with the facts its docket shows: its lane, its Trades and its Quote count. */
type BoardTicket = TicketSummary & { stage: Stage; trades: string[]; quotes: number };

function boardOf(actions: PropertyManagerActions, tickets: TicketSummary[]): Promise<BoardTicket[]> {
  return Promise.all(
    tickets.map(async (t) => ({
      ...t,
      stage: stageOf(t.jobs),
      trades: [...new Set(t.jobs.filter((j) => j.status !== 'cancelled').map((j) => j.trade))],
      quotes: (await actions.ticket(t.ticketId)).jobs.reduce((n, j) => n + j.quotes.length, 0),
    })),
  );
}

/**
 * The lane of a Ticket: its least advanced open Job (quoting < awaiting_owner <
 * approved < scheduled < done). Cancelled Jobs are ignored, and a Ticket whose Jobs
 * are all done or cancelled is Done.
 */
export function stageOf(jobs: { status: string }[]): Stage {
  const open = jobs.map((j) => STAGES.findIndex(([stage]) => stage === j.status)).filter((i) => i >= 0 && STAGES[i]![0] !== 'done');
  if (open.length) return STAGES[Math.min(...open)]![0];
  return jobs.length ? 'done' : 'quoting';
}

function board(tickets: BoardTicket[], now: Date, filter: Filter): Html {
  if (!tickets.length) {
    return emptyState(filter === 'mine' ? 'No open Tickets on your Properties. Confirmed Maintenance Requests appear here.' : 'No open Tickets. Confirmed Maintenance Requests appear here.');
  }
  return html`<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
    ${STAGES.map(([stage, title]) => {
      const inLane = tickets.filter((t) => t.stage === stage);
      return lane({
        title,
        count: inLane.length,
        body: inLane.length ? html`<div class="grid gap-2">${inLane.map((t) => ticketDocket(t, now))}</div>` : html`<p class="text-sm text-muted">Nothing at this stage.</p>`,
      });
    })}
  </div>`;
}

function ticketDocket(t: BoardTicket, now: Date): Html {
  return docket({
    number: t.ticketId,
    href: `/tickets/${t.ticketId}`,
    urgency: t.urgency,
    address: streetOf(t.propertyAddress),
    issue: t.description,
    meta: [
      ...t.trades.map((trade) => html`${humanise(trade)}`),
      ...(t.quotes ? [html`${t.quotes} ${t.quotes === 1 ? 'Quote' : 'Quotes'}`] : []),
      html`${ageOf(t.reportedAt, now)}`,
    ],
    unread: t.unreadMessages,
  });
}
