// The Property Manager's dashboard: Maintenance Requests to confirm, open Tickets,
// Urgent Repairs, the Agency inbox, alerts and the next two weeks of bookings, with
// the actions on each. Also serves stored photos and receipts at /files/:id.
// Controls repeated per item get the item's id in their element id ("reason-12"),
// so every label on the page points at its own control.

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError, URGENCIES, type Role, type Urgency } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { formAction, text } from '../forms.ts';
import {
  badge,
  button,
  card,
  dl,
  emptyState,
  field,
  flashFrom,
  formatWhen,
  humanise,
  linkButton,
  page,
  photoGrid,
  postButton,
  sectionHeader,
  stat,
  statGroup,
  statusBadge,
  table,
  tabs,
  urgencyBadge,
  type Html,
  type Tone,
} from '../ui.ts';
import { bookingList, bookingTrades } from './calendar.ts';
import { finishSetupBanner } from './welcome.ts';

type Dashboard = ReturnType<PropertyManagerActions['dashboard']>;
type MaintenanceRequest = Dashboard['maintenanceRequests'][number];
type Photo = MaintenanceRequest['photos'][number];
type TicketSummary = Dashboard['tickets'][number];
type UrgentRepair = Dashboard['urgentRepairs'][number];
type InboxItem = Dashboard['inbox'][number];
type Alert = Dashboard['alerts'][number];
type Person = ReturnType<PropertyManagerActions['people']>[number];
type Filter = 'mine' | 'all';

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

const IMAGE_CHECK: Record<NonNullable<MaintenanceRequest['imageMatch']>['result'], [string, Tone]> = {
  matches: ['Photos match the description', 'success'],
  does_not_match: ["Photos don't match the description", 'error'],
  unclear: ['Photo check unclear', 'warning'],
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

/** File types safe to show in the browser. Anything else (HTML, SVG...) downloads instead. */
const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);

/** The dashboard at /: Maintenance Requests, Tickets, Urgent Repairs, the inbox, alerts and the coming calendar; their actions; and /files/:id for photos. */
export function dashboardPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', (c) => {
    const { actions, pm } = c.var;
    const filter = filterOf(c);
    const view = actions.dashboard({ filter });
    const { timeZone } = actions.agency();
    const people = view.inbox.some((item) => item.personId === null) ? actions.people() : [];
    const trades = bookingTrades(actions, view.calendar, view.tickets.flatMap((t) => t.jobs));
    const q = filter === 'all' ? '?filter=all' : '';

    return c.html(
      page({
        title: 'Dashboard',
        pm,
        active: 'dashboard',
        flash: flashFrom(c.req.url),
        body: html`
          ${finishSetupBanner(actions)}
          ${tabs([
            { label: 'My Properties', href: '/', active: filter === 'mine' },
            { label: 'All Properties', href: '/?filter=all', active: filter === 'all' },
          ])}
          ${stats(view)}
          ${section('requests', 'Maintenance Requests', view.maintenanceRequests.length, requestsList(view.maintenanceRequests, timeZone, q))}
          ${section('tickets', 'Tickets', view.tickets.length, ticketsTable(view.tickets, filter, timeZone))}
          ${section('urgent-repairs', 'Urgent Repairs', view.urgentRepairs.length, urgentRepairsTable(view.urgentRepairs, timeZone))}
          ${section('inbox', 'Inbox', view.inbox.length, inboxList(view.inbox, people, timeZone, q))}
          ${section('alerts', 'Alerts', view.alerts.length, alertsList(view.alerts, timeZone))}
          ${section(
            'coming-up',
            'Coming up',
            view.calendar.length,
            html`${bookingList(view.calendar, timeZone, trades, 'Nothing booked in the next 14 days.')}
              <p class="mt-2">${linkButton('Open the calendar', '/calendar', { size: 'sm' })}</p>`,
          )}
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

function section(id: string, title: string, count: number, body: Html): Html {
  return html`<section id="${id}" class="mt-8" aria-label="${title}">
    ${sectionHeader(title, count ? badge(String(count)) : undefined)} ${body}
  </section>`;
}

function stats(view: Dashboard): Html {
  const needReceipt = view.urgentRepairs.filter((u) => u.status === 'reminder_sent').length;
  const waiting = (n: number): Tone => (n ? 'warning' : 'neutral');
  return statGroup([
    stat({ label: 'Maintenance Requests waiting', value: view.maintenanceRequests.length, tone: waiting(view.maintenanceRequests.length) }),
    stat({ label: 'Open Tickets', value: view.tickets.length }),
    stat({ label: 'Urgent Repairs needing a receipt', value: needReceipt, tone: needReceipt ? 'error' : 'neutral' }),
    stat({ label: 'Inbox', value: view.inbox.length, hint: 'Shared by the whole Agency', tone: waiting(view.inbox.length) }),
    stat({ label: 'Alerts', value: view.alerts.length, tone: waiting(view.alerts.length) }),
  ]);
}

// Maintenance Requests

function requestsList(requests: MaintenanceRequest[], timeZone: string, q: string): Html {
  if (!requests.length) return emptyState('No Maintenance Requests waiting for you.');
  return html`<div class="grid gap-4">${requests.map((r) => requestCard(r, timeZone, q))}</div>`;
}

function requestCard(r: MaintenanceRequest, timeZone: string, q: string): Html {
  const answer = (value: string | null) => value ?? 'Not answered';
  return card({
    title: r.propertyAddress,
    actions: html`${urgencyBadge(r.urgency)} ${r.checkUrgency ? badge('Check Urgency', 'warning') : ''}`,
    body: html`
      <p class="font-medium">${r.description}</p>
      <p class="flex flex-wrap gap-1 my-2">
        ${badge(humanise(r.trade), 'info')} ${r.checkTrade ? badge('Check Trade', 'warning') : ''}
        ${r.noPhotos ? badge('No photos', 'warning') : ''} ${r.unreadMessages ? badge(`${r.unreadMessages} unread`, 'info') : ''}
      </p>
      ${dl([
        ['Tenant', r.tenantName],
        ['Property Manager', r.propertyManager],
        ['Reported', formatWhen(r.reportedAt, timeZone)],
        ['Where', answer(r.answers.location)],
        ['Started', answer(r.answers.started)],
        ['Getting worse', r.answers.worsening ? humanise(r.answers.worsening) : 'Not answered'],
        ['Usually home', r.answers.availability ? humanise(r.answers.availability) : 'Not answered'],
      ])}
      <h3 class="font-semibold mt-3">Photos</h3>
      ${r.photos.length
        ? photoGrid(r.photos.map((p) => ({ src: `/files/${p.fileId}`, caption: photoCaption(p) })))
        : emptyState(r.noPhotos ? 'No photos: the Tenant sent none within 48 hours.' : 'No photos yet.')}
      ${imageCheck(r.imageMatch)} ${requestActions(r, q)}
    `,
  });
}

/** What the metadata check found, in words. Missing metadata never counts against the Tenant. */
function photoCaption(p: Photo): string {
  if (p.metadata === 'no_metadata') return 'No metadata';
  if (p.metadata === 'ok') return 'Metadata matches the report';
  return `Flagged: ${p.reasons.map((r) => PHOTO_FLAG[r] ?? humanise(r)).join(', ')}`;
}

function imageCheck(match: MaintenanceRequest['imageMatch']): Html {
  if (!match) return html``;
  const [label, tone] = IMAGE_CHECK[match.result];
  return html`<p class="mt-2">${badge(label, tone)} ${match.reason}</p>`;
}

function requestActions(r: MaintenanceRequest, q: string): Html {
  const base = `/requests/${r.issueId}`;
  return html`<div class="grid gap-4 mt-4 md:grid-cols-3">
    <div>${postButton(`${base}/confirm${q}`, 'Confirm')}</div>
    <form method="post" action="${base}/reject${q}">
      ${field({ label: 'Reason for the Tenant', name: 'reason', id: `reason-${r.issueId}`, required: true, placeholder: 'Why this is rejected' })}
      ${button('Reject', { variant: 'danger', size: 'sm' })}
    </form>
    <form method="post" action="${base}/urgency${q}">
      ${field({
        label: 'Urgency',
        name: 'urgency',
        id: `urgency-${r.issueId}`,
        type: 'select',
        value: r.urgency,
        options: URGENCIES.map((u) => ({ value: u, label: humanise(u) })),
        hint: "Choosing Urgent turns this into an Urgent Repair: the Tenant is reminded to arrange it with a Nominated Tradie and claim it back from the Property Owner. It won't become a Ticket.",
      })}
      ${button('Change Urgency', { variant: 'secondary', size: 'sm' })}
    </form>
  </div>`;
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
      <p class="text-sm opacity-70">${item.personName ? html`${item.from} · ` : ''}${formatWhen(item.receivedAt, timeZone)}</p>
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

// Alerts

function alertsList(alerts: Alert[], timeZone: string): Html {
  if (!alerts.length) return emptyState('No alerts.');
  return html`<ul class="grid gap-2">${alerts.map((a) => html`<li class="card card-border bg-base-100 p-3">${alertText(a, timeZone)}</li>`)}</ul>`;
}

function alertText(alert: Alert, timeZone: string): Html {
  const ticket = (label: string) => html`<a class="link" href="/tickets/${alert.ticketId}">${label}</a>`;
  switch (alert.kind) {
    case 'invite_more_tradies':
      return html`${badge('Quotes', 'warning')} Only ${alert.confirmedQuotes} confirmed
        ${alert.confirmedQuotes === 1 ? 'Quote' : 'Quotes'} for the Job at ${alert.propertyAddress} after 72 hours.
        ${ticket('Invite more Tradies')}`;
    case 'owner_no_reply':
      return html`${badge('Approval', 'warning')} ${alert.ownerName}, the Property Owner of ${alert.propertyAddress}, hasn't replied since
        ${formatWhen(alert.requestedAt, timeZone)}.
        ${alert.ownerPhone ? html`Call <a class="link" href="tel:${alert.ownerPhone}">${alert.ownerPhone}</a>.` : 'No phone number on file.'}
        ${ticket('Open Ticket')}`;
    case 'rating_due':
      return html`${badge('Rating', 'info')} ${alert.businessName} finished the Job at ${alert.propertyAddress}. ${ticket('Rate the Tradie')}`;
  }
}
