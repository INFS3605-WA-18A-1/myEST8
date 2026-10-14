// Setup: verify the Agency's phone numbers, show its inbound email address, and add
// Property Owners, Building Managers and Tenants. Properties and Tradies have their
// own pages (/properties, /tradies); their forms still post here.
//
// Several forms share field names ("name", "mobile"), so each control's id is
// prefixed with its form ("owner-name") to keep every label pointing at its own
// control. A refused form comes back with `?form=<form>`: its error shows next to
// its fields, and it opens, while the other "Add" forms stay folded away.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { ImportKind } from '../../imports.ts';
import { ActionError, normalizeAddress } from '../../shared.ts';
import { NO_CONNECTORS, type ChannelConnectors } from '../connectors.ts';
import type { WebEnv } from '../env.ts';
import { gmailControls, whatsappControls } from './oauth-google.ts';
import { cents, formAction, list, text } from '../forms.ts';
import { icon } from '../icons.ts';
import { shellInfo } from '../shell.ts';
import { importPages } from './import.ts';
import { alert, button, emptyState, field, flashFrom, linkButton, page, section, table, type Flash, type Html } from '../ui.ts';
import {
  addTradieFrom,
  CHANNELS,
  channelChip,
  channelGuide,
  channelLine,
  channelOf,
  inboundEmailField,
  phoneChannelForm,
  chosenId,
  contactFields,
  contactFrom,
  fieldGrid,
  importPanel,
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
  properties: Property[];
};

/** A form's own refusal: the message to show in it, and whether it starts open. */
type Shown = { error: Html; open: boolean };

/** The areas of the page, in dependency order. */
const AREAS = [
  ['channels', 'Channels'],
  ['people', 'Property Owners and Building Managers'],
  ['tenants', 'Tenants'],
] as const;

/** Onboarding under /setup: channels, Properties, people and Tradies. */
export function setupPages(o: { connectors?: ChannelConnectors } = {}) {
  const connectors = o.connectors ?? NO_CONNECTORS;
  const pages = new Hono<WebEnv>();
  pages.route('/', importPages());

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const flash = flashFrom(c.req.url);
    const refusedForm = flash?.kind === 'error' ? c.req.query('form') : undefined;
    const shownFor = (key: FormKey): Shown => ({ error: refusedForm === key && flash ? formError(flash) : html``, open: refusedForm === key });
    const agency: Agency = {
      owners: await actions.people('owner'),
      buildingManagers: await actions.people('building_manager'),
      tenants: await actions.people('tenant'),
      properties: await actions.properties(),
    };
    const origin = new URL(c.req.url).origin;
    const { timeZone } = actions.agency();
    const email = await actions.ensureInboundEmail();
    const channels = await actions.channels();
    const pending = await actions.pendingChannelVerifications();

    return c.html(
      page({
        title: 'Setup',
        pm,
        active: 'settings',
        flash,
        shell: await shellInfo(c),
        subtitle: html`Channels, Property Owners, Building Managers and Tenants. Properties and Tradies have their own pages: <a class="link" href="/properties">Properties</a>, <a class="link" href="/tradies">Tradies</a>.`,
        actions: linkButton('Use the step-by-step guide', '/welcome', { variant: 'secondary', size: 'sm' }),
        body: html`
          <nav aria-label="Setup areas">
            <ul class="flex flex-wrap gap-x-4 gap-y-1 text-sm">${AREAS.map(([id, title]) => html`<li><a class="link" href="#${id}">${title}</a></li>`)}</ul>
          </nav>
          ${section({ id: 'channels', title: 'Channels', body: await channelsArea(origin, channels, timeZone, shownFor('channels'), connectors, actions.agency().id, email, pending) })}
          ${section({ id: 'people', title: 'Property Owners and Building Managers', body: peopleArea(agency, shownFor) })}
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
    const back = `/tradies?form=tradie${google ? `&google=${encodeURIComponent(google)}` : ''}`;
    return formAction(c, back, async (form) => {
      const businessName = await addTradieFrom(c.var.actions, form);
      return { ok: `${businessName} added as a Tradie`, redirect: '/tradies' };
    });
  });

  pages.post('/properties', (c) =>
    formAction(c, '/properties?form=property', async (form) => {
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
): Promise<Html> {
  const gmailBlock = connectors.gmail ? await gmailControls(connectors.gmail, agencyId, 'setup') : null;
  return html`
    <p class="text-sm">Tenants, Tradies and Property Owners reach the Agency by SMS, WhatsApp and email. Verify a phone number with a code. Forward the Agency inbox to the email address below.</p>
    ${shown.error}
    ${CHANNELS.map((channel) => channelRow(channel, connected.find((c) => c.type === channel.type), timeZone, origin, { gmailBlock, whatsappNumber: connectors.whatsappNumber }, email, pending.find((row) => row.channelType === channel.type)))}
  `;
}

/** One channel: its name and status, setup notes on the left, the form on the right. */
function channelRow(
  channel: (typeof CHANNELS)[number],
  connected: AgencyChannel | undefined,
  timeZone: string,
  origin: string,
  via: { gmailBlock: Html | null; whatsappNumber: string | null },
  email: { address: string; state: 'waiting' | 'verified' | 'connected' },
  pending: { address: string } | undefined,
): Html {
  const viaWhatsapp = channel.type === 'whatsapp' && via.whatsappNumber !== null;
  const waiting = channel.type === 'email' && email.state === 'waiting';
  const emailVerified = channel.type === 'email' && email.state === 'verified';
  const rowForm = 'mt-3 flex flex-wrap items-end gap-3';
  return html`<div class="mt-4 grid gap-4 border-t border-line pt-4 lg:grid-cols-2" id="${channel.type}">
    <div class="min-w-0">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 class="section-title">${channel.name}</h3>
        ${channelChip(connected, { waiting, verified: emailVerified })}
      </div>
      ${connected ? channelLine(connected, timeZone, { waiting }) : ''}
      ${channel.type === 'email' || !viaWhatsapp ? channelGuide(channel.type, origin) : ''}
    </div>
    <div class="min-w-0">
      ${channel.type === 'email'
        ? html`${inboundEmailField(email.address)}${via.gmailBlock ?? ''}`
        : viaWhatsapp
          ? connected?.address === via.whatsappNumber
            ? ''
            : whatsappControls(via.whatsappNumber!, '/setup/channels')
          : phoneChannelForm({
              channel,
              postTo: '/setup/channels',
              confirmTo: '/setup/channels/confirm',
              pending,
              current: connected?.address,
              className: rowForm,
            })}
    </div>
  </div>`;
}

function peopleArea(agency: Agency, shownFor: (key: FormKey) => Shown): Html {
  const owner = shownFor('owner');
  const buildingManager = shownFor('building-manager');
  return html`<div class="grid gap-6 lg:grid-cols-2">
    <div class="min-w-0">
      <h3 class="section-title mb-2">Property Owners</h3>
      ${peopleTable(agency.owners, 'Property Owners appear here once you add them.')}
      ${addForm(
        'Add a Property Owner',
        owner.open,
        html`${owner.error}
          <form method="post" action="/setup/owners">
            ${fieldGrid(contactFields('owner'))}
            <div class="mt-3">${button('Add Property Owner', { size: 'sm', variant: 'secondary' })}</div>
          </form>`,
      )}
      ${importForm('owners', shownFor('import-owners'))}
    </div>
    <div class="min-w-0 border-t border-line pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
      <h3 class="section-title mb-2">Building Managers</h3>
      <p class="mb-2 text-sm text-muted">For strata Properties: Common Area issues go to the Building Manager.</p>
      ${peopleTable(agency.buildingManagers, 'Building Managers appear here once you add them.')}
      ${addForm(
        'Add a Building Manager',
        buildingManager.open,
        html`${buildingManager.error}
          <form method="post" action="/setup/building-managers">
            ${fieldGrid(contactFields('building-manager'))}
            <div class="mt-3">${button('Add Building Manager', { size: 'sm', variant: 'secondary' })}</div>
          </form>`,
      )}
      ${importForm('building-managers', shownFor('import-building-managers'))}
    </div>
  </div>`;
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
      : emptyState('Tenants appear here once you add them. Add a Property first.')}
    ${addForm(
      'Add a Tenant',
      shown.open,
      html`${agency.properties.length ? '' : html`<p class="mb-3 text-sm text-high">Add a Property on the Properties page first.</p>`}
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
  );
}

function formError(flash: Flash): Html {
  return alert(flash.message, 'error');
}
