// What is waiting on a Property Owner or a Tenant's claim, at /approvals: Quotes held up
// because choosing them would take a Ticket's Repair Cost over the Property's Max Repair
// Cost (the Property Owner must say yes), and every Reimbursement Request not yet
// reimbursed (a Tenant's claim for an Urgent Repair they arranged), the ones whose
// receipt the Property Manager is to check first, each opening its own page. A request
// awaiting review can be forwarded to its Property Owner from its row, and marked
// reimbursed there once the Owner has paid the Tenant. The rail's count is the Quotes
// waiting on a Property Owner and the Reimbursement Requests to check.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { icon } from '../icons.ts';
import { contactLink, emptyState, entityLink, flashFrom, formatAge, formatMoney, formatWhen, humanise, linkButton, page, postButton, rowLink, segmented, type Html } from '../ui.ts';
import { reimbursementForwardForm, reimbursementLabel } from './reimbursement.ts';

type Approvals = Awaited<ReturnType<PropertyManagerActions['approvals']>>;

/** The approvals under /approvals. */
export function approvalPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const all = c.req.query('filter') === 'all';
    const now = actions.now();
    const { timeZone } = actions.agency();
    const waiting = await actions.approvals({ filter: all ? 'all' : 'mine' });
    return c.html(
      page({
        title: 'Approvals',
        pm,
        active: 'approvals',
        flash: flashFrom(c.req.url),
        shell: await shellInfo(c),
        subtitle: "Quotes held up until a Property Owner says yes, and Tenants' Reimbursement Requests for Urgent Repairs they arranged.",
        controls: segmented([
          { label: 'Mine', href: '/approvals', active: !all },
          { label: 'All', href: '/approvals?filter=all', active: all },
        ]),
        body: body(waiting, all, timeZone, now),
      }),
    );
  });

  return pages;
}

/**
 * A white panel: the stages as a chevron bar (each with a line under it), then each list
 * that has rows, as cards, and a closing line. With nothing waiting anywhere the
 * page is one sentence: three zeros and two empty lists would only be noise.
 */
function body(waiting: Approvals, all: boolean, timeZone: string, now: Date): Html {
  const owners = waiting.waitingOnOwner;
  const claims = waiting.reimbursements;
  if (!owners.length && !claims.length) {
    return emptyState(
      'Nothing is waiting on a Property Owner, and no Reimbursement Requests are open. A Quote lands here when choosing it would take a Ticket over its Max Repair Cost, and a Reimbursement Request when a Tenant arranges an Urgent Repair.',
      all ? undefined : linkButton('Show all approvals', '/approvals?filter=all'),
    );
  }
  const silent = owners.filter((w) => w.silent).length;
  const toReview = claims.filter((r) => r.status === 'receipt_received').length;
  // One list alone is already named by its heading, so the bar is left out and its line moves to the heading's right.
  const barShown = [owners.length > 0, silent > 0, claims.length > 0].filter(Boolean).length > 1;
  return html`<div class="appr-panel">
    ${stageBar(owners, silent, claims, toReview, now)}
    ${owners.length ? list('Waiting on a Property Owner', 'owners', owners.length, 'owners', barShown ? '' : ownersNote(owners, now), owners.map((w) => ownerCard(w, timeZone, now))) : ''}
    ${claims.length ? list('Reimbursement Requests', 'reimbursements', claims.length, 'claims', barShown ? '' : claimsNote(claims, toReview, now), claims.map((u) => claimCard(u, all, timeZone, now))) : ''}
    <p class="appr-done">${icon('seal-check', { size: 'size-8' })}<span>That's everything waiting on approval.</span></p>
  </div>`;
}

const days = (iso: string, now: Date) => formatAge(iso, now).replace(' ago', '');

/** What each list says under its heading: the Quotes' total and how long the oldest has waited. */
const ownersNote = (owners: Approvals['waitingOnOwner'], now: Date) => `${formatMoney(owners.reduce((sum, w) => sum + w.quotePriceCents, 0))} in Quotes · waiting ${days(owners[0]!.requestedAt, now)}`;

/** The claims to review, and how long the oldest has waited. */
const claimsNote = (claims: Approvals['reimbursements'], toReview: number, now: Date) =>
  `${toReview ? `${toReview} to review` : 'Awaiting receipt'} · oldest ${days(claims.reduce((oldest, u) => (u.reportedAt < oldest ? u.reportedAt : oldest), claims[0]!.reportedAt), now)}`;

/**
 * The stages as a chevron bar: a summary to read, each stage saying how many and one line
 * about them. Not links: nothing in it reacts to the pointer. With one stage alone the list's
 * heading already names it, so the bar is left out and its line moves to the heading's right.
 */
function stageBar(owners: Approvals['waitingOnOwner'], silent: number, claims: Approvals['reimbursements'], toReview: number, now: Date): Html {
  const stage = (kind: string, label: string, count: number, note: string) =>
    html`<li class="appr-stage-item"><div class="appr-stage is-${kind}"><span class="appr-stage-label">${label}</span><span class="appr-stage-count">${count}</span></div><p class="appr-stage-note">${note}</p></li>`;
  const stages = [
    ...(owners.length ? [stage('owners', 'Waiting on a Property Owner', owners.length, ownersNote(owners, now))] : []),
    ...(silent ? [stage('silent', 'No reply for 48 hours', silent, 'Reminder sent · needs you')] : []),
    ...(claims.length ? [stage('claims', 'Reimbursement Requests', claims.length, claimsNote(claims, toReview, now))] : []),
  ];
  return stages.length > 1 ? html`<ul class="appr-stages" role="list" aria-label="Approvals by stage">${stages}</ul>` : html``;
}

/** A list's heading with its count, then its cards. */
function list(title: string, id: string, count: number, kind: 'owners' | 'claims', note: string, cards: Html[]): Html {
  return html`<section class="appr-list is-${kind}" id="${id}" aria-labelledby="${id}-title">
    <h2 class="appr-list-title" id="${id}-title">${title}<span class="appr-list-count">${count}</span>${note ? html`<span class="appr-list-note">${note}</span>` : ''}</h2>
    <div class="appr-cards">${cards}</div>
  </section>`;
}

/** Two letters for an avatar: the first letters of the first two words. */
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

function person(label: string, name: string, tone: 'owner' | 'tenant', contact?: Html): Html {
  return html`<div class="appr-col"><p class="appr-label">${label}</p>
    <div class="appr-person"><span class="appr-avatar is-${tone}" aria-hidden="true">${initials(name)}</span><div class="min-w-0"><p class="appr-person-name">${name}</p>${contact ?? ''}</div></div>
  </div>`;
}

/** A Quote held up for a Property Owner: where its reminder stands, the Ticket and Property, who, how much, and how far over the limit. */
function ownerCard(w: Approvals['waitingOnOwner'][number], timeZone: string, now: Date): Html {
  const over = Math.round((w.repairCostCents / w.maxRepairCostCents) * 100);
  return html`<article class="appr-card ${w.silent ? 'is-silent' : 'is-waiting'}">
    <div class="appr-status">
      <p class="appr-status-main">${w.silent ? 'No reply for 48 hours' : 'Waiting for the Owner'}</p>
      <p class="appr-status-sub">${w.reminded ? 'Reminder sent' : 'Reminder not due yet'}</p>
      <p class="appr-status-age">Waiting ${days(w.requestedAt, now)}</p>
    </div>
    <div class="appr-main">
      <p class="appr-title">${rowLink(`Ticket #${w.ticketId}`, `/tickets/${w.ticketId}`)}<span class="appr-pill">${humanise(w.trade)}</span></p>
      <p class="appr-address">${entityLink('property', w.propertyAddress, `/properties/${w.propertyId}`)}</p>
      <details class="appr-more">
        <summary>Show more</summary>
        <p>Asked ${formatWhen(w.requestedAt, timeZone)}. The Property's Max Repair Cost is ${formatMoney(w.maxRepairCostCents)}.</p>
      </details>
    </div>
    <div class="appr-figures">
      ${person('Property Owner', w.ownerName, 'owner', w.ownerMobile ? html`<p class="appr-person-contact">${contactLink('mobile', w.ownerMobile, { title: true })}</p>` : undefined)}
      <div class="appr-col"><p class="appr-label">Quote</p>
        <div class="appr-tile"><p class="appr-amount">${formatMoney(w.quotePriceCents)}</p><p class="appr-tile-note">${w.tradieBusinessName}</p></div></div>
      <div class="appr-col"><p class="appr-label">Over the limit</p>
        <div class="appr-over">
          <span class="appr-ring" style="--pct:${Math.min(100, over)}"><span>${over}%</span></span>
          <div><p class="appr-amount is-over">${formatMoney(w.overByCents)}</p><p class="appr-tile-note">${formatMoney(w.repairCostCents)} of ${formatMoney(w.maxRepairCostCents)}</p></div>
        </div></div>
    </div>
  </article>`;
}

/** A Tenant's claim for an Urgent Repair they arranged: its status, the claim, who, the amount, and the action it needs. */
function claimCard(u: Approvals['reimbursements'][number], all: boolean, timeZone: string, now: Date): Html {
  const tone = u.status === 'receipt_received' ? 'review' : u.status === 'receipt_forwarded' ? 'forwarded' : 'receipt';
  return html`<article class="appr-card is-${tone}">
    <div class="appr-status">
      <p class="appr-status-main">${reimbursementLabel(u.status)}</p>
      <p class="appr-status-age" title="${formatWhen(u.reportedAt, timeZone)}">Reported ${formatAge(u.reportedAt, now)}</p>
    </div>
    <div class="appr-main">
      <p class="appr-title">${rowLink(u.description, `/reimbursements/${u.urgentRepairId}`)}</p>
      <p class="appr-address">${entityLink('property', u.propertyAddress, `/properties/${u.propertyId}`)}</p>
      <div class="appr-action">${reimbursementAction(u, all)}</div>
    </div>
    <div class="appr-figures">
      ${person('Tenant', u.tenantName, 'tenant')}
      ${person('Property Owner', u.ownerName, 'owner')}
      <div class="appr-col"><p class="appr-label">Amount</p>
        ${
          u.amountCents === null
            ? html`<div class="appr-tile is-empty"><p class="appr-amount is-quiet">Not given</p><p class="appr-tile-note">Waiting for the receipt</p></div>`
            : html`<div class="appr-tile"><p class="appr-amount">${formatMoney(u.amountCents)}</p>${u.amountCents > u.limitCents ? html`<p class="appr-tile-note text-high">Over the ${formatMoney(u.limitCents)} limit</p>` : ''}</div>`
        }
      </div>
    </div>
  </article>`;
}

/** Forward a checked receipt to the Property Owner, or mark it reimbursed once they have paid the Tenant. */
function reimbursementAction(u: Approvals['reimbursements'][number], all: boolean): Html {
  const query = `?from=approvals${all ? '&filter=all' : ''}`;
  switch (u.status) {
    case 'receipt_received':
      return reimbursementForwardForm(u, `/reimbursements/${u.urgentRepairId}/forward${query}`, { compact: true });
    case 'receipt_forwarded':
      return postButton(`/reimbursements/${u.urgentRepairId}/reimbursed${query}`, 'Mark reimbursed', {
        variant: 'secondary',
        size: 'sm',
        confirm: `Mark this reimbursed? ${u.tenantName} will be told.`,
      });
    default:
      return html`<span class="text-muted">Waiting for the receipt</span>`;
  }
}
