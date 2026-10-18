// The Agency's Properties: the list at /properties and one Property's profile at
// /properties/:id: its open Tickets first, then the Max Repair Cost, Property Owner
// and Property Manager, its Tenants, nominated Tradies, frequent issues and closed
// Tickets. Adding a Property is the form in Setup.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import { icon } from '../icons.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { alert, badge, button, emptyState, field, flashFrom, section, formatAge, formatMoney, humanise, linkButton, page, sectionHeader, statusBadge, table, ticketCell, urgencyBadge, type Html } from '../ui.ts';
import { choiceGroup, fieldGrid, importPanel } from './onboarding-forms.ts';

type Overview = Awaited<ReturnType<PropertyManagerActions['propertyOverviews']>>[number];
type PropertyView = Awaited<ReturnType<PropertyManagerActions['property']>>;

/** Properties under /properties. */
export function propertyPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const flash = flashFrom(c.req.url);
    const refused = flash?.kind === 'error' ? c.req.query('form') : undefined;
    const errorFor = (key: string): Html => (refused === key && flash ? alert(flash.message, 'error') : html``);
    const [properties, owners, buildingManagers, tradies, propertyManagers] = await Promise.all([
      actions.propertyOverviews(),
      actions.people('owner'),
      actions.people('building_manager'),
      actions.people('tradie'),
      actions.propertyManagers(),
    ]);
    return c.html(
      page({
        title: 'Properties',
        pm,
        active: 'properties',
        flash,
        shell: shellInfo(c),
        subtitle: `${properties.length} ${properties.length === 1 ? 'Property' : 'Properties'} managed by the Agency.`,
        actions: linkButton('Add a Property', '#add-property', { variant: 'primary', size: 'sm' }),
        body: html`${list(properties)}
          ${section({
            id: 'add-property',
            title: 'Add a Property',
            body: html`
              ${owners.length ? '' : html`<p class="mb-3 text-sm text-high">Add a Property Owner on the Setup page first.</p>`}
              <form method="post" action="/setup/properties">
                ${errorFor('property')}
                ${fieldGrid(html`
                  ${field({ label: 'Address', name: 'address', id: 'property-address', required: true, placeholder: '12 King St, Newtown NSW 2042' })}
                  ${field({ label: 'Suburb', name: 'suburb', id: 'property-suburb', required: true })}
                  ${field({
                    label: 'Property Owner',
                    name: 'ownerId',
                    id: 'property-owner',
                    type: 'select',
                    required: true,
                    placeholder: 'Choose the Property Owner',
                    options: owners.map((o) => ({ value: String(o.id), label: o.name })),
                  })}
                  ${field({
                    label: 'Property Manager',
                    name: 'propertyManagerId',
                    id: 'property-manager',
                    type: 'select',
                    required: true,
                    value: String(pm.id),
                    options: propertyManagers.map((m) => ({ value: String(m.id), label: m.name })),
                  })}
                  ${field({
                    label: 'Max Repair Cost ($)',
                    name: 'maxRepairCost',
                    id: 'property-max',
                    type: 'number',
                    step: '0.01',
                    min: 0,
                    required: true,
                    placeholder: '500',
                    hint: "The most a Ticket's Repair Cost can reach before the Property Owner must approve.",
                  })}
                  ${field({
                    label: 'Building Manager (strata only)',
                    name: 'buildingManagerId',
                    id: 'property-building-manager',
                    type: 'select',
                    options: [{ value: '', label: 'None' }, ...buildingManagers.map((b) => ({ value: String(b.id), label: b.name }))],
                  })}
                `)}
                <div class="mt-3">
                  ${tradies.length
                    ? choiceGroup({
                        legend: 'Nominated Tradies',
                        name: 'nominatedTradieIds',
                        type: 'checkbox',
                        options: tradies.map((t) => ({ value: String(t.id), label: `${t.businessName ?? t.name} (${t.trades.map(humanise).join(', ')})` })),
                        hint: 'Who the Tenant can call for an Urgent Repair.',
                      })
                    : html`<p class="text-sm text-muted">Add Tradies on the Tradies page to nominate them for Urgent Repairs.</p>`}
                </div>
                <div class="mt-3">${button('Add Property', { variant: 'primary' })}</div>
              </form>
              <details class="import-details mt-4 border-t border-line pt-3" id="import-properties" ${refused === 'import-properties' ? 'open' : ''}>
                <summary class="cursor-pointer font-semibold text-action">${icon('file-xls', { size: 'size-4' })}<span>Add many from a spreadsheet</span></summary>
                <div class="mt-3">${importPanel('properties', { error: errorFor('import-properties') })}</div>
              </details>
            `,
          })}
`,
      }),
    );
  });

  pages.get('/:id{[0-9]+}', async (c) => {
    const { actions, pm } = c.var;
    let property: PropertyView;
    try {
      property = await actions.property(Number(c.req.param('id')));
    } catch (error) {
      if (!(error instanceof ActionError) || error.code !== 'not_found') throw error;
      return c.html(
        page({
          title: 'Property not found',
          pm,
          active: 'properties',
          shell: shellInfo(c),
          body: emptyState('There is no such Property in your Agency.', linkButton('Back to Properties', '/properties')),
        }),
        404,
      );
    }
    const now = actions.now();
    return c.html(
      page({
        title: property.address,
        pm,
        active: 'properties',
        flash: flashFrom(c.req.url),
        shell: shellInfo(c),
        actions: linkButton('Back to Properties', '/properties', { variant: 'ghost', size: 'sm' }),
        body: html`
          ${openTickets(property, now)} ${facts(property)}
          <div class="grid gap-6 lg:grid-cols-2">${tenants(property)}${nominated(property)}</div>
          ${frequent(property)} ${closedTickets(property, now)}
        `,
      }),
    );
  });

  return pages;
}

function list(properties: Overview[]): Html {
  if (!properties.length) return emptyState('No Properties yet. Add the first one to start taking reports.', linkButton('Add a Property', '#add-property', { variant: 'primary' }));
  return table(
    ['Property', 'Open Tickets', 'Max Repair Cost', 'Property Owner', 'Tenants', 'Property Manager'],
    properties.map((p) => [
      html`<a class="link font-medium" href="/properties/${p.propertyId}">${p.address}</a>`,
      html`<span class="${p.openTickets ? 'property-open' : 'text-muted'}">${p.openTickets}</span>`,
      html`${formatMoney(p.maxRepairCostCents)}`,
      html`${p.ownerName}`,
      p.tenants.length
        ? html`${p.tenants.map((t, i) => html`${i ? ', ' : ''}<a class="link" href="/tenants/${t.personId}">${t.name}</a>`)}`
        : html`<span class="text-muted">No Tenants</span>`,
      html`${p.propertyManager}`,
    ]),
    { stack: 'labelled', caption: 'Properties', align: ['left', 'right', 'right', 'left', 'left', 'left'] },
  );
}

/** A name, then the mobile number and the email to reach them on, each on its own line. */
function contact(person: { name: string; mobile: string | null; email: string | null }): Html {
  return html`<span class="property-contact">
    <span class="font-medium">${person.name}</span>
    ${person.mobile ? html`<a class="link num" href="tel:${person.mobile}">${person.mobile}</a>` : ''}
    ${person.email ? html`<a class="link break-all" href="mailto:${person.email}">${person.email}</a>` : ''}
  </span>`;
}

/** The headline facts: the Max Repair Cost first and large, then who owns and who manages the Property. */
function facts(p: PropertyView): Html {
  return html`<section class="section" aria-label="Property details">
    <dl class="property-facts">
      <div>
        <dt>Max Repair Cost</dt>
        <dd class="property-facts-money num">${formatMoney(p.maxRepairCostCents)}</dd>
      </div>
      <div>
        <dt>Property Owner</dt>
        <dd>${contact(p.owner)}</dd>
      </div>
      <div>
        <dt>Property Manager</dt>
        <dd>${p.propertyManager}</dd>
      </div>
      ${p.buildingManager
        ? html`<div>
            <dt>Building Manager</dt>
            <dd>${contact(p.buildingManager)}</dd>
          </div>`
        : ''}
    </dl>
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
            html`<a class="link font-medium" href="/tenants/${t.personId}">${t.name}</a>${t.tenancyStart ? html`<br /><span class="text-xs text-muted">Since ${formatDate(t.tenancyStart)}</span>` : ''}`,
            html`${t.mobile ? html`<a class="link num" href="tel:${t.mobile}">${t.mobile}</a>` : '—'}`,
            html`${t.email ? html`<a class="link break-all" href="mailto:${t.email}">${t.email}</a>` : '—'}`,
          ]),
          { caption: 'Tenants', stack: 'labelled' },
        )
      : emptyState('No Tenants yet. Add the people who live here so they can report repairs.', linkButton('Add a Tenant', '/setup#tenants'))}
  </section>`;
}

function nominated(p: PropertyView): Html {
  return html`<section class="section min-w-0" aria-label="Nominated Tradies">
    ${sectionHeader('Nominated Tradies')}
    ${p.nominatedTradies.length
      ? table(
          ['Tradie', 'Trades'],
          p.nominatedTradies.map((t) => [
            html`<a class="link font-medium" href="/tradies/${t.tradieId}">${t.businessName ?? t.name}</a>`,
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
