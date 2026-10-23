// An Agency's SMS number on Twilio (ADR 0005): the one component the welcome wizard's
// Channels step, Settings' Channels tab and Setup (where Settings' "Manage channels" goes)
// all show, and the routes its buttons post to.
// Two separate paths: create a new number (myEST8 buys it), or register a number from the
// Agency's own Twilio account. Both end with the number connected as the Agency's SMS channel.
// The routes are the same wherever the component sits; `from` says which page to go back to.

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { text, type FormValues } from '../forms.ts';
import { shellInfo } from '../shell.ts';
import { alert, button, field, linkButton, page, withFlash, type Html } from '../ui.ts';

type Actions = PropertyManagerActions;
type Origin = 'welcome' | 'setup' | 'settings';

const TWILIO_SIGN_UP = 'https://www.twilio.com/try-twilio';
const TWILIO_BUY_A_NUMBER = 'https://console.twilio.com/us1/develop/phone-numbers/manage/search';
const TWILIO_CONSOLE = 'https://console.twilio.com/';

const originOf = (value: unknown): Origin => (value === 'welcome' || value === 'settings' ? value : 'setup');
const backTo = (from: Origin) => (from === 'welcome' ? '/welcome/channels?channel=sms' : from === 'settings' ? '/settings?tab=channels' : '/setup?form=channels');
const anchor = '#sms';

const NAME = { created: 'created by myEST8', registered: 'your Twilio number' } as const;

/** The routes the component's buttons post to, mounted at /sms-number behind requirePropertyManager. */
export function smsNumberPages() {
  const pages = new Hono<WebEnv>();

  /** Reads the form, runs `action` and goes back to where the component was, with its message. */
  async function act(c: Context<WebEnv>, action: (form: FormValues, actions: Actions) => Promise<string>) {
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const back = backTo(originOf(form.from));
    try {
      return c.redirect(`${withFlash(back, 'ok', await action(form, c.var.actions))}${anchor}`, 303);
    } catch (error) {
      if (error instanceof ActionError) return c.redirect(`${withFlash(back, 'error', error.message)}${anchor}`, 303);
      throw error;
    }
  }

  pages.post('/create', (c) =>
    act(c, async (_form, actions) => {
      const number = await actions.createSmsNumber();
      return `${number} is now the Agency's SMS number. Tenants can text it.`;
    }),
  );

  pages.post('/account', (c) =>
    act(c, async (form, actions) => {
      const count = await actions.checkTwilioAccount(text(form, 'accountSid'), text(form, 'authToken'));
      return count ? 'Twilio accepted those details. Choose the number to use.' : 'Twilio accepted those details, but the account has no number that can send and receive texts.';
    }),
  );

  pages.post('/register', (c) =>
    act(c, async (form, actions) => {
      const sid = text(form, 'numberSid');
      if (!sid) throw new ActionError('invalid', 'Choose a number');
      const number = await actions.registerTwilioNumber(sid);
      return `${number} is now the Agency's SMS number. Its incoming texts go to myEST8.`;
    }),
  );

  // Releasing a number is asked about on a page of its own, which says what it costs and undoes.
  pages.get('/release', async (c) => {
    const from = originOf(c.req.query('from'));
    const status = await c.var.actions.smsNumber();
    if (!status?.number) return c.redirect(`${backTo(from)}${anchor}`, 303);
    const { kind, phoneNumber } = status.number;
    const created = kind === 'created';
    return c.html(
      page({
        title: created ? 'Release this SMS number?' : 'Disconnect this SMS number?',
        pm: c.var.pm,
        active: 'settings',
        shell: await shellInfo(c),
        body: html`<div class="max-w-xl">
          <p><strong>${phoneNumber}</strong> is ${c.var.actions.agency().name}'s SMS number.</p>
          ${created
            ? html`<p class="mt-3">Releasing it gives the number back to Twilio, which stops its monthly fee. Tenants can no longer text it, and
                the number can't be got back. You can create a new number afterwards, but it will be a different one.</p>`
            : html`<p class="mt-3">Disconnecting only unlinks it from myEST8. myEST8 stops pointing the number's incoming texts at itself, if it still
                does, and deletes the Twilio details it stored. The number stays on your Twilio account.</p>`}
          <form method="post" action="/sms-number/release" class="mt-5 flex flex-wrap items-center gap-3">
            <input type="hidden" name="from" value="${from}" />
            ${button(created ? 'Release this number' : 'Disconnect this number', { variant: 'danger' })}
            ${linkButton('Keep it', `${backTo(from)}${anchor}`, { variant: 'secondary' })}
          </form>
        </div>`,
      }),
    );
  });

  pages.post('/release', (c) =>
    act(c, async (_form, actions) => {
      const status = await actions.smsNumber();
      await actions.releaseSmsNumber();
      if (!status?.number) return 'Starting again: the Twilio details were forgotten.';
      return status.number.kind === 'created'
        ? `${status.number.phoneNumber} was released back to Twilio. The Agency has no SMS number now.`
        : `${status.number.phoneNumber} was disconnected from myEST8. It stays on your Twilio account.`;
    }),
  );

  return pages;
}

/** Whether this server sets up SMS numbers: the Channels pages show `smsNumberPanel` instead of the typed number and code. */
export async function smsNumbersOffered(actions: Actions): Promise<boolean> {
  return (await actions.smsNumber()) !== null;
}

/**
 * The SMS number component. Not connected: the two paths, each with its own button and a short
 * explanation. Mid-way through registering: the Twilio account's numbers to pick from. Connected:
 * the number, how it was set up, and a Disconnect button. `current` is a number already on file
 * that myEST8 doesn't manage (a typed one), which either path replaces.
 */
export async function smsNumberPanel(actions: Actions, o: { from: Origin; current?: string | undefined }): Promise<Html> {
  const status = await actions.smsNumber();
  if (!status) return html``;
  const { from } = o;

  if (status.number) {
    const { kind, phoneNumber } = status.number;
    return html`<div data-sms-number="${kind}">
      <p class="text-sm"><strong class="break-all">${phoneNumber}</strong> is the Agency's SMS number (${NAME[kind]}). Tenants, Tradies and Property Owners text it, and myEST8 replies from it.</p>
      <div class="mt-3">${linkButton(kind === 'created' ? 'Release this number' : 'Disconnect this number', `/sms-number/release?from=${from}`, { variant: 'secondary', size: 'sm' })}</div>
    </div>`;
  }

  if (status.choosing) return choosing(actions, status.choosing.accountSid, from);

  const { creation } = status;
  return html`<div data-sms-number="none">
    <p class="text-sm">Tenants text one number to reach the Agency. Choose how to get it.${o.current ? html` Either way replaces ${o.current}, the number on file now.` : ''}</p>
    <div class="mt-3 grid gap-4 md:grid-cols-2">
      <div class="section" data-sms-path="create">
        <div class="section-head"><h3 class="section-title">Create a new number</h3></div>
        <div class="section-body">
          <p class="text-sm">myEST8 buys an Australian mobile number for the Agency and connects it, with nothing to type or verify. Tenants text this new number. It costs the myEST8 platform a monthly fee.</p>
          <form method="post" action="/sms-number/create" class="mt-3">
            <input type="hidden" name="from" value="${from}" />
            ${button('Create a new number', { variant: 'primary', size: 'sm', disabled: !creation.ok })}
          </form>
          ${creation.ok ? '' : html`<p class="mt-2 text-sm text-muted" data-sms-create-unavailable>${creation.reason}</p>`}
        </div>
      </div>
      <div class="section" data-sms-path="register">
        <div class="section-head"><h3 class="section-title">Register a Twilio number</h3></div>
        <div class="section-body">
          <p class="text-sm">
            For an Agency that already has its own Twilio number. You need a Twilio account first:
            <a class="link" href="${TWILIO_SIGN_UP}" rel="noopener noreferrer">sign up for Twilio</a>. Then paste its Account SID and Auth Token from the
            <a class="link" href="${TWILIO_CONSOLE}" rel="noopener noreferrer">Twilio Console</a>. myEST8 checks them, lets you pick one of your numbers, and points its incoming
            texts at myEST8. Your Auth Token is stored encrypted.
          </p>
          <form method="post" action="/sms-number/account" class="mt-3 grid gap-3" autocomplete="off">
            <input type="hidden" name="from" value="${from}" />
            ${field({ label: 'Account SID', name: 'accountSid', id: `sms-account-sid-${from}`, required: true, placeholder: 'AC…', autocomplete: 'off' })}
            ${field({ label: 'Auth Token', name: 'authToken', id: `sms-auth-token-${from}`, type: 'password', required: true, autocomplete: 'off' })}
            <div>${button('Check my Twilio account', { variant: 'secondary', size: 'sm' })}</div>
          </form>
        </div>
      </div>
    </div>
  </div>`;
}

/** After the Agency's Twilio account is accepted: its SMS-capable numbers to choose from, or where to get one. */
async function choosing(actions: Actions, accountSid: string, from: Origin): Promise<Html> {
  let numbers: Awaited<ReturnType<Actions['twilioNumbers']>> | null = null;
  try {
    numbers = await actions.twilioNumbers();
  } catch (error) {
    if (!(error instanceof ActionError)) throw error;
    return html`<div data-sms-number="choosing">
      ${alert(error.message, 'warning')}
      <div class="mt-3">${startOver(from, 'Use different details')}</div>
    </div>`;
  }
  if (!numbers.length) {
    return html`<div data-sms-number="choosing">
      <p class="text-sm">Twilio accepted account <strong class="break-all">${accountSid}</strong>, but it has no number that can send and receive texts.
        <a class="link" href="${TWILIO_BUY_A_NUMBER}" rel="noopener noreferrer">Buy one in Twilio</a>, then check again.</p>
      <div class="mt-3 flex flex-wrap items-center gap-3">
        ${linkButton('Check again', `${backTo(from)}${anchor}`, { variant: 'secondary', size: 'sm' })}
        ${startOver(from, 'Use a different account')}
      </div>
    </div>`;
  }
  return html`<div data-sms-number="choosing">
    <form method="post" action="/sms-number/register">
      <input type="hidden" name="from" value="${from}" />
      <fieldset class="min-w-0">
        <legend class="field-label mb-1">Choose the number to use</legend>
        <p class="field-hint mb-2">From account ${accountSid}. myEST8 points its incoming texts at itself.</p>
        <div class="flex flex-col">
          ${numbers.map(
            (n, i) => html`<label class="flex cursor-pointer items-start gap-2 py-1 text-sm">
              <input type="radio" class="radio radio-primary radio-sm mt-0.5" name="numberSid" value="${n.sid}" required ${i === 0 ? 'checked' : ''} />
              <span><strong>${n.phoneNumber}</strong>${n.name && n.name !== n.phoneNumber ? html` <span class="text-muted">${n.name}</span>` : ''}</span>
            </label>`,
          )}
        </div>
      </fieldset>
      <div class="mt-3 flex flex-wrap items-center gap-3">${button('Use this number', { variant: 'primary', size: 'sm' })}</div>
    </form>
    <div class="mt-2">${startOver(from, 'Use a different account')}</div>
  </div>`;
}

/** Forgets the Twilio details given so far, so the two paths show again. */
function startOver(from: Origin, label: string): Html {
  return html`<form method="post" action="/sms-number/release" class="inline-flex">
    <input type="hidden" name="from" value="${from}" />
    ${button(label, { variant: 'ghost', size: 'sm' })}
  </form>`;
}
