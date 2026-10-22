// The server's one SMS phone (textbee, ADR 0013): the component the welcome
// wizard's Channels step, Setup and Settings all show, and the routes its
// buttons post to. The number arrives through ChannelConnectors. The pages
// never read the environment. Connecting needs no code: the phone is the server's.

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError, normalizeAddress } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import type { FormValues } from '../forms.ts';
import { button, withFlash, type Html } from '../ui.ts';

type Actions = PropertyManagerActions;
type Origin = 'welcome' | 'setup' | 'settings';

const originOf = (value: unknown): Origin => (value === 'welcome' || value === 'settings' ? value : 'setup');
const backTo = (from: Origin) => (from === 'welcome' ? '/welcome/channels?channel=sms' : from === 'settings' ? '/settings?tab=channels' : '/setup?form=channels');
const anchor = '#sms';

/** "+61412345678" as "+61 412 345 678". Any other number is shown as stored. */
function spokenSmsNumber(number: string): string {
  const e164 = normalizeAddress(number);
  const match = /^\+61(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return match ? `+61 ${match[1]} ${match[2]} ${match[3]}` : e164;
}

/** True when the Agency's SMS channel is already this server's phone. */
function holds(current: string | undefined, number: string): boolean {
  return current !== undefined && normalizeAddress(current) === normalizeAddress(number);
}

/**
 * Not connected: who Tenants text, and Connect SMS. Connected: the number and Disconnect.
 * `current` is the Agency's SMS address on file, if it has one.
 */
export function serverSmsPanel(o: { from: Origin; number: string; current?: string | undefined }): Html {
  const shown = spokenSmsNumber(o.number);
  if (holds(o.current, o.number)) {
    return html`<div data-server-sms="connected">
      <p class="text-sm"><strong class="break-all">${shown}</strong> is the Agency's SMS number. Tenants text it, and myEST8 replies from it.</p>
      <form method="post" action="/server-sms/disconnect" class="mt-3">
        <input type="hidden" name="from" value="${o.from}" />
        ${button('Disconnect', { variant: 'secondary', size: 'sm' })}
      </form>
    </div>`;
  }
  return html`<div data-server-sms="none">
    <p class="text-sm">Tenants text <strong>${shown}.</strong> This is the server's SMS phone.</p>
    <form method="post" action="/server-sms/connect" class="mt-3">
      <input type="hidden" name="from" value="${o.from}" />
      ${button('Connect SMS', { variant: 'primary', size: 'sm' })}
    </form>
  </div>`;
}

/** The routes the component's buttons post to. Mounted only when the server has a phone. */
export function serverSmsPages(number: string) {
  const pages = new Hono<WebEnv>();

  /** Runs `action` and goes back to where the component was, with its message. */
  async function act(c: Context<WebEnv>, action: (actions: Actions) => Promise<string>) {
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const back = backTo(originOf(form.from));
    try {
      return c.redirect(`${withFlash(back, 'ok', await action(c.var.actions))}${anchor}`, 303);
    } catch (error) {
      if (error instanceof ActionError) return c.redirect(`${withFlash(back, 'error', error.message)}${anchor}`, 303);
      throw error;
    }
  }

  pages.post('/connect', (c) =>
    act(c, async (actions) => {
      await actions.connectServerSms(number);
      return `${spokenSmsNumber(number)} is now the Agency's SMS number. Tenants can text it.`;
    }),
  );

  pages.post('/disconnect', (c) =>
    act(c, async (actions) => {
      await actions.disconnectServerSms(number);
      return 'The Agency has no SMS number now.';
    }),
  );

  return pages;
}
