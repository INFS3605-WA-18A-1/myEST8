// The Agency's Properties: the list at /properties, adding one at /properties/new
// (the form still posts to /setup/properties), and one Property's profile at
// /properties/:id. The profile opens with the Property's photo (fetched when it was
// added, or one the Property Manager uploaded), then its open Tickets, the Max Repair
// Cost, Property Owner and Property Manager, its Tenants, nominated Tradies, frequent
// issues and closed Tickets. The profile's pen edits its details in place (inlineEdit;
// without JavaScript ?edit=details opens it) and posts to /properties/:id/details.
// GET /properties/:id/photo serves the photo. POST replaces it, or restores the online one.

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import { cents, files, list as listOf, text, type FormValues } from '../forms.ts';
import { icon } from '../icons.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { addButton, listFilter, mineAll, profileChips, profilesCard, type ProfileFilter } from '../profiles-frame.ts';
import { neighboursIn, profileCard, profileHero, profileTabs, sideFact, sideHead } from '../profile-card.ts';
import { streamOf } from '../stream.ts';
import { alert, badge, button, contactLink, emptyState, entityLink, field, inlineEdit, flashFrom, formatAge, formatMoney, humanise, linkButton, page, postButton, rowLink, section, sectionHeader, statusBadge, table, ticketCell, urgencyBadge, withFlash, type Html } from '../ui.ts';
import { chosenId, importPanel, nominatedFrom, postedLocation, propertyFields, propertyPlaceFields, saveDetails, tradiePicker, valueOf, type DetailsEdit, type Errors, type Values } from './onboarding-forms.ts';

type Overview = Awaited<ReturnType<PropertyManagerActions['propertyOverviews']>>[number];
type PropertyView = Awaited<ReturnType<PropertyManagerActions['property']>>;

/** A 10 MB photo, plus the multipart framing. */
const PHOTO_UPLOAD_BYTES = 11 * 1024 * 1024;

const photoBack = (id: number) => `/properties/${id}#photo`;

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

  // A Profiles page: Mine is the Properties this Property Manager looks after, All the Agency's.
  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const filter: ProfileFilter = c.req.query('filter') === 'all' ? 'all' : 'mine';
    const [everything, records, overview] = await Promise.all([actions.propertyOverviews(), actions.properties(), actions.profilesOverview({ filter })]);
    const mine = new Set(records.filter((p) => p.propertyManagerId === pm.id).map((p) => p.id));
    const properties = filter === 'mine' ? everything.filter((p) => mine.has(p.propertyId)) : everything;
    return c.html(
      page({
        title: 'Properties',
        heading: 'Profiles',
        pm,
        active: 'profiles',
        flash: flashFrom(c.req.url),
        shell: shellInfo(c),
        controls: profileChips('properties', overview.counts, filter),
        body: profilesCard({
          search: listFilter('Filter Properties', 'Address, Owner or Tenant'),
          end: html`${mineAll('/properties', filter)}${addButton('Add a Property', '/properties/new')}`,
          body: list(properties, filter),
        }),
      }),
    );
  });

  pages.get('/new', (c) => addPropertyPage(c));

  pages.get('/:id{[0-9]+}/photo', async (c) => {
    const id = Number(c.req.param('id'));
    try {
      const file = await c.var.actions.propertyPhoto(id);
      if (!file) return c.text('Not found', 404);
      return c.body(streamOf(file.content), 200, {
        'content-type': file.contentType,
        'content-disposition': 'inline',
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
        // Uploaded content is never run as a page on this origin.
        'content-security-policy': "default-src 'none'; sandbox",
        'referrer-policy': 'no-referrer',
      });
    } catch (error) {
      if (error instanceof ActionError && error.code === 'not_found') return c.text('Not found', 404);
      throw error;
    }
  });

  pages.post(
    '/:id{[0-9]+}/photo',
    bodyLimit({
      maxSize: PHOTO_UPLOAD_BYTES,
      onError: (c) => c.redirect(withFlash(photoBack(Number(c.req.param('id'))), 'error', 'The photo must be under 10 MB.'), 303),
    }),
    async (c) => {
      const id = Number(c.req.param('id'));
      const form = (await c.req.parseBody({ all: true }).catch(() => ({}))) as FormValues;
      const file = files(form, 'photo')[0];
      if (!file) return c.redirect(withFlash(photoBack(id), 'error', 'Choose a photo to upload.'), 303);
      try {
        await c.var.actions.replacePropertyPhoto(id, {
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          content: new Uint8Array(await file.arrayBuffer()),
        });
      } catch (error) {
        if (error instanceof ActionError && error.code === 'not_found') return profilePage(c, id);
        if (error instanceof ActionError) return c.redirect(withFlash(photoBack(id), 'error', error.message), 303);
        throw error;
      }
      return c.redirect(withFlash(photoBack(id), 'ok', 'Photo replaced.'), 303);
    },
  );

  pages.post('/:id{[0-9]+}/photo/online', async (c) => {
    const id = Number(c.req.param('id'));
    try {
      await c.var.actions.useOnlinePropertyPhoto(id);
    } catch (error) {
      if (error instanceof ActionError && error.code === 'not_found') return profilePage(c, id);
      if (error instanceof ActionError) return c.redirect(withFlash(photoBack(id), 'error', error.message), 303);
      throw error;
    }
    return c.redirect(withFlash(photoBack(id), 'ok', 'Using the online photo.'), 303);
  });

  pages.post('/:id{[0-9]+}/details', (c) => {
    const id = Number(c.req.param('id'));
    return saveDetails(c, {
      profile: `/properties/${id}`,
      save: (form) => {
        const location = postedLocation(form);
        return c.var.actions.editProperty(id, {
          address: text(form, 'address'),
          suburb: text(form, 'suburb'),
          ownerId: chosenId(form, 'ownerId', 'the Owner'),
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
  const everything = await actions.propertyOverviews();
  const p = property;
  const hero = profileHero({
    back: { href: '/properties', label: 'Back to Properties' },
    avatar: icon('house', { size: 'size-8' }),
    name: p.address,
    meta: [
      html`<span>Owner ${entityLink('person', p.owner.name, `/owners/${p.owner.personId}`)}</span>`,
      html`<span><strong class="num">${p.tenants.length}</strong> ${p.tenants.length === 1 ? 'Tenant' : 'Tenants'}</span>`,
      html`<span>Max Repair Cost <strong class="num">${formatMoney(p.maxRepairCostCents)}</strong></span>`,
    ],
    steps: neighboursIn(everything, (x) => x.propertyId, id, (x) => ({ href: `/properties/${x.propertyId}`, name: x.address })),
    noun: 'Property',
  });
  const tabs = profileTabs(`${p.address}'s history`, [
    { id: 'property-open', label: 'Open Tickets', count: p.openTickets.length, body: html`${frequent(p)}${openTickets(p, now)}` },
    { id: 'property-closed', label: 'Closed Tickets', count: p.closedTickets.length, body: closedTickets(p, now) },
    { id: 'property-tenants', label: 'Tenants', count: p.tenants.length, body: tenants(p) },
    { id: 'property-tradies', label: 'Nominated Tradies', count: p.nominatedTradies.length, body: nominated(p) },
  ]);
  return c.html(
    page({
      title: p.address,
      pm,
      active: 'profiles',
      flash: flashFrom(c.req.url),
      shell: shellInfo(c),
      crumbs: [{ label: 'Profiles', href: '/profiles' }, { label: 'Properties', href: '/properties' }, { label: p.address }],
      body: profileCard({ hero, main: tabs, side: html`${await facts(c, p, editing, refused)}${photoBlock(p)}`, about: p.address }),
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
      back: { label: 'Properties', href: '/properties' },
      body: section({
        id: 'add-property',
        title: 'Add a Property',
        body: html`
          ${owners.length ? '' : html`<p class="mb-3 text-sm text-high">Add an Owner on the Setup page first.</p>`}
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

/** The Property's photo, and the ways a Property Manager changes it. */
function photoBlock(p: PropertyView): Html {
  return html`<section class="tradie-side-card" id="photo" aria-label="Photo">
    ${sideHead('Photo')}
    <div class="property-photo">
      ${p.photoUrl
        ? html`<figure class="property-photo-frame">
            <img src="${p.photoUrl}" alt="Photo of ${p.address}" width="640" height="400" />
            <figcaption>${p.photoSource === 'manager' ? 'Your photo' : 'Online photo'}</figcaption>
          </figure>`
        : html`<p class="property-photo-empty">No photo of this Property yet.</p>`}
      <form method="post" action="/properties/${p.propertyId}/photo" enctype="multipart/form-data" class="property-photo-replace">
        ${field({
          label: 'Choose a photo',
          name: 'photo',
          id: 'property-photo',
          type: 'file',
          accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic',
          hint: 'JPEG, PNG, WebP or HEIC, up to 10 MB.',
        })}
        <div class="property-photo-actions">${button('Replace photo', { variant: 'secondary', size: 'sm' })}</div>
      </form>
      ${p.photoSource === 'manager' ? html`<div class="property-photo-actions">${postButton(`/properties/${p.propertyId}/photo/online`, 'Use the online photo', { variant: 'ghost', size: 'sm' })}</div>` : ''}
    </div>
  </section>`;
}

function list(properties: Overview[], filter: ProfileFilter): Html {
  if (!properties.length && filter === 'mine') return emptyState('You look after no Properties yet.', linkButton('Show all Properties', '/properties?filter=all'));
  if (!properties.length) return emptyState('No Properties yet. Add the first one to start taking reports.', linkButton('Add a Property', '/properties/new', { variant: 'primary' }));
  return table(
    ['Property', 'Open Tickets', 'Max Repair Cost', 'Owner', 'Tenants', 'Property Manager'],
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

/**
 * The headline facts: the Max Repair Cost first and large, then who owns, manages and looks after the
 * Property, editing in place. The pen turns each into its input (the money as a number, the people as
 * selects) and adds the address, suburb and Nominated Tradies picker under them, as adding a Property
 * has them, filled in from the Property or from what was posted. The pin stays hidden and empty: only a
 * picked suggestion fills it. A save swaps the Nominated Tradies section too.
 */
async function facts(c: Context<WebEnv>, p: PropertyView, editing: boolean, refused?: DetailsEdit): Promise<Html> {
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
  const errors = refused?.errors;
  const select = (name: string, id: string, label: string, options: { value: string; label: string }[], placeholder?: string) =>
    field({ label, name, id, type: 'select', required: name !== 'buildingManagerId', bare: true, placeholder, value: valueOf(values, name), options, error: errors?.[name] });
  const money = field({
    label: 'Max Repair Cost ($)',
    name: 'maxRepairCost',
    id: 'property-max',
    type: 'number',
    step: '0.01',
    min: 0,
    required: true,
    bare: true,
    className: 'inline-edit-money',
    value: valueOf(values, 'maxRepairCost'),
    error: errors?.maxRepairCost,
  });
  return inlineEdit({
    id: 'details',
    label: 'Property details',
    action: `/properties/${p.propertyId}/details`,
    edit: { label: 'Edit details', href: `/properties/${p.propertyId}?edit=details#details` },
    cancel: `/properties/${p.propertyId}#details`,
    save: 'Save details',
    editing,
    className: 'tradie-side-card',
    refresh: ['nominated-tradies'],
    refusal: refused && !Object.keys(refused.errors).length ? refused.message : undefined,
    view: (tools) => html`
      ${sideHead('Property details', tools)}
      <dl class="tradie-facts is-stacked">
        ${sideFact('Max Repair Cost', html`<span class="property-facts-money num">${formatMoney(p.maxRepairCostCents)}</span>`, { for: 'property-max', control: money })}
        ${sideFact('Owner', contact(p.owner, `/owners/${p.owner.personId}`), {
          for: 'property-owner',
          control: select('ownerId', 'property-owner', 'Owner', owners.map((x) => ({ value: String(x.id), label: x.name })), 'Choose the Owner'),
        })}
        ${sideFact('Property Manager', p.propertyManager, {
          for: 'property-manager',
          control: select('propertyManagerId', 'property-manager', 'Property Manager', propertyManagers.map((m) => ({ value: String(m.id), label: m.name }))),
        })}
        ${sideFact('Building Manager', p.buildingManager ? contact(p.buildingManager, `/building-managers/${p.buildingManager.personId}`) : html`<span class="text-muted">None</span>`, {
          for: 'property-building-manager',
          control: select('buildingManagerId', 'property-building-manager', 'Building Manager', [{ value: '', label: 'None' }, ...buildingManagers.map((b) => ({ value: String(b.id), label: b.name }))]),
        })}
      </dl>
      <div class="inline-edit-only">
        <div class="grid gap-3">
          ${propertyPlaceFields({ values, errors })}
          ${tradies.length
            ? tradiePicker({ id: 'property', tradies, chosen: listOf(values, 'nominatedTradieIds'), error: errors?.nominatedTradieIds })
            : html`<p class="text-sm text-muted">Add Tradies on the Tradies page to nominate them for Urgent Repairs.</p>`}
        </div>
      </div>`,
  });
}

/** "1 Jan 2025" from a date like 2025-01-01. */
export function formatDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return date;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace('Sept', 'Sep');
}

function tenants(p: PropertyView): Html {
  return html`${p.tenants.length
      ? table(
          ['Tenant', 'Mobile', 'Email'],
          p.tenants.map((t) => [
            html`${rowLink(t.name, `/tenants/${t.personId}`)}${t.tenancyStart ? html`<br /><span class="text-xs text-muted">Since ${formatDate(t.tenancyStart)}</span>` : ''}`,
            html`${t.mobile ? contactLink('mobile', t.mobile) : '—'}`,
            html`${t.email ? contactLink('email', t.email) : '—'}`,
          ]),
          { caption: 'Tenants', stack: 'labelled' },
        )
      : emptyState('No Tenants yet. Add the people who live here so they can report repairs.', linkButton('Add a Tenant', '/tenants/new'))}`;
}

/** The Nominated Tradies; a saved edit of the details swaps this block too (inlineEdit's `refresh`). */
function nominated(p: PropertyView): Html {
  return html`<div class="min-w-0" id="nominated-tradies">
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
  </div>`;
}

/** The Trades that keep coming back at the Property, in the band the tabs open with; nothing before its first Ticket. */
function frequent(p: PropertyView): Html {
  if (!p.frequentIssues.length) return html``;
  return html`<div class="tradie-insight" aria-label="Frequent issues">
    <p class="tradie-insight-tag">${icon('chart-bar', { size: 'size-3.5', weight: 'fill' })}Frequent issues</p>
    <ul class="flex flex-wrap gap-2" role="list">${p.frequentIssues.map((i) => html`<li>${badge(`${humanise(i.trade)}: ${i.tickets} ${i.tickets === 1 ? 'Ticket' : 'Tickets'}`, 'neutral')}</li>`)}</ul>
  </div>`;
}

/** What is happening at the Property now: the open Tickets, issue first, with their Jobs' stages. */
function openTickets(p: PropertyView, now: Date): Html {
  return html`${p.openTickets.length
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
      : emptyState('No open Tickets.')}`;
}

/** The Property's history: closed Tickets, most recently closed first. */
function closedTickets(p: PropertyView, now: Date): Html {
  return html`${p.closedTickets.length
      ? table(
          ['Issue', 'Trades', 'Closed'],
          p.closedTickets.map((t) => [
            ticketCell({ ticketId: t.ticketId, issue: t.description }),
            html`<span class="flex flex-wrap gap-1">${[...new Set(t.jobs.map((j) => j.trade))].map((trade) => badge(humanise(trade), 'neutral'))}</span>`,
            html`<span class="text-muted whitespace-nowrap">Closed ${formatAge(t.closedAt, now)}</span>`,
          ]),
          { caption: 'Closed Tickets, most recently closed first', stack: true },
        )
      : emptyState('No closed Tickets yet.')}`;
}
