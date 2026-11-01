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

/** The board's lanes, named as the Property Manager says them. */
/** The same stages in a few words, for the counts above the Ticket rows. */
const STAGE_SHORT: Record<Stage, string> = {
  quoting: 'Quoting',
  awaiting_owner: 'With owner',
  approved: 'Ready',
  scheduled: 'Booked',
  done: 'Done',
};

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
    const shown = shownDay(now, timeZone, c.req.query('day'));
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
          { label: 'Mine', href: scopeHref('mine', shown.kept), active: filter === 'mine' },
          { label: 'All', href: scopeHref('all', shown.kept), active: filter === 'all' },
        ]),
        body: html`
          ${greeting(pm.name, view, needReceipt)}
          <div class="dashboard-desk">
            <div class="dash-col">
              ${glance(view, needReceipt, waiting, filter)}
              ${doNext({ view, ...decided, q, timeZone, now, shareLink: shareUrl(c, '/?filter=all#requests') })}
            </div>
            <div class="dash-col">
              ${inboxCard(view.inbox, people, timeZone, q)}
              ${nextSevenDays(view.calendar, now, timeZone, c.req.query('day'), filter)}
              ${ticketsByStage(view.tickets, filter, now)}
            </div>
          </div>
          ${inboxDialog(view.inbox, people, timeZone, q)}
          ${alertsDialog(view.alerts, timeZone)}
        `,
      }),
    );
  });

  // The day strip asks for this on its own, so choosing a day does not redraw the dashboard.
  // The visits are the same window dashboard() returns, which Mine and All do not narrow.
  pages.get('/next-7-days', async (c) => {
    const { actions } = c.var;
    const { timeZone } = actions.agency();
    const now = actions.now();
    const bookings = await actions.calendar(dashboardCalendarRange(now, timeZone));
    return c.html(nextSevenDays(bookings, now, timeZone, c.req.query('day'), filterOf(c)));
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

/** "Hi, Kevin" and what is waiting, in one line. */
function greeting(name: string, view: Dashboard, needReceipt: number): Html {
  const first = name.trim().split(/\s+/)[0] || name;
  const things = view.maintenanceRequests.length + view.alerts.length + needReceipt;
  const waiting = things === 0 ? 'Nothing needs you right now' : `${things} ${things === 1 ? 'thing needs' : 'things need'} you today`;
  const inbox = view.inbox.length ? ` · ${view.inbox.length} ${view.inbox.length === 1 ? 'message' : 'messages'} in the inbox` : '';
  return html`<div class="dash-hello">
    <h2 class="dash-hello-name">Hi, ${first}</h2>
    <p class="dash-hello-line">${waiting}${inbox}</p>
  </div>`;
}

/** Counts that size the bubbles: more of something, a bigger bubble, within a cap. */
const bubbleSize = (count: number, min: number, step: number, max: number) => (count === 0 ? min : Math.min(max, min + 14 + count * step));

type Decided = { toCheck: BoardTicket[]; toBook: BoardTicket[]; toChoose: BoardTicket[] };

/** The Tickets list, keeping All when the dashboard is showing everyone's work. */
function ticketsHref(filter: Filter) {
  return filter === 'all' ? '/tickets?filter=all' : '/tickets';
}

type GlanceItem = {
  cls: string;
  /** The word in the bubble. */
  label: string;
  /** The words in the legend, when they are longer than the bubble. */
  legend: string;
  count: number;
  href: string;
  size: number;
  /** Set when the bubble opens a dialog instead of a page. The href stays an anchor for when JavaScript is off. */
  dialog?: string;
};

/**
 * Today at a glance: a soft card of bubbles, one for each thing a Property Manager
 * counts (Open Tickets, Alerts, Maintenance Requests, Quotes, the inbox, and Urgent
 * Repairs when one needs a receipt). Open Tickets, Requests, Quotes and Urgent open
 * their lists. Inbox and Alerts open a dialog over the dashboard (the legend does
 * the same). A bubble's size follows its count. The Tickets list has no view that is
 * only quote decisions or Urgent Repairs, so those two open `/tickets`.
 */
function glance(view: Dashboard, needReceipt: number, waiting: number, filter: Filter): Html {
  const tickets = view.tickets.length;
  const alerts = view.alerts.length;
  const requests = view.maintenanceRequests.length;
  const inbox = view.inbox.length;
  const list = ticketsHref(filter);
  const items: GlanceItem[] = [
    { cls: 'is-tickets', label: 'Open Tickets', legend: 'Open Tickets', count: tickets, href: list, size: bubbleSize(tickets, 80, 12, 164) },
    { cls: 'is-alerts', label: 'Alerts', legend: 'Alerts', count: alerts, href: '#alerts', dialog: 'alerts-dialog', size: bubbleSize(alerts, 68, 14, 132) },
    { cls: 'is-requests', label: 'Requests', legend: 'Requests', count: requests, href: '/requests', size: bubbleSize(requests, 64, 20, 108) },
    { cls: 'is-quotes', label: 'Quotes', legend: 'Quote decisions', count: waiting, href: list, size: bubbleSize(waiting, 60, 14, 96) },
    { cls: 'is-inbox', label: 'Inbox', legend: 'Inbox', count: inbox, href: '#inbox', dialog: 'inbox-dialog', size: bubbleSize(inbox, 60, 10, 98) },
    ...(needReceipt
      ? [{ cls: 'is-urgent', label: 'Urgent', legend: 'Urgent Repairs', count: needReceipt, href: list, size: bubbleSize(needReceipt, 60, 14, 96) }]
      : []),
  ];
  return html`<section class="glance" aria-label="Today at a glance">
    <div class="glance-key">
      <h3 class="glance-title">Your day<br />at a glance</h3>
      <ul class="glance-legend">
        ${items.map((item) => legendItem(item))}
      </ul>
    </div>
    <div class="glance-bubbles" role="group" aria-label="Counts">
      ${items.map((item, i) => bubble(item, i))}
    </div>
  </section>`;
}

/** A legend row: the same destination as its bubble. */
function legendItem(item: GlanceItem): Html {
  const dialog = item.dialog ? html` data-dialog="${item.dialog}" aria-haspopup="dialog"` : '';
  return html`<li class="${item.cls}"><a href="${item.href}" class="glance-legend-link"${dialog}><i></i>${item.legend}<b>${item.count}</b></a></li>`;
}

/** One bubble. The glyph under the count says whether it opens a page or a dialog. */
function bubble(item: GlanceItem, i: number): Html {
  const dialog = item.dialog ? html` data-dialog="${item.dialog}" aria-haspopup="dialog"` : '';
  return html`<a href="${item.href}" class="bubble ${item.cls}${item.count === 0 ? ' is-zero' : ''}" style="--size:${item.size}px;--i:${i}"${dialog}><span class="bubble-num">${item.count}</span><span class="bubble-go">${icon(item.dialog ? 'tray' : 'arrow-up-right', { size: 'size-3.5' })}</span><span class="bubble-label">${item.label}</span></a>`;
}

/**
 * Inbox and Alerts over the dashboard. The rows are the same ones the card and
 * Do next draw, so linking a sender, routing, dismissing and each alert's action
 * post as they do there. An id prefix keeps the dialog's fields from repeating the
 * card's. Without JavaScript the bubbles are anchors and these stay closed.
 */
function inboxDialog(items: InboxItem[], people: Person[], timeZone: string, q: string): Html {
  const byNewest = [...items].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return glanceDialog({
    id: 'inbox-dialog',
    title: 'Inbox',
    body: html`<div class="dashboard-inbox">${inboxList(byNewest, people, timeZone, q, 'dialog-')}</div>`,
  });
}

function alertsDialog(alerts: Alert[], timeZone: string): Html {
  return glanceDialog({
    id: 'alerts-dialog',
    title: 'Alerts',
    body: alerts.length ? html`<div class="grid gap-2">${alerts.map((alert) => alertRow(alert, timeZone))}</div>` : emptyState('No alerts.'),
  });
}

function glanceDialog(o: { id: string; title: string; body: Html }): Html {
  const titleId = `${o.id}-title`;
  return html`<dialog id="${o.id}" class="glance-dialog" aria-labelledby="${titleId}">
    <div class="glance-dialog-head">
      <h2 id="${titleId}" class="section-title">${o.title}</h2>
      <button type="button" class="glance-dialog-close" data-dialog-close aria-label="Close">${icon('x', { size: 'size-5' })}</button>
    </div>
    <div class="glance-dialog-body">${o.body}</div>
  </dialog>`;
}

// Do next

/**
 * Maintenance Requests (oldest first, as the core orders them), then alerts: the
 * things only the Property Manager can do, each a soft row with its action. Urgent
 * Repairs that need a receipt sit above them, and when there are none one quiet line
 * says so. `shareLink` is the Agency-wide list of Maintenance Requests, which a Share
 * button passes on when there are any.
 */
function doNext(n: Decided & { view: Dashboard; q: string; timeZone: string; now: Date; shareLink: string }): Html {
  const { view, q, timeZone, now, shareLink } = n;
  const requests = view.maintenanceRequests;
  const waiting = requests.length + n.toCheck.length + n.toBook.length + n.toChoose.length + view.alerts.length;
  const group = (id: string, title: string, rows: Html[]) =>
    rows.length ? html`<div id="${id}" class="do-next-list"><h3 class="do-next-sub">${title}</h3>${rows}</div>` : '';
  return section({
    title: 'Do next',
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
      ${view.urgentRepairs.length ? html`<div id="urgent-repairs" class="do-next-urgent"><h3 class="do-next-sub">Urgent Repairs</h3>${urgentRepairsList(view.urgentRepairs, timeZone)}</div>` : ''}
      <div id="requests" class="do-next-list">
        ${requests.map((r) => requestRow(r, q, now))}
      </div>
      ${group('quotes-to-check', 'Quotes to check', n.toCheck.map((t) => ticketDecisionRow(t, 'check_quotes', now)))}
      ${group('inspections', 'Site Inspections to book', n.toBook.map((t) => ticketDecisionRow(t, 'book_inspection', now)))}
      ${group('quotes-to-choose', 'Quotes to choose', n.toChoose.map((t) => ticketDecisionRow(t, 'choose_quote', now)))}
      <div id="alerts" class="do-next-list">
        ${view.alerts.map((a) => alertRow(a, timeZone))}
      </div>
      ${waiting === 0 ? emptyState('No Maintenance Requests waiting for you. Nothing else needs you right now.') : ''}
      ${view.urgentRepairs.length === 0 ? html`<p id="urgent-repairs" class="do-next-clear">No Urgent Repairs</p>` : ''}
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
        actions: alert.ownerPhone ? linkButton(`Call ${alert.ownerPhone}`, `tel:${alert.ownerPhone}`, { size: 'sm' }) : html`<span class="text-xs text-muted">No phone number on file</span>`,
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
        actions: linkButton('Open the Ticket', `/tickets/${alert.ticketId}#job-${alert.jobId}`, { size: 'sm' }),
      });
    case 'tenant_no_visit_pick':
      return queueRow({
        href: `/tickets/${alert.ticketId}`,
        title: "The Tenant hasn't picked a visit time",
        detail: streetOf(alert.propertyAddress),
        badges: [badge('Visit', 'warning')],
        decision: true,
        actions: linkButton('Open the Ticket', `/tickets/${alert.ticketId}#job-${alert.jobId}`, { size: 'sm' }),
      });
  }
}


// Inbox

/**
 * The inbox in brief: the three newest messages as one-line previews, and a button
 * that opens every message with its actions (link the sender, route, dismiss). The
 * full list opens over the card, so the page keeps its shape.
 */
function inboxCard(items: InboxItem[], people: Person[], timeZone: string, q: string): Html {
  const byNewest = [...items].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const newest = byNewest.slice(0, 3);
  const initials = (name: string) => name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '+';
  return html`<section class="inbox-card" id="inbox" aria-label="Inbox">
    <div class="inbox-card-head">
      <h3 class="inbox-card-title">Inbox</h3>
      ${items.length ? html`<span class="inbox-card-count">${items.length} waiting</span><span class="inbox-card-note">Latest ${newest.length}</span>` : ''}
    </div>
    ${items.length
      ? html`<ul class="inbox-previews">
            ${newest.map(
              (item) => html`<li><a class="inbox-preview" href="#inbox-${item.itemId}">
                <span class="inbox-avatar" aria-hidden="true">${initials(item.personName ?? '')}</span>
                <span class="inbox-preview-main"><span class="inbox-preview-who">${item.personName ?? item.from}</span><span class="inbox-preview-text">${item.text}</span></span>
                <time class="inbox-preview-when" datetime="${item.receivedAt}">${formatWhen(item.receivedAt, timeZone)}</time>
              </a></li>`,
            )}
          </ul>
          <details class="inbox-more">
            <summary><span class="when-closed">Check ${items.length === 1 ? 'the message' : `all ${items.length} messages`}</span><span class="when-open">Close messages</span></summary>
            <div class="inbox-panel dashboard-inbox">${inboxList(byNewest, people, timeZone, q)}</div>
          </details>`
      : html`<p class="inbox-empty">The inbox is empty.</p>`}
  </section>`;
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
          <div class="stage-scale" aria-hidden="true">${STAGES.map((stage, i) => html`<i class="stage-${stage}" style="flex-grow:${counts[i]}"></i>`)}</div>
          <ul class="stage-counts">${STAGES.map((stage, i) => html`<li${counts[i] === 0 ? html` class="is-zero"` : ''}><b>${counts[i]}</b> ${STAGE_SHORT[stage]}</li>`)}</ul>
          <div class="stage-rows">${STAGES.flatMap((stage) => tickets.filter((t) => t.stage === stage).map((t) => ticketRow(t, now)))}</div>
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
      <span class="ticket-row-stage-name">${STAGE_TITLE[t.stage]}</span>
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
function nextSevenDays(bookings: Booking[], now: Date, timeZone: string, dayQuery: string | undefined, filter: Filter): Html {
  const { today, days, chosen } = shownDay(now, timeZone, dayQuery);
  const byDay = new Map<string, Booking[]>();
  for (const b of bookings) {
    const day = dayOf(b.start, timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }
  const weekday = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short' });
  const weekdayLong = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'long' });
  const dateOf = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric' });
  const visits = byDay.get(chosen) ?? [];
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

function inboxList(items: InboxItem[], people: Person[], timeZone: string, q: string, idPrefix = ''): Html {
  if (!items.length) return emptyState('The inbox is empty.');
  return html`<div class="grid gap-2">${items.map((item) => inboxItem(item, people, timeZone, q, idPrefix))}</div>`;
}

/**
 * One inbox item, compact: the message, who sent it and when, then the agent's best
 * guess in one line beside the actions. Every answer behind the guess is one click away.
 */
function inboxItem(item: InboxItem, people: Person[], timeZone: string, q: string, idPrefix = ''): Html {
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
    <blockquote class="inbox-item-text">${item.text}</blockquote>
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
