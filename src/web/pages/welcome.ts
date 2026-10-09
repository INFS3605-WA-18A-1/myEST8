// The guided onboarding wizard under /welcome, where a new Agency lands after
// signing up: one task per screen, in order, with Back, Continue and "Skip for
// now". Progress is read from what the Agency already has (its Property
// Managers, channels, Properties and Tradies), never from a stored flag, so the
// wizard can be left and picked up again, and an Agency set up through /setup
// shows as done here too.
//
//   1 Welcome          what we'll set up, and the Agency's details
//   2 Your team        colleagues as Property Managers (optional)
//   3 Channels         SMS, WhatsApp and email, each with a test message
//   4 First Property   address, Max Repair Cost, Property Owner, Tenant, Building Manager
//   5 Tradies          the Tradies the Agency already uses
//   6 Done             what's set up, and where to go next

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { ChannelType } from '../../ports.ts';
import { ActionError, isEmail, normalizeAddress, type Role } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { cents, list, text, type FormValues } from '../forms.ts';
import {
  alert,
  badge,
  button,
  card,
  dl,
  field,
  flashFrom,
  flashMessage,
  formatMoney,
  humanise,
  linkButton,
  page,
  steps,
  table,
  withFlash,
  type Flash,
  type Html,
} from '../ui.ts';
import {
  addTradieFrom,
  CHANNELS,
  channelGuide,
  channelOf,
  channelStatus,
  choiceGroup,
  contactFields,
  contactFrom,
  googleSearchForm,
  scoped,
  searchListings,
  tradieFields,
  tradiesTable,
  valueOf,
  valuesOf,
  type Errors,
  type Values,
} from './onboarding-forms.ts';
import { TIME_ZONES } from './signup.ts';

type Actions = PropertyManagerActions;
type Person = ReturnType<Actions['people']>[number];
type WizardContext = Context<WebEnv>;

const STEPS = [
  { key: 'welcome', label: 'Welcome', path: '/welcome' },
  { key: 'team', label: 'Your team', path: '/welcome/team' },
  { key: 'channels', label: 'Channels', path: '/welcome/channels' },
  { key: 'property', label: 'First Property', path: '/welcome/property' },
  { key: 'tradies', label: 'Tradies', path: '/welcome/tradies' },
  { key: 'done', label: 'Done', path: '/welcome/done' },
] as const;
type StepKey = (typeof STEPS)[number]['key'];

/** What a new Agency needs before Tenants' messages can be handled. Adding colleagues is optional. */
const NEEDED = ['channels', 'property', 'tradies'] as const;

/** Each needed step as the "Finish setting up" banner says it. */
const STILL_TO_DO: Record<(typeof NEEDED)[number], string> = {
  channels: 'connect SMS, WhatsApp and email',
  property: 'add your first Property',
  tradies: 'add the Tradies you use',
};

const ROLE_LABEL: Record<Role, string> = { tenant: 'Tenant', owner: 'Property Owner', tradie: 'Tradie', building_manager: 'Building Manager' };

/** How far the Agency's setup has got, read from what it has. */
export function setupProgress(actions: Actions) {
  const channels = actions.channels();
  return {
    team: actions.propertyManagers().length > 1,
    channels: CHANNELS.every((ch) => channels.some((c) => c.type === ch.type)),
    property: actions.properties().length > 0,
    tradies: actions.people('tradie').length > 0,
  };
}
type Progress = ReturnType<typeof setupProgress>;

function isDone(key: StepKey, progress: Progress): boolean {
  if (key === 'welcome') return true; // the Agency's details come with sign-up
  if (key === 'done') return NEEDED.every((k) => progress[k]);
  return progress[key];
}

/** Where to pick setup up again: the first needed step not done, or null once the Agency is set up. */
export function nextSetupStep(progress: Progress): string | null {
  const key = NEEDED.find((k) => !progress[k]);
  return key ? STEPS.find((s) => s.key === key)!.path : null;
}

/** The dashboard's "Finish setting up" banner, or nothing once the Agency is set up. */
export function finishSetupBanner(actions: Actions): Html {
  const progress = setupProgress(actions);
  const next = nextSetupStep(progress);
  if (!next) return html``;
  const left = NEEDED.filter((k) => !progress[k]).map((k) => STILL_TO_DO[k]);
  return html`<div data-banner="finish-setup">
    ${alert(
      html`<p>Before Tenants' messages can reach you, ${sentence(left)}. The guide takes you through it.</p>
        <p class="mt-3">${linkButton('Finish setting up', next, { variant: 'primary', size: 'sm' })}</p>`,
      'info',
      { title: `Finish setting up ${actions.agency().name}` },
    )}
  </div>`;
}

/** The wizard, mounted at /welcome behind requirePropertyManager. `demo` suggests made-up channel addresses for the phone simulator. */
export function welcomePages(o: { demo: boolean }) {
  const pages = new Hono<WebEnv>();

  pages.get('/', (c) => c.html(welcomeStep(c)));

  pages.get('/team', (c) => c.html(teamStep(c, {})));
  pages.post('/team', async (c) => {
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const colleague = { name: text(form, 'name'), email: text(form, 'email') };
    try {
      const { temporaryPassword } = c.var.actions.addColleague(colleague);
      // The page shows a password: keep it out of every cache.
      c.header('Cache-Control', 'no-store');
      return c.html(teamStep(c, { added: { ...colleague, temporaryPassword } }));
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      return c.html(teamStep(c, { values: valuesOf(form), errors: fieldErrors(error, 'email') }), 400);
    }
  });

  pages.get('/channels', (c) => c.html(channelsStep(c, o.demo)));
  pages.post('/channels', (c) =>
    channelAction(c, (form, channel) => {
      const address = text(form, 'address');
      if (!address) throw new ActionError('invalid', `Enter the ${channel.addressLabel}`);
      c.var.actions.connectChannel(channel.type, address);
      return `${channel.name} connected to ${address}. Now send a test message to check it works.`;
    }),
  );
  pages.post('/channels/test', (c) =>
    channelAction(c, async (form, channel) => {
      const to = text(form, 'to');
      if (!to) throw new ActionError('invalid', 'Enter where to send the test message');
      try {
        await c.var.actions.sendTestMessage(channel.type, to);
      } catch (error) {
        // The point of a test is to see what's wrong, so a channel or provider failure is shown, not hidden.
        if (error instanceof ActionError) throw error;
        throw new ActionError('invalid', `The ${channel.name} test message didn't send: ${error instanceof Error ? error.message : String(error)}`);
      }
      const where = o.demo ? ' In the demo it shows under "What myEST8 sent" in the phone simulator.' : ' Check that it arrived.';
      return `Test message sent to ${to} by ${channel.name}.${where}`;
    }),
  );

  pages.get('/property', (c) => c.html(propertyStep(c, {})));
  pages.post('/property', async (c) => {
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const values = valuesOf(form);
    const refused = (errors: Errors, message?: string) => c.html(propertyStep(c, { values, errors, message, showForm: true }), 400);
    const read = readPropertyForm(c.var.actions, form, c.var.pm.id);
    if (!read.ok) return refused(read.errors);
    try {
      const propertyId = await addPropertyFrom(c.var.actions, read.input);
      return c.redirect(`/welcome/property?added=${propertyId}`, 303);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      return refused(error.fields, error.message);
    }
  });

  pages.get('/tradies', async (c) => c.html(await tradiesStep(c, {})));
  pages.post('/tradies', async (c) => {
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    try {
      const businessName = await addTradieFrom(c.var.actions, form);
      return c.redirect(withFlash('/welcome/tradies', 'ok', `${businessName} added as a Tradie`), 303);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      return c.html(await tradiesStep(c, { values: valuesOf(form), errors: error.fields, message: error.message }), 400);
    }
  });

  pages.get('/done', (c) => c.html(doneStep(c, o.demo)));

  return pages;
}

// The frame around every step

function wizardPage(
  c: WizardContext,
  o: { step: StepKey; title: string; body: Html; progress?: Progress; flash?: Flash | null },
): Html {
  const { actions, pm } = c.var;
  const progress = o.progress ?? setupProgress(actions);
  const index = STEPS.findIndex((s) => s.key === o.step);
  const back = STEPS[index - 1];
  const forward = STEPS[index + 1];
  // A step not done yet moves on with "Skip for now"; a done one with "Continue".
  const onward = forward
    ? isDone(o.step, progress)
      ? linkButton(o.step === 'welcome' ? "Let's start" : 'Continue', forward.path, { variant: 'primary' })
      : linkButton('Skip for now', forward.path, { variant: 'ghost' })
    : '';
  return page({
    title: o.title,
    subtitle: `Step ${index + 1} of ${STEPS.length} · Setting up ${actions.agency().name}`,
    pm,
    active: 'setup',
    flash: o.flash ?? null,
    body: html`
      <nav aria-label="Setup steps">
        ${steps(
          STEPS.map((s) => ({ label: s.label, done: isDone(s.key, progress), href: s.path })),
          { current: index, horizontal: true },
        )}
      </nav>
      ${o.body}
      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 pt-4">
        ${back ? linkButton('Back', back.path, { variant: 'secondary' }) : html`<a class="link text-sm" href="/">Set up later</a>`}
        <div class="flex flex-wrap items-center gap-2">${onward}</div>
      </div>
    `,
  });
}

// 1 Welcome

function welcomeStep(c: WizardContext): Html {
  const { actions, pm } = c.var;
  const agency = actions.agency();
  const zone = TIME_ZONES.find((z) => z.value === agency.timeZone)?.label ?? agency.timeZone;
  return wizardPage(c, {
    step: 'welcome',
    title: `Welcome to myEST8, ${firstName(pm.name)}`,
    body: html`
      <p class="max-w-prose">
        Let's get ${agency.name} ready for its first maintenance message. It takes about 5 minutes. You can skip any step and come back to it: what
        you add is saved as you go.
      </p>
      ${card({
        title: "What we'll set up",
        body: html`<ol class="list-decimal space-y-2 ml-5">
          <li><strong>Your team.</strong> Add the other Property Managers so each has their own sign-in. Optional.</li>
          <li><strong>Channels.</strong> Connect the SMS number, WhatsApp and email inbox Tenants already use, and test each one.</li>
          <li><strong>Your first Property.</strong> Its address, Max Repair Cost, Property Owner and Tenant.</li>
          <li><strong>Tradies.</strong> The Tradies you already use, with their Trades and a starting rating.</li>
        </ol>`,
      })}
      ${card({
        title: 'Your Agency',
        body: dl([
          ['Agency', agency.name],
          ['Time zone', zone],
          ['First Property Manager', html`${pm.name} <span class="text-base-content/75">(${pm.email})</span>`],
        ]),
      })}
    `,
  });
}

// 2 Your team

function teamStep(c: WizardContext, o: { added?: { name: string; email: string; temporaryPassword: string }; values?: Values; errors?: Errors }): Html {
  const { actions, pm } = c.var;
  const team = actions.propertyManagers();
  const origin = new URL(c.req.url).origin;
  return wizardPage(c, {
    step: 'team',
    title: 'Your team',
    body: html`
      <p class="max-w-prose">
        Add the other Property Managers at ${actions.agency().name}. Each gets their own sign-in and sees their own Properties first, and can cover for
        colleagues when needed. Tenants, Tradies and Property Owners never need an account.
      </p>
      ${o.added
        ? alert(
            html`<p>Pass these on to ${o.added.name}. The password is shown only this once, so copy it now.</p>
              <dl class="my-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                <dt>Sign in at</dt>
                <dd class="break-all">${origin}/login</dd>
                <dt>Email</dt>
                <dd class="break-all">${o.added.email}</dd>
                <dt>Temporary password</dt>
                <dd><code class="rounded bg-base-100 px-2 py-0.5 text-base font-semibold tracking-wider" data-temporary-password>${o.added.temporaryPassword}</code></dd>
              </dl>`,
            'success',
            { title: `${o.added.name} added as a Property Manager` },
          )
        : ''}
      ${table(
        ['Name', 'Email'],
        team.map((m) => [html`${m.name}${m.id === pm.id ? html` ${badge('You')}` : ''}`, html`${m.email}`]),
        { caption: 'Property Managers' },
      )}
      ${card({
        title: 'Add a colleague',
        body: html`<form method="post" action="/welcome/team" class="space-y-1">
          ${field({ label: 'Name', name: 'name', id: 'colleague-name', required: true, autocomplete: 'off', value: valueOf(o.values, 'name'), error: o.errors?.name })}
          ${field({
            label: 'Work email',
            name: 'email',
            id: 'colleague-email',
            type: 'email',
            required: true,
            autocomplete: 'off',
            value: valueOf(o.values, 'email'),
            hint: 'They sign in with this. myEST8 makes them a temporary password.',
            error: o.errors?.email,
          })}
          <div class="pt-2">${button('Add colleague')}</div>
        </form>`,
      })}
    `,
  });
}

// 3 Channels

/** Runs a channel form's action; back to its card with the result. */
async function channelAction(c: WizardContext, action: (form: FormValues, channel: (typeof CHANNELS)[number]) => string | Promise<string>) {
  const form = (await c.req.parseBody({ all: true })) as FormValues;
  let channel: (typeof CHANNELS)[number];
  try {
    channel = channelOf(form);
  } catch (error) {
    if (error instanceof ActionError) return c.redirect(withFlash('/welcome/channels', 'error', error.message), 303);
    throw error;
  }
  const back = `/welcome/channels?channel=${channel.type}`;
  try {
    return c.redirect(`${withFlash(back, 'ok', await action(form, channel))}#${channel.type}`, 303);
  } catch (error) {
    if (error instanceof ActionError) return c.redirect(`${withFlash(back, 'error', error.message)}#${channel.type}`, 303);
    throw error;
  }
}

function channelsStep(c: WizardContext, demo: boolean): Html {
  const { actions, pm } = c.var;
  const agency = actions.agency();
  const connected = actions.channels();
  const flash = flashFrom(c.req.url);
  const flashChannel = c.req.query('channel');
  const origin = new URL(c.req.url).origin;
  const tested = connected.filter((ch) => ch.testedAt).length;
  return wizardPage(c, {
    step: 'channels',
    title: 'Channels',
    // A channel's own result shows in its card; anything else at the top.
    flash: flash && !CHANNELS.some((ch) => ch.type === flashChannel) ? flash : null,
    body: html`
      <p class="max-w-prose">
        Tenants, Tradies and Property Owners reach ${agency.name} by SMS, WhatsApp and email. Connect each one, then send yourself a test message to check
        it works. Don't have one yet? Each card explains how to create it.
      </p>
      <p class="text-sm">${connected.length} of ${CHANNELS.length} connected, ${tested} tested.</p>
      ${demo
        ? alert('This is the demo, so nothing is really sent. Each form suggests a made-up address that works with the phone simulator.', 'info')
        : ''}
      <div class="grid gap-4 lg:grid-cols-3">
        ${CHANNELS.map((channel) => {
          const current = connected.find((ch) => ch.type === channel.type);
          const suggestion = demo ? demoAddress(channel.type, agency) : '';
          return html`<div id="${channel.type}" class="min-w-0">
            ${card({
              title: channel.name,
              body: html`
                ${flash && flashChannel === channel.type ? flashMessage(flash) : ''}
                <p>${channelStatus(current, agency.timeZone)}</p>
                ${channelGuide(channel.type, origin)}
                <form method="post" action="/welcome/channels" class="space-y-1">
                  <input type="hidden" name="type" value="${channel.type}" />
                  ${field({
                    label: channel.addressLabel,
                    name: 'address',
                    id: `${channel.type}-address`,
                    type: channel.inputType,
                    required: true,
                    value: current?.address ?? suggestion,
                    placeholder: channel.placeholder,
                    hint: demo && !current ? 'A made-up address for the demo. Any address no other Agency uses works.' : undefined,
                  })}
                  ${button(current ? `Change ${channel.name}` : `Connect ${channel.name}`, { size: 'sm', variant: current ? 'secondary' : 'primary' })}
                </form>
                ${current
                  ? html`<form method="post" action="/welcome/channels/test" class="space-y-1">
                      <input type="hidden" name="type" value="${channel.type}" />
                      ${field({
                        label: channel.type === 'email' ? 'Send a test email to' : 'Send a test message to',
                        name: 'to',
                        id: `${channel.type}-to`,
                        type: channel.inputType,
                        required: true,
                        value: channel.type === 'email' ? pm.email : '',
                        placeholder: channel.type === 'email' ? 'you@youragency.com.au' : 'Your mobile, like 0412 345 678',
                      })}
                      ${button('Send a test message', { variant: current.testedAt ? 'secondary' : 'primary', size: 'sm' })}
                    </form>`
                  : ''}
              `,
            })}
          </div>`;
        })}
      </div>
    `,
  });
}

/** A made-up channel address for a demo Agency, unique to it: channel addresses can belong to only one Agency. */
function demoAddress(type: ChannelType, agency: { id: number; name: string }) {
  if (type === 'email') {
    const slug = agency.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agency';
    return `inbox@${slug}-${agency.id}.example`;
  }
  return `+61 2 9100 ${String(agency.id).padStart(4, '0')}`;
}

// 4 First Property

type PropertyInput = {
  address: string;
  suburb: string;
  maxRepairCostCents: number;
  propertyManagerId: number;
  nominatedTradieIds: number[];
  owner: { name: string; mobile?: string; email?: string; existing: Person | null };
  tenant: { name: string; mobile?: string; email?: string; tenancyStart: string };
  buildingManager: { name: string; mobile?: string; email?: string; existing: Person | null } | null;
};

/**
 * Checks the whole form before anything is created, so a refusal never leaves a
 * Property Owner or Property half added. A Property Owner or Building Manager
 * whose mobile or email the Agency already has is reused, not added twice.
 */
function readPropertyForm(actions: Actions, form: FormValues, myId: number): { ok: true; input: PropertyInput } | { ok: false; errors: Errors } {
  const errors: Errors = {};
  const address = text(form, 'address');
  const suburb = text(form, 'suburb');
  if (!address) errors.address = 'Enter the address';
  if (!suburb) errors.suburb = 'Enter the suburb';

  let maxRepairCostCents = 0;
  if (!text(form, 'maxRepairCost')) errors.maxRepairCost = 'Enter the Max Repair Cost';
  else {
    try {
      maxRepairCostCents = cents(form, 'maxRepairCost', 'the Max Repair Cost');
    } catch {
      errors.maxRepairCost = 'Enter the Max Repair Cost in dollars, like 500';
    }
  }

  const managers = actions.propertyManagers();
  const chosenManager = Number(text(form, 'propertyManagerId') || myId);
  if (!managers.some((m) => m.id === chosenManager)) errors.propertyManagerId = 'Choose a Property Manager in your Agency';

  const tradies = actions.people('tradie');
  const nominatedTradieIds = list(form, 'nominatedTradieIds').map(Number);
  if (nominatedTradieIds.some((id) => !tradies.some((t) => t.id === id))) errors.nominatedTradieIds = 'Choose Tradies from the list';

  // Who already has each mobile and email, so nobody is added twice.
  const holders = new Map<string, Person>();
  for (const person of actions.people()) {
    for (const a of [person.mobile, person.email]) if (a) holders.set(normalizeAddress(a), person);
  }
  const usedInForm = new Map<string, string>();

  /** Checks one person's contact; returns the existing person to reuse, if any. */
  function checkContact(scope: string, label: string, role: Role, reuse: boolean): Person | null {
    const contact = contactFrom(form, scope);
    const at = (f: string) => scoped(scope, f);
    if (!contact.name) errors[at('name')] = `Enter the ${label}'s name`;
    if (!contact.mobile && !contact.email) errors[at('mobile')] = 'Enter a mobile number or email address';
    if (contact.mobile && !/^\+?\d{8,15}$/.test(normalizeAddress(contact.mobile))) errors[at('mobile')] = 'Enter a mobile number, like 0412 345 678';
    if (contact.email && !isEmail(contact.email)) errors[at('email')] = `${contact.email} isn't an email address`;
    let existing: Person | null = null;
    for (const [f, value] of [['mobile', contact.mobile], ['email', contact.email]] as const) {
      if (!value || errors[at(f)]) continue;
      const key = normalizeAddress(value);
      const other = usedInForm.get(key);
      if (other) {
        errors[at(f)] = `${value} is also the ${other}'s. Each person needs their own.`;
        continue;
      }
      usedInForm.set(key, label);
      const holder = holders.get(key);
      if (!holder) continue;
      if (reuse && holder.role === role && (!existing || existing.id === holder.id)) existing = holder;
      else errors[at(f)] = `${value} already belongs to ${holder.name}, a ${ROLE_LABEL[holder.role]}`;
    }
    return existing;
  }

  const ownerExisting = checkContact('owner', 'Property Owner', 'owner', true);
  const tenantContact = contactFrom(form, 'tenant');
  checkContact('tenant', 'Tenant', 'tenant', false);
  const tenancyStart = text(form, 'tenancyStart');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tenancyStart) || Number.isNaN(Date.parse(tenancyStart))) errors.tenancyStart = 'Enter the date the tenancy started';

  const bm = contactFrom(form, 'buildingManager');
  const hasBuildingManager = !!(bm.name || bm.mobile || bm.email);
  const bmExisting = hasBuildingManager ? checkContact('buildingManager', 'Building Manager', 'building_manager', true) : null;

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    input: {
      address,
      suburb,
      maxRepairCostCents,
      propertyManagerId: chosenManager,
      nominatedTradieIds,
      owner: { ...contactFrom(form, 'owner'), existing: ownerExisting },
      tenant: { ...tenantContact, tenancyStart },
      buildingManager: hasBuildingManager ? { ...bm, existing: bmExisting } : null,
    },
  };
}

/** Adds the Property Owner (unless reused), any Building Manager, the Property, then its Tenant. Returns the Property's id. */
async function addPropertyFrom(actions: Actions, input: PropertyInput): Promise<number> {
  const { existing: owner, ...newOwner } = input.owner;
  const ownerId = owner?.id ?? within('owner', () => actions.addOwner(newOwner));
  let buildingManagerId: number | undefined;
  if (input.buildingManager) {
    const { existing, ...newBuildingManager } = input.buildingManager;
    buildingManagerId = existing?.id ?? within('buildingManager', () => actions.addBuildingManager(newBuildingManager));
  }
  const propertyId = await actions
    .addProperty({
      address: input.address,
      suburb: input.suburb,
      ownerId,
      propertyManagerId: input.propertyManagerId,
      maxRepairCostCents: input.maxRepairCostCents,
      nominatedTradieIds: input.nominatedTradieIds,
      buildingManagerId,
    })
    .catch((error: unknown) => {
      throw renamed(error, { maxRepairCostCents: 'maxRepairCost' });
    });
  within('tenant', () => actions.addTenant({ ...input.tenant, propertyId }), { tenancyStart: 'tenancyStart' });
  return propertyId;
}

/** Runs one action for a person in the form, naming any refused field the way the form posts it ("ownerMobile"). */
function within<T>(scope: string, action: () => T, keep: Record<string, string> = {}): T {
  try {
    return action();
  } catch (error) {
    throw renamed(error, { name: scoped(scope, 'name'), mobile: scoped(scope, 'mobile'), email: scoped(scope, 'email'), ...keep });
  }
}

function renamed(error: unknown, names: Record<string, string>): unknown {
  if (!(error instanceof ActionError)) return error;
  const fields = Object.fromEntries(Object.entries(error.fields).map(([f, message]) => [names[f] ?? f, message]));
  return new ActionError(error.code, error.message, fields);
}

function propertyStep(c: WizardContext, o: { values?: Values; errors?: Errors; message?: string; showForm?: boolean }): Html {
  const { actions, pm } = c.var;
  const properties = actions.properties();
  const people = actions.people();
  const nameOf = (id: number | null) => people.find((p) => p.id === id)?.name ?? '—';
  const tenantsOf = (propertyId: number) => people.filter((p) => p.role === 'tenant' && p.propertyId === propertyId).map((p) => p.name);
  const added = properties.find((p) => String(p.id) === c.req.query('added'));
  const showForm = o.showForm || !properties.length || c.req.query('another') !== undefined;

  return wizardPage(c, {
    step: 'property',
    title: properties.length ? 'Your Properties' : 'Your first Property',
    body: html`
      <p class="max-w-prose">
        A Property is one rentable dwelling with its own lease. Add it with its Property Owner and Tenant, and the intake agent can act on their messages
        straight away. You can add the rest later, here or in Setup.
      </p>
      ${added
        ? alert(
            html`${added.address} is set up with Property Owner ${nameOf(added.ownerId)} and Tenant ${sentence(tenantsOf(added.id))}. Repairs up to
              ${formatMoney(added.maxRepairCostCents)} go ahead without asking the Property Owner.`,
            'success',
            { title: 'Property added' },
          )
        : ''}
      ${properties.length
        ? table(
            ['Address', 'Property Owner', 'Tenants', 'Max Repair Cost'],
            properties.map((p) => [
              html`${p.address}`,
              html`${nameOf(p.ownerId)}`,
              html`${tenantsOf(p.id).join(', ') || '—'}`,
              html`${formatMoney(p.maxRepairCostCents)}`,
            ]),
            { caption: 'Properties' },
          )
        : ''}
      ${showForm
        ? propertyForm(actions, pm.id, o)
        : html`<p>${linkButton('Add another Property', '/welcome/property?another#add-property', { variant: 'secondary' })}</p>`}
    `,
  });
}

function propertyForm(actions: Actions, myId: number, o: { values?: Values; errors?: Errors; message?: string }): Html {
  const { values, errors = {} } = o;
  const managers = actions.propertyManagers();
  const tradies = actions.people('tradie');
  const nominated = values?.nominatedTradieIds;
  const legend = (text: string) => html`<legend class="fieldset-legend text-base font-semibold">${text}</legend>`;
  return card({
    id: 'add-property',
    title: 'Add a Property',
    body: html`<form method="post" action="/welcome/property" class="space-y-4">
      ${o.message ? alert(o.message, 'error') : ''}
      <fieldset class="fieldset">
        ${legend('The Property')}
        ${field({ label: 'Address', name: 'address', id: 'property-address', required: true, placeholder: '12 King St, Newtown NSW 2042', value: valueOf(values, 'address'), error: errors.address })}
        ${field({ label: 'Suburb', name: 'suburb', id: 'property-suburb', required: true, value: valueOf(values, 'suburb'), error: errors.suburb })}
        ${field({
          label: 'Max Repair Cost ($)',
          name: 'maxRepairCost',
          id: 'property-max',
          type: 'number',
          step: '0.01',
          min: 0,
          required: true,
          placeholder: '500',
          value: valueOf(values, 'maxRepairCost'),
          hint: "The most a Ticket's Repair Cost can reach before the Property Owner must approve.",
          error: errors.maxRepairCost,
        })}
        ${managers.length > 1
          ? field({
              label: 'Property Manager',
              name: 'propertyManagerId',
              id: 'property-manager',
              type: 'select',
              required: true,
              value: valueOf(values, 'propertyManagerId') || String(myId),
              options: managers.map((m) => ({ value: String(m.id), label: m.name })),
              hint: 'Their dashboard shows this Property first.',
              error: errors.propertyManagerId,
            })
          : html`<input type="hidden" name="propertyManagerId" value="${myId}" />`}
      </fieldset>
      <fieldset class="fieldset">
        ${legend('Property Owner')}
        ${contactFields('owner', {
          scope: 'owner',
          values,
          errors,
          hint: "A mobile number, an email address, or both. If they own another Property you've added, use the same details and they're linked, not added twice.",
        })}
      </fieldset>
      <fieldset class="fieldset">
        ${legend('Tenant')} ${contactFields('tenant', { scope: 'tenant', values, errors })}
        ${field({
          label: 'Tenancy start date',
          name: 'tenancyStart',
          id: 'tenant-start',
          type: 'date',
          required: true,
          value: valueOf(values, 'tenancyStart'),
          hint: 'Photos taken before this date are flagged.',
          error: errors.tenancyStart,
        })}
        <p class="text-sm text-base-content/75">More Tenants on the same lease can be added in Setup.</p>
      </fieldset>
      <fieldset class="fieldset">
        ${legend('Building Manager (strata only, optional)')}
        <p class="text-sm">For a unit in a strata building: Common Area issues, like a broken lift, go straight to them.</p>
        ${contactFields('building-manager', { scope: 'buildingManager', values, errors, optional: true })}
      </fieldset>
      ${tradies.length
        ? choiceGroup({
            legend: 'Nominated Tradies (optional)',
            name: 'nominatedTradieIds',
            type: 'checkbox',
            options: tradies.map((t) => ({ value: String(t.id), label: `${t.businessName ?? t.name} (${t.trades.map(humanise).join(', ')})` })),
            checked: Array.isArray(nominated) ? nominated : nominated ? [nominated] : [],
            hint: 'Who the Tenant can call for an Urgent Repair.',
            error: errors.nominatedTradieIds,
          })
        : ''}
      ${button('Add the Property')}
    </form>`,
  });
}

// 5 Tradies

async function tradiesStep(c: WizardContext, o: { values?: Values; errors?: Errors; message?: string }): Promise<Html> {
  const { actions } = c.var;
  const tradies = actions.people('tradie');
  const query = c.req.query('google')?.trim() ?? '';
  const { listings, problem } = await searchListings(actions, query);
  const unplaced = o.message && !Object.keys(o.errors ?? {}).length ? o.message : null;
  return wizardPage(c, {
    step: 'tradies',
    title: 'Tradies',
    flash: flashFrom(c.req.url),
    body: html`
      <p class="max-w-prose">
        Add the Tradies ${actions.agency().name} already uses, with their Trades and how good they've been so far, so recommendations work from the first
        Job. They're shared by every Property Manager. Linking a Google listing shows their Google rating next to ours.
      </p>
      ${tradiesTable(actions, tradies, 'No Tradies yet. Add the first one below.')}
      ${card({
        id: 'add-tradie',
        title: 'Add a Tradie',
        body: html`
          ${googleSearchForm('/welcome/tradies#add-tradie', query, problem, listings.length)}
          <form method="post" action="/welcome/tradies${query ? `?google=${encodeURIComponent(query)}` : ''}" class="mt-4 space-y-1">
            ${unplaced ? alert(unplaced, 'error') : ''} ${tradieFields({ listings, values: o.values, errors: o.errors })}
            <div class="pt-2">${button('Add Tradie')}</div>
          </form>
        `,
      })}
    `,
  });
}

// 6 Done

function doneStep(c: WizardContext, demo: boolean): Html {
  const { actions } = c.var;
  const progress = setupProgress(actions);
  const agency = actions.agency();
  const team = actions.propertyManagers();
  const channels = actions.channels();
  const properties = actions.properties();
  const tenants = actions.people('tenant');
  const tradies = actions.people('tradie');
  const finished = isDone('done', progress);

  const items: { done: boolean; text: Html | string; fix?: [string, string] }[] = [
    { done: true, text: `${agency.name} created, with you as its first Property Manager` },
    {
      done: progress.team,
      text: progress.team ? `${team.length} Property Managers on the team` : 'Just you so far. Add colleagues any time.',
      fix: ['Add colleagues', '/welcome/team'],
    },
    ...CHANNELS.map((ch) => {
      const current = channels.find((c) => c.type === ch.type);
      return {
        done: !!current?.testedAt,
        text: current ? (current.testedAt ? `${ch.name} connected to ${current.address} and tested` : `${ch.name} connected to ${current.address}, not tested yet`) : `${ch.name} not connected`,
        fix: [current ? 'Send a test message' : `Connect ${ch.name}`, `/welcome/channels#${ch.type}`] as [string, string],
      };
    }),
    {
      done: progress.property,
      text: progress.property ? `${count(properties.length, 'Property', 'Properties')} with ${count(tenants.length, 'Tenant')}` : 'No Properties yet',
      fix: ['Add a Property', '/welcome/property'],
    },
    { done: progress.tradies, text: progress.tradies ? count(tradies.length, 'Tradie') : 'No Tradies yet', fix: ['Add Tradies', '/welcome/tradies'] },
  ];
  const firstTenant = tenants[0];
  const sms = channels.find((ch) => ch.type === 'sms');

  return wizardPage(c, {
    step: 'done',
    title: finished ? "You're set up" : 'Nearly there',
    progress,
    body: html`
      <p class="max-w-prose">
        ${finished
          ? `${agency.name} is ready for its first maintenance message. Here's what's set up.`
          : `A few things are still to do before Tenants' messages can reach you. You can finish them now or come back later.`}
      </p>
      ${card({
        title: 'Your setup',
        body: html`<ul class="space-y-2" aria-label="Setup checklist">
          ${items.map(
            (item) => html`<li class="flex flex-wrap items-start gap-2">
              <span class="badge badge-sm ${item.done ? 'badge-success' : 'badge-soft badge-neutral'} mt-0.5 w-6 justify-center" aria-hidden="true">${item.done ? '✓' : '–'}</span>
              <span class="sr-only">${item.done ? 'Done: ' : 'To do: '}</span>
              <span class="min-w-0 flex-1">${item.text}</span>
              ${!item.done && item.fix ? html`<a class="link text-sm" href="${item.fix[1]}">${item.fix[0]}</a>` : ''}
            </li>`,
          )}
        </ul>`,
      })}
      ${card({
        title: 'Try it',
        body: demo
          ? html`<p>
                Open the phone simulator and act as ${firstTenant ? firstTenant.name : 'a Tenant'}. Send "The kitchen tap is dripping", answer the questions,
                and watch it arrive on your dashboard as a Maintenance Request.
              </p>
              <p>${linkButton('Open the phone simulator', '/demo', { size: 'sm' })}</p>`
          : html`<p>
              Ask a Tenant to text ${sms ? sms.address : "your Agency's SMS number"} about something that needs fixing. The intake agent replies, asks a few
              questions, and it arrives on your dashboard as a Maintenance Request.
            </p>`,
      })}
      <p>${linkButton('Go to your dashboard', '/', { variant: 'primary' })}</p>
    `,
  });
}

// Words

/** A refusal's messages by field; one that names no field goes against `fallback`. */
function fieldErrors(error: ActionError, fallback: string): Errors {
  return Object.keys(error.fields).length ? { ...error.fields } : { [fallback]: error.message };
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

function count(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** ["a", "b", "c"] -> "a, b and c". */
function sentence(parts: string[]) {
  return parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
