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
import { COLLEAGUES_ONLY, shareButton, shareUrl } from '../share.ts';
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
  section,
  segmented,
  table,
  urgencyBadge,
  statusBadge,
  type Html,
  type Tone,
} from '../ui.ts';
import type { Booking } from './calendar.ts';
import { finishSetupBanner } from './welcome.ts';

type Dashboard = Awaited<ReturnType<PropertyManagerActions['dashboard']>>;
type MaintenanceRequest = Dashboard['maintenanceRequests'][number];
type TicketSummary = Dashboard['tickets'][number];
type UrgentRepair = Dashboard['urgentRepairs'][number];
type InboxItem = Dashboard['inbox'][number];
type Alert = Dashboard['alerts'][number];
type Person = Awaited<ReturnType<PropertyManagerActions['people']>>[number];
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
  '[&_.docket-address]:!whitespace-normal',
  '[&_.docket-address]:line-clamp-2',
  '[&_.docket-issue]:!whitespace-normal',
  '[&_.docket-issue]:line-clamp-2',
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

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const filter = filterOf(c);
    const view = await actions.dashboard({ filter });
    const { timeZone } = actions.agency();
    const now = actions.now();
    const people = view.inbox.some((item) => item.personId === null) ? await actions.people() : [];
    const q = filter === 'all' ? '?filter=all' : '';
    const needReceipt = view.urgentRepairs.filter((u) => u.status === 'reminder_sent').length;
    const board = await boardOf(actions, view.tickets);

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
          ${(await finishSetupBanner(actions))}
          ${countStrip([
            { label: 'Maintenance Requests to review', count: view.maintenanceRequests.length, href: '#requests', decision: true },
            { label: 'Open Tickets', count: view.tickets.length, href: '#tickets' },
            { label: 'Alerts', count: view.alerts.length, href: '#alerts', decision: true },
            { label: 'In the inbox', count: view.inbox.length, href: '#inbox', decision: true },
            { label: 'Urgent Repairs needing a receipt', count: needReceipt, href: '#urgent-repairs' },
          ])}
          <div class="dispatch grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
            <div class="min-w-0 [&_.section]:!p-2.5">${decisions(view, q, timeZone, now, shareUrl(c, '/?filter=all#requests'))}</div>
            <div class="grid min-w-0 gap-4">
              ${ticketsByStage(board, now)}
              ${nextSevenDays(view.calendar, now, timeZone)}
            </div>
          </div>
          ${section({ title: 'Urgent Repairs', id: 'urgent-repairs', actions: countBadge(view.urgentRepairs.length), body: urgentRepairsTable(view.urgentRepairs, timeZone) })}
          ${section({ title: 'Inbox', id: 'inbox', actions: countBadge(view.inbox.length), body: inboxList(view.inbox, people, timeZone, q) })}
          ${section({ title: 'All open Tickets', id: 'open-tickets', actions: countBadge(view.tickets.length), body: ticketsTable(view.tickets, filter, timeZone) })}
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

/**
 * Maintenance Requests (oldest first), then alerts, then inbox items: the decisions,
 * each with its actions. `shareLink` is the Agency-wide list of Maintenance
 * Requests, which a Share button passes on when there are any.
 */
function decisions(view: Dashboard, q: string, timeZone: string, now: Date, shareLink: string): Html {
  const requests = [...view.maintenanceRequests].sort((a, b) => a.reportedAt.localeCompare(b.reportedAt));
  return section({
    title: 'Needs your decision',
    id: 'decisions',
    body: html`<div class="grid gap-4">
      <div id="requests" class="grid gap-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-semibold">Maintenance Requests to review</h3>
          ${requests.length
            ? shareButton({
                title: 'Maintenance Requests to review',
                text: `${requests.length} ${requests.length === 1 ? 'Maintenance Request is' : 'Maintenance Requests are'} waiting for review in myEST8.`,
                url: shareLink,
                note: COLLEAGUES_ONLY,
              })
            : ''}
        </div>
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

/** A Maintenance Request in "Needs your decision": its photo, street, one-line description and badges, with Confirm and Review. */
function requestRow(r: MaintenanceRequest, q: string, now: Date): Html {
  const [first] = r.photos;
  const flagged = r.photos.some((p) => p.metadata !== 'ok' && p.metadata !== 'no_metadata');
  const thumb = first
    ? html`<img src="/files/${first.fileId}" alt="Photo of ${r.propertyAddress}" width="48" height="48" loading="lazy" class="size-full object-cover" />`
    : html`<span class="flex size-full items-center justify-center p-1 text-center text-[11px] leading-tight text-muted">No photos</span>`;
  const flags = [
    ...(r.checkUrgency ? ['Check urgency'] : []),
    ...(r.checkTrade ? ['Check trade'] : []),
    ...(flagged ? ['Flagged photos'] : []),
    ...(r.noPhotos ? ['No photos'] : []),
  ];
  // Urgency, Trade and at most one flag; the rest of the flags count as "+N" so the line never wraps.
  const [firstFlag, ...moreFlags] = flags;
  const badges = [
    html`<span class="shrink-0">${urgencyBadge(r.urgency)}</span>`,
    html`<span class="min-w-0 shrink overflow-hidden">${badge(humanise(r.trade))}</span>`,
    ...(firstFlag ? [html`<span class="min-w-0 shrink overflow-hidden">${badge(firstFlag, 'warning')}</span>`] : []),
    ...(moreFlags.length ? [html`<span class="shrink-0"><span class="badge badge-soft badge-neutral whitespace-nowrap" title="${moreFlags.join(', ')}">+${moreFlags.length}</span></span>`] : []),
  ];
  return decisionRow({
    thumb,
    title: addressTitle(r.propertyAddress),
    detail: r.description,
    oneLine: true,
    badges,
    meta: ageOf(r.reportedAt, now),
    actions: html`${postButton(`/requests/${r.issueId}/confirm${q}`, 'Confirm', { size: 'sm' })}${linkButton('Review', `/requests/${r.issueId}`, { variant: 'secondary', size: 'sm' })}`,
  });
}

/**
 * A row in "Needs your decision": a 4px hi-vis stripe, an optional thumbnail, a title
 * line with its actions on the right, a detail line with its age, and a line of badges
 * that is clipped rather than wrapped.
 */
function decisionRow(o: { thumb?: Html; title: Html; detail?: Html | string; oneLine?: boolean; badges?: Html[]; meta?: string; actions?: Html }): Html {
  return html`<article class="flex min-w-0 items-start gap-3 rounded border border-line border-l-4 border-l-hivis bg-surface px-3 py-1.5">
    ${o.thumb ? html`<div class="size-12 shrink-0 overflow-hidden rounded bg-page">${o.thumb}</div>` : ''}
    <div class="grid min-w-0 flex-1 gap-0.5">
      <div class="flex min-w-0 items-center gap-2">
        <p class="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm leading-snug">${o.title}</p>
        ${o.actions ? html`<div class="flex shrink-0 items-center gap-1.5 [&_.btn]:!h-7 [&_.btn]:!min-h-7 [&_.btn]:!px-2.5 [&_.btn]:!text-xs">${o.actions}</div>` : ''}
      </div>
      ${o.detail
        ? html`<p class="flex min-w-0 items-baseline gap-2 text-sm"><span class="${o.oneLine ? 'truncate' : 'line-clamp-2'} min-w-0 flex-1">${o.detail}</span>${o.meta ? html`<span class="shrink-0 text-xs text-muted">${o.meta}</span>` : ''}</p>`
        : ''}
      ${o.badges?.length ? html`<div class="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap [&_.badge]:max-w-full [&_.badge]:justify-start [&_.badge]:truncate">${o.badges}</div>` : ''}
    </div>
  </article>`;
}

/** A street address as a title: the street, with the suburb and postcode muted beside it. The full address is in the tooltip. */
function addressTitle(address: string, href?: string): Html {
  const street = streetOf(address);
  const suburb = address.slice(street.length).replace(/^,\s*/, '').trim();
  return html`<span class="max-w-[78%] shrink-0 truncate font-semibold" title="${address}">${href ? html`<a class="link" href="${href}">${street}</a>` : street}</span>${suburb ? html`<span class="min-w-0 flex-1 truncate text-muted">${suburb}</span>` : ''}`;
}

/** The street part of an address: "12 King St" from "12 King St, Newtown NSW 2042". */
function streetOf(address: string) {
  return address.split(',')[0]?.trim() || address;
}

/** Each alert keeps its wording and links to its Ticket. */
function alertRow(alert: Alert, timeZone: string): Html {
  const title = addressTitle(alert.propertyAddress, `/tickets/${alert.ticketId}`);
  switch (alert.kind) {
    case 'invite_more_tradies':
      return decisionRow({
        title,
        detail: `Only ${alert.confirmedQuotes} confirmed ${alert.confirmedQuotes === 1 ? 'Quote' : 'Quotes'} for the Job after 72 hours.`,
        oneLine: true,
        actions: badge('Quotes', 'warning'),
      });
    case 'owner_no_reply':
      return decisionRow({
        title,
        detail: html`${alert.ownerName}, the Property Owner, hasn't replied since ${formatWhen(alert.requestedAt, timeZone)}. ${alert.ownerPhone
          ? html`Call <a class="link" href="tel:${alert.ownerPhone}">${alert.ownerPhone}</a>`
          : 'No phone number on file.'}`,
        actions: badge('Approval', 'warning'),
      });
    case 'rating_due':
      return decisionRow({
        title,
        detail: `${alert.businessName} finished the Job. Rate the Tradie.`,
        oneLine: true,
        actions: badge('Rating', 'info'),
      });
  }
}

function inboxRow(item: InboxItem, timeZone: string): Html {
  const [reason, tone] = INBOX_REASON[item.reason];
  return decisionRow({
    title: html`<a class="link min-w-0 truncate font-semibold" href="#inbox">${item.personName ?? item.from}</a>`,
    detail: item.text,
    oneLine: true,
    actions: badge(reason, tone),
    meta: formatWhen(item.receivedAt, timeZone),
  });
}

// Tickets by stage

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

// Next 7 days

/**
 * Today and the six days after it, in the Agency's time zone. Each day with bookings
 * gets a row (today always has one); the empty days between them collapse into a
 * single muted line.
 */
function nextSevenDays(bookings: Booking[], now: Date, timeZone: string): Html {
  const today = dayKey(now, timeZone);
  const byDay = new Map<string, Booking[]>();
  for (const b of bookings) {
    const day = dayKey(new Date(b.start), timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }
  const rows: Html[] = [];
  let quiet: string[] = [];
  const flushQuiet = () => {
    if (quiet.length) rows.push(html`<li class="px-2 py-2 text-sm text-muted">Nothing booked ${dayRange(quiet)}</li>`);
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
    <p class="text-sm font-semibold"><time datetime="${day}">${dayLabel(day, true)}</time>${isToday ? html` ${badge('Today', 'info')}` : ''}</p>
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

/** A day as "Thu 8 Oct", or "Thu 8" when a range of days is named after its last day (en-GB writes it without a comma). */
function dayLabel(day: string, withMonth: boolean) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: withMonth ? 'short' : undefined }).format(new Date(`${day}T00:00:00Z`));
}

/** "Fri 9 – Mon 12 Oct" for a run of days, or "Mon 12 Oct" for one. */
function dayRange(days: string[]) {
  const first = days[0] ?? '';
  const last = days.at(-1) ?? first;
  return first === last ? dayLabel(first, true) : `${dayLabel(first, false)} – ${dayLabel(last, true)}`;
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
