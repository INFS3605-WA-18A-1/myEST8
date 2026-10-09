// The onboarding guide: connect and test the Agency's channels, then add the people,
// Tradies, Properties and Tenants the agent acts for. Steps run in dependency order:
// a Property needs its Property Owner (and any Nominated Tradies) first, and a Tenant
// needs their Property.
//
// Several forms share field names ("name", "mobile"), so each control's id is
// prefixed with its form ("owner-name") to keep every label pointing at its own
// control. A refused form comes back with `?form=<form>` so its error also shows
// next to the fields.

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { cents, formAction, list, text } from '../forms.ts';
import { button, card, emptyState, field, flashFrom, formatMoney, humanise, linkButton, page, sectionHeader, table, type Flash, type Html } from '../ui.ts';
import {
  addTradieFrom,
  CHANNELS,
  channelGuide,
  channelOf,
  channelStatus,
  choiceGroup,
  chosenId,
  contactFields,
  contactFrom,
  googleSearchForm,
  searchListings,
  tradieFields,
  tradiesTable,
} from './onboarding-forms.ts';

type Person = ReturnType<PropertyManagerActions['people']>[number];
type Property = ReturnType<PropertyManagerActions['properties']>[number];
type PropertyManager = ReturnType<PropertyManagerActions['propertyManagers']>[number];
type AgencyChannel = ReturnType<PropertyManagerActions['channels']>[number];
type FormKey = 'channels' | 'owner' | 'building-manager' | 'tradie' | 'property' | 'tenant';

/** Everything the guide lists, read once per page. */
type Agency = {
  owners: Person[];
  buildingManagers: Person[];
  tenants: Person[];
  tradies: Person[];
  properties: Property[];
  propertyManagers: PropertyManager[];
};

const STEPS = [
  ['channels', 'Channels'],
  ['people', 'Property Owners and Building Managers'],
  ['tradies', 'Tradies'],
  ['properties', 'Properties'],
  ['tenants', 'Tenants'],
] as const;

/** Onboarding under /setup: channels and test messages, Properties, people and Tradies. */
export function setupPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const flash = flashFrom(c.req.url);
    const formKey = c.req.query('form');
    const errorFor = (key: FormKey): Html => (flash?.kind === 'error' && formKey === key ? formError(flash) : html``);
    const googleQuery = c.req.query('google')?.trim() ?? '';
    const agency: Agency = {
      owners: actions.people('owner'),
      buildingManagers: actions.people('building_manager'),
      tenants: actions.people('tenant'),
      tradies: actions.people('tradie'),
      properties: actions.properties(),
      propertyManagers: actions.propertyManagers(),
    };
    const origin = new URL(c.req.url).origin;
    const { timeZone } = actions.agency();
    const channels = actions.channels();

    return c.html(
      page({
        title: 'Set up myEST8',
        pm,
        active: 'setup',
        flash,
        body: html`
          <p>Work through these steps once. You can come back any time to add more.</p>
          <p>${linkButton('Use the step-by-step guide', '/welcome', { size: 'sm' })}</p>
          <nav aria-label="Setup steps" class="my-4">
            <ol class="list-decimal ml-6">${STEPS.map(([id, title]) => html`<li><a class="link" href="#${id}">${title}</a></li>`)}</ol>
          </nav>
          ${step(1, 'channels', 'Channels', channelsStep(origin, channels, timeZone, errorFor('channels')))}
          ${step(2, 'people', 'Property Owners and Building Managers', peopleStep(agency, errorFor))}
          ${step(3, 'tradies', 'Tradies', await tradiesStep(c, agency, googleQuery, errorFor('tradie')))}
          ${step(4, 'properties', 'Properties', propertiesStep(agency, pm.id, errorFor('property')))}
          ${step(5, 'tenants', 'Tenants', tenantsStep(agency, errorFor('tenant')))}
        `,
      }),
    );
  });

  pages.post('/channels', (c) =>
    formAction(c, '/setup?form=channels', (form) => {
      const channel = channelOf(form);
      const address = text(form, 'address');
      if (!address) throw new ActionError('invalid', `Enter the ${channel.addressLabel}`);
      c.var.actions.connectChannel(channel.type, address);
      return { ok: `${channel.name} connected to ${address}. Now send a test message.` };
    }),
  );

  pages.post('/channels/test', (c) =>
    formAction(c, '/setup?form=channels', async (form) => {
      const channel = channelOf(form);
      const to = text(form, 'to');
      if (!to) throw new ActionError('invalid', 'Enter where to send the test message');
      try {
        await c.var.actions.sendTestMessage(channel.type, to);
      } catch (error) {
        // The point of a test is to see what's wrong, so a channel or provider failure is shown, not hidden.
        if (error instanceof ActionError) throw error;
        throw new ActionError('invalid', `The ${channel.name} test message didn't send: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { ok: `Test message sent to ${to} by ${channel.name}. Check that it arrived.` };
    }),
  );

  pages.post('/owners', (c) =>
    formAction(c, '/setup?form=owner', (form) => {
      const contact = contactFrom(form);
      c.var.actions.addOwner(contact);
      return { ok: `${contact.name} added as a Property Owner` };
    }),
  );

  pages.post('/building-managers', (c) =>
    formAction(c, '/setup?form=building-manager', (form) => {
      const contact = contactFrom(form);
      c.var.actions.addBuildingManager(contact);
      return { ok: `${contact.name} added as a Building Manager` };
    }),
  );

  pages.post('/tradies', (c) => {
    const google = c.req.query('google');
    const back = `/setup?form=tradie${google ? `&google=${encodeURIComponent(google)}` : ''}`;
    return formAction(c, back, async (form) => {
      const businessName = await addTradieFrom(c.var.actions, form);
      return { ok: `${businessName} added as a Tradie`, redirect: '/setup?form=tradie' };
    });
  });

  pages.post('/properties', (c) =>
    formAction(c, '/setup?form=property', async (form) => {
      if (!text(form, 'maxRepairCost')) throw new ActionError('invalid', 'Enter the Max Repair Cost');
      const buildingManager = text(form, 'buildingManagerId');
      const address = text(form, 'address');
      await c.var.actions.addProperty({
        address,
        suburb: text(form, 'suburb'),
        ownerId: chosenId(form, 'ownerId', 'the Property Owner'),
        propertyManagerId: chosenId(form, 'propertyManagerId', 'the Property Manager'),
        maxRepairCostCents: cents(form, 'maxRepairCost', 'the Max Repair Cost'),
        nominatedTradieIds: list(form, 'nominatedTradieIds').map(Number),
        buildingManagerId: buildingManager ? Number(buildingManager) : undefined,
      });
      return { ok: `${address} added. Now add its Tenants.` };
    }),
  );

  pages.post('/tenants', (c) =>
    formAction(c, '/setup?form=tenant', (form) => {
      const contact = contactFrom(form);
      c.var.actions.addTenant({
        ...contact,
        propertyId: chosenId(form, 'propertyId', 'the Property'),
        tenancyStart: text(form, 'tenancyStart'),
      });
      return { ok: `${contact.name} added as a Tenant` };
    }),
  );

  return pages;
}

// Steps

function step(n: number, id: string, title: string, body: Html): Html {
  return html`<section id="${id}" class="mt-10" aria-label="Step ${n}: ${title}">
    ${sectionHeader(`Step ${n} · ${title}`)} ${body}
  </section>`;
}

function channelsStep(origin: string, connected: AgencyChannel[], timeZone: string, error: Html): Html {
  return html`
    <p>Tenants, Tradies and Property Owners reach the Agency by SMS, WhatsApp and email. Connect each one, then send yourself a test message.</p>
    ${error}
    <div class="grid gap-4 mt-4 lg:grid-cols-3">
      ${CHANNELS.map((channel) => channelCard(channel, connected.find((c) => c.type === channel.type), timeZone, origin))}
    </div>
  `;
}

function channelCard(channel: (typeof CHANNELS)[number], connected: AgencyChannel | undefined, timeZone: string, origin: string): Html {
  return card({
    title: channel.name,
    body: html`
      <p>${channelStatus(connected, timeZone)}</p>
      ${channelGuide(channel.type, origin)}
      <form method="post" action="/setup/channels" class="mt-3">
        <input type="hidden" name="type" value="${channel.type}" />
        ${field({
          label: channel.addressLabel,
          name: 'address',
          id: `${channel.type}-address`,
          type: channel.inputType,
          required: true,
          placeholder: channel.placeholder,
        })}
        ${button(`Connect ${channel.name}`, { size: 'sm' })}
      </form>
      <form method="post" action="/setup/channels/test" class="mt-3">
        <input type="hidden" name="type" value="${channel.type}" />
        ${field({
          label: channel.type === 'email' ? 'Send a test email to' : 'Send a test message to',
          name: 'to',
          id: `${channel.type}-to`,
          type: channel.inputType,
          required: true,
          placeholder: channel.type === 'email' ? 'you@youragency.com.au' : 'Your mobile',
        })}
        ${button('Send test message', { variant: 'secondary', size: 'sm' })}
      </form>
    `,
  });
}

function peopleStep(agency: Agency, errorFor: (key: FormKey) => Html): Html {
  return html`<div class="grid gap-4 lg:grid-cols-2">
    ${card({
      title: 'Property Owners',
      body: html`${peopleTable(agency.owners, 'No Property Owners yet.')}
        <form method="post" action="/setup/owners" class="mt-4">
          <h3 class="font-semibold">Add a Property Owner</h3>
          ${errorFor('owner')} ${contactFields('owner')} ${button('Add Property Owner', { size: 'sm' })}
        </form>`,
    })}
    ${card({
      title: 'Building Managers',
      body: html`<p class="text-sm">For strata Properties: Common Area issues go to the Building Manager.</p>
        ${peopleTable(agency.buildingManagers, 'No Building Managers yet.')}
        <form method="post" action="/setup/building-managers" class="mt-4">
          <h3 class="font-semibold">Add a Building Manager</h3>
          ${errorFor('building-manager')} ${contactFields('building-manager')} ${button('Add Building Manager', { size: 'sm' })}
        </form>`,
    })}
  </div>`;
}

async function tradiesStep(c: Context<WebEnv>, agency: Agency, googleQuery: string, error: Html): Promise<Html> {
  const { actions } = c.var;
  const { listings, problem } = await searchListings(actions, googleQuery);
  const action = `/setup/tradies${googleQuery ? `?google=${encodeURIComponent(googleQuery)}` : ''}`;

  return html`
    <p>Add the Tradies the Agency already uses. They're shared by every Property Manager.</p>
    ${tradiesTable(actions, agency.tradies)}
    ${card({
      title: 'Add a Tradie',
      body: html`
        ${googleSearchForm('/setup#tradies', googleQuery, problem, listings.length)}
        <form method="post" action="${action}" class="mt-4">
          ${error} ${tradieFields({ listings })} ${button('Add Tradie', { size: 'sm' })}
        </form>
      `,
    })}
  `;
}

function propertiesStep(agency: Agency, myId: number, error: Html): Html {
  const nameOf = (people: Person[], id: number | null) => {
    const person = people.find((p) => p.id === id);
    return person ? (person.businessName ?? person.name) : '—';
  };
  const rows = agency.properties.map((p) => [
    html`${p.address}`,
    html`${agency.propertyManagers.find((m) => m.id === p.propertyManagerId)?.name ?? '—'}`,
    html`${nameOf(agency.owners, p.ownerId)}`,
    html`${formatMoney(p.maxRepairCostCents)}`,
    html`${
      agency.tenants
        .filter((t) => t.propertyId === p.id)
        .map((t) => t.name)
        .join(', ') || '—'
    }`,
    html`${p.nominatedTradieIds.map((id) => nameOf(agency.tradies, id)).join(', ') || 'None'}`,
    html`${nameOf(agency.buildingManagers, p.buildingManagerId)}`,
  ]);

  return html`
    <p>Each Property has one Property Owner and is assigned to one Property Manager.</p>
    ${agency.properties.length
      ? table(['Address', 'Property Manager', 'Property Owner', 'Max Repair Cost', 'Tenants', 'Nominated Tradies', 'Building Manager'], rows, {
          caption: 'Properties',
        })
      : emptyState('No Properties yet.')}
    ${card({
      title: 'Add a Property',
      body: html`<form method="post" action="/setup/properties">
        ${error}
        ${agency.owners.length ? '' : html`<p class="text-warning">Add the Property Owner in step 2 first.</p>`}
        ${field({ label: 'Address', name: 'address', id: 'property-address', required: true, placeholder: '12 King St, Newtown NSW 2042' })}
        ${field({ label: 'Suburb', name: 'suburb', id: 'property-suburb', required: true })}
        ${field({
          label: 'Property Owner',
          name: 'ownerId',
          id: 'property-owner',
          type: 'select',
          required: true,
          placeholder: 'Choose the Property Owner',
          options: agency.owners.map((o) => ({ value: String(o.id), label: o.name })),
        })}
        ${field({
          label: 'Property Manager',
          name: 'propertyManagerId',
          id: 'property-manager',
          type: 'select',
          required: true,
          value: String(myId),
          options: agency.propertyManagers.map((m) => ({ value: String(m.id), label: m.name })),
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
        ${agency.tradies.length
          ? choiceGroup({
              legend: 'Nominated Tradies',
              name: 'nominatedTradieIds',
              type: 'checkbox',
              options: agency.tradies.map((t) => ({ value: String(t.id), label: `${t.businessName ?? t.name} (${t.trades.map(humanise).join(', ')})` })),
              hint: 'Who the Tenant can call for an Urgent Repair.',
            })
          : html`<p class="text-sm">Add Tradies in step 3 to nominate them for Urgent Repairs.</p>`}
        ${field({
          label: 'Building Manager (strata only)',
          name: 'buildingManagerId',
          id: 'property-building-manager',
          type: 'select',
          options: [{ value: '', label: 'None' }, ...agency.buildingManagers.map((b) => ({ value: String(b.id), label: b.name }))],
        })}
        ${button('Add Property', { size: 'sm' })}
      </form>`,
    })}
  `;
}

function tenantsStep(agency: Agency, error: Html): Html {
  const addressOf = (id: number | null) => agency.properties.find((p) => p.id === id)?.address ?? '—';
  return html`
    ${agency.tenants.length
      ? table(
          ['Name', 'Property', 'Mobile', 'Email', 'Tenancy start'],
          agency.tenants.map((t) => [
            html`${t.name}`,
            html`${addressOf(t.propertyId)}`,
            html`${t.mobile ?? '—'}`,
            html`${t.email ?? '—'}`,
            html`${t.tenancyStart ?? '—'}`,
          ]),
          { caption: 'Tenants' },
        )
      : emptyState('No Tenants yet.')}
    ${card({
      title: 'Add a Tenant',
      body: html`<form method="post" action="/setup/tenants">
        ${error}
        ${agency.properties.length ? '' : html`<p class="text-warning">Add the Property in step 4 first.</p>`}
        ${contactFields('tenant')}
        ${field({
          label: 'Property',
          name: 'propertyId',
          id: 'tenant-property',
          type: 'select',
          required: true,
          placeholder: 'Choose the Property',
          options: agency.properties.map((p) => ({ value: String(p.id), label: p.address })),
        })}
        ${field({ label: 'Tenancy start date', name: 'tenancyStart', id: 'tenant-start', type: 'date', required: true, hint: 'Photos taken before this date are flagged.' })}
        ${button('Add Tenant', { size: 'sm' })}
      </form>`,
    })}
  `;
}

// Form parts

function peopleTable(people: Person[], empty: string): Html {
  if (!people.length) return emptyState(empty);
  return table(
    ['Name', 'Mobile', 'Email'],
    people.map((p) => [html`${p.name}`, html`${p.mobile ?? '—'}`, html`${p.email ?? '—'}`]),
  );
}

function formError(flash: Flash): Html {
  return html`<p class="text-error font-medium my-2">${flash.message}</p>`;
}
