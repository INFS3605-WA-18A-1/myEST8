// Properties under /properties: every Property with its people, the form to add
// one, and the spreadsheet import. Adding posts to /setup/properties and comes back here.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { WebEnv } from '../env.ts';
import { icon } from '../icons.ts';
import { shellInfo } from '../shell.ts';
import { alert, button, emptyState, field, flashFrom, formatMoney, humanise, page, section, table, type Html } from '../ui.ts';
import { choiceGroup, fieldGrid, importPanel } from './onboarding-forms.ts';

type Person = Awaited<ReturnType<PropertyManagerActions['people']>>[number];

/** Properties under /properties. */
export function propertyPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const flash = flashFrom(c.req.url);
    const refused = flash?.kind === 'error' ? c.req.query('form') : undefined;
    const errorFor = (key: string): Html => (refused === key && flash ? alert(flash.message, 'error') : html``);
    const [owners, buildingManagers, tenants, tradies, properties, propertyManagers] = await Promise.all([
      actions.people('owner'),
      actions.people('building_manager'),
      actions.people('tenant'),
      actions.people('tradie'),
      actions.properties(),
      actions.propertyManagers(),
    ]);
    const nameOf = (people: Person[], id: number | null) => {
      const person = people.find((p) => p.id === id);
      return person ? (person.businessName ?? person.name) : '—';
    };
    const rows = properties.map((p) => [
      html`${p.address}`,
      html`${propertyManagers.find((m) => m.id === p.propertyManagerId)?.name ?? '—'}`,
      html`${nameOf(owners, p.ownerId)}`,
      html`${formatMoney(p.maxRepairCostCents)}`,
      html`${tenants.filter((t) => t.propertyId === p.id).map((t) => t.name).join(', ') || '—'}`,
      html`${p.nominatedTradieIds.map((id) => nameOf(tradies, id)).join(', ') || 'None'}`,
    ]);

    return c.html(
      page({
        title: 'Properties',
        pm,
        active: 'properties',
        flash,
        shell: await shellInfo(c),
        subtitle: 'Each Property has one Property Owner and one Property Manager.',
        body: html`
          ${section({
            title: 'Properties',
            body: properties.length
              ? table(['Address', 'Property Manager', 'Property Owner', 'Max Repair Cost', 'Tenants', 'Nominated Tradies'], rows, {
                  caption: 'Properties',
                  align: ['left', 'left', 'left', 'right', 'left', 'left'],
                })
              : emptyState('Properties appear here once you add them. Add the first one below.'),
          })}
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

  return pages;
}
