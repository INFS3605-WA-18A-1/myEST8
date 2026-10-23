// Setup: verify the Agency's phone numbers, show its inbound email address, and add
// Property Owners, Building Managers, Tradies, Properties and Tenants. Tradies and
// Properties also have their own pages (/tradies, /properties), whose forms post here
// too and come back to those pages; the forms on this page ask to come back here.
//
// Several forms share field names ("name", "mobile"), so each control's id is
// prefixed with its form ("owner-name") to keep every label pointing at its own
// control. A refused form comes back with `?form=<form>`: its error shows next to
// its fields, and it opens, while the other "Add" forms stay folded away.

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { ImportKind } from '../../imports.ts';
import { ActionError, normalizeAddress } from '../../shared.ts';
import type { ChannelType } from '../../ports.ts';
import { NO_CONNECTORS, type ChannelConnectors } from '../connectors.ts';
import type { WebEnv } from '../env.ts';
import { gmailControls } from './oauth-google.ts';
import { cents, formAction, text } from '../forms.ts';
import { icon } from '../icons.ts';
import { shellInfo } from '../shell.ts';
import { importPages } from './import.ts';
import { serverSmsPanel } from './server-sms.ts';
import { smsNumberPanel, smsNumbersOffered } from './sms-number.ts';
import { alert, button, emptyState, field, flashFrom, formatMoney, linkButton, page, section, table, type Flash, type Html } from '../ui.ts';
import {
  addPersonForm,
  addTradieFrom,
  addTradieSection,
  CHANNELS,
  channelChip,
  unavailableChip,
  unavailableNote,
  channelGuide,
  channelLine,
  channelOf,
  inboundEmailField,
  phoneChannelForm,
  chosenId,
  nominatedFrom,
  postedLocation,
  propertyOptions,
  propertyPlaceFields,
  tradiePicker,
  contactFields,
  contactFrom,
  fieldGrid,
  importPanel,
  listingChoice,
  listingParams,
  type ListingChoice,
  tradiesTable,
} from './onboarding-forms.ts';

type Person = Awaited<ReturnType<PropertyManagerActions['people']>>[number];
type Property = Awaited<ReturnType<PropertyManagerActions['properties']>>[number];
type AgencyChannel = Awaited<ReturnType<PropertyManagerActions['channels']>>[number];
type FormKey = 'channels' | 'owner' | 'building-manager' | 'tradie' | 'property' | 'tenant' | `import-${ImportKind}`;

/** Everything the guide lists, read once per page. */
type Agency = {
  owners: Person[];
  buildingManagers: Person[];
  tenants: Person[];
  tradies: Person[];
  properties: Property[];
  propertyManagers: Awaited<ReturnType<PropertyManagerActions['propertyManagers']>>;
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

/** Onboarding under /setup: channels, people, Tradies, Properties and Tenants. */
export function setupPages(o: { connectors?: ChannelConnectors } = {}) {
  const connectors = o.connectors ?? NO_CONNECTORS;
  const pages = new Hono<WebEnv>();
  pages.route('/', importPages());

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const flash = flashFrom(c.req.url);
    const refusedForm = flash?.kind === 'error' ? c.req.query('form') : undefined;
    const shownFor = (key: FormKey): Shown => ({ error: refusedForm === key && flash ? formError(flash) : html``, open: refusedForm === key });
    const choice = listingChoice((name) => c.req.query(name));
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
    const email = await actions.ensureInboundEmail();
    const channels = await actions.channels();
    const pending = await actions.pendingChannelVerifications();
    // The server's phone replaces both the typed number and code and the Twilio panel.
    const serverPhone = connectors.smsPhone;
    const currentSms = channels.find((ch) => ch.type === 'sms')?.address;
    const smsPanel = serverPhone ? serverSmsPanel({ from: 'setup', number: serverPhone, current: currentSms }) : (await smsNumbersOffered(actions)) ? await smsNumberPanel(actions, { from: 'setup', current: currentSms }) : null;

    return c.html(
      page({
        title: 'Set up myEST8',
        pm,
        active: 'settings',
        flash,
        shell: await shellInfo(c),
        subtitle: 'Work through these areas once. Come back any time to add more.',
        actions: linkButton('Use the step-by-step guide', '/welcome', { variant: 'secondary', size: 'sm' }),
        body: html`
          ${areasNav(agency, channels, connectors.unavailable)}
          ${section({ id: 'channels', title: 'Channels', body: await channelsArea(origin, channels, timeZone, shownFor('channels'), connectors, actions.agency().id, email, pending, smsPanel) })}
          ${section({ id: 'people', title: 'Property Owners and Building Managers', body: peopleArea(agency, shownFor) })}
          ${section({ id: 'tradies', title: 'Tradies', body: html`${await tradiesArea(c, agency, choice, shownFor('tradie'))}${importForm('tradies', shownFor('import-tradies'))}` })}
          ${section({ id: 'properties', title: 'Properties', body: html`${propertiesArea(agency, pm.id, shownFor('property'))}${importForm('properties', shownFor('import-properties'))}` })}
          ${section({ id: 'tenants', title: 'Tenants', body: html`${tenantsArea(agency, shownFor('tenant'))}${importForm('tenants', shownFor('import-tenants'))}` })}
        `,
      }),
    );
  });

  pages.post('/channels', (c) =>
    formAction(c, '/setup?form=channels', async (form) => {
      const channel = channelOf(form);
      if (channel.type === 'email') return { ok: 'Forward the Agency inbox to the inbound address on this page.' };
      const address = text(form, 'address');
      if (!address) throw new ActionError('invalid', `Enter the ${channel.addressLabel}`);
      await c.var.actions.startChannelVerification(channel.type, address);
      return { ok: `We sent a 6-digit code to ${normalizeAddress(address)}. It expires in 10 minutes.` };
    }),
  );

  pages.post('/channels/confirm', (c) =>
    formAction(c, '/setup?form=channels', async (form) => {
      const channel = channelOf(form);
      const address = text(form, 'address');
      const code = text(form, 'code');
      if (!code) throw new ActionError('invalid', 'Enter the 6-digit code');
      await c.var.actions.confirmChannelVerification(channel.type, address, code);
      return { ok: `${channel.name} verified.` };
    }),
  );

  // The Property Owners and Building Managers pages post here too (`from=list`) and come back to themselves.
  const listHome = (c: Context<WebEnv>, list: '/owners' | '/building-managers') => (c.req.query('from') === 'list' ? list : '/setup');

  pages.post('/owners', (c) => {
    const here = listHome(c, '/owners');
    return formAction(c, `${here}?form=owner`, async (form) => {
      const contact = contactFrom(form);
      await c.var.actions.addOwner(contact);
      return { ok: `${contact.name} added as a Property Owner`, ...(here === '/owners' ? { redirect: here } : {}) };
    });
  });

  pages.post('/building-managers', (c) => {
    const here = listHome(c, '/building-managers');
    return formAction(c, `${here}?form=building-manager`, async (form) => {
      const contact = contactFrom(form);
      await c.var.actions.addBuildingManager(contact);
      return { ok: `${contact.name} added as a Building Manager`, ...(here === '/building-managers' ? { redirect: here } : {}) };
    });
  });

  // The Tradies, Properties and Tenants pages post here too and come back to themselves; this page's forms add `from=setup`.
  const home = (c: Context<WebEnv>, page: '/tradies' | '/properties' | '/tenants') => (c.req.query('from') === 'setup' ? '/setup' : page);

  pages.post('/tradies', (c) => {
    const chosen = listingParams(listingChoice((name) => c.req.query(name)));
    const here = home(c, '/tradies');
    const back = `${here}?form=tradie${chosen ? `&${chosen}` : ''}`;
    return formAction(c, back, async (form) => {
      const businessName = await addTradieFrom(c.var.actions, form);
      return { ok: `${businessName} added as a Tradie`, redirect: here };
    });
  });

  pages.post('/properties', (c) =>
    formAction(c, `${home(c, '/properties')}?form=property`, async (form) => {
      if (!text(form, 'maxRepairCost')) throw new ActionError('invalid', 'Enter the Max Repair Cost');
      const buildingManager = text(form, 'buildingManagerId');
      const address = text(form, 'address');
      const location = postedLocation(form);
      await c.var.actions.addProperty({
        address,
        suburb: text(form, 'suburb'),
        ownerId: chosenId(form, 'ownerId', 'the Property Owner'),
        propertyManagerId: chosenId(form, 'propertyManagerId', 'the Property Manager'),
        maxRepairCostCents: cents(form, 'maxRepairCost', 'the Max Repair Cost'),
        nominatedTradieIds: nominatedFrom(form),
        buildingManagerId: buildingManager ? Number(buildingManager) : undefined,
        ...(location ? { location } : {}),
      });
      return { ok: `${address} added. Now add its Tenants.` };
    }),
  );

  pages.post('/tenants', (c) =>
    formAction(c, `${home(c, '/tenants')}?form=tenant`, async (form) => {
      const contact = contactFrom(form);
      await c.var.actions.addTenant({
        ...contact,
        propertyId: chosenId(form, 'propertyId', 'the Property'),
        tenancyStart: text(form, 'tenancyStart'),
      });
      return { ok: `${contact.name} added as a Tenant`, redirect: home(c, '/tenants') };
    }),
  );

  return pages;
}

// Areas

/** "3 Tradies", "1 Property". */
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The areas in the order they must happen, each a link to its section with what
 * it has so far, so the page opens on what's done and what's next.
 */
function areasNav(agency: Agency, channels: AgencyChannel[], unavailable: readonly ChannelType[]): Html {
  const offered = CHANNELS.filter((ch) => !unavailable.includes(ch.type));
  const connected = offered.filter((ch) => channels.some((c) => c.type === ch.type)).map((ch) => (ch.type === 'email' ? 'email' : ch.name));
  const people = [
    ...(agency.owners.length ? [count(agency.owners.length, 'Property Owner')] : []),
    ...(agency.buildingManagers.length ? [count(agency.buildingManagers.length, 'Building Manager')] : []),
  ];
  const state: Record<(typeof AREAS)[number][0], string | null> = {
    channels: !offered.length ? 'Not available here' : connected.length ? `${connected.join(' and ').replace(/^./, (c) => c.toUpperCase())} connected` : null,
    people: people.length ? people.join(', ') : null,
    tradies: agency.tradies.length ? count(agency.tradies.length, 'Tradie') : null,
    properties: agency.properties.length ? count(agency.properties.length, 'Property', 'Properties') : null,
    tenants: agency.tenants.length ? count(agency.tenants.length, 'Tenant') : null,
  };
  return html`<nav aria-label="Setup areas" class="setup-areas">
    <ol>
      ${AREAS.map(([id, title]) => {
        const has = state[id];
        return html`<li>
          <a href="#${id}" class="setup-area ${has ? 'is-done' : 'is-todo'}">
            <span class="setup-area-mark" aria-hidden="true">${icon(has ? 'check-circle' : 'circle', { size: 'size-5' })}</span>
            <span class="setup-area-name">${title}</span>
            <span class="setup-area-state">${has ?? 'None yet'}</span>
          </a>
        </li>`;
      })}
    </ol>
  </nav>`;
}

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

async function channelsArea(
  origin: string,
  connected: AgencyChannel[],
  timeZone: string,
  shown: Shown,
  connectors: ChannelConnectors,
  agencyId: number,
  email: { address: string; state: 'waiting' | 'verified' | 'connected' },
  pending: { channelType: AgencyChannel['type']; address: string }[],
  smsPanel: Html | null,
): Promise<Html> {
  const gmailBlock = connectors.gmail ? await gmailControls(connectors.gmail, agencyId, 'setup') : null;
  return html`
    <p class="text-sm">Tenants, Tradies and Property Owners reach the Agency by SMS and email. ${connectors.smsPhone ? "Connect the server's SMS phone." : smsPanel ? 'Set up the number Tenants will text.' : 'Verify a phone number with a code.'} Forward the Agency inbox to the email address below.</p>
    ${shown.error}
    <div class="mt-4 grid gap-4 ${smsPanel ? '' : 'md:grid-cols-2'}">
      ${CHANNELS.map((channel) => channelCard(channel, connected.find((c) => c.type === channel.type), timeZone, origin, { gmailBlock, unavailable: connectors.unavailable, smsInbound: connectors.smsInbound, smsPanel }, email, pending.find((row) => row.channelType === channel.type)))}
    </div>
  `;
}

/** One channel as a card: its chip, what it is set to, how it works, and the form that connects it. */
function channelCard(
  channel: (typeof CHANNELS)[number],
  connected: AgencyChannel | undefined,
  timeZone: string,
  origin: string,
  via: { gmailBlock: Html | null; unavailable: ChannelType[]; smsInbound: 'simulator' | 'none'; smsPanel: Html | null },
  email: { address: string; state: 'waiting' | 'verified' | 'connected' },
  pending: { address: string } | undefined,
): Html {
  const waiting = channel.type === 'email' && email.state === 'waiting';
  const emailVerified = channel.type === 'email' && email.state === 'verified';
  const rowForm = 'grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]';
  if (via.unavailable.includes(channel.type)) {
    return subsection({ id: channel.type, title: channel.name, actions: unavailableChip(), body: html`<div class="mt-2">${unavailableNote(channel.type, via.unavailable)}</div>` });
  }
  return subsection({
    id: channel.type,
    title: channel.name,
    actions: channelChip(connected, { waiting, verified: emailVerified }),
    body: html`
      ${connected && !(channel.type === 'sms' && via.smsPanel) ? channelLine(connected, timeZone, { waiting, smsInbound: via.smsInbound }) : ''}
      <div class="mt-3">
        ${channel.type === 'email'
          ? html`${inboundEmailField(email.address)}${via.gmailBlock ?? ''}`
          : via.smsPanel ?? phoneChannelForm({
                channel,
                postTo: '/setup/channels',
                confirmTo: '/setup/channels/confirm',
                pending,
                current: connected?.address,
                className: rowForm,
              })}
      </div>
      ${channel.type === 'sms' && via.smsPanel ? '' : html`<div class="mt-3">${channelGuide(channel.type, origin)}</div>`}
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
            ${addPersonForm({ id: 'owner', action: '/setup/owners', submit: 'Add Property Owner' })}`,
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
            ${addPersonForm({ id: 'building-manager', action: '/setup/building-managers', submit: 'Add Building Manager' })}`,
        )}
        ${importForm('building-managers', shownFor('import-building-managers'))}`,
    })}
  </div>`;
}

async function tradiesArea(c: Context<WebEnv>, agency: Agency, choice: ListingChoice, shown: Shown): Promise<Html> {
  const { actions } = c.var;
  return html`
    <p class="text-sm">Add the Tradies the Agency already uses. They're shared by every Property Manager. Each Tradie's page is under <a class="link" href="/tradies">Tradies</a>.</p>
    ${await tradiesTable(actions, agency.tradies)}
    ${addForm(
      'Add a Tradie',
      shown.open || !!(choice.query || choice.place || choice.manual),
      await addTradieSection({
        actions,
        choice,
        path: '/setup',
        anchor: '#tradies',
        postTo: '/setup/tradies?from=setup',
        submit: button('Add Tradie', { size: 'sm' }),
        refusal: shown.error,
      }),
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
    html`${agency.tenants.filter((t) => t.propertyId === p.id).map((t) => t.name).join(', ') || '—'}`,
    html`${p.nominatedTradieIds.map((id) => nameOf(agency.tradies, id)).join(', ') || 'None'}`,
    html`${nameOf(agency.buildingManagers, p.buildingManagerId)}`,
  ]);
  return html`
    <p class="text-sm">Each Property has one Property Owner and is assigned to one Property Manager. Open one from <a class="link" href="/properties">Properties</a>.</p>
    ${agency.properties.length
      ? table(['Address', 'Property Manager', 'Property Owner', 'Max Repair Cost', 'Tenants', 'Nominated Tradies', 'Building Manager'], rows, { caption: 'Properties', stack: 'labelled' })
      : emptyState('No Properties yet.')}
    ${addForm(
      'Add a Property',
      shown.open,
      html`${agency.owners.length ? '' : html`<p class="mb-3 text-sm text-high">Add a Property Owner first.</p>`}
        <form method="post" action="/setup/properties?from=setup">
          ${shown.error}
          ${fieldGrid(html`
            ${propertyPlaceFields()}
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
              ? tradiePicker({ id: 'setup-property', tradies: agency.tradies })
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
            html`${formatDate(t.tenancyStart)}`,
          ]),
          { caption: 'Tenants', stack: 'labelled' },
        )
      : emptyState('Tenants appear here once you add them. Add a Property first.')}
    ${addForm(
      'Add a Tenant',
      shown.open,
      html`${agency.properties.length ? '' : html`<p class="mb-3 text-sm text-high">Add a Property above first.</p>`}
        <form method="post" action="/setup/tenants?from=setup">
          ${shown.error}
          ${fieldGrid(html`
            ${contactFields('tenant')}
            ${field({
              label: 'Property',
              name: 'propertyId',
              id: 'tenant-property',
              type: 'select',
              required: true,
              placeholder: 'Search by street, suburb or postcode',
              search: true,
              options: propertyOptions(agency.properties),
            })}
            ${field({ label: 'Tenancy start date', name: 'tenancyStart', id: 'tenant-start', type: 'date', required: true, hint: 'Photos taken before this date are flagged.' })}
          `)}
          <div class="mt-3">${button('Add Tenant', { size: 'sm', variant: 'secondary' })}</div>
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
    { stack: 'labelled' },
  );
}

/** A calendar date as people read it: "2026-09-01" is "1 Sep 2026". */
function formatDate(isoDate: string | null): string {
  const m = isoDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate ?? '—';
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1];
  return `${Number(m[3])} ${month} ${m[1]}`;
}

function formError(flash: Flash): Html {
  return alert(flash.message, 'error');
}
