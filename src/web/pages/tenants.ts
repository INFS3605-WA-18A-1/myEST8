// The Agency's Tenants: the list at /tenants (Mine or All, by name) and a Tenant's
// profile at /tenants/:id with their Property, contact details and when they are
// usually home, the Tickets they raised, their Maintenance Requests still waiting and
// their Reimbursement Requests. Each Property's page links its Tenants here.
//
// Adding a Tenant is /tenants/new (the form still posts to /setup/tenants). Removing
// one takes them off their Property, but their profile and the Tickets they raised
// stay. The profile's pen opens the name, mobile and email in a form (?edit=details)
// that posts to /tenants/:id/details. Above the facts, a read says what their
// history adds up to.

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { formAction } from '../forms.ts';
import { shellInfo } from '../shell.ts';
import {
  alert,
  button,
  contactLink,
  detailsForm,
  dl,
  editPen,
  emptyState,
  entityLink,
  field,
  flashFrom,
  formatWhen,
  humanise,
  linkButton,
  othersUsing,
  page,
  postButton,
  profileRead,
  sharedAddressNote,
  rowLink,
  section,
  sectionHeader,
  segmented,
  statusBadge,
  table,
  ticketCell,
  urgencyBadge,
  type Html,
} from '../ui.ts';
import { contactFields, contactFrom, fieldGrid, propertyOptions, saveDetails, type DetailsEdit, type Errors, type Values } from './onboarding-forms.ts';
import { formatDate } from './properties.ts';

type TenantList = Awaited<ReturnType<PropertyManagerActions['tenants']>>;
type TenantView = Awaited<ReturnType<PropertyManagerActions['tenant']>>;
type Property = Awaited<ReturnType<PropertyManagerActions['properties']>>[number];
type Filter = 'mine' | 'all';

const hrefFor = (filter: Filter) => (filter === 'all' ? '/tenants?filter=all' : '/tenants');

/** Tenants under /tenants. */
export function tenantProfilePages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const filter: Filter = c.req.query('filter') === 'all' ? 'all' : 'mine';
    const flash = flashFrom(c.req.url);
    const tenants = await actions.tenants({ filter });
    return c.html(
      page({
        title: 'Tenants',
        pm,
        active: 'tenants',
        flash,
        shell: shellInfo(c),
        subtitle: tenants.length ? `${tenants.length} ${tenants.length === 1 ? 'Tenant' : 'Tenants'}${filter === 'mine' ? ' on your Properties' : ' in the Agency'}, by name.` : undefined,
        actions: linkButton('Add a Tenant', '/tenants/new', { variant: 'primary', size: 'sm' }),
        controls: segmented([
          { label: 'Mine', href: hrefFor('mine'), active: filter === 'mine' },
          { label: 'All', href: hrefFor('all'), active: filter === 'all' },
        ]),
        body: list(tenants, filter),
      }),
    );
  });

  pages.get('/new', (c) => addTenantPage(c));

  // Refused, the reason shows on the Tenant's profile, beside the open Tickets it names.
  pages.post('/:id{[0-9]+}/remove', (c) => {
    const id = Number(c.req.param('id'));
    return formAction(c, `/tenants/${id}`, async () => {
      const name = await c.var.actions.removeTenant(id);
      return { ok: `${name} removed from their Property`, redirect: '/tenants' };
    });
  });

  pages.post('/:id{[0-9]+}/details', (c) => {
    const id = Number(c.req.param('id'));
    return saveDetails(c, { profile: `/tenants/${id}`, save: (form) => c.var.actions.editTenant(id, contactFrom(form)), show: (refused) => profilePage(c, id, refused) });
  });

  pages.get('/:id{[0-9]+}', (c) => profilePage(c, Number(c.req.param('id'))));

  return pages;
}

/** A Tenant's profile; `refused` is a save of their details that was refused, shown with the form open. */
async function profilePage(c: Context<WebEnv>, id: number, refused?: DetailsEdit) {
  const { actions, pm } = c.var;
  let tenant: TenantView;
  try {
    tenant = await actions.tenant(id);
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
  // Someone who has left their Property has no details to edit: their addresses are free for others.
  const editing = tenant.property !== null && (!!refused || c.req.query('edit') === 'details');
  const people = editing ? [] : await actions.people();
  return c.html(
    page({
      title: tenant.name,
      pm,
      active: 'tenants',
      flash: flashFrom(c.req.url),
      shell: shellInfo(c),
      subtitle: tenant.property
        ? html`Tenant at ${entityLink('property', tenant.property.address, `/properties/${tenant.property.propertyId}`)}`
        : 'Former Tenant: no longer at a Property',
      actions: html`${tenant.property ? removeButton(tenant.tenantId, tenant.name, tenant.property.address) : ''}${linkButton('Back to Tenants', '/tenants', { variant: 'ghost', size: 'sm' })}`,
      body: html`${profileRead(tenant.read)}${refused && !editing ? alert(refused.message, 'error') : ''}${facts(tenant, editing, refused, people)} ${ticketsSection(tenant, timeZone)} ${requestsSection(tenant, timeZone)} ${reimbursementsSection(tenant, timeZone)}`,
    }),
    refused ? 400 : 200,
  );
}

/** The address, and a quiet note of who else in the Agency uses it. */
function contactDetail(kind: 'mobile' | 'email', value: string | null, people: Parameters<typeof othersUsing>[0], selfId: number): Html | string {
  if (!value) return '—';
  return html`${contactLink(kind, value)}${sharedAddressNote('Also', othersUsing(people, value, selfId))}`;
}

/** A mobile number and an email, each a link on its own line, or a dash for neither. */
function contact(t: { mobile: string | null; email: string | null }): Html {
  if (!t.mobile && !t.email) return html`<span class="text-muted">—</span>`;
  return html`<span class="tenant-contact">
    ${t.mobile ? contactLink('mobile', t.mobile) : ''}
    ${t.email ? contactLink('email', t.email) : ''}
  </span>`;
}

function list(tenants: TenantList, filter: Filter): Html {
  if (!tenants.length) {
    return filter === 'mine'
      ? emptyState('No Tenants on your Properties.', linkButton('Show all Tenants', hrefFor('all')))
      : emptyState('No Tenants yet. Add the people who live in your Properties so they can report repairs.', linkButton('Add a Tenant', '/tenants/new'));
  }
  const all = filter === 'all';
  return table(
    ['Tenant', 'Property', ...(all ? ['Property Manager'] : []), 'Since', 'Open Tickets', 'Contact', ''],
    tenants.map((t) => [
      rowLink(t.name, `/tenants/${t.tenantId}`),
      t.property ? entityLink('property', t.property.address, `/properties/${t.property.propertyId}`) : html`<span class="text-muted">No Property</span>`,
      ...(all ? [html`<span class="text-muted">${t.propertyManager ?? '—'}</span>`] : []),
      html`<span class="whitespace-nowrap">${t.tenancyStart ? formatDate(t.tenancyStart) : '—'}</span>`,
      html`<span class="${t.openTickets ? 'property-open' : 'text-muted'}">${t.openTickets}</span>`,
      contact(t),
      t.property ? removeButton(t.tenantId, t.name, t.property.address) : html``,
    ]),
    { stack: 'labelled', caption: 'Tenants, by name', align: ['left', 'left', ...(all ? ['left' as const] : []), 'left', 'right', 'left', 'right'] },
  );
}

function removeButton(tenantId: number, name: string, address: string): Html {
  return postButton(`/tenants/${tenantId}/remove`, 'Remove', {
    variant: 'ghost',
    size: 'sm',
    confirm: `Remove ${name} from ${address}? Their profile and past Tickets stay on record.`,
  });
}

export type AddRefusal = { message: string; values: Values; errors: Errors };

/** The Add a Tenant page. A refused save is this same page, with what was typed and why. */
export async function addTenantPage(c: Context<WebEnv>, refused?: AddRefusal) {
  const { actions, pm } = c.var;
  const properties = await actions.properties();
  return c.html(
    page({
      title: 'Add a Tenant',
      pm,
      active: 'tenants',
      shell: shellInfo(c),
      actions: linkButton('Back to Tenants', '/tenants', { variant: 'ghost', size: 'sm' }),
      body: addForm(properties, refused),
    }),
    refused ? 400 : 200,
  );
}

/** Adds a Tenant to a Property the Property Manager chooses. */
function addForm(properties: Property[], refused: AddRefusal | undefined): Html {
  const values = refused?.values;
  const errors = refused?.errors;
  return section({
    id: 'add-tenant',
    title: 'Add a Tenant',
    body: html`
      ${properties.length ? '' : html`<p class="mb-3 text-sm text-high">Add a Property on the Properties page first.</p>`}
      ${refused ? alert(refused.message, 'error') : ''}
      <form method="post" action="/setup/tenants">
        ${fieldGrid(html`
          ${contactFields('tenant', { values, errors })}
          ${field({
            label: 'Property',
            name: 'propertyId',
            id: 'tenant-property',
            type: 'select',
            required: true,
            placeholder: 'Search by street, suburb or postcode',
            search: true,
            value: typeof values?.propertyId === 'string' ? values.propertyId : '',
            error: errors?.propertyId,
            options: propertyOptions(properties),
          })}
          ${field({
            label: 'Tenancy start date',
            name: 'tenancyStart',
            id: 'tenant-start',
            type: 'date',
            required: true,
            value: typeof values?.tenancyStart === 'string' ? values.tenancyStart : '',
            error: errors?.tenancyStart,
            hint: 'Photos taken before this date are flagged.',
          })}
        `)}
        <div class="mt-3">${button('Add Tenant', { variant: 'primary' })}</div>
      </form>`,
  });
}

/**
 * Where they live, who manages it, and how and when to reach them, with a pen to edit the name, mobile and
 * email. Editing, the form takes the facts' place, filled in from the Tenant or from what was posted.
 */
function facts(t: TenantView, editing: boolean, refused: DetailsEdit | undefined, people: Parameters<typeof othersUsing>[0]): Html {
  if (editing) {
    const values = refused?.values ?? { name: t.name, mobile: t.mobile ?? '', email: t.email ?? '' };
    return html`<section class="section" id="details" aria-label="Tenant details">
      ${detailsForm({
        action: `/tenants/${t.tenantId}/details`,
        cancel: `/tenants/${t.tenantId}`,
        refusal: refused && !Object.keys(refused.errors).length ? refused.message : undefined,
        fields: fieldGrid(contactFields('tenant', { values, errors: refused?.errors })),
      })}
    </section>`;
  }
  return html`<section class="section" id="details" aria-label="Tenant details">
    <div class="details-head">
      <div class="details-body">
        ${dl([
          ['Property', t.property ? entityLink('property', t.property.address, `/properties/${t.property.propertyId}`) : html`<span class="text-muted">No Property</span>`],
          ['Property Manager', t.propertyManager ?? '—'],
          ['Tenant since', t.tenancyStart ? formatDate(t.tenancyStart) : '—'],
          ['Mobile', contactDetail('mobile', t.mobile, people, t.tenantId)],
          ['Email', contactDetail('email', t.email, people, t.tenantId)],
          ['Usually home', t.availability ? humanise(t.availability) : html`<span class="text-muted">Not asked yet</span>`],
        ])}
      </div>
      ${t.property ? editPen('Edit details', `/tenants/${t.tenantId}?edit=details#details`) : ''}
    </div>
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
              html`${rowLink(r.summary ?? r.description, `/requests/${r.issueId}`)}${address ? html`<br /><span class="text-xs text-muted">${address}</span>` : ''}`,
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
              html`${rowLink(u.description, `/reimbursements/${u.urgentRepairId}`)}${address ? html`<br /><span class="text-xs text-muted">${address}</span>` : ''}`,
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
