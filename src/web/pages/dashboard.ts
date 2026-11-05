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
import { dashboardCalendarRange, STAGES, type Stage } from '../../views.ts';
import { addDays, dayOf, parseDay } from '../../zoned-time.ts';
import type { WebEnv } from '../env.ts';
import { formAction, text, type FormValues } from '../forms.ts';
import { icon } from '../icons.ts';
import { requestFlags } from '../request-checks.ts';
import { COLLEAGUES_ONLY, shareButton, shareUrl } from '../share.ts';
import { shellInfo } from '../shell.ts';
import {
  badge,
  button,
  clip,
  dl,
  emptyState,
  field,
  flashFrom,
  formatTime,
  formatWhen,
  humanise,
  linkButton,
  page,
  postButton,
  profileHref,
  queueRow,
  ROLE_LABEL,
  sharedAddressNote,
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
  shared_address: ['Shared address', 'warning'],
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

/** The same stages in a few words, for the counts above the Ticket rows and each row's marker. */
const STAGE_SHORT: Record<Stage, string> = {
  quoting: 'Quoting',
  awaiting_owner: 'With owner',
  approved: 'To book',
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
    const shown = shownDay(now, timeZone, c.req.query('day'));
    const decided = {
      toCheck: view.tickets.filter((t) => t.decision === 'check_quotes'),
      toBook: view.tickets.filter((t) => t.decision === 'book_inspection'),
      toChoose: view.tickets.filter((t) => t.decision === 'choose_quote'),
    };
    // Only the receipts the Property Manager has to review are "Do next" work; the ones awaiting a receipt or with the Owner wait on someone else.
    const toReview = view.urgentRepairs.filter((u) => u.status === 'receipt_received');
    // A Tradie slow to offer visit times, or a Tenant yet to pick one, waits on someone else:
    // it belongs in Waiting on others, never in both cards.
    const alerts = view.alerts.filter((a) => a.kind !== 'tradie_no_visit_times' && a.kind !== 'tenant_no_visit_pick');
    const waiting = view.maintenanceRequests.length + decided.toCheck.length + decided.toBook.length + decided.toChoose.length + alerts.length + toReview.length;
    const threads = view.inbox.length ? await actions.inboxThreads() : [];
    const firstName = pm.name.trim().split(/\s+/)[0] || pm.name;

    return c.html(
      page({
        title: 'Dashboard',
        heading: `Hi, ${firstName}`,
        subtitle: helloLine(waiting, view.inbox.length),
        pm,
        active: 'dashboard',
        flash: flashFrom(c.req.url),
        shell: await shellInfo(c),
        controls: segmented([
          { label: 'Mine', href: scopeHref('mine', shown.kept), active: filter === 'mine' },
          { label: 'All', href: scopeHref('all', shown.kept), active: filter === 'all' },
        ]),
        body: html`
          <div class="dashboard-desk">
            <div class="dash-col">
              ${doNext({ view, ...decided, toReview, alerts, total: waiting, q, timeZone, now, shareLink: shareUrl(c, '/?filter=all#requests') })}
              ${glance(view, filter, now, timeZone, pm.id)}
            </div>
            <div class="dash-col">
              ${inboxCard(threads, view.inbox.length, timeZone)}
              ${nextSevenDays(view.calendar, now, timeZone, c.req.query('day'), filter, pm.id)}
              ${ticketsByStage(view.tickets, filter, now)}
            </div>
          </div>
          ${inboxModal(threads, people, timeZone, q)}
        `,
      }),
    );
  });

  // The day strip asks for this on its own, so choosing a day does not redraw the dashboard.
  // The visits are the same window dashboard() returns, narrowed to the Property Manager's own on Mine.
  pages.get('/next-7-days', async (c) => {
    const { actions, pm } = c.var;
    const { timeZone } = actions.agency();
    const now = actions.now();
    const bookings = await actions.calendar(dashboardCalendarRange(now, timeZone));
    return c.html(nextSevenDays(bookings, now, timeZone, c.req.query('day'), filterOf(c), pm.id));
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

// Greeting and glance

/** "4 things need you today · 4 messages in the inbox": the line under "Hi, Alice". */
function helloLine(things: number, inbox: number): string {
  const waiting = things === 0 ? 'Nothing needs you right now' : `${things} ${things === 1 ? 'thing needs' : 'things need'} you today`;
  const messages = inbox ? ` · ${inbox} ${inbox === 1 ? 'message' : 'messages'} in the inbox` : '';
  return `${waiting}${messages}`;
}

type Decided = { toCheck: BoardTicket[]; toBook: BoardTicket[]; toChoose: BoardTicket[] };

type GlanceItem = {
  cls: string;
  /** The words beside the count. */
  label: string;
  /** The words on a phone's compact strip ("Tradies", "Owners"). */
  short: string;
  /** The words for the quiet line when this row has nothing waiting. */
  none: string;
  count: number;
  href: string;
  /** What the row waits on, under the label. A zero count reads "None" instead. */
  sub: string;
  /** One item per pip, oldest first; each carries when it was opened. */
  items: { at: string }[];
  chips?: Html[];
};

/** A Ticket is stale once it has waited this many days for the other side. */
const STALE_DAYS = 7;

/** "a", "a or b", "a, b or c". */
function orList(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;
}

/**
 * Waiting on others: the things a Property Manager is waiting for someone else to do
 * (Tradies to quote, Property Owners to approve — a Quote or a receipt — visit times
 * to be arranged, visits to be confirmed and receipts to come back), each a row with
 * its count, what it waits on, and a pip for every item. A row with nothing waiting is
 * left out and named in one quiet line; when nothing waits at all, the rows give way
 * to one line saying so.
 */
function glance(view: Dashboard, filter: Filter, now: Date, timeZone: string, pmId: number): Html {
  const q = filter === 'all' ? '&filter=all' : '';
  const tradies = view.tickets.filter((t) => t.stage === 'quoting' && t.decision === null);
  const owners = view.tickets.filter((t) => t.stage === 'awaiting_owner');
  const visits = view.tickets.filter((t) => t.stage === 'approved');
  const forwarded = view.urgentRepairs.filter((u) => u.status === 'receipt_forwarded');
  const receipts = view.urgentRepairs.filter((u) => u.status === 'reminder_sent');
  const ownerNoReply = view.alerts.filter((alert) => alert.kind === 'owner_no_reply').length;
  const slowAlerts = view.alerts.filter((alert) => alert.kind === 'tradie_no_visit_times');
  const pickAlerts = view.alerts.filter((alert) => alert.kind === 'tenant_no_visit_pick');
  const slowToOffer = slowAlerts.length;
  const tenantToPick = pickAlerts.length;
  const today = dayOf(now, timeZone);
  const tomorrow = addDays(today, 1);
  const inWindow = view.calendar.filter((b) => {
    const day = dayOf(b.start, timeZone);
    return (day === today || day === tomorrow) && (filter === 'all' || b.propertyManagerId === pmId);
  });
  const unconfirmed = inWindow.filter((b) => b.visit === 'not_confirmed');
  const reschedules = inWindow.filter((b) => b.visit === 'reschedule_requested');
  const todayUnconfirmed = unconfirmed.filter((b) => dayOf(b.start, timeZone) === today).length;
  const tomorrowUnconfirmed = unconfirmed.length - todayUnconfirmed;

  const firm = tradies.reduce((sum, t) => sum + (t.quoting?.firm ?? 0), 0);
  const asked = tradies.reduce((sum, t) => sum + (t.quoting?.asked ?? 0), 0);
  const oldest = (items: { reportedAt: string }[]) => (items.length ? ageOf(items.reduce((oldest, t) => (t.reportedAt < oldest ? t.reportedAt : oldest), items[0]!.reportedAt), now) : '');
  const oldestFirst = (items: { at: string }[]) => [...items].sort((a, b) => a.at.localeCompare(b.at));
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  // Visit times: the approved Tickets plus any Ticket a slow-to-offer or tenant-to-pick
  // alert names, once each, so the count and its sub-line describe the same set.
  const visitIds = new Set(visits.map((t) => t.ticketId));
  for (const alert of [...slowAlerts, ...pickAlerts]) visitIds.add(alert.ticketId);
  const visitTickets = view.tickets.filter((t) => visitIds.has(t.ticketId));

  // What the visit rows wait on, with the zero clauses left out.
  const visitParts = [slowToOffer ? `${plural(slowToOffer, 'Tradie', 'Tradies')} slow to offer` : '', tenantToPick ? `${plural(tenantToPick, 'Tenant', 'Tenants')} yet to pick` : ''].filter(Boolean);
  const confirmParts = [todayUnconfirmed ? `today ${todayUnconfirmed}` : '', tomorrowUnconfirmed ? `tomorrow ${tomorrowUnconfirmed}` : ''].filter(Boolean);
  const ownerParts = [owners.length ? `oldest opened ${oldest(owners)}` : '', forwarded.length ? `${plural(forwarded.length, 'receipt', 'receipts')} with the Owner` : ''].filter(Boolean);
  const ownerCount = owners.length + forwarded.length;
  // The quoting row waits on Firm Quotes: say how many of the Tradies asked have given one.
  const quotingSub = asked
    ? `${firm} ${firm === 1 ? 'Firm Quote' : 'Firm Quotes'} of ${asked} in · oldest opened ${oldest(tradies)}`
    : `No Quote Requests yet · oldest opened ${oldest(tradies)}`;

  const rows: GlanceItem[] = [
    {
      cls: 'is-tradies',
      label: 'Tradies quoting',
      short: 'Tradies',
      none: 'Tradies to quote',
      count: tradies.length,
      href: `/tickets?stage=quoting${q}`,
      sub: quotingSub,
      items: oldestFirst(tradies.map((t) => ({ at: t.reportedAt }))),
    },
    {
      cls: 'is-owners',
      label: 'Owners approving',
      short: 'Owners',
      none: 'Owners approving',
      count: ownerCount,
      // A receipt with the Owner lives on Approvals; a Ticket waiting on the Owner lives on the Tickets list.
      href: forwarded.length && !owners.length ? '/approvals#reimbursements' : `/tickets?stage=awaiting_owner${q}`,
      sub: ownerParts.join(' · '),
      items: oldestFirst([...owners.map((t) => ({ at: t.reportedAt })), ...forwarded.map((u) => ({ at: u.reportedAt }))]),
      chips: ownerNoReply ? [badge(`${ownerNoReply} not replying`, 'warning', { outline: true })] : [],
    },
    {
      cls: 'is-visits',
      label: 'Visit times being arranged',
      short: 'Visit times',
      none: 'visit times',
      count: visitIds.size,
      href: `/tickets?stage=approved${q}`,
      sub: visitParts.length ? visitParts.join(' · ') : `oldest opened ${oldest(visitTickets)}`,
      items: oldestFirst(visitTickets.map((t) => ({ at: t.reportedAt }))),
    },
    {
      cls: 'is-confirm',
      label: 'Visits not confirmed',
      short: 'Confirm',
      none: 'visit confirmations',
      count: unconfirmed.length,
      href: `/calendar?view=day&date=${today}&status=not_confirmed${q}`,
      sub: confirmParts.join(' · '),
      items: oldestFirst(unconfirmed.map((b) => ({ at: b.start }))),
      chips: reschedules.length ? [badge(`${reschedules.length} reschedule asked`, 'warning', { outline: true })] : [],
    },
    {
      cls: 'is-receipts',
      label: 'Receipts awaited',
      short: 'Receipts',
      none: 'receipts',
      count: receipts.length,
      href: '/approvals#reimbursements',
      sub: `oldest opened ${oldest(receipts)}`,
      items: oldestFirst(receipts.map((u) => ({ at: u.reportedAt }))),
    },
  ];

  const shown = rows.filter((row) => row.count > 0);
  const hidden = rows.filter((row) => row.count === 0);
  return html`<section class="glance${shown.length ? '' : ' is-clear'}" aria-label="Waiting on others">
    <h2 class="glance-title">Waiting on others</h2>
    ${shown.length
      ? html`<ul class="glance-list">
          ${shown.map((row) => glanceRow(row, now))}
        </ul>${hidden.length ? html`<p class="glance-none">Nothing waiting on ${orList(hidden.map((row) => row.none))}.</p>` : ''}`
      : html`<p class="glance-clear">Nothing is waiting on Tradies, Owners or Tenants.</p>`}
  </section>`;
}

/** One tally row. The trailing glyph opens the row's list. */
function glanceRow(item: GlanceItem, now: Date): Html {
  return html`<li class="${item.cls}"><a href="${item.href}" class="glance-row${item.count === 0 ? ' is-zero' : ''}">
    <span class="glance-count">${item.count}</span>
    <span class="glance-body">
      <span class="glance-line">
        <span class="glance-label">${item.label}</span>
        <span class="glance-label-short" aria-hidden="true">${item.short}</span>
        ${pips(item.items, item.count, now)}
      </span>
      <span class="glance-sub">${item.count === 0 ? 'None' : item.sub}${item.chips?.length ? html` ${item.chips}` : ''}</span>
    </span>
    <span class="glance-go">${icon('caret-right', { size: 'size-4' })}</span>
  </a></li>`;
}

/** One pip per item, up to twelve, then "+n". A count of zero is a single hollow ring. */
function pips(items: { at: string }[], count: number, now: Date): Html {
  if (count === 0) return html`<span class="glance-pips" aria-hidden="true"><i class="glance-pip is-zero"></i></span>`;
  const shown = items.slice(0, 12);
  return html`<span class="glance-pips" aria-hidden="true">${shown.map((pip, i) => html`<i class="glance-pip${isStale(pip.at, now) ? ' is-stale' : ''}" style="--n:${i}"></i>`)}${count > 12 ? html`<span class="glance-more">+${count - 12}</span>` : ''}</span>`;
}

/** Whether an item has waited more than a week for the other side. */
function isStale(at: string, now: Date): boolean {
  return now.getTime() - new Date(at).getTime() > STALE_DAYS * 24 * 60 * 60 * 1000;
}

// Do next

/**
 * Maintenance Requests (oldest first, as the core orders them), the Urgent Repair
 * receipts to review, then the Tickets waiting on a Quote decision, then alerts: the
 * things only the Property Manager can do, each a soft row with its action. Every
 * group has its own sub-heading, so a heading always sits with the rows it names.
 * When there are none one quiet line says so. `shareLink` is the Agency-wide list of
 * Maintenance Requests, which a Share button passes on when there are any.
 */
function doNext(n: Decided & { view: Dashboard; toReview: UrgentRepair[]; alerts: Alert[]; total: number; q: string; timeZone: string; now: Date; shareLink: string }): Html {
  const { view, q, timeZone, now, shareLink, toReview, alerts, total } = n;
  const requests = view.maintenanceRequests;
  const group = (id: string, title: string, rows: Html[]) =>
    rows.length ? html`<div id="${id}" class="do-next-list"><h3 class="do-next-sub">${title}</h3>${rows}</div>` : '';
  return section({
    title: html`Do next <span class="count-chip is-decision">${total}</span>`,
    id: 'decisions',
    actions: requests.length
      ? shareButton({
          title: 'Maintenance Requests to confirm',
          text: `${requests.length} ${requests.length === 1 ? 'Maintenance Request is' : 'Maintenance Requests are'} waiting for review in myEST8.`,
          url: shareLink,
          note: COLLEAGUES_ONLY,
        })
      : undefined,
    body: html`<div class="do-next">
      ${toReview.length ? html`<div id="urgent-repairs" class="do-next-urgent"><h3 class="do-next-sub">Urgent Repairs</h3>${urgentRepairsList(toReview, timeZone)}</div>` : ''}
      ${requests.length ? html`<div id="requests" class="do-next-list"><h3 class="do-next-sub">Maintenance Requests to confirm</h3>${requests.map((r) => requestRow(r, q, now))}</div>` : ''}
      ${group('quotes-to-check', 'Quotes to check', n.toCheck.map((t) => ticketDecisionRow(t, 'check_quotes', now)))}
      ${group('inspections', 'Site Inspections to book', n.toBook.map((t) => ticketDecisionRow(t, 'book_inspection', now)))}
      ${group('quotes-to-choose', 'Firm Quotes to choose', n.toChoose.map((t) => ticketDecisionRow(t, 'choose_quote', now)))}
      <div id="alerts" class="do-next-list">
        ${alerts.length ? html`<h3 class="do-next-sub">Alerts</h3>` : ''}
        ${alerts.map((a) => alertRow(a, timeZone))}
      </div>
      ${total === 0 ? emptyState('No Maintenance Requests waiting for you. Nothing else needs you right now.') : ''}
      ${total > 0 && toReview.length === 0 ? html`<p id="urgent-repairs" class="do-next-clear">No Urgent Repair receipts to review</p>` : ''}
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
 * A Maintenance Request in "Do next", read like a docket: the issue, the
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
  switch (alert.kind) {
    case 'safety_risk':
      return queueRow({
        href: `/reimbursements/${alert.urgentRepairId}`,
        title: `Safety risk: ${alert.description}`,
        detail: streetOf(alert.propertyAddress),
        badges: [badge('Safety', 'error')],
        decision: true,
        actions: linkButton('Review the Urgent Repair', `/reimbursements/${alert.urgentRepairId}`, { size: 'sm' }),
      });
    case 'invite_more_tradies':
      return queueRow({
        href: `/tickets/${alert.ticketId}`,
        title: `Only ${alert.confirmedQuotes} confirmed ${alert.confirmedQuotes === 1 ? 'Quote' : 'Quotes'} after 72 hours`,
        detail: streetOf(alert.propertyAddress),
        badges: [badge('Quotes', 'warning')],
        decision: true,
        actions: linkButton('Ask more Tradies', `/tickets/${alert.ticketId}#job-${alert.jobId}-tradies`, { size: 'sm' }),
      });
    case 'owner_no_reply':
      return queueRow({
        href: `/tickets/${alert.ticketId}`,
        title: `${alert.ownerName}, the Property Owner, hasn't replied since ${formatWhen(alert.requestedAt, timeZone)}`,
        detail: streetOf(alert.propertyAddress),
        badges: [badge('Approval', 'warning')],
        decision: true,
        actions: alert.ownerPhone ? linkButton(`Call ${alert.ownerName}`, `tel:${alert.ownerPhone}`, { size: 'sm', title: alert.ownerPhone }) : html`<span class="text-xs text-muted">No phone number on file</span>`,
      });
    case 'rating_due':
      return queueRow({
        href: `/tickets/${alert.ticketId}`,
        title: `${alert.businessName} finished the Job`,
        detail: streetOf(alert.propertyAddress),
        badges: [badge('Rating', 'info')],
        decision: true,
        actions: linkButton('Rate the Tradie', `/tickets/${alert.ticketId}#job-${alert.jobId}`, { size: 'sm' }),
      });
    case 'tradie_no_visit_times':
      return queueRow({
        href: `/tickets/${alert.ticketId}`,
        title: `${alert.businessName} hasn't offered visit times`,
        detail: streetOf(alert.propertyAddress),
        badges: [badge('Visit', 'warning')],
        decision: true,
        actions: linkButton(`Chase ${alert.businessName}`, `/tickets/${alert.ticketId}#job-${alert.jobId}`, { size: 'sm' }),
      });
    case 'tenant_no_visit_pick':
      return queueRow({
        href: `/tickets/${alert.ticketId}`,
        title: "The Tenant hasn't picked a visit time",
        detail: streetOf(alert.propertyAddress),
        badges: [badge('Visit', 'warning')],
        decision: true,
        actions: linkButton('Ask the Tenant to pick', `/tickets/${alert.ticketId}#job-${alert.jobId}`, { size: 'sm' }),
      });
  }
}


// Inbox

type InboxThread = Awaited<ReturnType<PropertyManagerActions['inboxThreads']>>[number];
type InboxMessage = InboxThread['messages'][number];

/** The channel each message came by, in words and as a Phosphor icon. */
const CHANNEL: Record<string, { label: string; icon: string }> = {
  sms: { label: 'SMS', icon: 'chat-circle-text' },
  email: { label: 'Email', icon: 'envelope-simple' },
  whatsapp: { label: 'WhatsApp', icon: 'whatsapp-logo' },
};

/** Initials for an avatar, or "+" for a number with no name. */
function initialsOf(name: string): string {
  return name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '+';
}

/** The last thing said in a conversation. */
function lastMessage(thread: InboxThread): InboxMessage | undefined {
  return thread.messages.at(-1);
}

/**
 * The inbox in brief: the newest three conversations as one-line previews, and one
 * control that opens the whole inbox over the dashboard. Each preview opens the modal
 * on its own person.
 */
function inboxCard(threads: InboxThread[], total: number, timeZone: string): Html {
  const newest = threads.slice(0, 3);
  return html`<section class="inbox-card" id="inbox" aria-label="Inbox">
    <div class="inbox-card-head">
      <h2 class="inbox-card-title">Inbox</h2>
      ${threads.length ? html`<span class="inbox-card-count">${total} waiting</span>` : ''}
    </div>
    ${threads.length
      ? html`<ul class="inbox-previews">
            ${newest.map((thread, i) => {
              const last = lastMessage(thread);
              return html`<li><a class="inbox-preview" href="#inbox" data-inbox-open="${i}">
                <span class="inbox-avatar" aria-hidden="true">${initialsOf(thread.personName ?? thread.address)}</span>
                <span class="inbox-preview-main"><span class="inbox-preview-who">${thread.personName ?? thread.address}</span><span class="inbox-preview-text">${last?.text ?? thread.items[0]?.text ?? ''}</span></span>
                <time class="inbox-preview-when" datetime="${thread.latestAt}"><span class="inbox-when-full">${formatWhen(thread.latestAt, timeZone)}</span><span class="inbox-when-short">${formatTime(thread.latestAt, timeZone)}</span></time>
              </a></li>`;
            })}
          </ul>
          <a class="inbox-open" href="#inbox" data-inbox-open="0">Check ${total === 1 ? 'the message' : `all ${total} messages`}</a>`
      : html`<p class="inbox-empty">The inbox is empty.</p>`}
  </section>`;
}

/**
 * The inbox as a mail client over the dashboard: people on the left, with a search
 * over names, numbers and message text, and the selected person's whole history on the
 * right, each message saying its channel and time. The open inbox items keep their
 * triage actions in the thread, under "Waiting on you". A native dialog traps focus,
 * Escape closes it, and the button that opened it gets focus back.
 */
function inboxModal(threads: InboxThread[], people: Person[], timeZone: string, q: string): Html {
  const titleId = 'inbox-dialog-title';
  return html`<dialog id="inbox-dialog" class="inbox-modal" aria-labelledby="${titleId}">
    <div class="inbox-modal-head">
      <h2 id="${titleId}" class="section-title">Inbox</h2>
      <button type="button" class="inbox-modal-close" data-dialog-close aria-label="Close">${icon('x', { size: 'size-5' })}</button>
    </div>
    ${threads.length
      ? html`<div class="inbox-shell">
          <aside class="inbox-people">
            <label class="inbox-people-search">
              <span class="sr-only">Search people or messages</span>
              ${icon('magnifying-glass', { size: 'size-4' })}
              <input type="search" placeholder="Search people or messages" autocomplete="off" data-inbox-search />
            </label>
            <ul class="inbox-people-list" aria-label="Conversations">
              ${threads.map((thread, i) => inboxPerson(thread, i, timeZone))}
            </ul>
            <p class="inbox-no-matches" data-inbox-no-matches hidden>No people match that search.</p>
          </aside>
          <div class="inbox-thread-panes">
            ${threads.map((thread, i) => inboxThread(thread, i, people, timeZone, q))}
          </div>
        </div>`
      : html`<p class="inbox-empty inbox-modal-empty">The inbox is empty.</p>`}
  </dialog>`;
}

/** One person in the modal's left column: avatar, name or number, the last line and its time. */
function inboxPerson(thread: InboxThread, i: number, timeZone: string): Html {
  const last = lastMessage(thread);
  const haystack = [thread.personName ?? '', thread.address, ...thread.items.map((item) => item.text), ...thread.messages.map((message) => message.text)].join(' ').toLowerCase();
  return html`<li>
    <button type="button" class="inbox-person${i === 0 ? ' is-active' : ''}" data-inbox-person="${i}" data-inbox-haystack="${haystack}" aria-pressed="${i === 0 ? 'true' : 'false'}">
      <span class="inbox-avatar" aria-hidden="true">${initialsOf(thread.personName ?? thread.address)}</span>
      <span class="inbox-person-main">
        <span class="inbox-person-who">${thread.personName ?? thread.address}</span>
        <span class="inbox-person-preview">${last?.text ?? thread.items[0]?.text ?? ''}</span>
      </span>
      <span class="inbox-person-meta">
        <time datetime="${thread.latestAt}">${formatWhen(thread.latestAt, timeZone)}</time>
        ${thread.waiting ? html`<span class="inbox-waiting">${thread.waiting}</span>` : ''}
      </span>
    </button>
  </li>`;
}

/** One conversation on the right: its whole history oldest to newest, then what waits on the Property Manager. */
function inboxThread(thread: InboxThread, i: number, people: Person[], timeZone: string, q: string): Html {
  const headingId = `inbox-thread-${i}`;
  return html`<section class="inbox-thread" data-inbox-thread="${i}" aria-labelledby="${headingId}"${i === 0 ? '' : html` hidden`}>
    <header class="inbox-thread-head">
      <h3 id="${headingId}" class="inbox-thread-name">${thread.personName ?? thread.address}</h3>
      <p class="inbox-thread-sub">${thread.personName ? thread.address : 'Unknown sender'}${thread.waiting ? ` · ${thread.waiting} waiting` : ''}</p>
    </header>
    <ol class="inbox-messages">
      ${thread.messages.length
        ? thread.messages.map((message) => inboxMessage(message, timeZone))
        : html`<li class="inbox-message-empty">No messages recorded with this person yet.</li>`}
    </ol>
    ${thread.items.length
      ? html`<div class="inbox-triage-list">
          <h4 class="inbox-triage-title">Waiting on you</h4>
          ${thread.items.map((item) => triageCard(item, people, timeZone, q, `thread-${i}-`))}
        </div>`
      : ''}
  </section>`;
}

/** One message in a thread: its channel, when it came, and whether it came in or went out. */
function inboxMessage(message: InboxMessage, timeZone: string): Html {
  const inbound = message.direction === 'in';
  const channel = CHANNEL[message.channel] ?? { label: humanise(message.channel), icon: 'chat-circle-text' };
  return html`<li class="inbox-message ${inbound ? 'is-in' : 'is-out'}">
    <div class="inbox-message-head">
      <span class="inbox-message-channel">${icon(channel.icon, { size: 'size-3.5' })}${channel.label}</span>
      <span class="inbox-message-direction">${icon(inbound ? 'arrow-down-left' : 'arrow-up-right', { size: 'size-3.5' })}${inbound ? 'Received' : 'Sent'}</span>
      <time class="inbox-message-time" datetime="${message.at}">${formatWhen(message.at, timeZone)}</time>
    </div>
    <p class="inbox-message-text">${message.text}</p>
  </li>`;
}

/**
 * One open inbox message's triage block: the classification, the agent's best guess,
 * and linking the sender, routing and dismissing, exactly as the inbox has always
 * offered them. `idPrefix` keeps two conversations' fields apart.
 */
function triageCard(item: InboxItem, people: Person[], timeZone: string, q: string, idPrefix = ''): Html {
  const [reason, tone] = INBOX_REASON[item.reason];
  const base = `/inbox/${item.itemId}`;
  const guesses = item.bestGuess && Object.keys(item.bestGuess).length ? item.bestGuess : null;
  return html`<article class="inbox-item${item.personId === null ? ' is-unknown' : ''}" id="${idPrefix}inbox-${item.itemId}">
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
    ${item.reason === 'shared_address'
      ? sharedAddressNote(
          'Could be',
          item.candidates.map((c) => ({ label: `${c.name} (${ROLE_LABEL[c.role]})`, href: profileHref(c.role, c.personId) })),
        )
      : ''}
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
              id: `${idPrefix}person-${item.itemId}`,
              type: 'select',
              required: true,
              placeholder: 'Search people by name',
              search: true,
              options: people.map((p) => ({ value: String(p.id), label: personLabel(p) })),
              hint:
                item.reason === 'shared_address'
                  ? 'This message is recorded as theirs. A later message from this address is still shared.'
                  : 'Their next message from this address will be recognised.',
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

// Tickets by stage

/**
 * Tickets by stage: a bar and counts that show where the open Tickets are, then one
 * soft row for each Ticket with its progress through the five stages. The core gives
 * each Ticket its stage, Quote counts and whether it needs a decision; this only draws
 * them. With no open Tickets at all it is one empty state, not five.
 */
function ticketsByStage(tickets: BoardTicket[], filter: Filter, now: Date): Html {
  const counts = STAGES.map((stage) => tickets.filter((t) => t.stage === stage).length);
  return section({
    title: 'Tickets by stage',
    id: 'tickets',
    actions: linkButton('See all Tickets', filter === 'all' ? '/tickets?filter=all' : '/tickets', { variant: 'ghost', size: 'sm' }),
    body: tickets.length
      ? html`<div class="stage-board">
          <p class="stage-caption">All open Tickets by stage</p>
          <div class="stage-scale" aria-hidden="true">${STAGES.map((stage, i) => html`<i class="stage-${stage}" style="flex-grow:${counts[i]}"></i>`)}</div>
          <ul class="stage-counts">${STAGES.map((stage, i) => html`<li${counts[i] === 0 ? html` class="is-zero"` : ''}><b>${counts[i]}</b> ${STAGE_SHORT[stage]}</li>`)}</ul>
          <div class="stage-rows">${STAGES.flatMap((stage) => tickets.filter((t) => t.stage === stage).map((t) => ticketRow(t, now)))}</div>
        </div>`
      : emptyState(filter === 'mine' ? 'No open Tickets on your Properties. Confirming a Maintenance Request opens one.' : 'No open Tickets. Confirming a Maintenance Request opens one.'),
  });
}

/** What a Ticket being quoted waits on: Quotes to check, Firm Quotes to choose, or how many Quotes are in. */
function quotingStatus(t: Pick<BoardTicket, 'quoting' | 'decision'>): string | null {
  const q = t.quoting;
  if (!q) return null;
  if (t.decision === 'check_quotes') return `${q.toCheck} ${q.toCheck === 1 ? 'Quote' : 'Quotes'} to check`;
  if (t.decision === 'choose_quote') return 'Firm Quotes to choose';
  if (t.decision === 'book_inspection') return 'Site Inspection to book';
  if (!q.asked && !q.received) return 'No Quote Requests yet';
  const of = Math.max(q.asked, q.received);
  // Estimates and Firm Quotes are counted apart, never added together.
  return `${q.received} of ${of} ${of === 1 ? 'Estimate' : 'Estimates'} in${q.firm ? `, ${q.firm} ${q.firm === 1 ? 'Firm Quote' : 'Firm Quotes'}` : ''}`;
}

/** One Ticket as a soft row: its number, the issue and where, and how far along it is (filled segments up to its stage, then the stage's name). */
function ticketRow(t: BoardTicket, now: Date): Html {
  const quoting = quotingStatus(t);
  const reached = STAGES.indexOf(t.stage);
  const street = t.propertyAddress.replace(/\s+[A-Z]{2,3}\s+\d{4}$/, '').split(',')[0]!;
  return html`<a href="/tickets/${t.ticketId}" class="ticket-row${t.decision !== null ? ' is-decision' : ''}">
    <span class="ticket-row-id">#${t.ticketId}</span>
    <span class="ticket-row-main">
      <span class="ticket-row-title">${t.description}${t.unreadMessages ? html`<span class="unread-dot" aria-hidden="true"></span><span class="sr-only">unread messages</span>` : ''}</span>
      <span class="ticket-row-sub">${street} · ${ageOf(t.reportedAt, now)}${quoting ? html` · ${quoting}` : ''}${t.urgency === 'urgent' || t.urgency === 'high' ? html` · <span class="ticket-row-urgency is-${t.urgency}">${humanise(t.urgency)}</span>` : ''}</span>
    </span>
    <span class="ticket-row-stage">
      <span class="stage-segs" aria-hidden="true">${STAGES.map((stage, i) => html`<i class="${i <= reached ? `on stage-${t.stage}` : ''}"></i>`)}</span>
      <span class="ticket-row-stage-name">${STAGE_SHORT[t.stage]}</span>
    </span>
  </a>`;
}

// Next 7 days

/** A day chip's link: that day, and Mine or All as the page already has it. */
function dayHref(day: string, filter: Filter) {
  const params = new URLSearchParams();
  if (filter === 'all') params.set('filter', 'all');
  params.set('day', day);
  return `/?${params.toString()}#next-7-days`;
}

/** The same day, as the fragment the chip fetches so the rest of the dashboard stays put. */
function dayFragment(day: string, filter: Filter) {
  const params = new URLSearchParams();
  params.set('day', day);
  if (filter === 'all') params.set('filter', 'all');
  return `/next-7-days?${params.toString()}`;
}

/** Mine or All, keeping the chosen day and returning to the strip when one is set. */
function scopeHref(filter: Filter, day: string | undefined) {
  const params = new URLSearchParams();
  if (filter === 'all') params.set('filter', 'all');
  if (day) params.set('day', day);
  const query = params.toString();
  return `/${query ? `?${query}` : ''}${day ? '#next-7-days' : ''}`;
}

/** Open calendar for `date`, keeping All when the dashboard is showing everyone's visits. */
function calendarHref(date: string, filter: Filter) {
  const params = new URLSearchParams({ view: 'day', date });
  if (filter === 'all') params.set('filter', 'all');
  return `/calendar?${params}`;
}

/** Today, the seven days from it, and the day the strip shows. `kept` is set only when the query named one of those days. */
function shownDay(now: Date, timeZone: string, dayQuery: string | undefined) {
  const today = dayOf(now, timeZone);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const asked = parseDay(dayQuery);
  const kept = asked && days.includes(asked) ? asked : undefined;
  return { today, days, chosen: kept ?? today, kept };
}

/**
 * Today and the six days after it, in the Agency's time zone. Each day is a link (and a
 * fragment the page fetches in place), and the chosen one (today, when `day` is missing
 * or not one of the seven) is filled; today stays ringed when another day is chosen.
 * Under the strip, that day's visits in time order. The dashboard and `GET /next-7-days`
 * both draw this.
 */
function nextSevenDays(bookings: Booking[], now: Date, timeZone: string, dayQuery: string | undefined, filter: Filter, pmId: number): Html {
  const { today, days, chosen } = shownDay(now, timeZone, dayQuery);
  // Mine keeps the Property Manager's own visits; All keeps the Agency's.
  const scoped = filter === 'mine' ? bookings.filter((b) => b.propertyManagerId === pmId) : bookings;
  const byDay = new Map<string, Booking[]>();
  for (const b of scoped) {
    const day = dayOf(b.start, timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }
  const weekday = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short' });
  const dateOf = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric' });
  const visits = byDay.get(chosen) ?? [];
  // With nothing on the chosen day, say where the next visit is rather than leaving a dead end.
  const next = visits.length ? undefined : [...scoped].sort((a, b) => a.start.localeCompare(b.start)).find((b) => dayOf(b.start, timeZone) >= chosen);
  return section({
    title: 'Next 7 days',
    id: 'next-7-days',
    actions: linkButton('Open calendar', calendarHref(chosen, filter), { variant: 'ghost', size: 'sm' }),
    body: html`<ol class="day-strip">
        ${days.map((day) => {
          const at = new Date(`${day}T00:00:00Z`);
          return html`<li><a class="day-chip${day === today ? ' is-today' : ''}" href="${dayHref(day, filter)}" data-fragment="${dayFragment(day, filter)}" ${day === chosen ? html`aria-current="date"` : ''}><time datetime="${day}"><span class="day-name">${weekday.format(at)}</span><span class="day-num">${dateOf.format(at)}</span></time>${day === today ? html`<span class="sr-only">today</span>` : ''}${byDay.has(day) ? html`<span class="day-dot" role="img" aria-label="Has a visit"></span>` : ''}</a></li>`;
        })}
      </ol>
      <h3 class="visit-heading">${longDay(chosen)}</h3>
      ${visits.length
        ? html`<ul class="visit-list">${visits.slice(0, 2).map((b) => visitRow(b, timeZone))}</ul>${visits.length > 2 ? html`<a class="visit-more" href="${calendarHref(chosen, filter)}">+${visits.length - 2} more ${visits.length - 2 === 1 ? 'visit' : 'visits'} this day</a>` : ''}`
        : next
          ? nextVisitLine(next, timeZone)
          : html`<p class="visit-none">Nothing booked in the next 7 days.</p>`}`,
  });
}

/** "Next: Mon 9, 10:00 am · FixIt Carpentry · 9 Albion St": the first visit after an empty day. */
function nextVisitLine(b: Booking, timeZone: string): Html {
  const day = dayOf(b.start, timeZone);
  const at = new Date(`${day}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short' }).format(at);
  const date = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric' }).format(at);
  const time = new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(b.start));
  return html`<p class="visit-next">Next: ${weekday} ${date}, ${time} · ${b.businessName} · ${streetOf(b.propertyAddress)}</p>`;
}

/** One booked visit: the time, the Tradie (linked to the profile), the issue and street (linked to the Ticket), and a Site inspection badge when it is one. */
function visitRow(b: Booking, timeZone: string): Html {
  const time = new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(b.start));
  const kind = visitKind(b);
  return html`<li class="visit-row">
    <time datetime="${b.start}" class="visit-time num">${time}</time>
    <span class="visit-what">
      <a class="visit-tradie" href="/tradies/${b.tradieId}">${b.businessName}</a>
      <a class="visit-place" href="${ticketHref(b)}">${b.issue} · ${streetOf(b.propertyAddress)}</a>
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

/** Urgent Repairs as a compact list: the issue (linked to its Reimbursement Request), where, who and when, then the Urgent badge and where the receipt stands, with the receipt's review as the row's action. */
function urgentRepairsList(repairs: UrgentRepair[], timeZone: string): Html {
  if (!repairs.length) return emptyState('No Urgent Repairs reported.');
  return html`<ul class="urgent-list">
    ${repairs.map(
      (u) => html`<li class="urgent-item">
        <div class="urgent-main">
          <p class="urgent-issue">${rowLink(u.description, `/reimbursements/${u.urgentRepairId}`)}</p>
          <p class="urgent-meta">${streetOf(u.propertyAddress)} · ${u.tenantName} · ${formatWhen(u.reportedAt, timeZone)}</p>
          <p class="urgent-foot">${urgencyBadge('urgent')}${reimbursementBadge(u.status)}<span class="urgent-receipts">${u.receipts === 1 ? '1 receipt' : u.receipts ? `${u.receipts} receipts` : 'No receipts yet'}</span></p>
        </div>
        <div class="urgent-actions">${linkButton('Review the receipt', `/reimbursements/${u.urgentRepairId}`, { size: 'sm' })}</div>
      </li>`,
    )}
  </ul>`;
}

// Inbox helpers

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
