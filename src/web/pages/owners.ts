// Property Owners (/owners) and Building Managers (/building-managers): the lists, each
// with the Add form Setup uses, and a profile at /:id with a pen to edit the name,
// mobile and email. Removing one is refused while they own or look after a Property.

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { formAction } from '../forms.ts';
import { shellInfo } from '../shell.ts';
import {
  alert,
  badge,
  contactLink,
  detailsForm,
  dl,
  editPen,
  emptyState,
  entityLink,
  flashFrom,
  othersUsing,
  sharedAddressNote,
  formatWhen,
  linkButton,
  page,
  postButton,
  rowLink,
  section,
  statusBadge,
  table,
  type Html,
  type NavKey,
} from '../ui.ts';
import { addPersonForm, contactFields, contactFrom, fieldGrid, saveDetails, type DetailsEdit } from './onboarding-forms.ts';

type Person = Awaited<ReturnType<PropertyManagerActions['people']>>[number];
type Property = Awaited<ReturnType<PropertyManagerActions['properties']>>[number];
type Profile = Awaited<ReturnType<PropertyManagerActions['owner']>>;

type Kind = {
  role: 'owner' | 'building_manager';
  path: '/owners' | '/building-managers';
  nav: NavKey;
  title: string;
  singular: string;
  column: string;
  formId: string;
  formKey: 'owner' | 'building-manager';
  anchor: string;
  submit: string;
  empty: string;
  removeLabel: string;
  /** What Remove asks before it goes ahead. */
  confirm: (name: string) => string;
  /** The Properties this person is named on. */
  propertiesOf: (properties: Property[], id: number) => Property[];
  load: (actions: PropertyManagerActions, id: number) => Promise<Profile>;
  save: (actions: PropertyManagerActions, id: number, input: { name: string; mobile?: string; email?: string }) => Promise<unknown>;
  remove: (actions: PropertyManagerActions, id: number) => Promise<string>;
};

const OWNER: Kind = {
  role: 'owner',
  path: '/owners',
  nav: 'owners',
  title: 'Property Owners',
  singular: 'Property Owner',
  column: 'Property Owner',
  formId: 'owner',
  formKey: 'owner',
  anchor: 'add-owner',
  submit: 'Add Property Owner',
  empty: 'No Property Owners yet. Add the people who own your Properties.',
  removeLabel: 'Remove Property Owner',
  confirm: (name) => `${name} won't be asked to approve repairs. Their past approvals stay on the Tickets they belong to.`,
  propertiesOf: (properties, id) => properties.filter((p) => p.ownerId === id),
  load: (actions, id) => actions.owner(id),
  save: (actions, id, input) => actions.editOwner(id, input),
  remove: (actions, id) => actions.removeOwner(id),
};

const BUILDING_MANAGER: Kind = {
  role: 'building_manager',
  path: '/building-managers',
  nav: 'building-managers',
  title: 'Building Managers',
  singular: 'Building Manager',
  column: 'Building Manager',
  formId: 'building-manager',
  formKey: 'building-manager',
  anchor: 'add-building-manager',
  submit: 'Add Building Manager',
  empty: 'No Building Managers yet. Add one for each strata Property.',
  removeLabel: 'Remove Building Manager',
  confirm: (name) => `${name} won't be listed for Common Area issues. Their record stays.`,
  propertiesOf: (properties, id) => properties.filter((p) => p.buildingManagerId === id),
  load: (actions, id) => actions.buildingManager(id),
  save: (actions, id, input) => actions.editBuildingManager(id, input),
  remove: (actions, id) => actions.removeBuildingManager(id),
};

/** Property Owners under /owners. */
export function ownerPages() {
  return listPages(OWNER);
}

/** Building Managers under /building-managers. */
export function buildingManagerPages() {
  return listPages(BUILDING_MANAGER);
}

function listPages(kind: Kind) {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const flash = flashFrom(c.req.url);
    const refused = flash?.kind === 'error' && c.req.query('form') === kind.formKey ? alert(flash.message, 'error') : html``;
    const [people, properties, channels] = await Promise.all([actions.people(kind.role), actions.properties(), actions.channels()]);
    const sms = channels.some((ch) => ch.type === 'sms');
    return c.html(
      page({
        title: kind.title,
        pm,
        active: kind.nav,
        flash,
        shell: shellInfo(c),
        subtitle: people.length ? `${people.length} ${people.length === 1 ? kind.singular : kind.title}, by name.` : undefined,
        actions: linkButton(`Add a ${kind.singular}`, `#${kind.anchor}`, { variant: 'primary', size: 'sm' }),
        body: html`${list(kind, people, properties, sms)} ${addForm(kind, refused)}`,
      }),
    );
  });

  // Refused, the reason shows on the profile, naming the Properties still in their name.
  pages.post('/:id{[0-9]+}/remove', (c) => {
    const id = Number(c.req.param('id'));
    return formAction(c, `${kind.path}/${id}`, async () => {
      const name = await kind.remove(c.var.actions, id);
      return { ok: `${name} removed`, redirect: kind.path };
    });
  });

  pages.post('/:id{[0-9]+}/details', (c) => {
    const id = Number(c.req.param('id'));
    return saveDetails(c, {
      profile: `${kind.path}/${id}`,
      save: (form) => kind.save(c.var.actions, id, contactFrom(form)),
      show: (refused) => profilePage(c, kind, id, refused),
    });
  });

  pages.get('/:id{[0-9]+}', (c) => profilePage(c, kind, Number(c.req.param('id'))));

  return pages;
}

/** No mobile the Agency can text, and no email. */
function unreachable(person: Person, sms: boolean) {
  return !person.email && !(sms && person.mobile);
}

function list(kind: Kind, people: Person[], properties: Property[], sms: boolean): Html {
  if (!people.length) return emptyState(kind.empty, linkButton(`Add a ${kind.singular}`, `#${kind.anchor}`));
  return table(
    [kind.column, 'Mobile', 'Email', 'Properties'],
    people.map((person) => {
      const theirs = kind.propertiesOf(properties, person.id);
      return [
        html`${rowLink(person.name, `${kind.path}/${person.id}`)}${unreachable(person, sms) ? html`<br />${badge('No way to reach', 'warning')}` : ''}`,
        person.mobile ? contactLink('mobile', person.mobile) : html`<span class="text-muted">—</span>`,
        person.email ? contactLink('email', person.email) : html`<span class="text-muted">—</span>`,
        theirs.length
          ? html`<span class="flex flex-wrap gap-1">${theirs.map((p) => entityLink('property', p.address, `/properties/${p.id}`))}</span>`
          : html`<span class="text-muted">None</span>`,
      ];
    }),
    { stack: 'labelled', caption: `${kind.title}, by name` },
  );
}

function addForm(kind: Kind, refused: Html): Html {
  const post = kind.role === 'owner' ? '/setup/owners?from=list' : '/setup/building-managers?from=list';
  return section({
    id: kind.anchor,
    title: `Add a ${kind.singular}`,
    body: html`${refused}
      ${addPersonForm({ id: kind.formId, action: post, submit: kind.submit })}`,
  });
}

/** A profile; `refused` is a save of the details that was refused, shown with the form open. */
async function profilePage(c: Context<WebEnv>, kind: Kind, id: number, refused?: DetailsEdit) {
  const { actions, pm } = c.var;
  let person: Profile;
  try {
    person = await kind.load(actions, id);
  } catch (error) {
    if (!(error instanceof ActionError) || error.code !== 'not_found') throw error;
    return c.html(
      page({
        title: `${kind.singular} not found`,
        pm,
        active: kind.nav,
        shell: shellInfo(c),
        body: emptyState(`There's no such ${kind.singular} in your Agency.`, linkButton(`Back to ${kind.title}`, kind.path)),
      }),
      404,
    );
  }
  const { timeZone } = actions.agency();
  const removed = !!person.removedAt;
  // A removed person can't be edited: no form, even if one is asked for or a save is refused.
  const editing = !removed && (!!refused || c.req.query('edit') === 'details');
  const people = editing ? [] : await actions.people();
  const notice = removed
    ? html`${alert(`Removed from the Agency on ${longDate(person.removedAt!, timeZone)}.`, 'info')}${refused ? alert(refused.message, 'error') : ''}`
    : '';
  return c.html(
    page({
      title: person.name,
      pm,
      active: kind.nav,
      flash: flashFrom(c.req.url),
      shell: shellInfo(c),
      actions: html`${removed ? '' : removeButton(kind, person)}${linkButton(`Back to ${kind.title}`, kind.path, { variant: 'ghost', size: 'sm' })}`,
      body: html`${notice}${facts(kind, person, editing, refused, people)} ${propertiesSection(kind, person)} ${kind.role === 'owner' ? approvalsSection(person, timeZone) : ''}`,
    }),
    refused ? 400 : 200,
  );
}

function removeButton(kind: Kind, person: Profile): Html {
  return postButton(`${kind.path}/${person.personId}/remove`, kind.removeLabel, {
    variant: 'danger',
    size: 'sm',
    confirm: kind.confirm(person.name),
  });
}

/** "8 October 2026", in the Agency's time zone. */
function longDate(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(at));
}

/** The address, and a quiet note of who else in the Agency uses it. */
function contactDetail(kind: 'mobile' | 'email', value: string | null, people: Parameters<typeof othersUsing>[0], selfId: number): Html | string {
  if (!value) return '—';
  return html`${contactLink(kind, value)}${sharedAddressNote('Also', othersUsing(people, value, selfId))}`;
}

/** Name, mobile and email, with a pen. Editing, the form takes their place. */
function facts(kind: Kind, person: Profile, editing: boolean, refused: DetailsEdit | undefined, people: Parameters<typeof othersUsing>[0]): Html {
  if (editing) {
    const values = refused?.values ?? { name: person.name, mobile: person.mobile ?? '', email: person.email ?? '' };
    return html`<section class="section" id="details" aria-label="${kind.singular} details">
      ${detailsForm({
        action: `${kind.path}/${person.personId}/details`,
        cancel: `${kind.path}/${person.personId}`,
        refusal: refused && !Object.keys(refused.errors).length ? refused.message : undefined,
        fields: fieldGrid(contactFields(kind.formId, { values, errors: refused?.errors })),
      })}
    </section>`;
  }
  return html`<section class="section" id="details" aria-label="${kind.singular} details">
    <div class="details-head">
      <div class="details-body">
        ${dl([
          ['Mobile', contactDetail('mobile', person.mobile, people, person.personId)],
          ['Email', contactDetail('email', person.email, people, person.personId)],
        ])}
      </div>
      ${person.removedAt ? '' : editPen('Edit details', `${kind.path}/${person.personId}?edit=details#details`)}
    </div>
  </section>`;
}

function propertiesSection(kind: Kind, person: Profile): Html {
  const label = kind.role === 'owner' ? 'Properties they own' : 'Properties they look after';
  return section({
    title: 'Properties',
    body: person.properties.length
      ? html`<ul class="flex flex-col gap-2">${person.properties.map((p) => html`<li>${entityLink('property', p.address, `/properties/${p.propertyId}`)}</li>`)}</ul>`
      : emptyState(`No ${label.toLowerCase()}.`),
  });
}

/** Recent approvals, newest first, each linking to its Ticket. */
function approvalsSection(person: Profile, timeZone: string): Html {
  return section({
    title: 'Approvals',
    body: person.approvals.length
      ? table(
          ['Ticket', 'Status', 'Asked'],
          person.approvals.map((a) => [
            entityLink('ticket', a.description, `/tickets/${a.ticketId}`),
            statusBadge(a.status),
            html`<span class="whitespace-nowrap">${formatWhen(a.requestedAt, timeZone)}</span>`,
          ]),
          { stack: 'labelled', caption: 'Approvals, newest first' },
        )
      : emptyState('No approvals yet.'),
  });
}
