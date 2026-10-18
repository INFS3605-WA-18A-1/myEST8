// The Property Manager's dispatch board. A count sentence, then "Needs you" (Maintenance
// Requests to confirm, Quotes to check, Site quotes to book, Quotes to choose, Tradies to
// rate, alerts and the inbox, each once with its actions), then Tickets by stage in one
// row of lanes, then the next 7 days and Urgent Repairs. Also the actions on each, and
// /files/:id for photos.
// Controls repeated per item get the item's id in their element id ("reason-12"),
// so every label on the page points at its own control.

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError, type Urgency } from '../../shared.ts';
import { STAGES, type Stage } from '../../views.ts';
import { addDays, dayOf } from '../../zoned-time.ts';
import type { WebEnv } from '../env.ts';
import { formAction, text, type FormValues } from '../forms.ts';
import { requestFlags } from '../request-checks.ts';
import { COLLEAGUES_ONLY, shareButton, shareUrl } from '../share.ts';
import { shellInfo } from '../shell.ts';
import {
  badge,
  button,
  countSentence,
  dl,
  docket,
  emptyState,
  field,
  flashFrom,
  formatWhen,
  humanise,
  lane,
  linkButton,
  needsYou,
  page,
  postButton,
  queueRow,
  section,
  segmented,
  table,
  urgencyBadge,
  type Html,
  ROLE_LABEL,
  type Tone,
} from '../ui.ts';
import { dayRange, shortDay, streetOf, type Booking } from '../bookings.ts';
import { finishSetupBanner } from './welcome.ts';
import { streamOf } from '../stream.ts';

/** Kept for the pages that still import it from here; the words live with the other request checks. */
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
  site_quoting: 'Site quotes',
  awaiting_owner: 'With Property Owner',
  approved: 'Ready to book',
  scheduled: 'Booked',
  done: 'Done',
};

/** Where a Maintenance Request's action may send the Property Manager back to: the Requests list or one request's review. */
const REQUEST_RETURN = /^\/requests(\/\d+)?$/;

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
    const toCheck = view.tickets.filter((t) => t.decision === 'check_quotes');
    const toBook = view.tickets.filter((t) => t.decision === 'book_site_quotes');
    const toChoose = view.tickets.filter((t) => t.decision === 'choose_quote');
    const toRate = view.alerts.filter((a) => a.kind === 'rating_due');
    const otherAlerts = view.alerts.filter((a) => a.kind !== 'rating_due');

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
          ${(await finishSetupBanner(actions, c.var.unavailableChannels))}
          ${countSentence(
            [
              { label: 'Maintenance Requests to confirm', one: 'Maintenance Request to confirm', count: view.maintenanceRequests.length, href: '#requests', decision: true },
              { label: 'Quotes to check', one: 'Quote to check', count: toCheck.length, href: '#quotes-to-check', decision: true },
              { label: 'Site quotes to book', one: 'Site quote to book', count: toBook.length, href: '#site-quotes', decision: true },
              { label: 'Quotes to choose', one: 'Quote to choose', count: toChoose.length, href: '#quotes-to-choose', decision: true },
              { label: 'Tradies to rate', one: 'Tradie to rate', count: toRate.length, href: '#to-rate', decision: true },
              { label: 'Alerts', one: 'Alert', count: otherAlerts.length, href: '#alerts', decision: true },
              { label: 'Messages in the inbox', one: 'Message in the inbox', count: view.inbox.length, href: '#inbox', decision: true },
              { label: 'Urgent Repairs waiting for a receipt', one: 'Urgent Repair waiting for a receipt', count: needReceipt, href: '#urgent-repairs' },
            ],
            { label: 'What needs you' },
          )}
          <div class="dashboard-desk">
            ${needsYouSection({ view, toCheck, toBook, toChoose, toRate, otherAlerts, people, q, timeZone, now, shareLink: shareUrl(c, '/?filter=all#requests') })}
            ${ticketsByStage(view.tickets, filter, now, timeZone)}
            <div class="dashboard-side">
              ${nextSevenDays(view.calendar, now, timeZone)}
              ${section({ title: 'Urgent Repairs', id: 'urgent-repairs', actions: countBadge(view.urgentRepairs.length), body: urgentRepairsTable(view.urgentRepairs, timeZone, now) })}
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
 * names one (its hidden `return` field, the Requests list or a review), else the dashboard.
 */
async function requestBack(c: Context<WebEnv>) {
  const form = (await c.req.parseBody({ all: true })) as FormValues;
  const to = text(form, 'return');
  return REQUEST_RETURN.test(to) ? to : back(c);
}

function idParam(c: Context<WebEnv>, name: string) {
  return Number(c.req.param(name));
}

function countBadge(count: number) {
  return count ? badge(String(count)) : undefined;
}

// Needs your decision

type NeedsYouInput = {
  view: Dashboard;
  toCheck: BoardTicket[];
  toBook: BoardTicket[];
  toChoose: BoardTicket[];
  toRate: Alert[];
  otherAlerts: Alert[];
  people: Person[];
  q: string;
  timeZone: string;
  now: Date;
  shareLink: string;
};

/**
 * "Needs you": every decision once, in groups, each row with its action. Maintenance
 * Requests first (oldest first, as the core orders them), then Quotes to check, Site
 * quotes to book, Quotes to choose, Tradies to rate, other alerts and the inbox. A group
 * with nothing in it is left out. `shareLink` is the Agency-wide list of Maintenance
 * Requests, which a Share button passes on when there are any.
 */
function needsYouSection(n: NeedsYouInput): Html {
  const requests = n.view.maintenanceRequests;
  const group = (id: string, title: string, rows: Html[], head?: Html) =>
    rows.length
      ? html`<div id="${id}" class="decision-group">
          <div class="decision-group-head">
            <h3 class="decision-group-title">${title}</h3>
            ${head ?? ''}
          </div>
          ${rows}
        </div>`
      : '';
  const groups = [
    group(
      'requests',
      'Maintenance Requests to confirm',
      requests.map((r) => requestRow(r, n.q, n.now)),
      shareButton({
        title: 'Maintenance Requests to confirm',
        text: `${requests.length} ${requests.length === 1 ? 'Maintenance Request is' : 'Maintenance Requests are'} waiting for review in myEST8.`,
        url: n.shareLink,
        note: COLLEAGUES_ONLY,
      }),
    ),
    group('quotes-to-check', 'Quotes to check', n.toCheck.map((t) => ticketDecisionRow(t, 'check_quotes', n.now))),
    group('site-quotes', 'Site quotes to book', n.toBook.map((t) => ticketDecisionRow(t, 'book_site_quotes', n.now))),
    group('quotes-to-choose', 'Quotes to choose', n.toChoose.map((t) => ticketDecisionRow(t, 'choose_quote', n.now))),
    group('to-rate', 'Tradies to rate', n.toRate.map((a) => alertRow(a, n.timeZone))),
    group('alerts', 'Alerts', n.otherAlerts.map((a) => alertRow(a, n.timeZone))),
    group('inbox', 'In the inbox', n.view.inbox.map((item) => inboxItem(item, n.people, n.timeZone, n.q))),
  ];
  const any = requests.length + n.toCheck.length + n.toBook.length + n.toChoose.length + n.toRate.length + n.otherAlerts.length + n.view.inbox.length > 0;
  return needsYou({
    id: 'decisions',
    body: any ? html`<div class="decision-groups">${groups}</div>` : emptyState('No Maintenance Requests waiting for you. Nothing else needs you right now.'),
  });
}

const DECISION_ACTION: Record<'check_quotes' | 'book_site_quotes' | 'choose_quote', string> = {
  check_quotes: 'Check Quotes',
  book_site_quotes: 'Book site quotes',
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
 * A Maintenance Request in "Needs you", read like a docket: the issue, the
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

// Tickets by stage

/**
 * The board: six lanes in one row from 1024px (scrolling sideways inside its own
 * container if the width runs out), each scrolling inside itself, and on phones the
 * lanes stacked as a list grouped by stage. The core gives each Ticket its lane,
 * Trades, Quote counts, next visit and whether it needs a decision; this only draws
 * them. With no open Tickets at all it is one empty state, not five.
 */
function ticketsByStage(tickets: BoardTicket[], filter: Filter, now: Date, timeZone: string): Html {
  return section({
    title: 'Tickets by stage',
    id: 'tickets',
    actions: linkButton('See all Tickets', filter === 'all' ? '/tickets?filter=all' : '/tickets', { variant: 'ghost', size: 'sm' }),
    body: tickets.length
      ? html`<div class="board-lanes">
          ${STAGES.map((stage) => {
            const inLane = tickets.filter((t) => t.stage === stage);
            return lane({
              title: STAGE_TITLE[stage],
              count: inLane.length,
              body: inLane.length
                ? html`${inLane.map((t) => ticketDocket(t, now, timeZone))}`
                : html`<p class="text-sm text-muted">Nothing at this stage.</p>`,
            });
          })}
        </div>`
      : emptyState(filter === 'mine' ? 'No open Tickets on your Properties. Confirming a Maintenance Request opens one.' : 'No open Tickets. Confirming a Maintenance Request opens one.'),
  });
}

/** What a Ticket being quoted waits on: Quotes to check, Ready to choose, or how many Quotes are in. */
export function quotingStatus(t: Pick<BoardTicket, 'quoting' | 'decision'>): string | null {
  const q = t.quoting;
  if (!q) return null;
  if (t.decision === 'check_quotes') {
    const toCheck = q.received - q.confirmed;
    return `${toCheck} ${toCheck === 1 ? 'Quote' : 'Quotes'} to check`;
  }
  if (t.decision === 'choose_quote') return 'Ready to choose';
  if (t.decision === 'book_site_quotes') return 'Book site quotes';
  if (!q.asked && !q.received) return 'No Quote Requests yet';
  const of = Math.max(q.asked, q.received);
  return `${q.received} of ${of} ${of === 1 ? 'Quote' : 'Quotes'} in`;
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

/**
 * Today and the six days after it, in the Agency's time zone. Each day with bookings
 * gets a row (today always has one); the empty days between them collapse into a
 * single muted line.
 */
function nextSevenDays(bookings: Booking[], now: Date, timeZone: string): Html {
  const today = dayOf(now, timeZone);
  const byDay = new Map<string, Booking[]>();
  for (const b of bookings) {
    const day = dayOf(b.start, timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }
  const rows: Html[] = [];
  let quiet: string[] = [];
  const flushQuiet = () => {
    if (quiet.length) rows.push(html`<li class="px-2 py-2 text-sm text-muted">Nothing booked ${dayRange(quiet, { month: true })}</li>`);
    quiet = [];
  };
  for (let i = 0; i < 7; i++) {
    const day = addDays(today, i);
    const dayBookings = byDay.get(day) ?? [];
    if (i > 0 && !dayBookings.length) {
      quiet.push(day);
      continue;
    }
    flushQuiet();
    rows.push(dayRow(day, dayBookings, i === 0, timeZone));
  }
  flushQuiet();
  return section({
    title: 'Next 7 days',
    id: 'next-7-days',
    actions: linkButton('Open calendar', '/calendar', { variant: 'ghost', size: 'sm' }),
    body: html`<ol class="grid">${rows}</ol>`,
  });
}

/** One day: its date (today is highlighted), then its bookings or "Nothing booked today". */
function dayRow(day: string, bookings: Booking[], isToday: boolean, timeZone: string): Html {
  return html`<li class="grid gap-2 border-t border-line px-2 py-2 first:border-t-0 sm:grid-cols-[7rem_minmax(0,1fr)] ${isToday ? 'rounded bg-page' : ''}" ${isToday ? html`aria-current="date"` : ''}>
    <p class="text-sm font-semibold"><time datetime="${day}">${shortDay(day, { month: true })}</time>${isToday ? html` ${badge('Today', 'info')}` : ''}</p>
    ${bookings.length
      ? html`<ul class="grid gap-1.5">${bookings.map((b) => bookingLine(b, timeZone))}</ul>`
      : html`<p class="text-sm text-muted">Nothing booked today</p>`}
  </li>`;
}

/** One booking: its time, the Tradie's business name (linked to the profile) and the street (linked to the Ticket). */
function bookingLine(b: Booking, timeZone: string): Html {
  const time = new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(b.start));
  return html`<li class="flex min-w-0 flex-wrap items-baseline gap-x-3 text-sm">
    <time datetime="${b.start}" class="num shrink-0 font-semibold">${time}</time>
    <a class="link min-w-0 truncate" href="/tradies/${b.tradieId}">${b.businessName}</a>
    <a class="link min-w-0 truncate" href="/tickets/${b.ticketId}">${streetOf(b.propertyAddress)}</a>
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

function urgentRepairsTable(repairs: UrgentRepair[], timeZone: string, now: Date): Html {
  if (!repairs.length) return emptyState('No Urgent Repairs reported.');
  // Read as a docket is: the issue, then where; the Tenant who arranges it; then where the receipt stands.
  return table(
    ['Issue', 'Tenant', 'Status', 'Receipts', 'Reported'],
    repairs.map((u) => {
      const [label, tone] = URGENT_REPAIR_STATUS[u.status];
      return [
        html`<p class="font-semibold">${u.description}</p>
          <p class="text-xs text-muted">${u.propertyAddress}</p>`,
        html`${u.tenantName}`,
        badge(label, tone, { wrap: true }),
        html`${u.receipts}`,
        html`<time class="whitespace-nowrap" datetime="${u.reportedAt}" title="${formatWhen(u.reportedAt, timeZone)}">${ageOf(u.reportedAt, now)}</time>`,
      ];
    }),
    { caption: 'Urgent Repairs', stack: 'labelled', align: ['left', 'left', 'left', 'right', 'left'] },
  );
}

// Inbox

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
      <blockquote class="inbox-item-text">${item.text}</blockquote>
      ${badge(reason, tone)}
    </div>
    <p class="inbox-item-from">
      ${item.personName ? html`<span>${item.personName}</span><span>${item.from}</span>` : html`<span>${item.from}</span>`}
      <span>${formatWhen(item.receivedAt, timeZone)}</span>
    </p>
    ${guesses
      ? html`<details class="inbox-item-guess">
          <summary>Looks like: ${guessSummary(guesses)}</summary>
          ${dl(Object.entries(guesses).map(([question, answer]) => [guessLabel(question), guessAnswer(answer)]))}
        </details>`
      : ''}
    <div class="inbox-item-actions">
      ${item.personId === null
        ? html`<form method="post" action="${base}/link${q}" class="inbox-item-link">
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
            ${button('Link sender')}
          </form>`
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
