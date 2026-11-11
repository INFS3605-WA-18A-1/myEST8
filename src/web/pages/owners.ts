// Property Owners (/owners) and Building Managers (/building-managers): the lists,
// an Add page at /new (the form still posts to /setup), and a profile at /:id with
// a pen to edit the name, mobile and email. Above the facts, a read says what their
// record adds up to. Removing one is refused while they own or look after a Property.

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { formAction } from '../forms.ts';
import { shellInfo } from '../shell.ts';
import { addButton, listFilter, mineAll, profileChips, profilesCard, type ProfileFilter } from '../profiles-frame.ts';
import { callButton, editOnlyFact, initials, insight, neighboursIn, profileCard, profileHero, profileTabs, sideFact, sideHead } from '../profile-card.ts';
import {
  alert,
  badge,
  contactLink,
  dl,
  inlineEdit,
  emptyState,
  entityLink,
  flashFrom,
  othersUsing,
  sharedAddressNote,
  formatWhen,
  linkButton,
  page,
  postButton,
  profileRead,
  rowLink,
  section,
  statusBadge,
  table,
  type Html,
  type NavKey,
} from '../ui.ts';
import { addPersonForm, contactControls, contactFields, contactFrom, fieldGrid, saveDetails, type DetailsEdit, type Errors, type Values } from './onboarding-forms.ts';

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
  nav: 'profiles',
  title: 'Owners',
  singular: 'Owner',
  column: 'Owner',
  formId: 'owner',
  formKey: 'owner',
  submit: 'Add Owner',
  empty: 'No Owners yet. Add the people who own your Properties.',
  removeLabel: 'Remove Owner',
  confirm: (name) => `${name} won't be asked to approve repairs. Their past approvals stay on the Tickets they belong to.`,
  propertiesOf: (properties, id) => properties.filter((p) => p.ownerId === id),
  load: (actions, id) => actions.owner(id),
  save: (actions, id, input) => actions.editOwner(id, input),
  remove: (actions, id) => actions.removeOwner(id),
};

const BUILDING_MANAGER: Kind = {
  role: 'building_manager',
  path: '/building-managers',
  nav: 'profiles',
  title: 'Building Managers',
  singular: 'Building Manager',
  column: 'Building Manager',
  formId: 'building-manager',
  formKey: 'building-manager',
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

  // A Profiles page: Mine is the people named on this Property Manager's Properties and those on
  // none yet (as Profiles lists them, so someone just added is always there); All is the Agency's.
  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const flash = flashFrom(c.req.url);
    const filter: ProfileFilter = c.req.query('filter') === 'all' ? 'all' : 'mine';
    const [everyone, properties, channels, overview] = await Promise.all([actions.people(kind.role), actions.properties(), actions.channels(), actions.profilesOverview({ filter })]);
    const mine = properties.filter((p) => p.propertyManagerId === pm.id);
    const people = filter === 'mine' ? everyone.filter((person) => kind.propertiesOf(mine, person.id).length || !kind.propertiesOf(properties, person.id).length) : everyone;
    const sms = channels.some((ch) => ch.type === 'sms');
    const tab = kind.role === 'owner' ? 'owners' : 'building-managers';
    return c.html(
      page({
        title: kind.title,
        heading: 'Profiles',
        pm,
        active: kind.nav,
        flash,
        shell: shellInfo(c),
        controls: profileChips(tab, overview.counts, filter),
        body: profilesCard({
          search: listFilter(`Filter ${kind.title}`, 'Name, mobile, email or address'),
          end: html`${mineAll(kind.path, filter)}${addButton(`Add a ${kind.singular}`, `${kind.path}/new`)}`,
          body: list(kind, people, properties, sms),
        }),
      }),
    );
  });

  pages.get('/new', (c) => addPersonPage(c, kind));

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
  if (!people.length) return emptyState(kind.empty, linkButton(`Add a ${kind.singular}`, `${kind.path}/new`));
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

export type AddPersonRefusal = { message: string; values: Values; errors: Errors };

/** The Add a Property Owner page. */
export function addOwnerPage(c: Context<WebEnv>, refused?: AddPersonRefusal) {
  return addPersonPage(c, OWNER, refused);
}

/** The Add a Building Manager page. */
export function addBuildingManagerPage(c: Context<WebEnv>, refused?: AddPersonRefusal) {
  return addPersonPage(c, BUILDING_MANAGER, refused);
}

/** The Add page. A refused save is this same page, with what was typed and why. */
function addPersonPage(c: Context<WebEnv>, kind: Kind, refused?: AddPersonRefusal) {
  const { pm } = c.var;
  const post = kind.role === 'owner' ? '/setup/owners?from=list' : '/setup/building-managers?from=list';
  return c.html(
    page({
      title: `Add a ${kind.singular}`,
      pm,
      active: kind.nav,
      shell: shellInfo(c),
      back: { label: kind.title, href: kind.path },
      body: section({
        title: `Add a ${kind.singular}`,
        body: html`${refused ? alert(refused.message, 'error') : ''}
          ${addPersonForm({ id: kind.formId, action: post, submit: kind.submit, values: refused?.values, errors: refused?.errors })}`,
      }),
    }),
    refused ? 400 : 200,
  );
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
  const people = await actions.people();
  const listed = people.filter((p) => p.role === kind.role);
  const steps = removed ? null : neighboursIn(listed, (p) => p.id, id, (p) => ({ href: `${kind.path}/${p.id}`, name: p.name }));
  const notice = removed
    ? html`${alert(`Removed from the Agency on ${longDate(person.removedAt!, timeZone)}.`, 'info')}${refused ? alert(refused.message, 'error') : ''}`
    : '';
  const owns = person.properties.length;
  const hero = profileHero({
    back: { href: kind.path, label: `Back to ${kind.title}` },
    avatar: initials(person.name),
    name: person.name,
    meta: [
      removed ? badge('Removed', 'neutral') : html`<span class="profile-role">${kind.singular}</span>`,
      html`<span><strong class="num">${owns}</strong> ${owns === 1 ? 'Property' : 'Properties'}</span>`,
      !person.mobile && !person.email ? badge('No way to reach', 'warning') : '',
    ],
    actions: html`${removed ? '' : removeButton(kind, person)}${callButton(person.name, person.mobile)}`,
    steps,
    noun: kind.singular,
  });
  const read = insight(profileRead(person.read));
  const tabs =
    kind.role === 'owner'
      ? [
          { id: 'owner-approvals', label: 'Approvals', count: person.approvals.length, body: html`${read}${approvalsList(person, timeZone)}` },
          { id: 'owner-properties', label: 'Properties', count: owns, body: propertiesList(kind, person) },
        ]
      : [{ id: 'manager-properties', label: 'Properties', count: owns, body: html`${read}${propertiesList(kind, person)}` }];
  return c.html(
    page({
      title: person.name,
      pm,
      active: kind.nav,
      flash: flashFrom(c.req.url),
      shell: shellInfo(c),
      crumbs: [{ label: 'Profiles', href: '/profiles' }, { label: kind.title, href: kind.path }, { label: person.name }],
      body: html`${notice}${profileCard({ hero, main: profileTabs(`${person.name}'s record`, tabs), side: facts(kind, person, editing, refused, people), about: person.name })}`,
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

/**
 * The side card: what their record adds up to, then the mobile and email, editing in place with
 * the name (the card's title) added while editing. A removed person has no pen.
 */
function facts(kind: Kind, person: Profile, editing: boolean, refused: DetailsEdit | undefined, people: Parameters<typeof othersUsing>[0]): Html {
  const values = refused?.values ?? { name: person.name, mobile: person.mobile ?? '', email: person.email ?? '' };
  const controls = contactControls(kind.formId, { values, errors: refused?.errors });
  const path = `${kind.path}/${person.personId}`;
  return inlineEdit({
    id: 'details',
    label: `${kind.singular} details`,
    action: `${path}/details`,
    edit: { label: 'Edit details', href: `${path}?edit=details#details` },
    cancel: `${path}#details`,
    save: 'Save details',
    editing,
    canEdit: !person.removedAt,
    className: 'tradie-side-card',
    refusal: refused && !Object.keys(refused.errors).length ? refused.message : undefined,
    view: (tools) => html`
      ${sideHead(`${kind.singular} details`, tools)}
      <dl class="tradie-facts">
        ${editOnlyFact('Name', controls.name)}
        ${sideFact('Properties', html`<span class="num">${person.properties.length}</span>`)}
        ${kind.role === 'owner' ? sideFact('Approvals asked', html`<span class="num">${person.approvals.length}</span>`) : ''}
      </dl>
      <div class="tradie-side-block">
        <h3 class="tradie-side-sub">Contact information</h3>
        <dl class="tradie-facts is-stacked">
          ${sideFact('Mobile', contactDetail('mobile', person.mobile, people, person.personId), controls.mobile)}
          ${sideFact('Email', contactDetail('email', person.email, people, person.personId), controls.email)}
        </dl>
      </div>`,
  });
}

/** The Properties they own or look after, each a link to its profile. */
function propertiesList(kind: Kind, person: Profile): Html {
  const label = kind.role === 'owner' ? 'Properties they own' : 'Properties they look after';
  return person.properties.length
    ? html`<ul class="profile-links" role="list">${person.properties.map((p) => html`<li>${entityLink('property', p.address, `/properties/${p.propertyId}`)}</li>`)}</ul>`
    : emptyState(`No ${label.toLowerCase()}.`);
}

/** Recent approvals, newest first, each linking to its Ticket. */
function approvalsList(person: Profile, timeZone: string): Html {
  return person.approvals.length
    ? table(
        ['Ticket', 'Status', 'Asked'],
        person.approvals.map((a) => [
          entityLink('ticket', a.description, `/tickets/${a.ticketId}`),
          statusBadge(a.status),
          html`<span class="whitespace-nowrap">${formatWhen(a.requestedAt, timeZone)}</span>`,
        ]),
        { stack: 'labelled', caption: 'Approvals, newest first' },
      )
    : emptyState('No approvals yet.');
}
