// What is waiting on a Property Owner or a Tenant's claim, at /approvals: Quotes held up
// because choosing them would take a Ticket's Repair Cost over the Property's Max Repair
// Cost (the Property Owner must say yes), and every Reimbursement Request not yet
// reimbursed (a Tenant's claim for an Urgent Repair they arranged), the ones whose
// receipt the Property Manager is to check first, each opening its own page. The rail's
// count is the Quotes waiting on a Property Owner and the Reimbursement Requests to check.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { badge, contactLink, countSentence, emptyState, entityLink, flashFrom, formatAge, formatMoney, formatWhen, humanise, linkButton, page, rowLink, section, segmented, table, type Html } from '../ui.ts';
import { reimbursementBadge } from './reimbursement.ts';

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
 * The counts, then each list that has rows. With nothing waiting anywhere the page is
 * one sentence: three zeros and two empty lists would only be noise.
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
  const others = claims.length - toReview;
  return html`
    ${countSentence([
      // Only a silent Property Owner or a receipt to check needs the Property Manager; the rest wait on someone else.
      ...(toReview ? [{ label: 'Reimbursement Requests to review', one: 'Reimbursement Request to review', count: toReview, href: '#reimbursements', decision: true }] : []),
      ...(owners.length ? [{ label: 'Quotes waiting on a Property Owner', one: 'Quote waiting on a Property Owner', count: owners.length, href: '#owners' }] : []),
      ...(silent ? [{ label: 'Property Owners with no reply for 48 hours', one: 'Property Owner with no reply for 48 hours', count: silent, href: '#owners', decision: true }] : []),
      ...(others ? [{ label: 'Reimbursement Requests waiting on a Tenant or Property Owner', one: 'Reimbursement Request waiting on a Tenant or Property Owner', count: others, href: '#reimbursements' }] : []),
    ])}
    ${owners.length ? section({ title: 'Waiting on a Property Owner', id: 'owners', body: ownerTable(owners, now) }) : ''}
    ${claims.length ? section({ title: 'Reimbursement Requests', id: 'reimbursements', body: reimbursementTable(claims, timeZone, now) }) : ''}
  `;
}

/** Where the Owner's reminder stands: sent after 24 hours, and the Property Manager is alerted after 48. */
function reminder(w: Approvals['waitingOnOwner'][number]): Html {
  const sent = w.reminded ? badge('Reminder sent', 'warning') : badge('Reminder not due yet', 'neutral');
  return w.silent ? html`<div class="flex flex-wrap gap-1">${sent}${badge('No reply for 48 hours', 'error')}</div>` : sent;
}

function ownerTable(waiting: Approvals['waitingOnOwner'], now: Date): Html {
  return table(
    ['Ticket', 'Property Owner', 'Quote', 'Over the limit', 'Waiting', 'Reminder'],
    waiting.map((w) => [
      html`<p>${rowLink(`Ticket #${w.ticketId}`, `/tickets/${w.ticketId}`)} <span class="text-muted">${humanise(w.trade)}</span></p>
        <p class="mt-1">${entityLink('property', w.propertyAddress, `/properties/${w.propertyId}`)}</p>`,
      // One element per labelled cell, so its lines stay together beside the label on phones.
      html`<div><p>${w.ownerName}</p>${w.ownerMobile ? html`<p class="text-xs">${contactLink('mobile', w.ownerMobile)}</p>` : ''}</div>`,
      html`<div><p>${formatMoney(w.quotePriceCents)}</p><p class="text-xs text-muted">${w.tradieBusinessName}</p></div>`,
      html`<div><p class="font-semibold">${formatMoney(w.overByCents)}</p><p class="text-xs text-muted whitespace-nowrap">${formatMoney(w.repairCostCents)} of ${formatMoney(w.maxRepairCostCents)}</p></div>`,
      html`<span class="whitespace-nowrap">${formatAge(w.requestedAt, now).replace(' ago', '')}</span>`,
      reminder(w),
    ]),
    { stack: 'labelled', caption: 'Quotes waiting on a Property Owner, longest waiting first', align: ['left', 'left', 'right', 'right', 'left', 'left'] },
  );
}

/** Every open Reimbursement Request, each opening its page: the ones to review first, then oldest first. */
function reimbursementTable(claims: Approvals['reimbursements'], timeZone: string, now: Date): Html {
  return table(
    ['Reimbursement Request', 'Tenant', 'Property Owner', 'Status', 'Amount', 'Reported'],
    claims.map((u) => [
      html`<p>${rowLink(u.description, `/reimbursements/${u.urgentRepairId}`)}</p>
        <p class="mt-1">${entityLink('property', u.propertyAddress, `/properties/${u.propertyId}`)}</p>`,
      html`${u.tenantName}`,
      html`${u.ownerName}`,
      reimbursementBadge(u.status, { wrap: true }),
      u.amountCents === null
        ? html`<span class="text-muted">Not given</span>`
        : html`<div><p class="num">${formatMoney(u.amountCents)}</p>${u.amountCents > u.limitCents ? html`<p class="text-xs text-high">Over the ${formatMoney(u.limitCents)} limit</p>` : ''}</div>`,
      html`<span class="whitespace-nowrap" title="${formatWhen(u.reportedAt, timeZone)}">${formatAge(u.reportedAt, now)}</span>`,
    ]),
    { stack: 'labelled', caption: 'Reimbursement Requests not yet reimbursed, the ones to review first', align: ['left', 'left', 'left', 'left', 'right', 'left'] },
  );
}
