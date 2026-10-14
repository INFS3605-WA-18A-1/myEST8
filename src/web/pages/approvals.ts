// What is waiting on someone outside the Agency, at /approvals: Quotes held up because
// choosing them would take a Ticket's Repair Cost over the Property's Max Repair Cost
// (the Property Owner must say yes), and Urgent Repairs whose Tenant has not yet sent
// the receipt. The rail's count is the Quotes waiting on a Property Owner.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { badge, countStrip, emptyState, flashFrom, formatAge, formatMoney, formatWhen, humanise, linkButton, page, section, segmented, table, type Html } from '../ui.ts';

type Approvals = Awaited<ReturnType<PropertyManagerActions['approvals']>>;

/** The approvals under /approvals. */
export function approvalPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const all = c.req.query('filter') === 'all';
    const waiting = await actions.approvals({ filter: all ? 'all' : 'mine' });
    const now = actions.now();
    const { timeZone } = actions.agency();
    // The receipts list names each Property by its address; its id makes the address a link.
    const propertyIds = new Map((await actions.properties()).map((p) => [p.address, p.id]));
    return c.html(
      page({
        title: 'Approvals',
        pm,
        active: 'approvals',
        flash: flashFrom(c.req.url),
        shell: shellInfo(c),
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
    return emptyState('Nothing is waiting on a Property Owner or a receipt.', all ? undefined : linkButton('See every Property Manager’s', '/approvals?filter=all', { size: 'sm' }));
  }
  const silent = owners.filter((w) => w.silent).length;
  return html`
    ${countStrip([
      ...(owners.length ? [{ label: 'Quotes waiting on a Property Owner', count: owners.length, href: '#owners', decision: true }] : []),
      ...(silent ? [{ label: 'No reply for 48 hours', count: silent, href: '#owners', decision: true }] : []),
      ...(receipts.length ? [{ label: 'Urgent Repairs waiting on a receipt', count: receipts.length, href: '#receipts' }] : []),
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
    ['Ticket', 'Property', 'Property Owner', 'Quote', 'Over the limit', 'Waiting', 'Reminder'],
    waiting.map((w) => [
      html`<a class="link font-medium num" href="/tickets/${w.ticketId}">#${w.ticketId}</a><br /><span class="text-sm text-muted">${humanise(w.trade)}</span>`,
      html`<a class="link" href="/properties/${w.propertyId}">${w.propertyAddress}</a>`,
      html`${w.ownerName}${w.ownerMobile ? html`<br /><a class="link text-sm" href="tel:${w.ownerMobile}">${w.ownerMobile}</a>` : ''}`,
      html`${formatMoney(w.quotePriceCents)}<br /><span class="text-sm text-muted">${w.tradieBusinessName}</span>`,
      html`<strong>${formatMoney(w.overByCents)}</strong><br /><span class="text-sm text-muted">${formatMoney(w.repairCostCents)} against ${formatMoney(w.maxRepairCostCents)}</span>`,
      html`${formatAge(w.requestedAt, now).replace(' ago', '')}`,
      reminder(w),
    ]),
    { caption: 'Quotes waiting on a Property Owner, longest waiting first', align: ['left', 'left', 'left', 'right', 'right', 'left', 'left'] },
  );
}

function receiptTable(waiting: Approvals['waitingOnReceipt'], propertyIds: Map<string, number>, timeZone: string, now: Date): Html {
  return table(
    ['Property', 'Tenant', 'Property Owner', 'Issue', 'Reported', 'Waiting'],
    waiting.map((u) => [
      propertyIds.has(u.propertyAddress) ? html`<a class="link" href="/properties/${propertyIds.get(u.propertyAddress)}">${u.propertyAddress}</a>` : html`${u.propertyAddress}`,
      html`${u.tenantName}`,
      html`${u.ownerName}`,
      html`${u.description}`,
      html`${formatWhen(u.reportedAt, timeZone)}`,
      html`${formatAge(u.reportedAt, now).replace(' ago', '')}`,
    ]),
    { caption: 'Urgent Repairs waiting on a receipt, latest first' },
  );
}
