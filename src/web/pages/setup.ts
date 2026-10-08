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
import type { ChannelType } from '../../ports.ts';
import { ActionError, TRADES, type Trade } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { cents, formAction, int, list, optional, text, type FormValues } from '../forms.ts';
import {
  badge,
  button,
  card,
  emptyState,
  field,
  flashFrom,
  formatMoney,
  humanise,
  page,
  sectionHeader,
  table,
  type Flash,
  type Html,
} from '../ui.ts';

type Person = ReturnType<PropertyManagerActions['people']>[number];
type Property = ReturnType<PropertyManagerActions['properties']>[number];
type PropertyManager = ReturnType<PropertyManagerActions['propertyManagers']>[number];
type Listing = Awaited<ReturnType<PropertyManagerActions['findGoogleListings']>>[number];
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

/** The radio value for a Tradie who has no Google listing. */
const NOT_ON_GOOGLE = 'none';

const CHANNELS: { type: ChannelType; name: string; addressLabel: string; inputType: 'tel' | 'email'; placeholder: string }[] = [
  { type: 'sms', name: 'SMS', addressLabel: 'Agency SMS number', inputType: 'tel', placeholder: '+61 2 9000 0000' },
  { type: 'whatsapp', name: 'WhatsApp', addressLabel: 'WhatsApp sandbox number', inputType: 'tel', placeholder: '+1 415 523 8886' },
  { type: 'email', name: 'Email', addressLabel: 'Address the Agency inbox forwards to', inputType: 'email', placeholder: 'maintenance@parse.youragency.com.au' },
];

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

    return c.html(
      page({
        title: 'Set up myEST8',
        pm,
        active: 'setup',
        flash,
        body: html`
          <p>Work through these steps once. You can come back any time to add more.</p>
          <nav aria-label="Setup steps" class="my-4">
            <ol class="list-decimal ml-6">${STEPS.map(([id, title]) => html`<li><a class="link" href="#${id}">${title}</a></li>`)}</ol>
          </nav>
          ${step(1, 'channels', 'Channels', channelsStep(origin, errorFor('channels')))}
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
      const businessName = text(form, 'businessName');
      if (!businessName) throw new ActionError('invalid', 'Enter the business name');
      const tradie = {
        ...contactFrom(form),
        businessName,
        trades: list(form, 'trades') as Trade[],
        startingRating: int(form, 'startingRating', 'the starting rating'),
      };
      const listing = text(form, 'placeId');
      // An empty listing is left for addTradie to refuse with its own message.
      await c.var.actions.addTradie(listing === NOT_ON_GOOGLE ? { ...tradie, notOnGoogle: true } : { ...tradie, googlePlaceId: listing });
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

function channelsStep(origin: string, error: Html): Html {
  return html`
    <p>Tenants, Tradies and Property Owners reach the Agency by SMS, WhatsApp and email. Connect each one, then send yourself a test message.</p>
    ${error}
    <div class="grid gap-4 mt-4 lg:grid-cols-3">${CHANNELS.map((channel) => channelCard(channel, origin))}</div>
  `;
}

function channelCard(channel: (typeof CHANNELS)[number], origin: string): Html {
  return card({
    title: channel.name,
    body: html`
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

/** How to create the channel if the Agency doesn't have it yet. */
function channelGuide(type: ChannelType, origin: string): Html {
  const twilioWebhook = html`<code class="break-all">${origin}/webhooks/twilio</code>`;
  switch (type) {
    case 'sms':
      return html`<p>The Twilio phone number Tenants text.</p>
        <details class="mt-2">
          <summary>No Twilio number yet?</summary>
          <ol class="list-decimal ml-5 text-sm">
            <li>Sign up at twilio.com and open the Console.</li>
            <li>Buy an Australian number that can send and receive SMS.</li>
            <li>In the number's Messaging settings, set "A message comes in" to Webhook ${twilioWebhook}, HTTP POST.</li>
            <li>Connect the number here and send yourself a test message.</li>
          </ol>
        </details>`;
    case 'whatsapp':
      return html`<p>For now myEST8 uses the Twilio WhatsApp sandbox. A WhatsApp sender of your own, approved by Meta, comes later.</p>
        <details class="mt-2">
          <summary>Set up the sandbox</summary>
          <ol class="list-decimal ml-5 text-sm">
            <li>In the Twilio Console, open Messaging, then Try it out, then Send a WhatsApp message.</li>
            <li>In the sandbox settings, set "When a message comes in" to ${twilioWebhook}, HTTP POST.</li>
            <li>Join the sandbox from your phone by sending the join code shown there. Each Tenant does the same once.</li>
            <li>Connect the sandbox number here and send yourself a test message.</li>
          </ol>
        </details>`;
    case 'email':
      return html`<p>Email reaches myEST8 through SendGrid Inbound Parse. myEST8 also sends from this address, so replies come straight back.</p>
        <details class="mt-2">
          <summary>Set up SendGrid Inbound Parse</summary>
          <ol class="list-decimal ml-5 text-sm">
            <li>In SendGrid, authenticate your domain so email can be sent from it.</li>
            <li>Add an MX record for a receiving subdomain (for example parse.youragency.com.au) pointing to mx.sendgrid.net.</li>
            <li>In Settings, Inbound Parse, add that subdomain with the URL <code class="break-all">${origin}/webhooks/sendgrid</code>.</li>
            <li>Forward the Agency inbox to an address on that subdomain, and connect that address here.</li>
          </ol>
        </details>`;
  }
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
  let listings: Listing[] = [];
  let searchProblem: string | null = null;
  if (googleQuery) {
    try {
      listings = await actions.findGoogleListings(googleQuery);
    } catch {
      searchProblem = "Google search isn't working right now. Try again, or mark the Tradie as not on Google.";
    }
  }
  const rows = agency.tradies.map((t) => {
    const { average, count } = actions.tradie(t.id).myEst8Rating;
    return [
      html`<a class="link font-medium" href="/tradies/${t.id}">${t.businessName ?? t.name}</a>`,
      html`${t.name}`,
      html`${t.trades.map((trade) => html`${badge(humanise(trade), 'info')} `)}`,
      html`${average.toFixed(1)} <span class="text-sm opacity-70">(${count})</span>`,
      html`${t.googlePlaceId ? `${t.googleRating?.toFixed(1) ?? '—'} (${t.googleReviewCount ?? 0} reviews)` : 'Not on Google'}`,
    ];
  });
  const action = `/setup/tradies${googleQuery ? `?google=${encodeURIComponent(googleQuery)}` : ''}`;

  return html`
    <p>Add the Tradies the Agency already uses. They're shared by every Property Manager.</p>
    ${agency.tradies.length ? table(['Business', 'Name', 'Trades', 'myEST8 rating', 'Google rating'], rows, { caption: 'Tradies' }) : emptyState('No Tradies yet.')}
    ${card({
      title: 'Add a Tradie',
      body: html`
        <form method="get" action="/setup#tradies">
          ${field({ label: 'First, find their Google listing', name: 'google', id: 'google-search', value: googleQuery, placeholder: 'Business name and suburb' })}
          ${button('Search Google', { variant: 'secondary', size: 'sm' })}
        </form>
        ${searchProblem ? html`<p class="text-warning mt-2">${searchProblem}</p>` : ''}
        ${googleQuery && !searchProblem && !listings.length ? html`<p class="mt-2">No Google listings found for "${googleQuery}".</p>` : ''}
        <form method="post" action="${action}" class="mt-4">
          ${error}
          ${field({ label: 'Business name', name: 'businessName', id: 'tradie-business', required: true })}
          ${contactFields('tradie')}
          ${choiceGroup({
            legend: 'Trades',
            name: 'trades',
            type: 'checkbox',
            options: TRADES.map((trade) => ({ value: trade, label: humanise(trade) })),
          })}
          ${field({
            label: 'Starting rating',
            name: 'startingRating',
            id: 'tradie-rating',
            type: 'select',
            required: true,
            placeholder: 'Choose 1 to 5',
            options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} / 5` })),
            hint: 'How good they have been for the Agency so far. Ratings after each Job build on it.',
          })}
          ${choiceGroup({
            legend: 'Google listing',
            name: 'placeId',
            type: 'radio',
            required: true,
            options: [
              ...listings.map((l) => ({ value: l.placeId, label: `${l.name}, ${l.address}` })),
              { value: NOT_ON_GOOGLE, label: 'Not on Google' },
            ],
            hint: listings.length ? undefined : 'Search above to link their listing, so their Google rating shows next to ours.',
          })}
          ${button('Add Tradie', { size: 'sm' })}
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

/** Name, mobile and email; `form` prefixes the control ids. */
function contactFields(form: FormKey): Html {
  return html`
    ${field({ label: 'Name', name: 'name', id: `${form}-name`, required: true, autocomplete: 'off' })}
    ${field({ label: 'Mobile', name: 'mobile', id: `${form}-mobile`, type: 'tel', placeholder: '0412 345 678', autocomplete: 'off' })}
    ${field({ label: 'Email', name: 'email', id: `${form}-email`, type: 'email', hint: 'A mobile number, an email address, or both.', autocomplete: 'off' })}
  `;
}

function contactFrom(form: FormValues) {
  return { name: text(form, 'name'), mobile: optional(form, 'mobile'), email: optional(form, 'email') };
}

/** Checkboxes or radio buttons in a labelled group. */
function choiceGroup(o: {
  legend: string;
  name: string;
  type: 'checkbox' | 'radio';
  options: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
}): Html {
  return html`<fieldset class="fieldset my-2">
    <legend class="fieldset-legend">${o.legend}</legend>
    ${o.options.map(
      (opt) => html`<label class="label gap-2 cursor-pointer">
        <input type="${o.type}" class="${o.type} ${o.type}-primary ${o.type}-sm" name="${o.name}" value="${opt.value}" ${o.required ? 'required' : ''} />
        <span>${opt.label}</span>
      </label>`,
    )}
    ${o.hint ? html`<p class="label text-sm">${o.hint}</p>` : ''}
  </fieldset>`;
}

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

function channelOf(form: FormValues) {
  const type = text(form, 'type');
  const channel = CHANNELS.find((ch) => ch.type === type);
  if (!channel) throw new ActionError('invalid', 'Choose SMS, WhatsApp or email');
  return channel;
}

/** A chosen option's id; refuses an empty choice with "Choose <label>". */
function chosenId(form: FormValues, name: string, label: string) {
  const value = text(form, name);
  if (!value) throw new ActionError('invalid', `Choose ${label}`);
  return Number(value);
}
