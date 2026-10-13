// Approvals: where a Property Manager moves Quotes and Work Orders on. Four groups:
// Jobs ready for a Work Order, Jobs waiting on the Property Owner, Jobs still
// collecting Quotes, and Tradies to rate.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { emptyState, flashFrom, formatAge, humanise, linkButton, page, section, segmented, table, urgencyBadge, type Html } from '../ui.ts';

type View = Awaited<ReturnType<PropertyManagerActions['dashboard']>>;
type TicketRow = View['tickets'][number];
type Alert = View['alerts'][number];

/** Approvals under /approvals. */
export function approvalPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const filter = c.req.query('filter') === 'all' ? 'all' : 'mine';
    const view = await actions.dashboard({ filter });
    const now = actions.now();

    const jobs = view.tickets.flatMap((t) => t.jobs.map((j) => ({ ticket: t, ...j })));
    const ofStatus = (status: string) => jobs.filter((j) => j.status === status);
    const alertFor = <K extends Alert['kind']>(kind: K, jobId: number) =>
      view.alerts.find((a): a is Extract<Alert, { kind: K }> => a.kind === kind && a.jobId === jobId);
    const ticketOf = (id: number) => view.tickets.find((t) => t.ticketId === id);

    const ready = ofStatus('approved');
    const waiting = ofStatus('awaiting_owner');
    const quoting = ofStatus('quoting');
    const ratings = view.alerts.filter((a): a is Extract<Alert, { kind: 'rating_due' }> => a.kind === 'rating_due');

    const groups: Html[] = [];
    if (ready.length)
      groups.push(
        section({
          title: 'Ready for a Work Order',
          body: table(['Property', 'Issue', 'Trade', 'Urgency', 'Reported', ''], ready.map((j) => [...ticketCells(j.ticket, j.trade, now), open(j.ticket.ticketId, 'Send Work Order')]), { caption: 'Jobs ready for a Work Order' }),
        }),
      );
    if (waiting.length)
      groups.push(
        section({
          title: 'Waiting on the Property Owner',
          body: table(
            ['Property', 'Issue', 'Trade', 'Urgency', 'Reported', 'Property Owner', ''],
            waiting.map((j) => {
              const silent = alertFor('owner_no_reply', j.jobId);
              return [
                ...ticketCells(j.ticket, j.trade, now),
                silent
                  ? html`<span class="block font-semibold">No reply</span><span class="block">${silent.ownerName}</span><span class="num block text-muted">${silent.ownerPhone}</span>`
                  : html`<span class="text-muted">Asked</span>`,
                open(j.ticket.ticketId, 'View Ticket'),
              ];
            }),
            { caption: 'Jobs waiting on the Property Owner' },
          ),
        }),
      );
    if (quoting.length)
      groups.push(
        section({
          title: 'Collecting Quotes',
          body: table(
            ['Property', 'Issue', 'Trade', 'Urgency', 'Reported', 'Quotes', ''],
            quoting.map((j) => {
              const short = alertFor('invite_more_tradies', j.jobId);
              return [
                ...ticketCells(j.ticket, j.trade, now),
                short ? html`<span class="font-semibold">${short.confirmedQuotes} of 3 Quotes in</span>` : html`<span class="text-muted">Waiting on Quotes</span>`,
                open(j.ticket.ticketId, 'View Quotes'),
              ];
            }),
            { caption: 'Jobs collecting Quotes' },
          ),
        }),
      );
    if (ratings.length)
      groups.push(
        section({
          title: 'Rate the Tradie',
          body: table(
            ['Property', 'Issue', 'Tradie', ''],
            ratings.map((a) => {
              const t = ticketOf(a.ticketId);
              return [
                html`<a class="link" href="/tickets/${a.ticketId}">${a.propertyAddress}</a>`,
                t ? html`${t.description}` : html`<span class="text-muted">Completed Job</span>`,
                html`${a.businessName}`,
                open(a.ticketId, 'Rate'),
              ];
            }),
            { caption: 'Tradies to rate' },
          ),
        }),
      );

    return c.html(
      page({
        title: 'Approvals',
        pm,
        active: 'approvals',
        shell: await shellInfo(c),
        flash: flashFrom(c.req.url),
        controls: segmented([
          { label: 'Mine', href: '/approvals', active: filter === 'mine' },
          { label: 'All', href: '/approvals?filter=all', active: filter === 'all' },
        ]),
        body: groups.length
          ? html`<div class="grid gap-4">${groups}</div>`
          : emptyState('Nothing needs approving. Jobs ready for a Work Order, waiting on a Property Owner or short of Quotes will appear here.'),
      }),
    );
  });

  return pages;
}

/** Property (linked to the Ticket), issue, Trade, Urgency and age: the first five cells of every row. */
function ticketCells(t: TicketRow, trade: string, now: Date): Html[] {
  return [
    html`<a class="link" href="/tickets/${t.ticketId}">${t.propertyAddress}</a>`,
    html`${t.description}`,
    html`${humanise(trade)}`,
    urgencyBadge(t.urgency),
    html`<span class="whitespace-nowrap">${formatAge(t.reportedAt, now)}</span>`,
  ];
}

/** The row's next step, which happens on the Ticket. */
function open(ticketId: number, label: string): Html {
  return html`<span class="whitespace-nowrap">${linkButton(label, `/tickets/${ticketId}`, { size: 'sm' })}</span>`;
}
