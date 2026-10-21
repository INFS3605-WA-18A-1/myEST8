// The Property Manager's dispatch board. What needs attention comes first (Maintenance
// Requests, the Tickets waiting on a Quote decision and alerts, then the inbox with its
// actions); beside it from 1024px sit Urgent Repairs, the next 7 days and Tickets by stage.
// Also the actions on each, and /files/:id for photos.
// Controls repeated per item get the item's id in their element id ("reason-12"),
// so every label on the page points at its own control.

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError, type Urgency } from '../../shared.ts';
import { STAGES, type Stage } from '../../views.ts';
import { addDays, dayOf, parseDay } from '../../zoned-time.ts';
import type { WebEnv } from '../env.ts';
import { formAction, text, type FormValues } from '../forms.ts';
import { requestFlags } from '../request-checks.ts';
import { COLLEAGUES_ONLY, shareButton, shareUrl } from '../share.ts';
import { shellInfo } from '../shell.ts';
import {
  badge,
  button,
  clip,
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
  ROLE_LABEL,
  rowLink,
  section,
  segmented,
  urgencyBadge,
  type Html,
  type Tone,
} from '../ui.ts';
import { longDay, streetOf, ticketHref, visitKind, type Booking } from '../bookings.ts';
import { streamOf } from '../stream.ts';

/** Kept for the pages that still import it from here; the words live with the other request checks. */
import { reimbursementBadge } from './reimbursement.ts';

export { PHOTO_FLAG } from '../request-checks.ts';

type Dashboard = Awaited<ReturnType<PropertyManagerActions['dashboard']>>;
type MaintenanceRequest = Dashboard['maintenanceRequests'][number];
type BoardTicket = Dashboard['tickets'][number];
type UrgentRepair = Dashboard['urgentRepairs'][number];
type InboxItem = Dashboard['inbox'][number];
type Alert = Dashboard['alerts'][number];
type Person = Awaited<ReturnType<PropertyManagerActions['people']>>[number];
type Filter = 'mine' | 'all';

const INBOX_REASON: Record<InboxItem['reason'], [string, Tone]> = {
  unknown_sender: ['Unknown sender', 'warning'],
  other: ['Not maintenance', 'neutral'],
  low_confidence: ['Agent unsure', 'info'],
  common_area_no_building_manager: ['Common Area with no Building Manager', 'warning'],
};

const GUESS_LABEL: Record<string, string> = {
  messageClass: 'Kind of message',
  relatedItem: 'Related to',
  updateType: 'Update',
  replyType: 'Reply',
  urgency: 'Urgency',
  trade: 'Trade',
};

/** The kind of message the agent guessed, as the one-line best guess starts it. */
const MESSAGE_CLASS: Record<string, string> = {
  new_issue: 'New issue',
  update: 'Update',
  common_area: 'Common Area issue',
  other: 'Not maintenance',
};

/** The board's lanes, named as the Property Manager says them. */
const STAGE_TITLE: Record<Stage, string> = {
  quoting: 'Quoting',
  awaiting_owner: 'With Property Owner',
  approved: 'Ready to book',
  scheduled: 'Booked',
  done: 'Done',
};

/** Where a Maintenance Request's action may send the Property Manager back to: the Tickets list, or one request's review (/requests itself sends on to Tickets). */
const REQUEST_RETURN = /^\/(tickets|requests(\/\d+)?)$/;

/** File types safe to show in the browser. Anything else (HTML, SVG...) downloads instead. */
const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);

/** The dashboard at /: the dispatch board, the inbox, Urgent Repairs and their actions; and /files/:id for photos. */
export function dashboardPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const filter = filterOf(c);
    const view = await actions.dashboard({ filter });
    const { timeZone } = actions.agency();
    const now = actions.now();
    const people = view.inbox.some((item) => item.personId === null) ? await actions.people() : [];
    const q = filter === 'all' ? '?filter=all' : '';
    const needReceipt = view.urgentRepairs.filter((u) => u.status === 'reminder_sent').length;
    const decided = {
      toCheck: view.tickets.filter((t) => t.decision === 'check_quotes'),
      toBook: view.tickets.filter((t) => t.decision === 'book_inspection'),
      toChoose: view.tickets.filter((t) => t.decision === 'choose_quote'),
    };
    const waiting = decided.toCheck.length + decided.toBook.length + decided.toChoose.length;

    return c.html(
      page({
        title: 'Dashboard',
        pm,
        active: 'dashboard',
        flash: flashFrom(c.req.url),
        shell: await shellInfo(c),
        controls: segmented([
          { label: 'Mine', href: '/', active: filter === 'mine' },
          { label: 'All', href: '/?filter=all', active: filter === 'all' },
        ]),
        body: html`
          ${countStrip([
            { label: 'Maintenance Requests to confirm', count: view.maintenanceRequests.length, href: '#requests', decision: true, tone: 'attention' },
            { label: 'Tickets waiting on you', count: waiting, href: firstGroup(decided), decision: true, tone: 'attention' },
            { label: 'Open Tickets', count: view.tickets.length, href: '#tickets' },
            { label: 'Alerts', count: view.alerts.length, href: '#alerts', decision: true, tone: 'attention' },
            { label: 'In the inbox', count: view.inbox.length, href: '#inbox', decision: true, tone: 'attention' },
            { label: 'Urgent Repairs needing a receipt', count: needReceipt, href: '#urgent-repairs', tone: 'urgent' },
          ])}
          <div class="dashboard-desk grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
            <div class="dashboard-main grid min-w-0 gap-4">
              ${decisions({ view, ...decided, q, timeZone, now, shareLink: shareUrl(c, '/?filter=all#requests') })}
              ${section({ title: 'Inbox', id: 'inbox', actions: countBadge(view.inbox.length), body: html`<div class="dashboard-inbox">${inboxList(view.inbox, people, timeZone, q)}</div>` })}
            </div>
            <div class="dashboard-glance grid min-w-0 gap-4">
              <div class="${view.urgentRepairs.length ? 'urgent-panel' : ''}">${section({ title: 'Urgent Repairs', id: 'urgent-repairs', actions: countBadge(view.urgentRepairs.length, 'error'), body: urgentRepairsList(view.urgentRepairs, timeZone) })}</div>
              ${nextSevenDays(view.calendar, now, timeZone, c.req.query('day'), filter)}
              ${ticketsByStage(view.tickets, filter, now, timeZone)}
            </div>
          </div>
        `,
      }),
    );
  });

  pages.post('/requests/:issueId{[0-9]+}/confirm', async (c) =>
    formAction(c, await requestBack(c), async (form) => {
      // The review page sends the Summary as edited; an empty or unchanged one changes nothing.
      const summary = text(form, 'summary');
      const ticketId = await c.var.actions.confirmMaintenanceRequest(idParam(c, 'issueId'), summary ? { summary } : undefined);
      return { ok: 'Confirmed. The Ticket is open and the Tenant has been told.', redirect: `/tickets/${ticketId}` };
    }),
  );

  pages.post('/requests/:issueId{[0-9]+}/reject', async (c) =>
    formAction(c, await requestBack(c), async (form) => {
      const issueId = idParam(c, 'issueId');
      await c.var.actions.rejectMaintenanceRequest(issueId, text(form, 'reason'));
      return { ok: 'Rejected. The Tenant has been told why.' };
    }),
  );

  pages.post('/requests/:issueId{[0-9]+}/urgency', async (c) =>
    formAction(c, await requestBack(c), async (form) => {
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
    formAction(c, back(c), async (form) => {
      const personId = text(form, 'personId');
      if (!personId) throw new ActionError('invalid', 'Choose who sent this message');
      await c.var.actions.linkSender(idParam(c, 'itemId'), Number(personId));
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
    formAction(c, back(c), async () => {
      await c.var.actions.dismissInboxItem(idParam(c, 'itemId'));
      return { ok: 'Message dismissed' };
    }),
  );

  pages.get('/files/:id{[0-9]+}', async (c) => {
    const file = await c.var.actions.file(idParam(c, 'id'));
    if (!file) return c.notFound();
    const inline = INLINE_TYPES.has(file.contentType.toLowerCase());
    return c.body(streamOf(file.content), 200, {
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

/**
 * Back from a Maintenance Request's action: to the page it was taken on when the form
 * names one (its hidden `return` field, the Tickets list or a review), else the dashboard.
 */
async function requestBack(c: Context<WebEnv>) {
  const form = (await c.req.parseBody({ all: true })) as FormValues;
  const to = text(form, 'return');
  return REQUEST_RETURN.test(to) ? to : back(c);
}

function idParam(c: Context<WebEnv>, name: string) {
  return Number(c.req.param(name));
}

function countBadge(count: number, tone: Tone = 'neutral') {
  return count ? badge(String(count), tone) : undefined;
}

// Needs your attention

type Decided = { toCheck: BoardTicket[]; toBook: BoardTicket[]; toChoose: BoardTicket[] };

/** Where the "Tickets waiting on you" count links: the first of its groups with a Ticket in it. */
function firstGroup(d: Decided) {
  return d.toCheck.length ? '#quotes-to-check' : d.toBook.length ? '#inspections' : d.toChoose.length ? '#quotes-to-choose' : '#decisions';
}

/**
 * Maintenance Requests (oldest first, as the core orders them), then the Tickets waiting on
 * a Quote decision (Quotes to check, Site Inspections to book, Quotes to choose; a group with
 * none is left out), then alerts, then the inbox in brief on phones: the decisions, each with
 * its actions. `shareLink` is the Agency-wide list of Maintenance Requests, which a Share
 * button passes on when there are any.
 */
function decisions(n: Decided & { view: Dashboard; q: string; timeZone: string; now: Date; shareLink: string }): Html {
  const { view, q, timeZone, now } = n;
  const requests = view.maintenanceRequests;
  const group = (id: string, title: string, rows: Html[]) =>
    rows.length
      ? html`<div id="${id}" class="grid gap-2">
          <h3 class="text-sm font-semibold">${title}</h3>
          ${rows}
        </div>`
      : '';
  return section({
    title: 'Needs your attention',
    id: 'decisions',
    body: html`<div class="grid gap-4">
      <div id="requests" class="grid gap-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-semibold">Maintenance Requests to confirm</h3>
          ${requests.length
            ? shareButton({
                title: 'Maintenance Requests to confirm',
                text: `${requests.length} ${requests.length === 1 ? 'Maintenance Request is' : 'Maintenance Requests are'} waiting for review in myEST8.`,
                url: n.shareLink,
                note: COLLEAGUES_ONLY,
              })
            : ''}
        </div>
        ${requests.length ? requests.map((r) => requestRow(r, q, now)) : emptyState('No Maintenance Requests waiting for you.')}
      </div>
      ${group('quotes-to-check', 'Quotes to check', n.toCheck.map((t) => ticketDecisionRow(t, 'check_quotes', now)))}
      ${group('inspections', 'Site Inspections to book', n.toBook.map((t) => ticketDecisionRow(t, 'book_inspection', now)))}
      ${group('quotes-to-choose', 'Quotes to choose', n.toChoose.map((t) => ticketDecisionRow(t, 'choose_quote', now)))}
      <div id="alerts" class="grid gap-2">
        <h3 class="text-sm font-semibold">Alerts</h3>
        ${view.alerts.length ? view.alerts.map((a) => alertRow(a, timeZone)) : emptyState('No alerts.')}
      </div>
      ${view.inbox.length
        ? html`<div class="grid gap-2 lg:hidden">
            <h3 class="text-sm font-semibold">In the inbox</h3>
            ${view.inbox.map((item) => inboxRow(item, timeZone))}
          </div>`
        : ''}
    </div>`,
  });
}

const DECISION_ACTION: Record<'check_quotes' | 'book_inspection' | 'choose_quote', string> = {
  check_quotes: 'Check Quotes',
  book_inspection: 'Book a Site Inspection',
  choose_quote: 'Choose a Quote',
};

/** A Ticket waiting on a Quote decision: the issue, the Ticket and street, Urgency and Trade, with the step as its action. */
function ticketDecisionRow(t: BoardTicket, decision: keyof typeof DECISION_ACTION, now: Date): Html {
  const status = quotingStatus(t);
  return queueRow({
    href: `/tickets/${t.ticketId}`,
    title: t.description,
    detail: `Ticket ${t.ticketId}, ${streetOf(t.propertyAddress)}`,
    badges: [urgencyBadge(t.urgency), ...t.trades.map((trade) => badge(humanise(trade))), ...(status ? [badge(status, 'info', { outline: true })] : [])],
    meta: ageOf(t.reportedAt, now),
    decision: true,
    actions: linkButton(DECISION_ACTION[decision], `/tickets/${t.ticketId}`, { size: 'sm' }),
  });
}

/**
 * A Maintenance Request in "Needs your attention", read like a docket: the issue, the
 * street, then every badge (Urgency, Trade and each check that needs a second look),
 * with Confirm and Review on their own line.
 */
function requestRow(r: MaintenanceRequest, q: string, now: Date): Html {
  const [first] = r.photos;
  return queueRow({
    href: `/requests/${r.issueId}`,
    thumb: first ? html`<img src="/files/${first.fileId}" alt="Photo of the issue" width="56" height="56" loading="lazy" />` : undefined,
    title: r.summary ?? r.description,
    detail: streetOf(r.propertyAddress),
    badges: [urgencyBadge(r.urgency), badge(humanise(r.trade)), ...requestFlags(r).map((f) => badge(f.label, f.tone))],
    meta: ageOf(r.reportedAt, now),
    decision: true,
    actions: html`${postButton(`/requests/${r.issueId}/confirm${q}`, 'Confirm', { size: 'sm' })}${linkButton('Review', `/requests/${r.issueId}`, { variant: 'secondary', size: 'sm' })}`,
  });
}

/** Each alert says what is wrong, on which Property, with the next step as its action. */
function alertRow(alert: Alert, timeZone: string): Html {
  const ticket = `/tickets/${alert.ticketId}`;
  switch (alert.kind) {
    case 'invite_more_tradies':
      return queueRow({
        href: ticket,
        title: `Only ${alert.confirmedQuotes} confirmed ${alert.confirmedQuotes === 1 ? 'Quote' : 'Quotes'} after 72 hours`,
        detail: streetOf(alert.propertyAddress),
        badges: [badge('Quotes', 'warning')],
        decision: true,
        actions: linkButton('Ask more Tradies', `${ticket}#job-${alert.jobId}-tradies`, { size: 'sm' }),
      });
    case 'owner_no_reply':
      return queueRow({
        href: ticket,
        title: `${alert.ownerName}, the Property Owner, hasn't replied since ${formatWhen(alert.requestedAt, timeZone)}`,
        detail: streetOf(alert.propertyAddress),
        badges: [badge('Approval', 'warning')],
        decision: true,
        actions: alert.ownerPhone ? linkButton(`Call ${alert.ownerPhone}`, `tel:${alert.ownerPhone}`, { size: 'sm' }) : html`<span class="text-xs text-muted">No phone number on file</span>`,
      });
    case 'rating_due':
      return queueRow({
        href: ticket,
        title: `${alert.businessName} finished the Job`,
        detail: streetOf(alert.propertyAddress),
        badges: [badge('Rating', 'info')],
        decision: true,
        actions: linkButton('Rate the Tradie', `${ticket}#job-${alert.jobId}`, { size: 'sm' }),
      });
  }
}

/** An inbox item in brief: who sent it and what it says, linking to the item and its actions further down. */
function inboxRow(item: InboxItem, timeZone: string): Html {
  const [reason, tone] = INBOX_REASON[item.reason];
  return queueRow({
    href: `#inbox-${item.itemId}`,
    title: item.text,
    detail: item.personName ?? item.from,
    badges: [badge(reason, tone)],
    meta: formatWhen(item.receivedAt, timeZone),
    decision: true,
  });
}

// Tickets by stage

/**
 * The board: the lanes stacked in workflow order, each scrolling inside itself from
 * 1024px, and a stage with no Tickets left out. The core gives each Ticket its lane,
 * Trades, Quote counts, next visit and whether it needs a decision; this only draws
 * them. With no open Tickets at all it is one empty state.
 */
function ticketsByStage(tickets: BoardTicket[], filter: Filter, now: Date, timeZone: string): Html {
  return section({
    title: 'Tickets by stage',
    id: 'tickets',
    actions: linkButton('See all Tickets', filter === 'all' ? '/tickets?filter=all' : '/tickets', { variant: 'ghost', size: 'sm' }),
    body: tickets.length
      ? html`<div class="grid gap-3">
          ${STAGES.map((stage) => {
            const inLane = tickets.filter((t) => t.stage === stage);
            if (!inLane.length) return '';
            return lane({ title: STAGE_TITLE[stage], count: inLane.length, body: html`${inLane.map((t) => ticketDocket(t, now, timeZone))}` });
          })}
        </div>`
      : emptyState(filter === 'mine' ? 'No open Tickets on your Properties. Confirming a Maintenance Request opens one.' : 'No open Tickets. Confirming a Maintenance Request opens one.'),
  });
}

/** What a Ticket being quoted waits on: Quotes to check, Ready to choose, or how many Quotes are in. */
function quotingStatus(t: Pick<BoardTicket, 'quoting' | 'decision'>): string | null {
  const q = t.quoting;
  if (!q) return null;
  if (t.decision === 'check_quotes') return `${q.toCheck} ${q.toCheck === 1 ? 'Quote' : 'Quotes'} to check`;
  if (t.decision === 'choose_quote') return 'Ready to choose';
  if (t.decision === 'book_inspection') return 'Site Inspection to book';
  if (!q.asked && !q.received) return 'No Quote Requests yet';
  const of = Math.max(q.asked, q.received);
  // Estimates and Firm Quotes are counted apart, never added together.
  return `${q.received} of ${of} ${of === 1 ? 'Estimate' : 'Estimates'} in${q.firm ? `, ${q.firm} ${q.firm === 1 ? 'Firm Quote' : 'Firm Quotes'}` : ''}`;
}

function ticketDocket(t: BoardTicket, now: Date, timeZone: string): Html {
  const quoting = quotingStatus(t);
  return docket({
    number: t.ticketId,
    href: `/tickets/${t.ticketId}`,
    urgency: t.urgency,
    address: t.propertyAddress,
    street: t.propertyAddress.replace(/\s+[A-Z]{2,3}\s+\d{4}$/, ''),
    issue: t.description,
    meta: [
      ...t.trades.map((trade) => html`${humanise(trade)}`),
      ...(quoting ? [html`${quoting}`] : []),
      ...(t.nextVisit ? [html`Visit ${formatWhen(t.nextVisit, timeZone)}`] : []),
    ],
    age: ageOf(t.reportedAt, now),
    unread: t.unreadMessages,
    decision: t.decision !== null,
    lines: 2,
  });
}

// Next 7 days

/** A day chip's link: that day, and Mine or All as the page already has it. */
function dayHref(day: string, filter: Filter) {
  const params = new URLSearchParams();
  if (filter === 'all') params.set('filter', 'all');
  params.set('day', day);
  return `/?${params.toString()}#next-7-days`;
}

/**
 * Today and the six days after it, in the Agency's time zone. Each day is a link, and the
 * chosen one (today, when `day` is missing or not one of the seven) is filled; today stays
 * ringed when another day is chosen. Under the strip, that day's visits in time order.
 */
function nextSevenDays(bookings: Booking[], now: Date, timeZone: string, dayQuery: string | undefined, filter: Filter): Html {
  const today = dayOf(now, timeZone);
  const byDay = new Map<string, Booking[]>();
  for (const b of bookings) {
    const day = dayOf(b.start, timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const asked = parseDay(dayQuery);
  const chosen = asked && days.includes(asked) ? asked : today;
  const weekday = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short' });
  const weekdayLong = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'long' });
  const dateOf = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric' });
  const visits = byDay.get(chosen) ?? [];
  return section({
    title: 'Next 7 days',
    id: 'next-7-days',
    actions: linkButton('Open calendar', `/calendar?view=day&date=${chosen}`, { variant: 'ghost', size: 'sm' }),
    body: html`<ol class="day-strip">
        ${days.map((day) => {
          const at = new Date(`${day}T00:00:00Z`);
          return html`<li><a class="day-chip${day === today ? ' is-today' : ''}" href="${dayHref(day, filter)}" ${day === chosen ? html`aria-current="date"` : ''}><time datetime="${day}"><span class="day-name">${weekday.format(at)}</span><span class="day-num">${dateOf.format(at)}</span></time>${byDay.has(day) ? html`<span class="day-dot" role="img" aria-label="Has a visit"></span>` : ''}</a></li>`;
        })}
      </ol>
      <h3 class="visit-heading">${longDay(chosen)}</h3>
      ${visits.length
        ? html`<ul class="visit-list">${visits.map((b) => visitRow(b, timeZone))}</ul>`
        : html`<p class="visit-none">Nothing booked on ${weekdayLong.format(new Date(`${chosen}T00:00:00Z`))}.</p>`}`,
  });
}

/** One booked visit: the time, the Tradie (linked to the profile), the issue and street (linked to the Ticket), and a Site inspection badge when it is one. */
function visitRow(b: Booking, timeZone: string): Html {
  const time = new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(b.start));
  const kind = visitKind(b);
  return html`<li class="visit-row">
    <time datetime="${b.start}" class="visit-time num">${time}</time>
    <span class="visit-what">
      <a class="visit-tradie" href="/tradies/${b.tradieId}">${b.businessName}</a>
      <a class="visit-place" href="${ticketHref(b)}">${clip(b.issue, { lines: 1 })} · ${streetOf(b.propertyAddress)}</a>
    </span>
    ${kind ? badge(kind, 'info', { outline: true }) : ''}
  </li>`;
}

/** "2 days ago", "5 hours ago": how long a request has waited. */
function ageOf(iso: string, now: Date) {
  const hours = Math.floor((now.getTime() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

// Urgent Repairs

/** Urgent Repairs as a compact list: the issue (linked to its Reimbursement Request), where, who and when, then where the receipt stands. */
function urgentRepairsList(repairs: UrgentRepair[], timeZone: string): Html {
  if (!repairs.length) return emptyState('No Urgent Repairs reported.');
  return html`<ul class="grid gap-2">
    ${repairs.map(
      (u) => html`<li class="urgent-item">
        <p class="urgent-issue">${rowLink(u.description, `/reimbursements/${u.urgentRepairId}`)}</p>
        <p class="urgent-meta">${u.propertyAddress} · ${u.tenantName} · ${formatWhen(u.reportedAt, timeZone)}</p>
        <p class="urgent-foot">${reimbursementBadge(u.status)}<span class="urgent-receipts">${u.receipts === 1 ? '1 receipt' : u.receipts ? `${u.receipts} receipts` : 'No receipts yet'}</span></p>
      </li>`,
    )}
  </ul>`;
}

// Inbox

function inboxList(items: InboxItem[], people: Person[], timeZone: string, q: string): Html {
  if (!items.length) return emptyState('The inbox is empty.');
  return html`<div class="grid gap-2">${items.map((item) => inboxItem(item, people, timeZone, q))}</div>`;
}

/**
 * One inbox item, compact: the message, who sent it and when, then the agent's best
 * guess in one line beside the actions. Every answer behind the guess is one click away.
 */
function inboxItem(item: InboxItem, people: Person[], timeZone: string, q: string): Html {
  const [reason, tone] = INBOX_REASON[item.reason];
  const base = `/inbox/${item.itemId}`;
  const guesses = item.bestGuess && Object.keys(item.bestGuess).length ? item.bestGuess : null;
  return html`<article class="inbox-item${item.personId === null ? ' is-unknown' : ''}" id="inbox-${item.itemId}">
    <div class="inbox-item-head">
      <div class="min-w-0">
        <p class="inbox-item-who">${item.personName ?? item.from}</p>
        <p class="inbox-item-from">
          ${item.personName ? html`<span>${item.from}</span>` : ''}
          <span>${formatWhen(item.receivedAt, timeZone)}</span>
        </p>
      </div>
      ${badge(reason, tone)}
    </div>
    <blockquote class="inbox-item-text">${item.text}</blockquote>
    ${guesses
      ? html`<details class="inbox-item-guess">
          <summary>Looks like: ${guessSummary(guesses)}</summary>
          ${dl(Object.entries(guesses).map(([question, answer]) => [guessLabel(question), guessAnswer(answer)]))}
        </details>`
      : ''}
    <div class="inbox-item-actions">
      ${item.personId === null
        ? html`<details class="inbox-pick">
            <summary>Pick a contact</summary>
            <form method="post" action="${base}/link${q}" class="inbox-item-link">
            ${field({
              label: 'Link sender to',
              name: 'personId',
              id: `person-${item.itemId}`,
              type: 'select',
              required: true,
              placeholder: 'Search people by name',
              search: true,
              options: people.map((p) => ({ value: String(p.id), label: personLabel(p) })),
              hint: 'Their next message from this address will be recognised.',
            })}
            ${button('Link sender')}
            </form>
          </details>`
        : item.reason === 'low_confidence' && item.bestGuess
          ? postButton(`${base}/route${q}`, 'Route with best guess', { size: 'sm' })
          : ''}
      ${postButton(`${base}/dismiss${q}`, 'Dismiss', { variant: 'ghost', size: 'sm' })}
    </div>
  </article>`;
}

/**
 * The best guess in one line: what kind of message, what it is about, then its
 * Urgency and Trade. "Update on Ticket 12, Routine, Plumbing".
 */
function guessSummary(g: Record<string, string>): string {
  const kind =
    g.replyType && g.replyType !== 'other'
      ? humanise(g.replyType)
      : g.updateType && g.updateType !== 'general'
        ? humanise(g.updateType)
        : g.messageClass
          ? (MESSAGE_CLASS[g.messageClass] ?? humanise(g.messageClass))
          : 'Message';
  const about = g.relatedItem && g.relatedItem !== 'none' ? ` on ${guessAnswer(g.relatedItem)}` : '';
  return [`${kind}${about}`, ...(g.urgency ? [humanise(g.urgency)] : []), ...(g.trade ? [humanise(g.trade)] : [])].join(', ');
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
