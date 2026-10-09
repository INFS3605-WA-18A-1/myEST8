// The Property Manager's dispatch board: Maintenance Requests to decide, alerts and
// the inbox, Tickets by stage, this week's bookings, then Urgent Repairs, the inbox
// detail and every open Ticket. Also the actions on each, and /files/:id for photos.
// Controls repeated per item get the item's id in their element id ("reason-12"),
// so every label on the page points at its own control.

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError, URGENCIES, type Role, type Urgency } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { formAction, text } from '../forms.ts';
import { shellInfo } from '../shell.ts';
import {
  badge,
  button,
  card,
  countStrip,
  dl,
  docket,
  emptyState,
  field,
  flashFrom,
  formatWhen,
  humanise,
  lane,
  linkButton,
  page,
  postButton,
  queueRow,
  section,
  segmented,
  table,
  urgencyBadge,
  statusBadge,
  type Html,
  type Tone,
} from '../ui.ts';
import { bookingList, bookingTrades, type Booking } from './calendar.ts';
import { finishSetupBanner } from './welcome.ts';

type Dashboard = ReturnType<PropertyManagerActions['dashboard']>;
type MaintenanceRequest = Dashboard['maintenanceRequests'][number];
type TicketSummary = Dashboard['tickets'][number];
type UrgentRepair = Dashboard['urgentRepairs'][number];
type InboxItem = Dashboard['inbox'][number];
type Alert = Dashboard['alerts'][number];
type Person = ReturnType<PropertyManagerActions['people']>[number];
type Filter = 'mine' | 'all';
type Stage = 'quoting' | 'awaiting_owner' | 'approved' | 'scheduled' | 'done';

/** Role names as the Agency says them. */
export const ROLE_LABEL: Record<Role, string> = {
  tenant: 'Tenant',
  owner: 'Property Owner',
  tradie: 'Tradie',
  building_manager: 'Building Manager',
};

const INBOX_REASON: Record<InboxItem['reason'], [string, Tone]> = {
  unknown_sender: ['Unknown sender', 'warning'],
  other: ['Not maintenance', 'neutral'],
  low_confidence: ['Agent unsure', 'info'],
  common_area_no_building_manager: ['Common Area with no Building Manager', 'warning'],
};

/** Why the metadata check flagged a photo, in words. */
export const PHOTO_FLAG: Record<string, string> = {
  taken_before_tenancy: 'taken before the tenancy',
  taken_long_before_report: 'taken over 14 days before the report',
  far_from_property: 'taken far from the Property',
};

const URGENT_REPAIR_STATUS: Record<UrgentRepair['status'], [string, Tone]> = {
  reminder_sent: ['Waiting for receipt', 'warning'],
  receipt_received: ['Receipt received', 'info'],
  receipt_forwarded: ['Receipt sent to Property Owner', 'success'],
};

const GUESS_LABEL: Record<string, string> = {
  messageClass: 'Kind of message',
  relatedItem: 'Related to',
  updateType: 'Update',
  replyType: 'Reply',
  urgency: 'Urgency',
  trade: 'Trade',
};

/**
 * Page-local layout for the narrow lanes: each docket stacks its stub above its body
 * with a horizontal perforation, and the lane padding tightens. Arrays of token
 * classes only; the components' own CSS is untouched.
 */
const BOARD_CLASS = [
  '[&_.lane-body]:!p-2',
  '[&_.docket]:!flex-col',
  '[&_.docket-stub]:!flex-none',
  '[&_.docket-stub]:!flex-row',
  '[&_.docket-stub]:!justify-start',
  '[&_.docket-stub]:!gap-2',
  '[&_.docket-stub]:!px-2',
  '[&_.docket-stub]:!py-1',
  '[&_.docket-perf]:!mx-2',
  '[&_.docket-perf]:!my-0',
  '[&_.docket-perf]:!border-l-0',
  '[&_.docket-perf]:!border-t',
  '[&_.docket-perf]:!border-dashed',
  '[&_.docket-perf]:!border-control',
  '[&_.docket-body]:!p-2',
].join(' ');

/** The board's lanes in workflow order. Each lane's key is the Job status that puts a Ticket in it. */
const STAGES: [Stage, string][] = [
  ['quoting', 'Quoting'],
  ['awaiting_owner', 'With Property Owner'],
  ['approved', 'Ready to book'],
  ['scheduled', 'Booked'],
  ['done', 'Done'],
];

/** File types safe to show in the browser. Anything else (HTML, SVG...) downloads instead. */
const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);

/** The dashboard at /: the dispatch board, Urgent Repairs, the inbox and their actions; and /files/:id for photos. */
export function dashboardPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', (c) => {
    const { actions, pm } = c.var;
    const filter = filterOf(c);
    const view = actions.dashboard({ filter });
    const { timeZone } = actions.agency();
    const now = actions.now();
    const people = view.inbox.some((item) => item.personId === null) ? actions.people() : [];
    const trades = bookingTrades(actions, view.calendar, view.tickets.flatMap((t) => t.jobs));
    const q = filter === 'all' ? '?filter=all' : '';
    const needReceipt = view.urgentRepairs.filter((u) => u.status === 'reminder_sent').length;
    const board = boardOf(actions, view.tickets);

    return c.html(
      page({
        title: 'Dashboard',
        pm,
        active: 'dashboard',
        flash: flashFrom(c.req.url),
        shell: shellInfo(c),
        controls: segmented([
          { label: 'Mine', href: '/', active: filter === 'mine' },
          { label: 'All', href: '/?filter=all', active: filter === 'all' },
        ]),
        body: html`
          ${finishSetupBanner(actions)}
          ${countStrip([
            { label: 'Maintenance Requests to review', count: view.maintenanceRequests.length, href: '#requests', decision: true },
            { label: 'Open Tickets', count: view.tickets.length, href: '#tickets' },
            { label: 'Alerts', count: view.alerts.length, href: '#alerts', decision: true },
            { label: 'In the inbox', count: view.inbox.length, href: '#inbox', decision: true },
            { label: 'Urgent Repairs needing a receipt', count: needReceipt, href: '#urgent-repairs' },
          ])}
          <div class="dispatch grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
            ${decisions(view, q, timeZone, now)}
            <div class="grid min-w-0 gap-4">
              ${ticketsByStage(board, now)}
              ${thisWeek(view.calendar, now, timeZone)}
            </div>
          </div>
          ${section({ title: 'Urgent Repairs', id: 'urgent-repairs', actions: countBadge(view.urgentRepairs.length), body: urgentRepairsTable(view.urgentRepairs, timeZone) })}
          ${section({ title: 'Inbox', id: 'inbox', actions: countBadge(view.inbox.length), body: inboxList(view.inbox, people, timeZone, q) })}
          ${section({ title: 'All open Tickets', id: 'open-tickets', actions: countBadge(view.tickets.length), body: ticketsTable(view.tickets, filter, timeZone) })}
          ${section({
            title: 'Coming up',
            id: 'coming-up',
            actions: countBadge(view.calendar.length),
            body: html`${bookingList(view.calendar, timeZone, trades, 'Nothing booked in the next 14 days.')}
              <p class="mt-2">${linkButton('Open the calendar', '/calendar', { size: 'sm' })}</p>`,
          })}
        `,
      }),
    );
  });

  pages.post('/requests/:issueId{[0-9]+}/confirm', (c) =>
    formAction(c, back(c), async () => {
      const ticketId = await c.var.actions.confirmMaintenanceRequest(idParam(c, 'issueId'));
      return { ok: 'Confirmed. The Ticket is open and the Tenant has been told.', redirect: `/tickets/${ticketId}` };
    }),
  );

  pages.post('/requests/:issueId{[0-9]+}/reject', (c) =>
    formAction(c, back(c), async (form) => {
      const issueId = idParam(c, 'issueId');
      await c.var.actions.rejectMaintenanceRequest(issueId, text(form, 'reason'));
      return { ok: 'Rejected. The Tenant has been told why.' };
    }),
  );

  pages.post('/requests/:issueId{[0-9]+}/urgency', (c) =>
    formAction(c, back(c), async (form) => {
      const issueId = idParam(c, 'issueId');
      const urgency = text(form, 'urgency') as Urgency;
      await c.var.actions.changeUrgency({ issueId }, urgency);
      return {
        ok:
          urgency === 'urgent'
            ? 'Now an Urgent Repair. The Tenant has been reminded to arrange it with a Nominated Tradie.'
            : `Urgency changed to ${humanise(urgency)}`,
      };
    }),
  );

  pages.post('/inbox/:itemId{[0-9]+}/link', (c) =>
    formAction(c, back(c), (form) => {
      const personId = text(form, 'personId');
      if (!personId) throw new ActionError('invalid', 'Choose who sent this message');
      c.var.actions.linkSender(idParam(c, 'itemId'), Number(personId));
      return { ok: 'Sender linked. Their next message will be recognised.' };
    }),
  );

  pages.post('/inbox/:itemId{[0-9]+}/route', (c) =>
    formAction(c, back(c), async () => {
      await c.var.actions.routeInboxItem(idParam(c, 'itemId'));
      return { ok: 'Message routed with the best guess' };
    }),
  );

  pages.post('/inbox/:itemId{[0-9]+}/dismiss', (c) =>
    formAction(c, back(c), () => {
      c.var.actions.dismissInboxItem(idParam(c, 'itemId'));
      return { ok: 'Message dismissed' };
    }),
  );

  pages.get('/files/:id{[0-9]+}', (c) => {
    const file = c.var.actions.file(idParam(c, 'id'));
    if (!file) return c.notFound();
    const inline = INLINE_TYPES.has(file.contentType.toLowerCase());
    return c.body(new Uint8Array(file.content), 200, {
      'content-type': inline ? file.contentType : 'application/octet-stream',
      'content-disposition': inline ? 'inline' : `attachment; filename="${file.filename.replace(/[^\w.-]/g, '_')}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=3600',
    });
  });

  return pages;
}

function filterOf(c: Context<WebEnv>): Filter {
  return c.req.query('filter') === 'all' ? 'all' : 'mine';
}

/** Back to the dashboard, keeping "mine" or "all". */
function back(c: Context<WebEnv>) {
  return filterOf(c) === 'all' ? '/?filter=all' : '/';
}

function idParam(c: Context<WebEnv>, name: string) {
  return Number(c.req.param(name));
}

function countBadge(count: number) {
  return count ? badge(String(count)) : undefined;
}

// Needs your decision

/** Maintenance Requests (oldest first), then alerts, then inbox items: the decisions, each with its actions. */
function decisions(view: Dashboard, q: string, timeZone: string, now: Date): Html {
  const requests = [...view.maintenanceRequests].sort((a, b) => a.reportedAt.localeCompare(b.reportedAt));
  return section({
    title: 'Needs your decision',
    id: 'decisions',
    body: html`<div class="grid gap-4 [&_.queue-detail]:truncate [&_.queue-row]:!py-1.5">
      <div id="requests" class="grid gap-2">
        <h3 class="text-sm font-semibold">Maintenance Requests to review</h3>
        ${requests.length ? requests.map((r) => requestRow(r, q, now)) : emptyState('No Maintenance Requests waiting for you.')}
      </div>
      <div id="alerts" class="grid gap-2">
        <h3 class="text-sm font-semibold">Alerts</h3>
        ${view.alerts.length ? view.alerts.map((a) => alertRow(a, timeZone)) : emptyState('No alerts.')}
      </div>
      ${view.inbox.length
        ? html`<div class="grid gap-2">
            <h3 class="text-sm font-semibold">In the inbox</h3>
            ${view.inbox.map((item) => inboxRow(item, timeZone))}
          </div>`
        : ''}
    </div>`,
  });
}

function requestRow(r: MaintenanceRequest, q: string, now: Date): Html {
  const [first] = r.photos;
  const flagged = r.photos.some((p) => p.metadata !== 'ok' && p.metadata !== 'no_metadata');
  const thumb = first
    ? html`<img src="/files/${first.fileId}" alt="Photo of ${r.propertyAddress}" width="56" height="56" loading="lazy" class="object-cover" />`
    : html`<span class="flex size-14 items-center justify-center rounded border border-line bg-page text-center text-xs text-muted">No photos</span>`;
  const badges = [
    urgencyBadge(r.urgency),
    badge(humanise(r.trade)),
    ...(r.checkUrgency ? [badge('Check urgency', 'warning')] : []),
    ...(r.checkTrade ? [badge('Check trade', 'warning')] : []),
    ...(flagged ? [badge('Flagged photos', 'warning')] : []),
    ...(r.noPhotos ? [badge('No photos', 'warning')] : []),
  ];
  return queueRow({
    thumb,
    title: r.propertyAddress,
    detail: r.description,
    badges,
    meta: ageOf(r.reportedAt, now),
    actions: html`${postButton(`/requests/${r.issueId}/confirm${q}`, 'Confirm', { size: 'sm' })}
      ${linkButton('Review', `/requests/${r.issueId}`, { variant: 'secondary', size: 'sm' })}`,
  });
}

/** Each alert keeps its wording and links to its Ticket. */
function alertRow(alert: Alert, timeZone: string): Html {
  const ticketHref = `/tickets/${alert.ticketId}`;
  switch (alert.kind) {
    case 'invite_more_tradies':
      return queueRow({
        href: ticketHref,
        title: alert.propertyAddress,
        detail: `Only ${alert.confirmedQuotes} confirmed ${alert.confirmedQuotes === 1 ? 'Quote' : 'Quotes'} for the Job after 72 hours.`,
        badges: [badge('Quotes', 'warning')],
      });
    case 'owner_no_reply':
      return queueRow({
        href: ticketHref,
        title: alert.propertyAddress,
        detail: `${alert.ownerName}, the Property Owner, hasn't replied since ${formatWhen(alert.requestedAt, timeZone)}.`,
        badges: [badge('Approval', 'warning')],
        actions: alert.ownerPhone
          ? html`Call <a class="link" href="tel:${alert.ownerPhone}">${alert.ownerPhone}</a>`
          : html`No phone number on file.`,
      });
    case 'rating_due':
      return queueRow({
        href: ticketHref,
        title: alert.propertyAddress,
        detail: `${alert.businessName} finished the Job. Rate the Tradie.`,
        badges: [badge('Rating', 'info')],
      });
  }
}

function inboxRow(item: InboxItem, timeZone: string): Html {
  const [reason, tone] = INBOX_REASON[item.reason];
  return queueRow({
    href: '#inbox',
    title: item.personName ?? item.from,
    detail: item.text,
    badges: [badge(reason, tone)],
    meta: formatWhen(item.receivedAt, timeZone),
  });
}

// Tickets by stage

/** A Ticket with the facts its docket shows: its lane, its Trades and its Quote count. */
type BoardTicket = TicketSummary & { stage: Stage; trades: string[]; quotes: number };

function boardOf(actions: PropertyManagerActions, tickets: TicketSummary[]): BoardTicket[] {
  return tickets.map((t) => ({
    ...t,
    stage: stageOf(t.jobs),
    trades: [...new Set(t.jobs.filter((j) => j.status !== 'cancelled').map((j) => j.trade))],
    quotes: actions.ticket(t.ticketId).jobs.reduce((n, j) => n + j.quotes.length, 0),
  }));
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

function ticketsByStage(tickets: BoardTicket[], now: Date): Html {
  return section({
    title: 'Tickets by stage',
    id: 'tickets',
    body: html`<div class="${BOARD_CLASS} grid gap-2 lg:grid-cols-5">
      ${STAGES.map(([stage, title]) => {
        const inLane = tickets.filter((t) => t.stage === stage);
        return lane({
          title,
          count: inLane.length,
          body: inLane.length
            ? html`<div class="grid gap-2">${inLane.map((t) => ticketDocket(t, now))}</div>`
            : html`<p class="text-sm text-muted">Nothing at this stage.</p>`,
        });
      })}
    </div>`,
  });
}

function ticketDocket(t: BoardTicket, now: Date): Html {
  return docket({
    number: t.ticketId,
    href: `/tickets/${t.ticketId}`,
    urgency: t.urgency,
    address: t.propertyAddress,
    issue: t.description,
    meta: [
      ...t.trades.map((trade) => html`${humanise(trade)}`),
      ...(t.quotes ? [html`${t.quotes} ${t.quotes === 1 ? 'Quote' : 'Quotes'}`] : []),
      html`${ageOf(t.reportedAt, now)}`,
    ],
    unread: t.unreadMessages,
  });
}

// This week

const MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The seven days (Monday to Sunday) of the week containing today, in the Agency's time zone, with the bookings on each. */
function thisWeek(bookings: Booking[], now: Date, timeZone: string): Html {
  const today = dayKey(now, timeZone);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now);
  const monday = addDays(today, -MON_FIRST.indexOf(weekday));
  const byDay = new Map<string, Booking[]>();
  for (const b of bookings) {
    const day = dayKey(new Date(b.start), timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  return section({
    title: 'This week',
    id: 'this-week',
    actions: linkButton('Open calendar', '/calendar', { variant: 'ghost', size: 'sm' }),
    body: html`<ol class="grid gap-2 lg:grid-cols-7">
      ${days.map((day) => weekDay(day, byDay.get(day) ?? [], day === today, timeZone))}
    </ol>`,
  });
}

function weekDay(day: string, bookings: Booking[], isToday: boolean, timeZone: string): Html {
  const label = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric' }).format(new Date(`${day}T00:00:00Z`));
  return html`<li class="min-w-0 rounded border bg-surface p-2 ${isToday ? 'border-2 border-action' : 'border-line'}" ${isToday ? html`aria-current="date"` : ''}>
    <p class="text-sm font-semibold"><time datetime="${day}">${label}</time></p>
    ${isToday ? html`<p class="text-xs text-action">Today</p>` : ''}
    ${bookings.length
      ? html`<ul class="mt-1 grid gap-1.5">${bookings.map((b) => weekBlock(b, timeZone))}</ul>`
      : html`<p class="mt-1 text-xs text-muted">No visits</p>`}
  </li>`;
}

/** One booking as a compact block: its time, the Tradie, and the Property linking to its Ticket. */
function weekBlock(b: Booking, timeZone: string): Html {
  const time = new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(b.start));
  return html`<li class="rounded bg-page p-1.5 text-xs">
    <p class="num font-semibold"><time datetime="${b.start}">${time}</time></p>
    <p><a class="link" href="/tradies/${b.tradieId}">${b.businessName}</a></p>
    <p><a class="link" href="/tickets/${b.ticketId}">${b.propertyAddress.split(',')[0]}</a></p>
  </li>`;
}

/** The calendar day ("2026-10-12") that an instant falls on in the time zone. */
function dayKey(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

function addDays(day: string, days: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "2 days ago", "5 hours ago": how long a request has waited. */
function ageOf(iso: string, now: Date) {
  const hours = Math.floor((now.getTime() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

// Tickets and Urgent Repairs

function ticketsTable(tickets: TicketSummary[], filter: Filter, timeZone: string): Html {
  if (!tickets.length) return emptyState(filter === 'mine' ? 'No open Tickets on your Properties.' : 'No open Tickets.');
  const headers = ['Property', ...(filter === 'all' ? ['Property Manager'] : []), 'Issue', 'Urgency', 'Jobs', 'Unread', 'Reported'];
  return table(
    headers,
    tickets.map((t) => [
      html`<a class="link font-medium" href="/tickets/${t.ticketId}">${t.propertyAddress}</a>`,
      ...(filter === 'all' ? [html`${t.propertyManager}`] : []),
      html`${t.description}`,
      html`${urgencyBadge(t.urgency)} ${t.checkUrgency ? badge('Check Urgency', 'warning') : ''}`,
      html`${t.jobs.map((j) => html`<span class="whitespace-nowrap">${humanise(j.trade)} ${statusBadge(j.status)}</span> `)}`,
      html`${t.unreadMessages ? badge(`${t.unreadMessages} unread`, 'info') : '0'}`,
      html`${formatWhen(t.reportedAt, timeZone)}`,
    ]),
    { caption: 'Open Tickets, most urgent and oldest first' },
  );
}

function urgentRepairsTable(repairs: UrgentRepair[], timeZone: string): Html {
  if (!repairs.length) return emptyState('No Urgent Repairs reported.');
  return table(
    ['Property', 'Tenant', 'Issue', 'Status', 'Receipts', 'Reported'],
    repairs.map((u) => {
      const [label, tone] = URGENT_REPAIR_STATUS[u.status];
      return [
        html`${u.propertyAddress}`,
        html`${u.tenantName}`,
        html`${u.description}`,
        badge(label, tone),
        html`${u.receipts}`,
        html`${formatWhen(u.reportedAt, timeZone)}`,
      ];
    }),
    { caption: 'Urgent Repairs' },
  );
}

// Inbox

function inboxList(items: InboxItem[], people: Person[], timeZone: string, q: string): Html {
  if (!items.length) return emptyState('The inbox is empty.');
  return html`<div class="grid gap-4">${items.map((item) => inboxItem(item, people, timeZone, q))}</div>`;
}

function inboxItem(item: InboxItem, people: Person[], timeZone: string, q: string): Html {
  const [reason, tone] = INBOX_REASON[item.reason];
  const base = `/inbox/${item.itemId}`;
  return card({
    title: item.personName ?? item.from,
    actions: badge(reason, tone),
    body: html`
      <p class="flex flex-wrap gap-x-3 text-sm opacity-70">
        ${item.personName ? html`<span>${item.from}</span>` : ''}<span>${formatWhen(item.receivedAt, timeZone)}</span>
      </p>
      <blockquote class="border-l-4 pl-3 my-2 whitespace-pre-line">${item.text}</blockquote>
      ${item.bestGuess && Object.keys(item.bestGuess).length
        ? html`<h3 class="font-semibold mt-2">Best guess</h3>
            ${dl(Object.entries(item.bestGuess).map(([question, answer]) => [guessLabel(question), guessAnswer(answer)]))}`
        : ''}
      <div class="flex flex-wrap items-end gap-3 mt-3">
        ${item.personId === null
          ? html`<form method="post" action="${base}/link${q}">
              ${field({
                label: 'Link sender to',
                name: 'personId',
                id: `person-${item.itemId}`,
                type: 'select',
                required: true,
                placeholder: 'Choose a person',
                options: people.map((p) => ({ value: String(p.id), label: personLabel(p) })),
                hint: 'Their next message from this address will be recognised.',
              })}
              ${button('Link sender', { size: 'sm' })}
            </form>`
          : item.reason === 'low_confidence' && item.bestGuess
            ? postButton(`${base}/route${q}`, 'Route with best guess', { size: 'sm' })
            : ''}
        ${postButton(`${base}/dismiss${q}`, 'Dismiss', { variant: 'ghost', size: 'sm' })}
      </div>
    `,
  });
}

function personLabel(p: Person) {
  return `${p.businessName ?? p.name} (${ROLE_LABEL[p.role]})`;
}

function guessLabel(question: string) {
  return GUESS_LABEL[question] ?? humanise(question.replace(/([a-z])([A-Z])/g, '$1 $2').replace(':', ': ').toLowerCase());
}

function guessAnswer(answer: string) {
  if (answer === 'none') return 'Nothing open';
  const ref = /^([a-z_]+):(\d+)$/.exec(answer);
  return ref ? `${humanise(ref[1]!)} ${ref[2]}` : humanise(answer);
}
