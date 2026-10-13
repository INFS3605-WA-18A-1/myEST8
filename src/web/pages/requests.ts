// Requests: /requests lists the Maintenance Requests to confirm, the inbox and the Urgent
// Repairs; /requests/:issueId is one Maintenance Request for review, with the Tenant's
// answers, photos and checks, and Confirm, Reject and Change Urgency. The forms post to the
// dashboard module's /requests and /inbox endpoints, which redirect back to /requests.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { URGENCIES, type Role } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { COLLEAGUES_ONLY, shareButton, shareUrl } from '../share.ts';
import { shellInfo } from '../shell.ts';
import { badge, button, dl, emptyState, field, flashFrom, formatWhen, humanise, linkButton, page, photoGrid, postButton, queueRow, section, segmented, table, urgencyBadge, type Html, type Tone } from '../ui.ts';

type Dashboard = Awaited<ReturnType<PropertyManagerActions['dashboard']>>;
type MaintenanceRequest = Dashboard['maintenanceRequests'][number];
type Photo = MaintenanceRequest['photos'][number];
type UrgentRepair = Dashboard['urgentRepairs'][number];
type InboxItem = Dashboard['inbox'][number];
type Alert = Dashboard['alerts'][number];
type Person = Awaited<ReturnType<PropertyManagerActions['people']>>[number];

/** Role names as the Agency says them. */
export const ROLE_LABEL: Record<Role, string> = {
  tenant: 'Tenant',
  owner: 'Property Owner',
  tradie: 'Tradie',
  building_manager: 'Building Manager',
};

/** Why the metadata check flagged a photo, in words. */
export const PHOTO_FLAG: Record<string, string> = {
  taken_before_tenancy: 'taken before the tenancy',
  taken_long_before_report: 'taken over 14 days before the report',
  far_from_property: 'taken far from the Property',
};

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

const IMAGE_CHECK: Record<NonNullable<MaintenanceRequest['imageMatch']>['result'], [string, Tone]> = {
  matches: ['Photos match the description', 'success'],
  does_not_match: ["Photos don't match the description", 'error'],
  unclear: ['Photo check unclear', 'warning'],
};

/** The Maintenance Request review page under /requests. */
export function requestPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const filter = c.req.query('filter') === 'all' ? 'all' : 'mine';
    const view = await actions.dashboard({ filter });
    const { timeZone } = actions.agency();
    const now = actions.now();
    const people = view.inbox.some((item) => item.personId === null) ? await actions.people() : [];
    const q = filter === 'all' ? '?filter=all' : '';
    const requests = [...view.maintenanceRequests].sort((a, b) => a.reportedAt.localeCompare(b.reportedAt));
    return c.html(
      page({
        title: 'Requests',
        pm,
        active: 'requests',
        flash: flashFrom(c.req.url),
        shell: await shellInfo(c),
        controls: segmented([
          { label: 'Mine', href: '/requests', active: filter === 'mine' },
          { label: 'All', href: '/requests?filter=all', active: filter === 'all' },
        ]),
        body: html`
          ${section({
            title: 'Maintenance Requests to confirm',
            id: 'requests',
            actions: requests.length
              ? shareButton({
                  title: 'Maintenance Requests to confirm',
                  text: `${requests.length} ${requests.length === 1 ? 'Maintenance Request is' : 'Maintenance Requests are'} waiting for review in myEST8.`,
                  url: shareUrl(c, '/requests?filter=all'),
                  note: COLLEAGUES_ONLY,
                })
              : undefined,
            body: requests.length ? html`<div class="grid gap-2">${requests.map((r) => requestRow(r, q, now))}</div>` : emptyState('No Maintenance Requests waiting for you.'),
          })}
          ${section({ title: 'Inbox', id: 'inbox', body: inboxList(view.inbox, people, timeZone, q) })}
          ${section({ title: 'Urgent Repairs', id: 'urgent-repairs', body: urgentRepairsTable(view.urgentRepairs, timeZone) })}
        `,
      }),
    );
  });

  pages.get('/:issueId{[0-9]+}', async (c) => {
    const { actions, pm } = c.var;
    const issueId = Number(c.req.param('issueId'));
    const request = (await actions.dashboard({ filter: 'all' })).maintenanceRequests.find((r) => r.issueId === issueId);
    const flash = flashFrom(c.req.url);
    if (!request) {
      const body = emptyState('There is no Maintenance Request waiting for you with that number.', linkButton('Back to requests', '/requests'));
      return c.html(page({ title: 'Maintenance Request not found', pm, active: 'requests', flash, shell: await shellInfo(c), body }), 404);
    }
    const { timeZone } = actions.agency();
    return c.html(
      page({
        title: 'Maintenance Request',
        pm,
        active: 'requests',
        flash,
        shell: await shellInfo(c),
        actions: html`${linkButton('Back to requests', '/requests', { variant: 'ghost', size: 'sm' })}${shareButton({
          title: `Maintenance Request: ${request.description}`,
          text: `Maintenance Request at ${request.propertyAddress}, waiting for review: ${request.description}`,
          url: shareUrl(c, `/requests/${issueId}`),
          note: COLLEAGUES_ONLY,
        })}`,
        body: review(request, timeZone),
      }),
    );
  });

  return pages;
}

function review(r: MaintenanceRequest, timeZone: string): Html {
  const answer = (value: string | null) => value ?? 'Not answered';
  return html`
    ${section({
      title: 'The report',
      id: 'request',
      body: dl([
        ['Property', r.propertyAddress],
        ['Tenant', r.tenantName],
        ['Property Manager', r.propertyManager],
        ['Reported', formatWhen(r.reportedAt, timeZone)],
        ['Trade', humanise(r.trade)],
        ['Urgency', urgencyBadge(r.urgency)],
        ['Description', r.description],
      ]),
    })}
    ${section({
      title: 'Answers',
      body: dl([
        ['Where', answer(r.answers.location)],
        ['Started', answer(r.answers.started)],
        ['Getting worse', r.answers.worsening ? humanise(r.answers.worsening) : 'Not answered'],
        ['Usually home', r.answers.availability ? humanise(r.answers.availability) : 'Not answered'],
      ]),
    })}
    ${section({
      title: 'Photos',
      body: r.photos.length
        ? photoGrid(r.photos.map((p) => ({ src: `/files/${p.fileId}`, caption: photoCaption(p) })))
        : emptyState(r.noPhotos ? 'No photos: the Tenant sent none within 48 hours.' : 'No photos yet.'),
    })}
    ${section({ title: 'Checks', body: checks(r) })}
    ${section({ title: 'Decide', body: decide(r) })}
  `;
}

/** What the metadata check found, in words. Missing metadata never counts against the Tenant. */
function photoCaption(p: Photo): string {
  if (p.metadata === 'no_metadata') return 'No metadata';
  if (p.metadata === 'ok') return 'Metadata matches the report';
  return `Flagged: ${p.reasons.map((r) => PHOTO_FLAG[r] ?? humanise(r)).join(', ')}`;
}

function checks(r: MaintenanceRequest): Html {
  const flags = [
    ...(r.checkUrgency ? [badge('Check urgency', 'warning')] : []),
    ...(r.checkTrade ? [badge('Check trade', 'warning')] : []),
    ...(r.noPhotos ? [badge('No photos', 'warning')] : []),
  ];
  return html`<div class="flex flex-wrap gap-1">${flags.length ? flags : html`<span class="text-sm text-muted">Nothing to check.</span>`}</div>
    ${imageCheck(r.imageMatch)}`;
}

function imageCheck(match: MaintenanceRequest['imageMatch']): Html {
  if (!match) return html``;
  const [label, tone] = IMAGE_CHECK[match.result];
  return html`<p class="mt-2">${badge(label, tone)} ${match.reason}</p>`;
}

/** Confirm, Reject and Change Urgency: the same endpoints and field names as the dashboard used. */
function decide(r: MaintenanceRequest): Html {
  const base = `/requests/${r.issueId}`;
  return html`<div class="grid gap-4 md:grid-cols-3">
    <div>${postButton(`${base}/confirm`, 'Confirm')}</div>
    <form method="post" action="${base}/reject">
      ${field({ label: 'Reason for the Tenant', name: 'reason', id: `reason-${r.issueId}`, required: true, placeholder: 'Why this is rejected' })}
      ${button('Reject', { variant: 'danger', size: 'sm' })}
    </form>
    <form method="post" action="${base}/urgency">
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

// Shared with the dashboard

/** A Maintenance Request to confirm: its photo, address, what the Tenant reported, badges and age, with Confirm and Review. */
export function requestRow(r: MaintenanceRequest, q: string, now: Date): Html {
  const [first] = r.photos;
  const flagged = r.photos.some((p) => p.metadata !== 'ok' && p.metadata !== 'no_metadata');
  const thumb = first
    ? html`<img src="/files/${first.fileId}" alt="Photo of ${r.propertyAddress}" width="48" height="48" loading="lazy" class="size-full object-cover" />`
    : html`<span class="flex size-full items-center justify-center p-1 text-center text-[11px] leading-tight text-muted">No photos</span>`;
  const flags = [
    ...(r.checkUrgency ? ['Check urgency'] : []),
    ...(r.checkTrade ? ['Check trade'] : []),
    ...(flagged ? ['Flagged photos'] : []),
  ];
  return queueRow({
    thumb,
    title: r.propertyAddress,
    detail: r.description,
    badges: [urgencyBadge(r.urgency), badge(humanise(r.trade)), ...flags.map((f) => badge(f, 'warning'))],
    meta: ageOf(r.reportedAt, now),
    actions: html`${postButton(`/requests/${r.issueId}/confirm${q}`, 'Confirm', { variant: 'primary', size: 'sm' })}${linkButton('Review', `/requests/${r.issueId}`, { variant: 'secondary', size: 'sm' })}`,
    decision: true,
  });
}

/** Each alert keeps its wording and links to its Ticket. */
export function alertRow(alert: Alert, timeZone: string): Html {
  const base = { href: `/tickets/${alert.ticketId}`, title: alert.propertyAddress, decision: true };
  switch (alert.kind) {
    case 'invite_more_tradies':
      return queueRow({
        ...base,
        detail: `Only ${alert.confirmedQuotes} confirmed ${alert.confirmedQuotes === 1 ? 'Quote' : 'Quotes'} for the Job after 72 hours.`,
        badges: [badge('Quotes', 'warning')],
      });
    case 'owner_no_reply':
      return queueRow({
        ...base,
        detail: `${alert.ownerName}, the Property Owner, hasn't replied since ${formatWhen(alert.requestedAt, timeZone)}. ${alert.ownerPhone ? '' : 'No phone number on file.'}`.trim(),
        badges: [badge('Approval', 'warning')],
        actions: alert.ownerPhone ? linkButton(`Call ${alert.ownerPhone}`, `tel:${alert.ownerPhone}`, { variant: 'secondary', size: 'sm' }) : undefined,
      });
    case 'rating_due':
      return queueRow({ ...base, detail: `${alert.businessName} finished the Job. Rate the Tradie.`, badges: [badge('Rating', 'info')] });
  }
}

/** The street part of an address: "12 King St" from "12 King St, Newtown NSW 2042". */
export function streetOf(address: string) {
  return address.split(',')[0]?.trim() || address;
}

/** "2 days ago", "5 hours ago": how long a request has waited. */
export function ageOf(iso: string, now: Date) {
  const hours = Math.floor((now.getTime() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

// Urgent Repairs

function urgentRepairsTable(repairs: UrgentRepair[], timeZone: string): Html {
  if (!repairs.length) return emptyState('No Urgent Repairs reported.');
  return table(
    ['Property', 'Tenant', 'Issue', 'Status', 'Receipts', 'Reported'],
    repairs.map((u) => {
      const [label, tone] = URGENT_REPAIR_STATUS[u.status];
      return [html`${u.propertyAddress}`, html`${u.tenantName}`, html`${u.description}`, badge(label, tone), html`${u.receipts}`, html`${formatWhen(u.reportedAt, timeZone)}`];
    }),
    { caption: 'Urgent Repairs' },
  );
}

// Inbox

function inboxList(items: InboxItem[], people: Person[], timeZone: string, q: string): Html {
  if (!items.length) return emptyState('The inbox is empty. Messages that need routing will appear here.');
  return html`<div class="grid">${items.map((item) => inboxItem(item, people, timeZone, q))}</div>`;
}

function inboxItem(item: InboxItem, people: Person[], timeZone: string, q: string): Html {
  const [reason, tone] = INBOX_REASON[item.reason];
  const base = `/inbox/${item.itemId}`;
  const guess = item.bestGuess ? Object.entries(item.bestGuess) : [];
  return html`<article class="grid gap-2 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <h3 class="font-semibold">${item.personName ?? item.from}</h3>
      ${item.personName ? html`<span class="text-muted">${item.from}</span>` : ''}
      <span class="text-muted">${formatWhen(item.receivedAt, timeZone)}</span>
      ${badge(reason, tone)}
    </div>
    <blockquote class="whitespace-pre-line border-l-4 border-line pl-3 text-sm">${item.text}</blockquote>
    ${guess.length
      ? html`<details class="text-sm">
          <summary class="cursor-pointer">Best guess</summary>
          ${dl(guess.map(([question, answer]) => [guessLabel(question), guessAnswer(answer)]))}
        </details>`
      : ''}
    <div class="flex flex-wrap items-end gap-3">
      ${item.personId === null
        ? html`<form method="post" action="${base}/link${q}" class="flex flex-wrap items-end gap-3">
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
            ${button('Link sender', { variant: 'secondary', size: 'sm' })}
          </form>`
        : item.reason === 'low_confidence' && item.bestGuess
          ? postButton(`${base}/route${q}`, 'Route with best guess', { variant: 'secondary', size: 'sm' })
          : ''}
      ${postButton(`${base}/dismiss${q}`, 'Dismiss', { variant: 'ghost', size: 'sm' })}
    </div>
  </article>`;
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
