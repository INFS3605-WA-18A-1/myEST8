// The Agency's Properties: the list at /properties, adding one at /properties/new
// (the form still posts to /setup/properties), and one Property's profile at
// /properties/:id: its open Tickets first, then the Max Repair Cost, Property Owner
// and Property Manager, its Tenants, nominated Tradies, frequent issues and closed
// Tickets. The profile's pen opens its details in a form (?edit=details) that posts
// to /properties/:id/details.

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import { cents, text } from '../forms.ts';
import { icon } from '../icons.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { alert, badge, button, contactLink, detailsForm, editPen, emptyState, entityLink, flashFrom, formatAge, formatMoney, humanise, linkButton, page, rowLink, section, sectionHeader, statusBadge, table, ticketCell, urgencyBadge, type Html } from '../ui.ts';
import { chosenId, importPanel, nominatedFrom, postedLocation, propertyFields, saveDetails, type DetailsEdit, type Errors, type Values } from './onboarding-forms.ts';

type Overview = Awaited<ReturnType<PropertyManagerActions['propertyOverviews']>>[number];
type PropertyView = Awaited<ReturnType<PropertyManagerActions['property']>>;

/** Properties under /properties. */
export function propertyPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/address-suggestions', async (c) => {
    try {
      return c.json(await c.var.actions.suggestAddresses(c.req.query('q') ?? ''));
    } catch (error) {
      console.error('Address suggestions failed', error);
      return c.json([]);
    }
  });

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const properties = await actions.propertyOverviews();
    return c.html(
      page({
        title: 'Properties',
        pm,
        active: 'profiles',
        flash: flashFrom(c.req.url),
        shell: shellInfo(c),
        subtitle: `${properties.length} ${properties.length === 1 ? 'Property' : 'Properties'} managed by the Agency.`,
        actions: linkButton('Add a Property', '/properties/new', { variant: 'primary', size: 'sm' }),
        body: list(properties),
      }),
    );
  });

  pages.get('/new', (c) => addPropertyPage(c));

  pages.post('/:id{[0-9]+}/details', (c) => {
    const id = Number(c.req.param('id'));
    return saveDetails(c, {
      profile: `/properties/${id}`,
      save: (form) => {
        const location = postedLocation(form);
        return c.var.actions.editProperty(id, {
          address: text(form, 'address'),
          suburb: text(form, 'suburb'),
          ownerId: chosenId(form, 'ownerId', 'the Property Owner'),
          propertyManagerId: chosenId(form, 'propertyManagerId', 'the Property Manager'),
          maxRepairCostCents: maxRepairCost(form),
          nominatedTradieIds: nominatedFrom(form),
          buildingManagerId: text(form, 'buildingManagerId') ? Number(text(form, 'buildingManagerId')) : undefined,
          ...(location ? { location } : {}),
        });
      },
      show: (refused) => profilePage(c, id, refused),
    });
  });

  pages.get('/:id{[0-9]+}', (c) => profilePage(c, Number(c.req.param('id'))));

  return pages;
}

/** The Max Repair Cost typed in the edit form; a refusal comes back against its field, so it shows under it. */
function maxRepairCost(form: Parameters<typeof text>[0]): number {
  const refuse = (message: string): never => {
    throw new ActionError('invalid', message, { maxRepairCost: message });
  };
  if (!text(form, 'maxRepairCost')) refuse('Enter the Max Repair Cost');
  try {
    return cents(form, 'maxRepairCost', 'the Max Repair Cost');
  } catch (error) {
    if (error instanceof ActionError) refuse(error.message);
    throw error;
  }
}

/** A Property's profile; `refused` is a save of its details that was refused, shown with the form open. */
async function profilePage(c: Context<WebEnv>, id: number, refused?: DetailsEdit) {
  const { actions, pm } = c.var;
  let property: PropertyView;
  try {
    property = await actions.property(id);
  } catch (error) {
    if (!(error instanceof ActionError) || error.code !== 'not_found') throw error;
    return c.html(
      page({
        title: 'Property not found',
        pm,
        active: 'profiles',
        shell: shellInfo(c),
        body: emptyState('There is no such Property in your Agency.', linkButton('Back to Properties', '/properties')),
      }),
      404,
    );
  }
  const now = actions.now();
  const editing = !!refused || c.req.query('edit') === 'details';
  return c.html(
    page({
      title: property.address,
      pm,
      active: 'profiles',
      flash: flashFrom(c.req.url),
      shell: shellInfo(c),
      actions: linkButton('Back to Properties', '/properties', { variant: 'ghost', size: 'sm' }),
      body: html`
        ${openTickets(property, now)} ${editing ? await editForm(c, property, refused) : facts(property)}
        <div class="grid gap-6 lg:grid-cols-2">${tenants(property)}${nominated(property)}</div>
        ${frequent(property)} ${closedTickets(property, now)}
      `,
    }),
    refused ? 400 : 200,
  );
}

export type AddPropertyRefusal = { message: string; values: Values; errors: Errors };

/** The Add a Property page. A refused save is this same page, with what was typed and why. */
export async function addPropertyPage(c: Context<WebEnv>, refused?: AddPropertyRefusal) {
  const { actions, pm } = c.var;
  const flash = flashFrom(c.req.url);
  const form = flash?.kind === 'error' ? c.req.query('form') : undefined;
  const errorFor = (key: string): Html => (form === key && flash ? alert(flash.message, 'error') : html``);
  const [owners, buildingManagers, tradies, propertyManagers] = await Promise.all([
    actions.people('owner'),
    actions.people('building_manager'),
    actions.people('tradie'),
    actions.propertyManagers(),
  ]);
  return c.html(
    page({
      title: 'Add a Property',
      pm,
      active: 'profiles',
      flash,
      shell: shellInfo(c),
      actions: linkButton('Back to Properties', '/properties', { variant: 'ghost', size: 'sm' }),
      body: section({
        id: 'add-property',
        title: 'Add a Property',
        body: html`
          ${owners.length ? '' : html`<p class="mb-3 text-sm text-high">Add a Property Owner on the Setup page first.</p>`}
          ${refused ? alert(refused.message, 'error') : ''}
          <form method="post" action="/setup/properties">
            ${propertyFields({ owners, buildingManagers, propertyManagers, tradies, manager: pm.id, values: refused?.values, errors: refused?.errors })}
            <div class="mt-3">${button('Add Property', { variant: 'primary' })}</div>
          </form>
          <details class="import-details mt-4 border-t border-line pt-3" id="import-properties" ${form === 'import-properties' ? 'open' : ''}>
            <summary class="cursor-pointer font-semibold text-action">${icon('file-xls', { size: 'size-4' })}<span>Add many from a spreadsheet</span></summary>
            <div class="mt-3">${importPanel('properties', { error: errorFor('import-properties') })}</div>
          </details>
        `,
      }),
    }),
    refused ? 400 : 200,
  );
}

function list(properties: Overview[]): Html {
  if (!properties.length) return emptyState('No Properties yet. Add the first one to start taking reports.', linkButton('Add a Property', '/properties/new', { variant: 'primary' }));
  return table(
    ['Property', 'Open Tickets', 'Max Repair Cost', 'Property Owner', 'Tenants', 'Property Manager'],
    properties.map((p) => [
      rowLink(p.address, `/properties/${p.propertyId}`),
      html`<span class="${p.openTickets ? 'property-open' : 'text-muted'}">${p.openTickets}</span>`,
      html`${formatMoney(p.maxRepairCostCents)}`,
      entityLink('person', p.ownerName, `/owners/${p.ownerId}`),
      p.tenants.length
        ? html`<span class="flex flex-wrap gap-1">${p.tenants.map((t) => entityLink('tenant', t.name, `/tenants/${t.personId}`))}</span>`
        : html`<span class="text-muted">No Tenants</span>`,
      html`${p.propertyManager}`,
    ]),
    { stack: 'labelled', caption: 'Properties', align: ['left', 'right', 'right', 'left', 'left', 'left'] },
  );
}

/** A name, then the mobile number and the email to reach them on, each on its own line. */
function contact(person: { name: string; mobile: string | null; email: string | null }, href: string): Html {
  return html`<span class="property-contact">
    ${entityLink('person', person.name, href)}
    ${person.mobile ? contactLink('mobile', person.mobile) : ''}
    ${person.email ? contactLink('email', person.email) : ''}
  </span>`;
}

/** The headline facts: the Max Repair Cost first and large, then who owns and who manages the Property, with a pen to edit them. */
function facts(p: PropertyView): Html {
  return html`<section class="section" id="details" aria-label="Property details">
    <div class="details-head">
      <dl class="property-facts details-body">
        <div>
          <dt>Max Repair Cost</dt>
          <dd class="property-facts-money num">${formatMoney(p.maxRepairCostCents)}</dd>
        </div>
        <div>
          <dt>Property Owner</dt>
          <dd>${contact(p.owner, `/owners/${p.owner.personId}`)}</dd>
        </div>
        <div>
          <dt>Property Manager</dt>
          <dd>${p.propertyManager}</dd>
        </div>
        ${p.buildingManager
          ? html`<div>
              <dt>Building Manager</dt>
              <dd>${contact(p.buildingManager, `/building-managers/${p.buildingManager.personId}`)}</dd>
            </div>`
          : ''}
      </dl>
      ${editPen('Edit details', `/properties/${p.propertyId}?edit=details#details`)}
    </div>
  </section>`;
}

/**
 * The form to edit the address, suburb, Max Repair Cost, Property Owner, Property Manager, Building Manager and
 * Nominated Tradies, in place of the facts: the fields and the Tradie picker of adding a Property, filled in
 * from the Property or from what was posted. The pin stays hidden and empty: only a picked suggestion fills it.
 */
async function editForm(c: Context<WebEnv>, p: PropertyView, refused?: DetailsEdit): Promise<Html> {
  const { actions } = c.var;
  const [properties, owners, buildingManagers, tradies, propertyManagers] = await Promise.all([
    actions.properties(),
    actions.people('owner'),
    actions.people('building_manager'),
    actions.people('tradie'),
    actions.propertyManagers(),
  ]);
  const now = properties.find((x) => x.id === p.propertyId)!;
  const values: Values = refused?.values ?? {
    address: now.address,
    suburb: now.suburb,
    ownerId: String(now.ownerId),
    propertyManagerId: String(now.propertyManagerId),
    maxRepairCost: String(now.maxRepairCostCents / 100),
    buildingManagerId: now.buildingManagerId === null ? '' : String(now.buildingManagerId),
    nominatedTradieIds: now.nominatedTradieIds.map(String),
  };
  return html`<section class="section" id="details" aria-label="Property details">
    ${detailsForm({
      action: `/properties/${p.propertyId}/details`,
      cancel: `/properties/${p.propertyId}`,
      refusal: refused && !Object.keys(refused.errors).length ? refused.message : undefined,
      fields: propertyFields({ owners, buildingManagers, propertyManagers, tradies, values, errors: refused?.errors }),
    })}
  </section>`;
}

/** "1 Jan 2025" from a date like 2025-01-01. */
export function formatDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return date;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace('Sept', 'Sep');
}

function tenants(p: PropertyView): Html {
  return html`<section class="section min-w-0" aria-label="Tenants">
    ${sectionHeader('Tenants')}
    ${p.tenants.length
      ? table(
          ['Tenant', 'Mobile', 'Email'],
          p.tenants.map((t) => [
            html`${rowLink(t.name, `/tenants/${t.personId}`)}${t.tenancyStart ? html`<br /><span class="text-xs text-muted">Since ${formatDate(t.tenancyStart)}</span>` : ''}`,
            html`${t.mobile ? contactLink('mobile', t.mobile) : '—'}`,
            html`${t.email ? contactLink('email', t.email) : '—'}`,
          ]),
          { caption: 'Tenants', stack: 'labelled' },
        )
      : emptyState('No Tenants yet. Add the people who live here so they can report repairs.', linkButton('Add a Tenant', '/tenants/new'))}
  </section>`;
}

function nominated(p: PropertyView): Html {
  return html`<section class="section min-w-0" aria-label="Nominated Tradies">
    ${sectionHeader('Nominated Tradies')}
    ${p.nominatedTradies.length
      ? table(
          ['Tradie', 'Trades'],
          p.nominatedTradies.map((t) => [
            rowLink(t.businessName ?? t.name, `/tradies/${t.tradieId}`),
            html`<span class="flex flex-wrap gap-1">${t.trades.map((trade) => badge(humanise(trade), 'info'))}</span>`,
          ]),
          { caption: 'Nominated Tradies for Urgent Repairs', stack: 'labelled' },
        )
      : emptyState('No Nominated Tradie. Tenants arrange Urgent Repairs themselves.')}
  </section>`;
}

function frequent(p: PropertyView): Html {
  return html`<section class="section" aria-label="Frequent issues">
    ${sectionHeader('Frequent issues')}
    ${p.frequentIssues.length
      ? html`<ul class="flex flex-wrap gap-2" role="list">${p.frequentIssues.map((i) => html`<li>${badge(`${humanise(i.trade)}: ${i.tickets} ${i.tickets === 1 ? 'Ticket' : 'Tickets'}`, 'neutral')}</li>`)}</ul>`
      : emptyState('No Tickets on this Property yet.')}
  </section>`;
}

/** What is happening at the Property now: the open Tickets, issue first, with their Jobs' stages. */
function openTickets(p: PropertyView, now: Date): Html {
  return html`<section class="section" aria-label="Open Tickets">
    ${sectionHeader('Open Tickets')}
    ${p.openTickets.length
      ? table(
          ['Issue', 'Urgency', 'Jobs', 'Reported'],
          p.openTickets.map((t) => [
            ticketCell({ ticketId: t.ticketId, issue: t.description, unread: t.unreadMessages }),
            urgencyBadge(t.urgency),
            html`<span class="flex flex-wrap gap-1">${t.jobs.map((j) => html`<span class="whitespace-nowrap">${humanise(j.trade)} ${statusBadge(j.status, { job: true })}</span>`)}</span>`,
            html`<span class="text-muted whitespace-nowrap">${formatAge(t.reportedAt, now)}</span>`,
          ]),
          { caption: 'Open Tickets, most urgent first', stack: true },
        )
      : emptyState('No open Tickets.')}
  </section>`;
}

/** The Property's history: closed Tickets, most recently closed first. */
function closedTickets(p: PropertyView, now: Date): Html {
  return html`<section class="section" aria-label="Closed Tickets">
    ${sectionHeader('Closed Tickets')}
    ${p.closedTickets.length
      ? table(
          ['Issue', 'Trades', 'Closed'],
          p.closedTickets.map((t) => [
            ticketCell({ ticketId: t.ticketId, issue: t.description }),
            html`<span class="flex flex-wrap gap-1">${[...new Set(t.jobs.map((j) => j.trade))].map((trade) => badge(humanise(trade), 'neutral'))}</span>`,
            html`<span class="text-muted whitespace-nowrap">Closed ${formatAge(t.closedAt, now)}</span>`,
          ]),
          { caption: 'Closed Tickets, most recently closed first', stack: true },
        )
      : emptyState('No closed Tickets yet.')}
  </section>`;
}
