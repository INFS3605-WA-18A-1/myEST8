// The Agency's Tenants: the list at /tenants (Mine or All, by name) and a Tenant's
// profile at /tenants/:id with their Property, contact details and when they are
// usually home, the Tickets they raised, their Maintenance Requests still waiting and
// their Reimbursement Requests. Each Property's page links its Tenants here.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { dl, emptyState, flashFrom, formatWhen, humanise, linkButton, page, sectionHeader, segmented, statusBadge, table, ticketCell, urgencyBadge, type Html } from '../ui.ts';
import { formatDate } from './properties.ts';

type TenantList = Awaited<ReturnType<PropertyManagerActions['tenants']>>;
type TenantView = Awaited<ReturnType<PropertyManagerActions['tenant']>>;
type Filter = 'mine' | 'all';

const hrefFor = (filter: Filter) => (filter === 'all' ? '/tenants?filter=all' : '/tenants');

/** Tenants under /tenants. */
export function tenantProfilePages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const filter: Filter = c.req.query('filter') === 'all' ? 'all' : 'mine';
    const tenants = await actions.tenants({ filter });
    return c.html(
      page({
        title: 'Tenants',
        pm,
        active: 'tenants',
        flash: flashFrom(c.req.url),
        shell: shellInfo(c),
        subtitle: tenants.length ? `${tenants.length} ${tenants.length === 1 ? 'Tenant' : 'Tenants'}${filter === 'mine' ? ' on your Properties' : ' in the Agency'}, by name.` : undefined,
        controls: segmented([
          { label: 'Mine', href: hrefFor('mine'), active: filter === 'mine' },
          { label: 'All', href: hrefFor('all'), active: filter === 'all' },
        ]),
        body: list(tenants, filter),
      }),
    );
  });

  pages.get('/:id{[0-9]+}', async (c) => {
    const { actions, pm } = c.var;
    let tenant: TenantView;
    try {
      tenant = await actions.tenant(Number(c.req.param('id')));
    } catch (error) {
      if (!(error instanceof ActionError) || error.code !== 'not_found') throw error;
      return c.html(
        page({
          title: 'Tenant not found',
          pm,
          active: 'tenants',
          shell: shellInfo(c),
          body: emptyState("There's no such Tenant in your Agency.", linkButton('Back to Tenants', '/tenants')),
        }),
        404,
      );
    }
    const { timeZone } = actions.agency();
    return c.html(
      page({
        title: tenant.name,
        pm,
        active: 'tenants',
        flash: flashFrom(c.req.url),
        shell: shellInfo(c),
        subtitle: tenant.property
          ? html`Tenant at <a class="link" href="/properties/${tenant.property.propertyId}">${tenant.property.address}</a>`
          : 'Tenant with no Property',
        actions: linkButton('Back to Tenants', '/tenants', { variant: 'ghost', size: 'sm' }),
        body: html`${facts(tenant)} ${ticketsSection(tenant, timeZone)} ${requestsSection(tenant, timeZone)} ${reimbursementsSection(tenant, timeZone)}`,
      }),
    );
  });

  return pages;
}

/** A mobile number and an email, each a link on its own line, or a dash for neither. */
function contact(t: { mobile: string | null; email: string | null }): Html {
  if (!t.mobile && !t.email) return html`<span class="text-muted">—</span>`;
  return html`<span class="tenant-contact">
    ${t.mobile ? html`<a class="link num" href="tel:${t.mobile}">${t.mobile}</a>` : ''}
    ${t.email ? html`<a class="link break-all" href="mailto:${t.email}">${t.email}</a>` : ''}
  </span>`;
}

function list(tenants: TenantList, filter: Filter): Html {
  if (!tenants.length) {
    return filter === 'mine'
      ? emptyState('No Tenants on your Properties.', linkButton('Show all Tenants', hrefFor('all')))
      : emptyState('No Tenants yet. Add the people who live in your Properties so they can report repairs.', linkButton('Add a Tenant', '/setup#tenants'));
  }
  const all = filter === 'all';
  return table(
    ['Tenant', 'Property', ...(all ? ['Property Manager'] : []), 'Since', 'Open Tickets', 'Contact'],
    tenants.map((t) => [
      html`<a class="link font-medium" href="/tenants/${t.tenantId}">${t.name}</a>`,
      t.property ? html`<a class="link" href="/properties/${t.property.propertyId}">${t.property.address}</a>` : html`<span class="text-muted">No Property</span>`,
      ...(all ? [html`<span class="text-muted">${t.propertyManager ?? '—'}</span>`] : []),
      html`<span class="whitespace-nowrap">${t.tenancyStart ? formatDate(t.tenancyStart) : '—'}</span>`,
      html`<span class="${t.openTickets ? 'property-open' : 'text-muted'}">${t.openTickets}</span>`,
      contact(t),
    ]),
    { stack: 'labelled', caption: 'Tenants, by name', align: ['left', 'left', ...(all ? ['left' as const] : []), 'left', 'right', 'left'] },
  );
}

/** Where they live, who manages it, and how and when to reach them. */
function facts(t: TenantView): Html {
  return html`<section class="section" aria-label="Tenant details">
    ${dl([
      ['Property', t.property ? html`<a class="link" href="/properties/${t.property.propertyId}">${t.property.address}</a>` : html`<span class="text-muted">No Property</span>`],
      ['Property Manager', t.propertyManager ?? '—'],
      ['Tenant since', t.tenancyStart ? formatDate(t.tenancyStart) : '—'],
      ['Mobile', t.mobile ? html`<a class="link num" href="tel:${t.mobile}">${t.mobile}</a>` : '—'],
      ['Email', t.email ? html`<a class="link break-all" href="mailto:${t.email}">${t.email}</a>` : '—'],
      ['Usually home', t.availability ? humanise(t.availability) : html`<span class="text-muted">Not asked yet</span>`],
    ])}
  </section>`;
}

/** The address under an item, only when it isn't the Tenant's own Property (a Ticket from an earlier tenancy). */
const otherAddress = (t: TenantView, address: string) => (t.property?.address === address ? undefined : address);

/** Every Ticket the Tenant raised: open first, then the most recently closed. */
function ticketsSection(t: TenantView, timeZone: string): Html {
  return html`<section class="section" aria-label="Tickets">
    ${sectionHeader('Tickets')}
    ${t.tickets.length
      ? table(
          ['Issue', 'Urgency', 'Status', 'Reported', 'Closed'],
          t.tickets.map((x) => [
            ticketCell({ ticketId: x.ticketId, issue: x.description, address: otherAddress(t, x.propertyAddress) }),
            urgencyBadge(x.urgency),
            statusBadge(x.status),
            html`<span class="text-muted whitespace-nowrap">${formatWhen(x.reportedAt, timeZone)}</span>`,
            html`<span class="text-muted whitespace-nowrap">${x.closedAt ? formatWhen(x.closedAt, timeZone) : '—'}</span>`,
          ]),
          { caption: 'Tickets the Tenant raised, open first', stack: true },
        )
      : emptyState('No Tickets yet.')}
  </section>`;
}

/** What the Tenant reported that still waits for a Property Manager to confirm. */
function requestsSection(t: TenantView, timeZone: string): Html {
  return html`<section class="section" aria-label="Maintenance Requests waiting">
    ${sectionHeader('Maintenance Requests waiting')}
    ${t.maintenanceRequests.length
      ? table(
          ['Maintenance Request', 'Urgency', 'Reported'],
          t.maintenanceRequests.map((r) => {
            const address = otherAddress(t, r.propertyAddress);
            return [
              html`<a class="link font-medium" href="/requests/${r.issueId}">${r.summary ?? r.description}</a>${address ? html`<br /><span class="text-xs text-muted">${address}</span>` : ''}`,
              urgencyBadge(r.urgency),
              html`<span class="text-muted whitespace-nowrap">${formatWhen(r.reportedAt, timeZone)}</span>`,
            ];
          }),
          { caption: 'Maintenance Requests waiting to be confirmed', stack: true },
        )
      : emptyState('No Maintenance Requests waiting.')}
  </section>`;
}

/** The Tenant's claims for Urgent Repairs they arranged, newest first. */
function reimbursementsSection(t: TenantView, timeZone: string): Html {
  return html`<section class="section" aria-label="Reimbursement Requests">
    ${sectionHeader('Reimbursement Requests')}
    ${t.reimbursementRequests.length
      ? table(
          ['Urgent Repair', 'Status', 'Receipts', 'Reported'],
          t.reimbursementRequests.map((u) => {
            const address = otherAddress(t, u.propertyAddress);
            return [
              html`<a class="link font-medium" href="/reimbursements/${u.urgentRepairId}">${u.description}</a>${address ? html`<br /><span class="text-xs text-muted">${address}</span>` : ''}`,
              statusBadge(u.status),
              html`<span class="num">${u.receipts}</span>`,
              html`<span class="text-muted whitespace-nowrap">${formatWhen(u.reportedAt, timeZone)}</span>`,
            ];
          }),
          { caption: 'Reimbursement Requests, newest first', stack: true, align: ['left', 'left', 'right', 'left'] },
        )
      : emptyState('No Reimbursement Requests.')}
  </section>`;
}
