// The guided onboarding wizard under /welcome, where a new Agency lands after
// signing up: one task per screen, in order, with Back, Continue and "Skip for
// now". Progress is read from what the Agency already has (its Property
// Managers, channels, Properties and Tradies), never from a stored flag, so the
// wizard can be left and picked up again, and an Agency set up through /setup
// shows as done here too. The wizard fills the page, with no rail: the rest of
// the app comes after setup.
//
//   1 Email            the Agency's email inbox, with a test message (required: every
//                      other page leads here until it is connected; see requireEmailFirst)
//   2 Your team        colleagues as Property Managers (optional)
//   3 Channels         SMS and WhatsApp, each with a test message
//   4 Tradies          the Tradies the Agency already uses, so a Property can nominate them
//   5 First Property   address, Max Repair Cost, Property Owner, Tenant, Building Manager
//   6 Done             what's set up, and where to go next

import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { ImportKind } from '../../imports.ts';
import type { ChannelType } from '../../ports.ts';
import { simulatedAddress, type PropertyWithPeopleInput } from '../../onboarding.ts';
import { ActionError } from '../../shared.ts';
import type { ChannelModes, WebEnv } from '../env.ts';
import { cents, list, text, type FormValues } from '../forms.ts';
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
  humanise,
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
  choiceGroup,
  contactFields,
  contactFrom,
  fieldGrid,
  getSmsNumber,
  googleSearchForm,
  IMPORT_NOUNS,
  importPanel,
  modeChannelBody,
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
type WizardContext = Context<WebEnv>;

const STEPS = [
  { key: 'email', label: 'Email', path: '/welcome' },
  { key: 'team', label: 'Your team', path: '/welcome/team' },
  { key: 'channels', label: 'SMS and WhatsApp', path: '/welcome/channels' },
  { key: 'tradies', label: 'Tradies', path: '/welcome/tradies' },
  { key: 'property', label: 'First Property', path: '/welcome/property' },
  { key: 'done', label: 'Done', path: '/welcome/done' },
] as const;
type StepKey = (typeof STEPS)[number]['key'];

/** What a new Agency needs before Tenants' messages can be handled, in guide order. Adding colleagues is optional. */
const NEEDED = ['email', 'channels', 'tradies', 'property'] as const;

/** Each needed step as the "Finish setting up" banner says it. */
const STILL_TO_DO: Record<(typeof NEEDED)[number], string> = {
  email: "connect the Agency's email",
  channels: 'connect SMS and WhatsApp',
  property: 'add your first Property',
  tradies: 'add the Tradies you use',
};

/** How far the Agency's setup has got, read from what it has. */
export async function setupProgress(actions: Actions) {
  const channels = await actions.channels();
  return {
    email: channels.some((c) => c.type === 'email'),
    team: (await actions.propertyManagers()).length > 1,
    channels: PHONE_CHANNELS.every((ch) => channels.some((c) => c.type === ch.type)),
    property: (await actions.properties()).length > 0,
    tradies: (await actions.people('tradie')).length > 0,
  };
}
type Progress = Awaited<ReturnType<typeof setupProgress>>;

const EMAIL = CHANNELS.find((ch) => ch.type === 'email')!;
/** The channels on the Channels step: email has a step of its own. */
const PHONE_CHANNELS = CHANNELS.filter((ch) => ch.type !== 'email');

/** What a Property Manager may open before the Agency's email is connected: the email step and Google's sign-in. */
const BEFORE_EMAIL = [/^\/welcome\/?$/, /^\/welcome\/email(\/|$)/, /^\/oauth\/google(\/|$)/];

/**
 * Email is not optional: until the Agency's email is connected, every Property Manager page leads to
 * the first setup step. Mounted behind requirePropertyManager.
 */
export function requireEmailFirst(): MiddlewareHandler<WebEnv> {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (BEFORE_EMAIL.some((allowed) => allowed.test(path))) return next();
    if ((await c.var.actions.channels()).some((ch) => ch.type === 'email')) return next();
    return c.redirect('/welcome', 303);
  };
}

function isDone(key: StepKey, progress: Progress): boolean {
  if (key === 'done') return NEEDED.every((k) => progress[k]);
  return progress[key];
}

/** Where to pick setup up again: the first needed step not done, or null once the Agency is set up. */
export function nextSetupStep(progress: Progress): string | null {
  const key = NEEDED.find((k) => !progress[k]);
  return key ? STEPS.find((s) => s.key === key)!.path : null;
}

/** The dashboard's "Finish setting up" banner, or nothing once the Agency is set up. */
export async function finishSetupBanner(actions: Actions): Promise<Html> {
  const progress = await setupProgress(actions);
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
export function welcomePages(o: { demo: boolean; channels?: ChannelModes | undefined }) {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => c.html(await emailStep(c, o)));
  pages.post('/email', (c) => channelAction(c, connectChannel, EMAIL));
  pages.post('/email/test', (c) => channelAction(c, sendTest, EMAIL));

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

  pages.get('/channels', async (c) => c.html(await channelsStep(c, o)));
  const connectChannel: ChannelFormAction = async (c, form, channel) => {
    const address = text(form, 'address');
    if (!address) throw new ActionError('invalid', `Enter the ${channel.addressLabel}`);
    await c.var.actions.connectChannel(channel.type, address);
    return `${channel.name} connected to ${address}. Now send a test message to check it works.`;
  };
  const sendTest: ChannelFormAction = async (c, form, channel) => {
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
  };
  pages.post('/channels', (c) => channelAction(c, connectChannel));
  // The one WhatsApp number this server has (Meta's Cloud API) goes to the Agency that connects it first.
  pages.post('/channels/whatsapp', async (c) => {
    const number = o.channels?.whatsappNumber;
    if (!number) return c.text('WhatsApp is not set up on this server.', 404);
    try {
      await c.var.actions.connectChannel('whatsapp', number);
      return c.redirect(withFlash('/welcome/channels?channel=whatsapp', 'ok', `WhatsApp connected to ${number}. Now send a test message to check it works.`), 303);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      return c.redirect(withFlash('/welcome/channels?channel=whatsapp', 'error', error.message), 303);
    }
  });
  // myEST8 buys the Agency an Australian mobile number on Twilio and points its texts here.
  pages.post('/channels/sms', async (c) => {
    if (!o.channels?.smsNumbers) return c.text('SMS numbers are not set up on this server.', 404);
    try {
      const number = await getSmsNumber(c.var.actions);
      return c.redirect(withFlash('/welcome/channels?channel=sms', 'ok', `The Agency's SMS number is ${number}. Now send a test message to check it works.`), 303);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      return c.redirect(withFlash('/welcome/channels?channel=sms', 'error', error.message), 303);
    }
  });
  pages.post('/channels/test', (c) => channelAction(c, sendTest));

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
    const read = readPropertyForm(form, c.var.pm.id);
    try {
      // Checks everything, then adds the Property Owner, any Building Manager, the Property and its Tenant together, or none of them.
      const { propertyId } = await c.var.actions.addPropertyWithPeople(read.input);
      return c.redirect(`/welcome/property?added=${propertyId}`, 303);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      const errors: Errors = { ...Object.fromEntries(Object.entries(error.fields).map(([f, message]) => [formField(f), message])), ...read.errors };
      // Each refusal shows next to its field; only one about no field shows above the form.
      const message = Object.keys(errors).length ? undefined : error.message;
      return c.html(await propertyStep(c, { values, errors, message, showForm: true }), 400);
    }
  });

  pages.get('/done', async (c) => c.html(await doneStep(c, o.demo)));

  return pages;
}

// The frame around every step

async function wizardPage(
  c: WizardContext,
  o: { step: StepKey; title: string; body: Html; progress?: Progress; flash?: Flash | null },
): Promise<Html> {
  const { actions, pm } = c.var;
  const progress = o.progress ?? (await setupProgress(actions));
  const index = STEPS.findIndex((s) => s.key === o.step);
  const back = STEPS[index - 1];
  const forward = STEPS[index + 1];
  // A step not done yet moves on with "Skip for now"; a done one with "Continue". Email can't be skipped.
  const done = isDone(o.step, progress);
  const onward = forward
    ? done
      ? linkButton('Continue', forward.path, { variant: 'primary' })
      : o.step === 'email'
        ? ''
        : linkButton('Skip for now', forward.path, { variant: 'ghost' })
    : '';
  // Leaving for the dashboard waits for email too.
  const leave = progress.email ? linkButton('Set up later', '/', { variant: 'ghost' }) : '';
  return page({
    title: o.title,
    subtitle: html`<span class="flex flex-wrap gap-x-4"><span>Step ${index + 1} of ${STEPS.length}</span><span>Setting up ${actions.agency().name}</span></span>`,
    pm,
    fullPage: true,
    shell: shellInfo(c),
    flash: o.flash ?? null,
    body: html`<div class="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      <nav aria-label="Setup steps">
        ${steps(
          STEPS.map((s) => ({ label: s.label, done: isDone(s.key, progress), href: s.path })),
          { current: index, horizontal: true },
        )}
      </nav>
      ${o.body}
      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        ${back ? linkButton('Back', back.path, { variant: 'secondary' }) : leave}
        <div class="flex flex-wrap items-center gap-2">${onward}</div>
      </div>
    </div>`,
  });
}

// 1 Email

async function emailStep(c: WizardContext, o: { demo: boolean; channels?: ChannelModes | undefined }): Promise<Html> {
  const { actions, pm } = c.var;
  const agency = actions.agency();
  const progress = await setupProgress(actions);
  const flash = flashFrom(c.req.url);
  return wizardPage(c, {
    step: 'email',
    title: `Welcome to myEST8, ${firstName(pm.name)}`,
    progress,
    body: html`
      <p>
        Let's get ${agency.name} ready for its first maintenance message. It takes about 5 minutes, and what you add is saved as you go.
        ${progress.email
          ? html`Email is connected: carry on with the rest, or skip any of it and come back later.`
          : html`<strong>First, connect the Agency's email.</strong> Tenants, Tradies and Property Owners reach you there, and myEST8 replies from it, so
              it comes before everything else.`}
      </p>
      <div id="email">${card({ title: 'Email', body: await channelRow(c, o, EMAIL, flash, true) })}</div>
      <details class="text-sm">
        <summary class="cursor-pointer font-semibold">What comes after email</summary>
        <ol class="mt-2 ml-5 list-decimal space-y-1">
          <li><strong>Your team.</strong> The other Property Managers, each with their own sign-in. Optional.</li>
          <li><strong>SMS and WhatsApp.</strong> The numbers Tenants text and message, each with a test message.</li>
          <li><strong>Tradies.</strong> The Tradies you already use, with their Trades and a starting rating.</li>
          <li><strong>Your first Property.</strong> Its address, Max Repair Cost, Property Owner and Tenant.</li>
        </ol>
      </details>
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
          <div>${button('Add colleague')}</div>
        </form>`,
      })}
    `,
  });
}

// 3 Channels

type Channel = (typeof CHANNELS)[number];
type ChannelFormAction = (c: WizardContext, form: FormValues, channel: Channel) => string | Promise<string>;

/** Runs a channel form's action; back to its row with the result. `only` is the email step's channel, which isn't posted. */
async function channelAction(c: WizardContext, action: ChannelFormAction, only?: Channel) {
  const form = (await c.req.parseBody({ all: true })) as FormValues;
  let channel: Channel;
  try {
    channel = only ?? channelOf(form);
  } catch (error) {
    if (error instanceof ActionError) return c.redirect(withFlash('/welcome/channels', 'error', error.message), 303);
    throw error;
  }
  const back = channel.type === 'email' ? '/welcome?channel=email' : `/welcome/channels?channel=${channel.type}`;
  try {
    return c.redirect(`${withFlash(back, 'ok', await action(c, form, channel))}#${channel.type}`, 303);
  } catch (error) {
    if (error instanceof ActionError) return c.redirect(`${withFlash(back, 'error', error.message)}#${channel.type}`, 303);
    throw error;
  }
}

async function channelsStep(c: WizardContext, o: { demo: boolean; channels?: ChannelModes | undefined }): Promise<Html> {
  const { demo, channels: modes } = o;
  const agency = c.var.actions.agency();
  const connected = (await c.var.actions.channels()).filter((ch) => ch.type !== 'email');
  const flash = flashFrom(c.req.url);
  const flashChannel = c.req.query('channel');
  const tested = connected.filter((ch) => ch.testedAt).length;
  return wizardPage(c, {
    step: 'channels',
    title: 'SMS and WhatsApp',
    // A channel's own result shows in its row; anything else at the top.
    flash: flash && !CHANNELS.some((ch) => ch.type === flashChannel) ? flash : null,
    body: html`
      <p>
        Tenants, Tradies and Property Owners also reach ${agency.name} by SMS and WhatsApp.${modes ? ' Channels with no real provider on this server are simulated, and work with the phone simulator.' : ' Connect each one, then send yourself a test message.'}${demo && !modes ? ' In the demo nothing is really sent, and the addresses work with the phone simulator.' : ''}
      </p>
      <p class="text-sm text-muted">${connected.length} of ${PHONE_CHANNELS.length} connected, ${tested} tested.</p>
      <div class="flex flex-col gap-4">
        ${await Promise.all(
          PHONE_CHANNELS.map(
            async (channel) => html`<div id="${channel.type}" class="grid gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0 md:grid-cols-[9rem_minmax(0,1fr)]">
              <div>
                <h2 class="section-title">${channel.name}</h2>
                <p class="mt-1">${channelBadge(connected.find((ch) => ch.type === channel.type))}</p>
              </div>
              <div class="min-w-0">${await channelRow(c, o, channel, flashChannel === channel.type ? flash : null)}</div>
            </div>`,
          ),
        )}
      </div>
    `,
  });
}

/**
 * One channel's controls: its result, then connecting it (as the server's channel modes say, or by typing
 * the address) and sending a test message. Email's forms post to the email step's own routes.
 */
async function channelRow(c: WizardContext, o: { demo: boolean; channels?: ChannelModes | undefined }, channel: Channel, flash: Flash | null, badge = false): Promise<Html> {
  const { actions, pm } = c.var;
  const modes = o.channels;
  const agency = actions.agency();
  const current = (await actions.channels()).find((ch) => ch.type === channel.type);
  const email = channel.type === 'email';
  const connectAction = email ? '/welcome/email' : '/welcome/channels';
  const testAction = email ? '/welcome/email/test' : '/welcome/channels/test';
  const rowForm = 'mt-2 grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto]';
  const result = html`${badge ? html`<p class="mb-2">${channelBadge(current)}</p>` : ''}${flash ? flashMessage(flash) : ''}`;
  if (modes) {
    const gmail = modes.gmail ? await actions.gmailStatus() : 'unavailable';
    return html`${result}${modeChannelBody({
      channel,
      current,
      modes,
      gmail,
      pmEmail: pm.email,
      returnTo: email ? '/welcome' : '/welcome/channels',
      whatsappAction: '/welcome/channels/whatsapp',
      smsAction: '/welcome/channels/sms',
      testAction,
      timeZone: agency.timeZone,
    })}`;
  }
  return html`${result}${current ? channelLine(current, agency.timeZone) : ''}
    <form method="post" action="${connectAction}" class="${rowForm}">
      <input type="hidden" name="type" value="${channel.type}" />
      ${field({
        label: channel.addressLabel,
        name: 'address',
        id: `${channel.type}-address`,
        type: channel.inputType,
        required: true,
        value: current?.address ?? (o.demo ? simulatedAddress(channel.type, agency) : ''),
        placeholder: channel.placeholder,
      })}
      ${button(current ? `Change ${channel.name}` : `Connect ${channel.name}`, { size: 'sm', variant: current ? 'secondary' : 'primary' })}
    </form>
    ${current
      ? html`<form method="post" action="${testAction}" class="${rowForm}">
          <input type="hidden" name="type" value="${channel.type}" />
          ${field({
            label: email ? 'Send a test email to' : 'Send a test message to',
            name: 'to',
            id: `${channel.type}-to`,
            type: channel.inputType,
            required: true,
            value: email ? pm.email : '',
            placeholder: email ? 'you@youragency.com.au' : 'Your mobile, like 0412 345 678',
          })}
          ${button('Send a test message', { variant: current.testedAt ? 'secondary' : 'primary', size: 'sm' })}
        </form>`
      : ''}
    <div class="mt-2">${channelGuide(channel.type, new URL(c.req.url).origin)}</div>`;
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
            <div>${button('Add Tradie')}</div>
          </form>
        `,
      })}
    `,
  });
}

// 5 First Property

/**
 * The form as the core's addPropertyWithPeople takes it, with the one check the
 * core can't make: reading the Max Repair Cost as dollars. An unreadable amount
 * goes in as NaN, so the core refuses it too and every other field is still checked.
 */
function readPropertyForm(form: FormValues, myId: number): { input: PropertyWithPeopleInput; errors: Errors } {
  const errors: Errors = {};
  let maxRepairCostCents = Number.NaN;
  if (!text(form, 'maxRepairCost')) errors.maxRepairCost = 'Enter the Max Repair Cost';
  else {
    try {
      maxRepairCostCents = cents(form, 'maxRepairCost', 'the Max Repair Cost');
    } catch {
      errors.maxRepairCost = 'Enter the Max Repair Cost in dollars, like 500';
    }
  }
  const buildingManager = contactFrom(form, 'buildingManager');
  return {
    errors,
    input: {
      address: text(form, 'address'),
      suburb: text(form, 'suburb'),
      maxRepairCostCents,
      propertyManagerId: Number(text(form, 'propertyManagerId') || myId),
      nominatedTradieIds: list(form, 'nominatedTradieIds').map(Number),
      owner: contactFrom(form, 'owner'),
      // The Building Manager is optional: left blank, there is none.
      buildingManager: buildingManager.name || buildingManager.mobile || buildingManager.email ? buildingManager : null,
      tenants: [{ ...contactFrom(form, 'tenant'), tenancyStart: text(form, 'tenancyStart') }],
    },
  };
}

/** The form's name for a field the core names: "owner.mobile" -> "ownerMobile", "tenants.0.name" -> "tenantName". */
function formField(field: string): string {
  if (field === 'maxRepairCostCents') return 'maxRepairCost';
  const [scope, ...rest] = field.split('.');
  if (scope === 'tenants') return rest[1] === 'tenancyStart' ? 'tenancyStart' : scoped('tenant', rest[1] ?? 'name');
  return rest[0] ? scoped(scope, rest[0]) : field;
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
        ? await propertyForm(actions, pm.id, o)
        : html`<p>${linkButton('Add another Property', '/welcome/property?another#add-property', { variant: 'secondary' })}</p>`}
    `,
  });
}

async function propertyForm(actions: Actions, myId: number, o: { values?: Values; errors?: Errors; message?: string }): Promise<Html> {
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
        ? choiceGroup({
            legend: 'Nominated Tradies (optional)',
            name: 'nominatedTradieIds',
            type: 'checkbox',
            options: tradies.map((t) => ({ value: String(t.id), label: `${t.businessName ?? t.name} (${t.trades.map(humanise).join(', ')})` })),
            checked: Array.isArray(nominated) ? nominated : nominated ? [nominated] : [],
            hint: 'Who the Tenant can call for an Urgent Repair.',
            error: errors.nominatedTradieIds,
          })
        : html`<p class="text-sm text-muted">Add Tradies in the Tradies step to nominate them for Urgent Repairs.</p>`}
      <div>${button('Add the Property')}</div>
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
  const progress = await setupProgress(actions);
  const agency = actions.agency();
  const team = await actions.propertyManagers();
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
      return {
        done: !!current?.testedAt,
        text: current ? (current.testedAt ? `${ch.name} connected to ${current.address} and tested` : `${ch.name} connected to ${current.address}, not tested yet`) : `${ch.name} not connected`,
        fix: [current ? 'Send a test message' : `Connect ${ch.name}`, ch.type === 'email' ? '/welcome#email' : `/welcome/channels#${ch.type}`] as [string, string],
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
    title: finished ? "You're set up" : 'Nearly there',
    progress,
    body: html`
      <p>
        ${finished
          ? `${agency.name} is ready for its first maintenance message. Here's what's set up.`
          : `A few things are still to do before Tenants' messages can reach you. You can finish them now or come back later.`}
      </p>
      ${card({
        title: 'Your setup',
        body: html`<ul class="space-y-1" aria-label="Setup checklist">
          ${items.map(
            (item) => html`<li class="flex items-center gap-3 text-sm">
              <span class="${item.done ? 'text-done' : 'text-muted'} w-4 shrink-0 text-center font-semibold" aria-hidden="true">${item.done ? '✓' : '–'}</span>
              <span class="sr-only">${item.done ? 'Done: ' : 'To do: '}</span>
              <span class="min-w-0 flex-1">${item.text}</span>
              ${!item.done && item.fix ? linkButton(item.fix[0], item.fix[1], { size: 'sm' }) : ''}
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
