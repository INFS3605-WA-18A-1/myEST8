// What is waiting on someone outside the Agency, at /approvals: Quotes held up because
// choosing them would take a Ticket's Repair Cost over the Property's Max Repair Cost
// (the Property Owner must say yes), and Urgent Repairs whose Tenant has not yet sent
// the receipt. The rail's count is the Quotes waiting on a Property Owner.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { badge, countSentence, emptyState, flashFrom, formatAge, formatMoney, formatWhen, humanise, linkButton, page, section, segmented, table, type Html } from '../ui.ts';

type Approvals = Awaited<ReturnType<PropertyManagerActions['approvals']>>;

/** The approvals under /approvals. */
export function approvalPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const all = c.req.query('filter') === 'all';
    const now = actions.now();
    const { timeZone } = actions.agency();
    // The receipts list names each Property by its address; its id makes the address a link.
    const [waiting, properties] = await Promise.all([actions.approvals({ filter: all ? 'all' : 'mine' }), actions.properties()]);
    const propertyIds = new Map(properties.map((p) => [p.address, p.id]));
    return c.html(
      page({
        title: 'Approvals',
        pm,
        active: 'approvals',
        flash: flashFrom(c.req.url),
        shell: await shellInfo(c),
        subtitle: 'Work held up until a Property Owner says yes, or a Tenant sends a receipt.',
        controls: segmented([
          { label: 'Mine', href: '/approvals', active: !all },
          { label: 'All', href: '/approvals?filter=all', active: all },
        ]),
        body: body(waiting, all, propertyIds, timeZone, now),
      }),
    );
  });

  return pages;
}

/**
 * The counts, then each list that has rows. With nothing waiting anywhere the page is
 * one sentence: three zeros and two empty lists would only be noise.
 */
function body(waiting: Approvals, all: boolean, propertyIds: Map<string, number>, timeZone: string, now: Date): Html {
  const owners = waiting.waitingOnOwner;
  const receipts = waiting.waitingOnReceipt;
  if (!owners.length && !receipts.length) {
    return emptyState(
      'Nothing is waiting on a Property Owner or a receipt. A Quote lands here when choosing it would take a Ticket over its Max Repair Cost.',
      all ? undefined : linkButton('Show all approvals', '/approvals?filter=all'),
    );
  }
  const silent = owners.filter((w) => w.silent).length;
  return html`
    ${countSentence([
      // Only a silent Property Owner needs the Property Manager (a call); the rest wait on the Owner.
      ...(owners.length ? [{ label: 'Quotes waiting on a Property Owner', one: 'Quote waiting on a Property Owner', count: owners.length, href: '#owners' }] : []),
      ...(silent ? [{ label: 'Property Owners with no reply for 48 hours', one: 'Property Owner with no reply for 48 hours', count: silent, href: '#owners', decision: true }] : []),
      ...(receipts.length ? [{ label: 'Urgent Repairs waiting on a receipt', one: 'Urgent Repair waiting on a receipt', count: receipts.length, href: '#receipts' }] : []),
    ])}
    ${owners.length ? section({ title: 'Waiting on a Property Owner', id: 'owners', body: ownerTable(owners, now) }) : ''}
    ${receipts.length ? section({ title: 'Urgent Repairs waiting on a receipt', id: 'receipts', body: receiptTable(receipts, propertyIds, timeZone, now) }) : ''}
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
      html`<p><a class="link font-semibold num" href="/tickets/${w.ticketId}">Ticket #${w.ticketId}</a> <span class="text-muted">${humanise(w.trade)}</span></p>
        <p><a class="link text-xs" href="/properties/${w.propertyId}">${w.propertyAddress}</a></p>`,
      // One element per labelled cell, so its lines stay together beside the label on phones.
      html`<div><p>${w.ownerName}</p>${w.ownerMobile ? html`<p><a class="link text-xs" href="tel:${w.ownerMobile}">${w.ownerMobile}</a></p>` : ''}</div>`,
      html`<div><p>${formatMoney(w.quotePriceCents)}</p><p class="text-xs text-muted">${w.tradieBusinessName}</p></div>`,
      html`<div><p class="font-semibold">${formatMoney(w.overByCents)}</p><p class="text-xs text-muted whitespace-nowrap">${formatMoney(w.repairCostCents)} of ${formatMoney(w.maxRepairCostCents)}</p></div>`,
      html`<span class="whitespace-nowrap">${formatAge(w.requestedAt, now).replace(' ago', '')}</span>`,
      reminder(w),
    ]),
    { stack: 'labelled', caption: 'Quotes waiting on a Property Owner, longest waiting first', align: ['left', 'left', 'right', 'right', 'left', 'left'] },
  );
}

function receiptTable(waiting: Approvals['waitingOnReceipt'], propertyIds: Map<string, number>, timeZone: string, now: Date): Html {
  return table(
    ['Issue', 'Tenant', 'Property Owner', 'Reported', 'Waiting'],
    waiting.map((u) => {
      const id = propertyIds.get(u.propertyAddress);
      return [
        html`<p class="font-semibold">${u.description}</p>
          <p>${id === undefined ? html`<span class="text-xs text-muted">${u.propertyAddress}</span>` : html`<a class="link text-xs" href="/properties/${id}">${u.propertyAddress}</a>`}</p>`,
        html`${u.tenantName}`,
        html`${u.ownerName}`,
        html`<span class="whitespace-nowrap">${formatWhen(u.reportedAt, timeZone)}</span>`,
        html`${formatAge(u.reportedAt, now).replace(' ago', '')}`,
      ];
    }),
    { stack: 'labelled', caption: 'Urgent Repairs waiting on a receipt, latest first' },
  );
}
