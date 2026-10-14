// The onboarding guide: connect and test the Agency's channels, then add the people,
// Tradies, Properties and Tenants the agent acts for. Steps run in dependency order:
// a Property needs its Property Owner (and any Nominated Tradies) first, and a Tenant
// needs their Property.
//
// Several forms share field names ("name", "mobile"), so each control's id is
// prefixed with its form ("owner-name") to keep every label pointing at its own
// control. A refused form comes back with `?form=<form>`: its error shows next to
// its fields, and it opens, while the other "Add" forms stay folded away.

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { ImportKind } from '../../imports.ts';
import { ActionError } from '../../shared.ts';
import type { ChannelModes, WebEnv } from '../env.ts';
import { cents, formAction, list, text } from '../forms.ts';
import { icon } from '../icons.ts';
import { shellInfo } from '../shell.ts';
import { importPages } from './import.ts';
import { alert, button, emptyState, field, flashFrom, formatMoney, humanise, linkButton, page, section, table, type Flash, type Html } from '../ui.ts';
import {
  addTradieFrom,
  CHANNELS,
  channelChip,
  channelGuide,
  channelLine,
  channelOf,
  choiceGroup,
  chosenId,
  contactFields,
  contactFrom,
  fieldGrid,
  getSmsNumber,
  googleSearchForm,
  importPanel,
  modeChannelBody,
  searchListings,
  tradieFields,
  tradiesTable,
} from './onboarding-forms.ts';

type Person = Awaited<ReturnType<PropertyManagerActions['people']>>[number];
type Property = Awaited<ReturnType<PropertyManagerActions['properties']>>[number];
type PropertyManager = Awaited<ReturnType<PropertyManagerActions['propertyManagers']>>[number];
type AgencyChannel = Awaited<ReturnType<PropertyManagerActions['channels']>>[number];
type FormKey = 'channels' | 'owner' | 'building-manager' | 'tradie' | 'property' | 'tenant' | `import-${ImportKind}`;

/** Everything the guide lists, read once per page. */
type Agency = {
  owners: Person[];
  buildingManagers: Person[];
  tenants: Person[];
  tradies: Person[];
  properties: Property[];
  propertyManagers: PropertyManager[];
};

/** A form's own refusal: the message to show in it, and whether it starts open. */
type Shown = { error: Html; open: boolean };

/** The areas of the page, in dependency order. */
const AREAS = [
  ['channels', 'Channels'],
  ['people', 'Property Owners and Building Managers'],
  ['tradies', 'Tradies'],
  ['properties', 'Properties'],
  ['tenants', 'Tenants'],
] as const;

/** Onboarding under /setup: channels and test messages, Properties, people and Tradies. */
export function setupPages(o: { channels?: ChannelModes | undefined } = {}) {
  const pages = new Hono<WebEnv>();
  pages.route('/', importPages());

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const flash = flashFrom(c.req.url);
    const refusedForm = flash?.kind === 'error' ? c.req.query('form') : undefined;
    const shownFor = (key: FormKey): Shown => ({ error: refusedForm === key && flash ? formError(flash) : html``, open: refusedForm === key });
    const googleQuery = c.req.query('google')?.trim() ?? '';
    const agency: Agency = {
      owners: await actions.people('owner'),
      buildingManagers: await actions.people('building_manager'),
      tenants: await actions.people('tenant'),
      tradies: await actions.people('tradie'),
      properties: await actions.properties(),
      propertyManagers: await actions.propertyManagers(),
    };
    const origin = new URL(c.req.url).origin;
    const { timeZone } = actions.agency();
    const channels = await actions.channels();
    const gmail = o.channels?.gmail ? await actions.gmailStatus() : 'unavailable';

    return c.html(
      page({
        title: 'Set up myEST8',
        pm,
        active: 'settings',
        flash,
        shell: shellInfo(c),
        subtitle: 'Work through these areas once. Come back any time to add more.',
        actions: linkButton('Use the step-by-step guide', '/welcome', { variant: 'secondary', size: 'sm' }),
        body: html`
          <nav aria-label="Setup areas">
            <ul class="flex flex-wrap gap-x-4 gap-y-1 text-sm">${AREAS.map(([id, title]) => html`<li><a class="link" href="#${id}">${title}</a></li>`)}</ul>
          </nav>
          ${section({ id: 'channels', title: 'Channels', body: channelsArea(origin, channels, timeZone, shownFor('channels'), o.channels ? { modes: o.channels, gmail, pmEmail: pm.email } : undefined) })}
          ${section({ id: 'people', title: 'Property Owners and Building Managers', body: peopleArea(agency, shownFor) })}
          ${section({ id: 'tradies', title: 'Tradies', body: html`${await tradiesArea(c, agency, googleQuery, shownFor('tradie'))}${importForm('tradies', shownFor('import-tradies'))}` })}
          ${section({ id: 'properties', title: 'Properties', body: html`${propertiesArea(agency, pm.id, shownFor('property'))}${importForm('properties', shownFor('import-properties'))}` })}
          ${section({ id: 'tenants', title: 'Tenants', body: html`${tenantsArea(agency, shownFor('tenant'))}${importForm('tenants', shownFor('import-tenants'))}` })}
        `,
      }),
    );
  });

  pages.post('/channels', (c) =>
    formAction(c, '/setup?form=channels', async (form) => {
      const channel = channelOf(form);
      const address = text(form, 'address');
      if (!address) throw new ActionError('invalid', `Enter the ${channel.addressLabel}`);
      await c.var.actions.connectChannel(channel.type, address);
      return { ok: `${channel.name} connected to ${address}. Now send a test message.` };
    }),
  );

  // The one WhatsApp number this server has (Meta's Cloud API) goes to the Agency that connects it first.
  pages.post('/channels/whatsapp', (c) =>
    formAction(c, '/setup?form=channels', async () => {
      const number = o.channels?.whatsappNumber;
      if (!number) throw new ActionError('not_found', 'WhatsApp is not set up on this server');
      await c.var.actions.connectChannel('whatsapp', number);
      return { ok: `WhatsApp connected to ${number}. Now send a test message.` };
    }),
  );

  // myEST8 buys the Agency an Australian mobile number on Twilio and points its texts here.
  pages.post('/channels/sms', (c) =>
    formAction(c, '/setup?form=channels', async () => {
      if (!o.channels?.smsNumbers) throw new ActionError('not_found', 'SMS numbers are not set up on this server');
      const number = await getSmsNumber(c.var.actions);
      return { ok: `The Agency's SMS number is ${number}. Now send a test message.` };
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
    formAction(c, '/setup?form=owner', async (form) => {
      const contact = contactFrom(form);
      await c.var.actions.addOwner(contact);
      return { ok: `${contact.name} added as a Property Owner` };
    }),
  );

  pages.post('/building-managers', (c) =>
    formAction(c, '/setup?form=building-manager', async (form) => {
      const contact = contactFrom(form);
      await c.var.actions.addBuildingManager(contact);
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
      // The same action as the welcome guide's, with people the Agency already has and the Tenants added after.
      await c.var.actions.addPropertyWithPeople({
        address,
        suburb: text(form, 'suburb'),
        owner: { id: chosenId(form, 'ownerId', 'the Property Owner') },
        propertyManagerId: chosenId(form, 'propertyManagerId', 'the Property Manager'),
        maxRepairCostCents: cents(form, 'maxRepairCost', 'the Max Repair Cost'),
        nominatedTradieIds: list(form, 'nominatedTradieIds').map(Number),
        buildingManager: buildingManager ? { id: Number(buildingManager) } : null,
        tenants: [],
      });
      return { ok: `${address} added. Now add its Tenants.` };
    }),
  );

  pages.post('/tenants', (c) =>
    formAction(c, '/setup?form=tenant', async (form) => {
      const contact = contactFrom(form);
      await c.var.actions.addTenant({
        ...contact,
        propertyId: chosenId(form, 'propertyId', 'the Property'),
        tenancyStart: text(form, 'tenancyStart'),
      });
      return { ok: `${contact.name} added as a Tenant` };
    }),
  );

  return pages;
}

// Areas

/** A group inside an area: a surface with its own heading, an optional chip and its body. */
function subsection(o: { title: string; id?: string; actions?: Html; body: Html }): Html {
  return html`<div class="section" ${o.id ? html`id="${o.id}"` : ''}>
    <div class="section-head">
      <h3 class="section-title">${o.title}</h3>
      ${o.actions ? html`<div class="section-actions">${o.actions}</div>` : ''}
    </div>
    <div class="section-body">${o.body}</div>
  </div>`;
}

/** An "Add" form, folded away unless `open` (when it was refused, so its errors show). */
function addForm(title: string, open: boolean, body: Html): Html {
  return html`<details class="mt-4" ${open ? 'open' : ''}>
    <summary class="cursor-pointer font-semibold text-action">${title}</summary>
    <div class="mt-3">${body}</div>
  </details>`;
}

/** "Add many from a spreadsheet", folded away unless its upload was refused. */
function importForm(kind: ImportKind, shown: Shown): Html {
  return html`<details class="import-details" id="import-${kind}" ${shown.open ? 'open' : ''}>
    <summary class="cursor-pointer font-semibold text-action">${icon('file-xls', { size: 'size-4' })}<span>Add many from a spreadsheet</span></summary>
    <div class="mt-3">${importPanel(kind, { error: shown.error })}</div>
  </details>`;
}

function channelsArea(origin: string, connected: AgencyChannel[], timeZone: string, shown: Shown, mode?: { modes: ChannelModes; gmail: Parameters<typeof modeChannelBody>[0]['gmail']; pmEmail: string }): Html {
  return html`
    <p class="text-sm">Tenants, Tradies and Property Owners reach the Agency by SMS, WhatsApp and email.${mode ? ' Channels with no real provider on this server are simulated.' : ' Connect each channel, then send a test message.'}</p>
    ${shown.error}
    <div class="mt-4 grid gap-4 md:grid-cols-3">
      ${CHANNELS.map((channel) => channelCard(channel, connected.find((c) => c.type === channel.type), timeZone, origin, mode))}
    </div>
  `;
}

function channelCard(channel: (typeof CHANNELS)[number], connected: AgencyChannel | undefined, timeZone: string, origin: string, mode?: { modes: ChannelModes; gmail: Parameters<typeof modeChannelBody>[0]['gmail']; pmEmail: string }): Html {
  if (mode) {
    return subsection({
      id: channel.type,
      title: channel.name,
      actions: channelChip(connected),
      body: modeChannelBody({ channel, current: connected, modes: mode.modes, gmail: mode.gmail, pmEmail: mode.pmEmail, returnTo: '/setup', whatsappAction: '/setup/channels/whatsapp', smsAction: '/setup/channels/sms', testAction: '/setup/channels/test', timeZone }),
    });
  }
  return subsection({
    id: channel.type,
    title: channel.name,
    actions: channelChip(connected),
    body: html`
      ${connected ? channelLine(connected, timeZone) : ''}
      ${channelGuide(channel.type, origin)}
      <form method="post" action="/setup/channels" class="mt-3 grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <input type="hidden" name="type" value="${channel.type}" />
        ${field({
          label: channel.addressLabel,
          name: 'address',
          id: `${channel.type}-address`,
          type: channel.inputType,
          required: true,
          value: connected?.address ?? '',
          placeholder: channel.placeholder,
        })}
        ${button(connected ? `Change ${channel.name}` : `Connect ${channel.name}`, { size: 'sm', variant: connected ? 'secondary' : 'primary' })}
      </form>
      ${connected
        ? html`<form method="post" action="/setup/channels/test" class="mt-3 grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <input type="hidden" name="type" value="${channel.type}" />
            ${field({
              label: channel.type === 'email' ? 'Send a test email to' : 'Send a test message to',
              name: 'to',
              id: `${channel.type}-to`,
              type: channel.inputType,
              required: true,
              placeholder: channel.type === 'email' ? 'you@youragency.com.au' : 'Your mobile',
            })}
            ${button('Send test message', { variant: connected.testedAt ? 'secondary' : 'primary', size: 'sm' })}
          </form>`
        : ''}
    `,
  });
}

function peopleArea(agency: Agency, shownFor: (key: FormKey) => Shown): Html {
  const owner = shownFor('owner');
  const buildingManager = shownFor('building-manager');
  return html`<div class="grid gap-4 md:grid-cols-2">
    ${subsection({
      title: 'Property Owners',
      body: html`${peopleTable(agency.owners, 'No Property Owners yet.')}
        ${addForm(
          'Add a Property Owner',
          owner.open,
          html`${owner.error}
            <form method="post" action="/setup/owners">
              ${fieldGrid(contactFields('owner'))}
              <div class="mt-3">${button('Add Property Owner', { size: 'sm' })}</div>
            </form>`,
        )}
        ${importForm('owners', shownFor('import-owners'))}`,
    })}
    ${subsection({
      title: 'Building Managers',
      body: html`<p class="text-sm text-muted">For strata Properties: Common Area issues go to the Building Manager.</p>
        ${peopleTable(agency.buildingManagers, 'No Building Managers yet.')}
        ${addForm(
          'Add a Building Manager',
          buildingManager.open,
          html`${buildingManager.error}
            <form method="post" action="/setup/building-managers">
              ${fieldGrid(contactFields('building-manager'))}
              <div class="mt-3">${button('Add Building Manager', { size: 'sm' })}</div>
            </form>`,
        )}
        ${importForm('building-managers', shownFor('import-building-managers'))}`,
    })}
  </div>`;
}

async function tradiesArea(c: Context<WebEnv>, agency: Agency, googleQuery: string, shown: Shown): Promise<Html> {
  const { actions } = c.var;
  const { listings, problem } = await searchListings(actions, googleQuery);
  const action = `/setup/tradies${googleQuery ? `?google=${encodeURIComponent(googleQuery)}` : ''}`;

  return html`
    <p class="text-sm">Add the Tradies the Agency already uses. They're shared by every Property Manager.</p>
    ${(await tradiesTable(actions, agency.tradies))}
    ${addForm(
      'Add a Tradie',
      shown.open || googleQuery !== '',
      html`
        ${googleSearchForm('/setup#tradies', googleQuery, problem, listings.length)}
        <form method="post" action="${action}" class="mt-4">
          ${shown.error}
          ${tradieFields({ listings })}
          <div class="mt-3">${button('Add Tradie', { size: 'sm' })}</div>
        </form>
      `,
    )}
  `;
}

function propertiesArea(agency: Agency, myId: number, shown: Shown): Html {
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
    <p class="text-sm">Each Property has one Property Owner and is assigned to one Property Manager.</p>
    ${agency.properties.length
      ? table(['Address', 'Property Manager', 'Property Owner', 'Max Repair Cost', 'Tenants', 'Nominated Tradies', 'Building Manager'], rows, {
          caption: 'Properties',
        })
      : emptyState('No Properties yet.')}
    ${addForm(
      'Add a Property',
      shown.open,
      html`${agency.owners.length ? '' : html`<p class="mb-3 text-sm text-high">Add a Property Owner first.</p>`}
        <form method="post" action="/setup/properties">
          ${shown.error}
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
            ${field({
              label: 'Building Manager (strata only)',
              name: 'buildingManagerId',
              id: 'property-building-manager',
              type: 'select',
              options: [{ value: '', label: 'None' }, ...agency.buildingManagers.map((b) => ({ value: String(b.id), label: b.name }))],
            })}
          `)}
          <div class="mt-3">
            ${agency.tradies.length
              ? choiceGroup({
                  legend: 'Nominated Tradies',
                  name: 'nominatedTradieIds',
                  type: 'checkbox',
                  options: agency.tradies.map((t) => ({ value: String(t.id), label: `${t.businessName ?? t.name} (${t.trades.map(humanise).join(', ')})` })),
                  hint: 'Who the Tenant can call for an Urgent Repair.',
                })
              : html`<p class="text-sm text-muted">Add Tradies above to nominate them for Urgent Repairs.</p>`}
          </div>
          <div class="mt-3">${button('Add Property', { size: 'sm' })}</div>
        </form>`,
    )}
  `;
}

function tenantsArea(agency: Agency, shown: Shown): Html {
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
    ${addForm(
      'Add a Tenant',
      shown.open,
      html`${agency.properties.length ? '' : html`<p class="mb-3 text-sm text-high">Add a Property first.</p>`}
        <form method="post" action="/setup/tenants">
          ${shown.error}
          ${fieldGrid(html`
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
          `)}
          <div class="mt-3">${button('Add Tenant', { size: 'sm' })}</div>
        </form>`,
    )}
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
  return alert(flash.message, 'error');
}
