// The guided onboarding wizard under /welcome, where a new Agency lands after
// signing up: one task per screen, in order, with Back, Continue and "Skip for
// now". Progress is read from what the Agency already has (its Property
// Managers, channels, Properties and Tradies), never from a stored flag, so the
// wizard can be left and picked up again, and an Agency set up through /setup
// shows as done here too.
//
//   1 Welcome          what we'll set up, and the Agency's details
//   2 Your team        colleagues as Property Managers (optional)
//   3 Channels         SMS verified with a code, email at the inbound address
//   4 Tradies          the Tradies the Agency already uses, so a Property can nominate them
//   5 First Property   address, Max Repair Cost, Property Owner, Tenant, Building Manager
//   6 Done             what's set up, and where to go next

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { ImportKind } from '../../imports.ts';
import type { ChannelType } from '../../ports.ts';
import { ActionError, isEmail, normalizeAddress, type Role } from '../../shared.ts';
import { NO_CONNECTORS, type ChannelConnectors } from '../connectors.ts';
import type { WebEnv } from '../env.ts';
import { gmailControls } from './oauth-google.ts';
import { icon } from '../icons.ts';
import { cents, text, type FormValues } from '../forms.ts';
import { shareButton } from '../share.ts';
import { shellInfo } from '../shell.ts';
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
  linkButton,
  page,
  section,
  steps,
  table,
  withFlash,
  type Flash,
  type Html,
} from '../ui.ts';
import {
  addTradieFrom,
  CHANNELS,
  channelBadge,
  channelGuide,
  channelLine,
  channelOf,
  unavailableChip,
  unavailableNote,
  channelState,
  inboundEmailField,
  phoneChannelForm,
  nominatedFrom,
  tradiePicker,
  contactFields,
  contactFrom,
  fieldGrid,
  googleSearchForm,
  IMPORT_NOUNS,
  importPanel,
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
type Person = Awaited<ReturnType<Actions['people']>>[number];
type WizardContext = Context<WebEnv>;

const STEPS = [
  { key: 'welcome', label: 'Welcome', path: '/welcome' },
  { key: 'team', label: 'Your team', path: '/welcome/team' },
  { key: 'channels', label: 'Channels', path: '/welcome/channels' },
  { key: 'tradies', label: 'Tradies', path: '/welcome/tradies' },
  { key: 'property', label: 'First Property', path: '/welcome/property' },
  { key: 'done', label: 'Done', path: '/welcome/done' },
] as const;
type StepKey = (typeof STEPS)[number]['key'];

/** What a new Agency needs before Tenants' messages can be handled, in guide order. Adding colleagues is optional. */
const NEEDED = ['channels', 'tradies', 'property'] as const;

/** Each needed step as the "Finish setting up" banner says it. */
const STILL_TO_DO: Record<(typeof NEEDED)[number], string> = {
  channels: 'connect SMS and email',
  property: 'add your first Property',
  tradies: 'add the Tradies you use',
};

const ROLE_LABEL: Record<Role, string> = { tenant: 'Tenant', owner: 'Property Owner', tradie: 'Tradie', building_manager: 'Building Manager' };

/** How far the Agency's setup has got, read from what it has. */
export async function setupProgress(actions: Actions, unavailable: readonly ChannelType[] = []) {
  const channels = await actions.channels();
  return {
    team: (await actions.propertyManagers()).length > 1,
    // A channel this server can't deliver on isn't waited for.
    channels: CHANNELS.filter((ch) => !unavailable.includes(ch.type)).every((ch) => channels.some((c) => c.type === ch.type)),
    property: (await actions.properties()).length > 0,
    tradies: (await actions.people('tradie')).length > 0,
  };
}
type Progress = Awaited<ReturnType<typeof setupProgress>>;

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
export async function finishSetupBanner(actions: Actions, unavailable: readonly ChannelType[] = []): Promise<Html> {
  const progress = await setupProgress(actions, unavailable);
  const next = nextSetupStep(progress);
  if (!next) return html``;
  const left = NEEDED.filter((k) => !progress[k]).map((k) => STILL_TO_DO[k]);
  // One line on wide screens: a hi-vis stripe, the sentence, and the one link to the next step.
  return html`<div data-banner="finish-setup" class="flex flex-wrap items-center gap-x-3 gap-y-1 overflow-hidden rounded-md border border-line bg-surface text-sm">
    <span aria-hidden="true" class="inline-block h-6 w-4 shrink-0 self-center bg-[image:repeating-linear-gradient(-45deg,var(--ink)_0_4px,var(--hivis)_4px_8px)] sm:ml-2"></span>
    <p class="min-w-0 flex-1 py-2 pl-2 sm:pl-0"><strong class="font-semibold">Finish setting up ${actions.agency().name}.</strong> Still to do: ${sentence(left)}.</p>
    <div class="py-1.5 pr-3">${linkButton('Continue setup', next, { variant: 'primary', size: 'sm' })}</div>
  </div>`;
}

/** The wizard, mounted at /welcome behind requirePropertyManager. `demo` suggests made-up channel addresses for the phone simulator. */
export function welcomePages(o: { demo: boolean; connectors?: ChannelConnectors }) {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => c.html(await welcomeStep(c)));

  pages.get('/team', async (c) => c.html(await teamStep(c, {})));
  pages.post('/team', async (c) => {
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const colleague = { name: text(form, 'name'), email: text(form, 'email') };
    try {
      const { temporaryPassword } = await c.var.actions.addColleague(colleague);
      // The page shows a password: keep it out of every cache.
      c.header('Cache-Control', 'no-store');
      return c.html(await teamStep(c, { added: { ...colleague, temporaryPassword } }));
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      return c.html(await teamStep(c, { values: valuesOf(form), errors: fieldErrors(error, 'email') }), 400);
    }
  });

  pages.get('/channels', async (c) => c.html(await channelsStep(c, o.demo, o.connectors ?? NO_CONNECTORS)));
  pages.post('/channels', (c) =>
    channelAction(c, async (form, channel) => {
      if (channel.type === 'email') return 'Forward the Agency inbox to the inbound address on this page. A typed address is not saved.';
      const address = text(form, 'address');
      if (!address) throw new ActionError('invalid', `Enter the ${channel.addressLabel}`);
      await c.var.actions.startChannelVerification(channel.type, address);
      return `We sent a 6-digit code to ${normalizeAddress(address)}. It expires in 10 minutes.`;
    }),
  );
  pages.post('/channels/confirm', (c) =>
    channelAction(c, async (form, channel) => {
      const address = text(form, 'address');
      const code = text(form, 'code');
      if (!code) throw new ActionError('invalid', 'Enter the 6-digit code');
      await c.var.actions.confirmChannelVerification(channel.type, address, code);
      return `${channel.name} verified.`;
    }),
  );

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

  pages.get('/property', async (c) => c.html(await propertyStep(c, {})));
  pages.post('/property', async (c) => {
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const values = valuesOf(form);
    const refused = async (errors: Errors, message?: string) => c.html(await propertyStep(c, { values, errors, message, showForm: true }), 400);
    const read = await readPropertyForm(c.var.actions, form, c.var.pm.id);
    if (!read.ok) return refused(read.errors);
    try {
      const propertyId = await addPropertyFrom(c.var.actions, read.input);
      return c.redirect(`/welcome/property?added=${propertyId}`, 303);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      return refused(error.fields, error.message);
    }
  });

  pages.get('/done', async (c) => c.html(await doneStep(c, o.demo)));

  return pages;
}

// The frame around every step: the wizard fills the page with no rail, and the rest of the app comes after setup.

async function wizardPage(
  c: WizardContext,
  o: { step: StepKey; title: string; body: Html; progress?: Progress; flash?: Flash | null },
): Promise<Html> {
  const { actions, pm } = c.var;
  const progress = o.progress ?? (await setupProgress(actions, c.var.unavailableChannels));
  const index = STEPS.findIndex((s) => s.key === o.step);
  const back = STEPS[index - 1];
  const forward = STEPS[index + 1];
  // A step not done yet moves on with "Skip for now"; a done one with "Continue". The last step leads to the dashboard.
  const onward = forward
    ? isDone(o.step, progress)
      ? linkButton(o.step === 'welcome' ? "Let's start" : 'Continue', forward.path, { variant: 'primary' })
      : linkButton('Skip for now', forward.path, { variant: 'ghost' })
    : linkButton('Go to your dashboard', '/', { variant: 'primary' });
  return page({
    title: o.title,
    pm,
    fullPage: true,
    shell: await shellInfo(c),
    flash: o.flash ?? null,
    // Which step this is sits with the steps, in the wizard's own column.
    body: html`<div class="wizard">
      <nav aria-label="Setup steps" class="wizard-steps">
        <p class="wizard-where"><span>Step ${index + 1} of ${STEPS.length}</span><span>Setting up ${actions.agency().name}</span></p>
        ${steps(
          STEPS.map((s) => ({ label: s.label, done: isDone(s.key, progress), href: s.path })),
          { current: index, horizontal: true },
        )}
      </nav>
      ${o.body}
      <div class="wizard-foot">
        ${back ? linkButton('Back', back.path, { variant: 'secondary' }) : linkButton('Set up later', '/', { variant: 'ghost' })}
        <div class="wizard-onward">${onward}</div>
      </div>
    </div>`,
  });
}

// 1 Welcome

async function welcomeStep(c: WizardContext): Promise<Html> {
  const { actions, pm } = c.var;
  const agency = actions.agency();
  const zone = TIME_ZONES.find((z) => z.value === agency.timeZone)?.label ?? agency.timeZone;
  return wizardPage(c, {
    step: 'welcome',
    title: `Welcome to myEST8, ${firstName(pm.name)}`,
    body: html`
      <p>
        This takes about 5 minutes. You can skip any step and come back to it. What you add is saved as you go.
      </p>
      ${card({
        title: 'Steps ahead',
        body: html`<ol class="ml-5 list-decimal space-y-2">
          <li><strong>Your team.</strong> Add the other Property Managers so each has their own sign-in. Optional.</li>
          <li><strong>Channels.</strong> Connect the SMS number and email inbox Tenants already use, and test each one.</li>
          <li><strong>Tradies.</strong> The Tradies you already use, with their Trades and a starting rating.</li>
          <li><strong>Your first Property.</strong> Its address, Max Repair Cost, Property Owner and Tenant.</li>
        </ol>`,
      })}
      ${card({
        title: 'Your Agency',
        body: dl([
          ['Agency', agency.name],
          ['Time zone', zone],
          ['First Property Manager', html`${pm.name} <span class="text-muted">(${pm.email})</span>`],
        ]),
      })}
    `,
  });
}

// 2 Your team

async function teamStep(c: WizardContext, o: { added?: { name: string; email: string; temporaryPassword: string }; values?: Values; errors?: Errors }): Promise<Html> {
  const { actions, pm } = c.var;
  const team = await actions.propertyManagers();
  const origin = new URL(c.req.url).origin;
  return wizardPage(c, {
    step: 'team',
    title: 'Your team',
    body: html`
      <p>
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
                <dd><code class="rounded bg-page px-2 py-0.5 text-base font-semibold tracking-wider" data-temporary-password>${o.added.temporaryPassword}</code></dd>
              </dl>`,
            'success',
            { title: `${o.added.name} added as a Property Manager` },
          )
        : ''}
      ${o.added
        ? shareButton({
            title: `Send ${o.added.name} their sign-in link`,
            label: `Send ${o.added.name} their sign-in link`,
            // The temporary password never goes in a share: the link and the text end up in message histories.
            text: `You're on myEST8 for ${actions.agency().name}. Sign in with ${o.added.email}. I'll give you your temporary password separately.`,
            url: `${origin}/login`,
            note: 'Give them the temporary password another way, in person or by phone.',
            align: 'start',
          })
        : ''}
      ${table(
        ['Name', 'Email'],
        team.map((m) => [html`${m.name}${m.id === pm.id ? html` ${badge('You')}` : ''}`, html`${m.email}`]),
        { caption: 'Property Managers' },
      )}
      ${card({
        title: 'Add a colleague',
        body: html`<form method="post" action="/welcome/team" class="space-y-3">
          ${fieldGrid(html`
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
          `)}
          <div>${button('Add colleague', { variant: team.length > 1 ? 'secondary' : 'primary' })}</div>
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

async function channelsStep(c: WizardContext, demo: boolean, connectors: ChannelConnectors): Promise<Html> {
  const { actions } = c.var;
  const agency = actions.agency();
  const email = await actions.ensureInboundEmail();
  const pending = await actions.pendingChannelVerifications();
  const connected = await actions.channels();
  const flash = flashFrom(c.req.url);
  const flashChannel = c.req.query('channel');
  const origin = new URL(c.req.url).origin;
  const verifiedTypes = connected
    .filter((ch) => channelState(ch, { verified: ch.type === 'email' && email.state === 'verified', waiting: ch.type === 'email' && email.state === 'waiting' }) === 'verified')
    .map((ch) => ch.type);
  const rowForm = 'mt-2 grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto]';
  const gmailBlock = connectors.gmail ? await gmailControls(connectors.gmail, agency.id, 'welcome') : null;
  return wizardPage(c, {
    step: 'channels',
    title: 'Channels',
    // A channel's own result shows in its row; anything else at the top.
    flash: flash && !CHANNELS.some((ch) => ch.type === flashChannel) ? flash : null,
    body: html`
      <p>
        Tenants, Tradies and Property Owners reach ${agency.name} by SMS and email. Verify SMS with a code sent to the number.
        Email arrives at the address below once you forward the Agency inbox to it.${demo ? ' In the demo nothing is really sent, and the addresses work with the phone simulator.' : ''}
      </p>
      <p class="wizard-next">${channelsStillToDo(CHANNELS.filter((ch) => !connectors.unavailable.includes(ch.type)).map((ch) => ({ type: ch.type, verified: verifiedTypes.includes(ch.type) })))}</p>
      <div class="flex flex-col gap-4">
        ${CHANNELS.map((channel) => {
          const current = connected.find((ch) => ch.type === channel.type);
          const suggestion = demo && channel.type !== 'email' ? demoAddress(channel.type, agency) : '';
          const waiting = channel.type === 'email' && email.state === 'waiting';
          const emailVerified = channel.type === 'email' && email.state === 'verified';
          const open = pending.find((row) => row.channelType === channel.type);
          const unavailable = connectors.unavailable.includes(channel.type);
          return html`<div id="${channel.type}" class="grid gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0 md:grid-cols-[9rem_minmax(0,1fr)]">
            <div>
              <h2 class="section-title">${channel.name}</h2>
              <p class="mt-1">${unavailable ? unavailableChip() : channelBadge(current, { waiting, verified: emailVerified })}</p>
            </div>
            <div class="min-w-0">
              ${flash && flashChannel === channel.type ? flashMessage(flash) : ''}
              ${unavailable ? unavailableNote(channel.type, connectors.unavailable) : ''}
              ${unavailable ? '' : current ? channelLine(current, agency.timeZone, { waiting, smsInbound: connectors.smsInbound }) : ''}
              ${unavailable ? '' : channel.type === 'email'
                ? html`<div class="mt-2">${inboundEmailField(email.address)}</div>${gmailBlock ?? ''}<div class="mt-2">${channelGuide(channel.type, origin)}</div>`
                : html`${phoneChannelForm({
                      channel,
                      postTo: '/welcome/channels',
                      confirmTo: '/welcome/channels/confirm',
                      pending: open,
                      suggestion,
                      current: current?.address,
                      className: rowForm,
                    })}<div class="mt-2">${channelGuide(channel.type, origin)}</div>`}
            </div>
          </div>`;
        })}
      </div>
    `,
  });
}

/** What the channels still need, as one sentence: what's next rather than a count. */
function channelsStillToDo(channels: { type: ChannelType; verified: boolean }[]): string {
  const left = channels
    .filter((ch) => !ch.verified)
    .map((ch) => (ch.type === 'email' ? "send one email to the Agency inbox so it's forwarded here" : "verify the Agency's SMS number with a code"));
  if (!channels.length) return 'Nothing to connect on this server. Continue to the next step.';
  if (!left.length) return `${sentence(channels.map((ch) => (ch.type === 'email' ? 'email' : 'SMS')))} ${channels.length > 1 ? 'are' : 'is'} verified.`.replace(/^./, (c) => c.toUpperCase());
  return `Still to do: ${left.join(', and ')}.`;
}

/** A made-up channel address for a demo Agency, unique to it: channel addresses can belong to only one Agency. */
function demoAddress(type: ChannelType, agency: { id: number; name: string }) {
  if (type === 'email') {
    const slug = agency.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agency';
    return `inbox@${slug}-${agency.id}.example`;
  }
  return `+61 2 9100 ${String(agency.id).padStart(4, '0')}`;
}

// 4 Tradies

async function tradiesStep(c: WizardContext, o: { values?: Values; errors?: Errors; message?: string }): Promise<Html> {
  const { actions } = c.var;
  const tradies = await actions.people('tradie');
  const query = c.req.query('google')?.trim() ?? '';
  const { listings, problem } = await searchListings(actions, query);
  const unplaced = o.message && !Object.keys(o.errors ?? {}).length ? o.message : null;
  return wizardPage(c, {
    step: 'tradies',
    title: 'Tradies',
    flash: flashFrom(c.req.url),
    body: html`
      <p>
        Add the Tradies ${actions.agency().name} already uses, with their Trades and how good they've been so far, so recommendations work from the first
        Job. Linking a Google listing shows their Google rating next to ours.
      </p>
      ${(await tradiesTable(actions, tradies, 'No Tradies yet. Add the first one below.'))}
      ${importCard(c, 'Add many Tradies from a spreadsheet', ['tradies'])}
      ${card({
        id: 'add-tradie',
        title: 'Add a Tradie',
        body: html`
          ${googleSearchForm('/welcome/tradies#add-tradie', query, problem, listings.length)}
          <form method="post" action="/welcome/tradies${query ? `?google=${encodeURIComponent(query)}` : ''}" class="mt-4 space-y-3">
            ${unplaced ? alert(unplaced, 'error') : ''}
            ${tradieFields({ listings, values: o.values, errors: o.errors })}
            <div>${button('Add Tradie', { variant: tradies.length ? 'secondary' : 'primary' })}</div>
          </form>
        `,
      })}
    `,
  });
}

// 5 First Property

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
async function readPropertyForm(actions: Actions, form: FormValues, myId: number): Promise<{ ok: true; input: PropertyInput } | { ok: false; errors: Errors }> {
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

  const managers = await actions.propertyManagers();
  const chosenManager = Number(text(form, 'propertyManagerId') || myId);
  if (!managers.some((m) => m.id === chosenManager)) errors.propertyManagerId = 'Choose a Property Manager in your Agency';

  const tradies = await actions.people('tradie');
  const nominatedTradieIds = nominatedFrom(form);
  if (nominatedTradieIds.some((id) => !tradies.some((t) => t.id === id))) errors.nominatedTradieIds = 'Choose Tradies from the list';

  // Who already has each mobile and email, so nobody is added twice.
  const holders = new Map<string, Person>();
  for (const person of (await actions.people())) {
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
  const ownerId = owner?.id ?? (await within('owner', () => actions.addOwner(newOwner)));
  let buildingManagerId: number | undefined;
  if (input.buildingManager) {
    const { existing, ...newBuildingManager } = input.buildingManager;
    buildingManagerId = existing?.id ?? (await within('buildingManager', () => actions.addBuildingManager(newBuildingManager)));
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
  await within('tenant', () => actions.addTenant({ ...input.tenant, propertyId }), { tenancyStart: 'tenancyStart' });
  return propertyId;
}

/** Runs one action for a person in the form, naming any refused field the way the form posts it ("ownerMobile"). */
async function within<T>(scope: string, action: () => T | Promise<T>, keep: Record<string, string> = {}): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw renamed(error, { name: scoped(scope, 'name'), mobile: scoped(scope, 'mobile'), email: scoped(scope, 'email'), ...keep });
  }
}

function renamed(error: unknown, names: Record<string, string>): unknown {
  if (!(error instanceof ActionError)) return error;
  const fields = Object.fromEntries(Object.entries(error.fields).map(([f, message]) => [names[f] ?? f, message]));
  return new ActionError(error.code, error.message, fields);
}

async function propertyStep(c: WizardContext, o: { values?: Values; errors?: Errors; message?: string; showForm?: boolean }): Promise<Html> {
  const { actions, pm } = c.var;
  const properties = await actions.properties();
  const people = await actions.people();
  const nameOf = (id: number | null) => people.find((p) => p.id === id)?.name ?? '—';
  const tenantsOf = (propertyId: number) => people.filter((p) => p.role === 'tenant' && p.propertyId === propertyId).map((p) => p.name);
  const added = properties.find((p) => String(p.id) === c.req.query('added'));
  const showForm = o.showForm || !properties.length || c.req.query('another') !== undefined;

  return wizardPage(c, {
    step: 'property',
    title: properties.length ? 'Your Properties' : 'Your first Property',
    flash: flashFrom(c.req.url),
    body: html`
      <p>
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
      ${importCard(c, 'Add many Properties from spreadsheets', ['owners', 'properties', 'tenants'])}
      ${showForm
        ? await propertyForm(actions, pm.id, { ...o, first: !properties.length })
        : html`<p>${linkButton('Add another Property', '/welcome/property?another#add-property', { variant: 'secondary' })}</p>`}
    `,
  });
}

async function propertyForm(actions: Actions, myId: number, o: { values?: Values; errors?: Errors; message?: string; first?: boolean }): Promise<Html> {
  const { values, errors = {} } = o;
  const managers = await actions.propertyManagers();
  const tradies = await actions.people('tradie');
  const nominated = values?.nominatedTradieIds;
  // The Building Manager is optional, so its fields fold away unless they hold something or were refused.
  const buildingManagerShown =
    ['buildingManagerName', 'buildingManagerMobile', 'buildingManagerEmail'].some((f) => valueOf(values, f) !== '') ||
    Object.keys(errors).some((f) => f.startsWith('buildingManager'));
  return card({
    id: 'add-property',
    title: 'Add a Property',
    body: html`<form method="post" action="/welcome/property" class="space-y-4">
      ${o.message ? alert(o.message, 'error') : ''}
      ${group(
        'The Property',
        fieldGrid(html`
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
            hint: "Repairs over this need the Property Owner's approval.",
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
        `),
      )}
      ${group(
        'Property Owner',
        fieldGrid(
          contactFields('owner', {
            scope: 'owner',
            values,
            errors,
            hint: 'Already on another Property? The same mobile or email links them.',
          }),
        ),
      )}
      ${group(
        'Tenant',
        fieldGrid(html`
          ${contactFields('tenant', { scope: 'tenant', values, errors })}
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
        `),
        'More Tenants on the same lease can be added in Setup.',
      )}
      <details ${buildingManagerShown ? 'open' : ''}>
        <summary class="cursor-pointer font-semibold text-action">Add a Building Manager (strata only, optional)</summary>
        <div class="mt-3 space-y-3">
          <p class="text-sm text-muted">For a unit in a strata building: Common Area issues, like a broken lift, go straight to them.</p>
          ${fieldGrid(contactFields('building-manager', { scope: 'buildingManager', values, errors, optional: true }))}
        </div>
      </details>
      ${tradies.length
        ? tradiePicker({
            id: 'welcome-property',
            legend: 'Nominated Tradies (optional)',
            tradies,
            chosen: (Array.isArray(nominated) ? nominated : nominated ? [nominated] : []).filter(Boolean),
            error: errors.nominatedTradieIds,
          })
        : html`<p class="text-sm text-muted">Add Tradies in the Tradies step to nominate them for Urgent Repairs.</p>`}
      <div>${button('Add the Property', { variant: o.first ? 'primary' : 'secondary' })}</div>
    </form>`,
  });
}

/**
 * Uploads for a step, in the order they must happen (Property Owners before the
 * Properties they own, Properties before their Tenants). A refused upload's
 * message shows inside its own panel, which opens.
 */
function importCard(c: WizardContext, title: string, kinds: ImportKind[]): Html {
  const flash = flashFrom(c.req.url);
  const refused = flash?.kind === 'error' ? c.req.query('form') : undefined;
  const panel = (kind: ImportKind) =>
    importPanel(kind, { from: 'welcome', compact: true, error: refused === `import-${kind}` && flash ? alert(flash.message, 'error') : undefined });
  const open = kinds.some((k) => refused === `import-${k}`);
  return html`<details class="import-details section" id="import" ${open ? 'open' : ''}>
    <summary class="cursor-pointer font-semibold text-action">${title}</summary>
    <div class="mt-3 flex flex-col gap-4">
      <p class="text-sm">
        Already have a list? Upload it as an Excel (.xlsx) or CSV file. Your column names can be anything: myEST8 matches them, and AI fills in
        what's missing. You check every row before anything is added.
      </p>
      ${kinds.length > 1
        ? html`<ol class="import-steps">
            ${kinds.map((kind, i) => html`<li id="import-${kind}"><h3 class="import-step-title">${i + 1}. ${IMPORT_NOUNS[kind].many}</h3>${panel(kind)}</li>`)}
          </ol>`
        : html`<div id="import-${kinds[0]}">${panel(kinds[0]!)}</div>`}
    </div>
  </details>`;
}

/** A labelled group of fields in a form: a legend, an optional note, then the fields. */
function group(legend: string, fields: Html, note?: string): Html {
  return html`<fieldset class="min-w-0 space-y-3">
    <legend class="text-sm font-semibold text-ink">${legend}</legend>
    ${note ? html`<p class="text-sm text-muted">${note}</p>` : ''}
    ${fields}
  </fieldset>`;
}

// 6 Done

async function doneStep(c: WizardContext, demo: boolean): Promise<Html> {
  const { actions } = c.var;
  const progress = await setupProgress(actions, c.var.unavailableChannels);
  const agency = actions.agency();
  const team = await actions.propertyManagers();
  const email = await actions.ensureInboundEmail();
  const channels = await actions.channels();
  const properties = await actions.properties();
  const tenants = await actions.people('tenant');
  const tradies = await actions.people('tradie');
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
      const waiting = ch.type === 'email' && email.state === 'waiting';
      const verified = !!current?.testedAt || (ch.type === 'email' && email.state === 'verified');
      const text = !current
        ? `${ch.name} not connected`
        : waiting
          ? `Email is ${current.address}, waiting for your first message`
          : verified
            ? `${ch.name} verified at ${current.address}`
            : `${ch.name} connected to ${current.address}, not verified yet`;
      // The button says the next thing to do for this channel.
      const fix = ch.type === 'email' ? 'Check email' : current ? 'Verify SMS' : 'Connect SMS';
      return {
        done: verified,
        text,
        fix: [fix, `/welcome/channels#${ch.type}`] as [string, string],
      };
    }),
    { done: progress.tradies, text: progress.tradies ? count(tradies.length, 'Tradie') : 'No Tradies yet', fix: ['Add Tradies', '/welcome/tradies'] },
    {
      done: progress.property,
      text: progress.property ? `${count(properties.length, 'Property', 'Properties')} with ${count(tenants.length, 'Tenant')}` : 'No Properties yet',
      fix: ['Add a Property', '/welcome/property'],
    },
  ];
  const firstTenant = tenants[0];
  const sms = channels.find((ch) => ch.type === 'sms');

  return wizardPage(c, {
    step: 'done',
    title: finished ? "You're set up" : 'Setup is not finished',
    progress,
    body: html`
      <p>
        ${finished
          ? `${agency.name} is ready for its first maintenance message.`
          : `Tenants' messages can't reach you until the items below are done. You can finish them now or come back later.`}
      </p>
      ${card({
        title: 'Your setup',
        body: html`<ul class="wizard-checklist" aria-label="Setup checklist">
          ${items.map(
            (item) => html`<li class="${item.done ? 'is-done' : 'is-todo'}">
              <span class="wizard-check" aria-hidden="true">${item.done ? icon('check-circle', { size: 'size-5' }) : icon('circle', { size: 'size-5' })}</span>
              <span class="sr-only">${item.done ? 'Done: ' : 'To do: '}</span>
              <span class="wizard-check-text">${item.text}</span>
              ${!item.done && item.fix ? linkButton(item.fix[0], item.fix[1], { size: 'sm' }) : ''}
            </li>`,
          )}
        </ul>`,
      })}
      ${card({
        title: 'Try a message',
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
