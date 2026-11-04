// The server's one WhatsApp number (Meta's WhatsApp Cloud API, ADR 0019): the component
// the welcome wizard's Channels step, Setup and Settings all show, and the routes its
// buttons post to. Modelled on the server's SMS phone (server-sms.ts). The number arrives
// through ChannelConnectors; the pages never read the environment. Connecting needs no
// code: the number is the server's, so a code sent to it would only reach the server.

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError, normalizeAddress } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import type { FormValues } from '../forms.ts';
import { badge, button, withFlash, type Html } from '../ui.ts';
import { spokenNumber } from './server-sms.ts';

type Actions = PropertyManagerActions;
type AgencyChannel = Awaited<ReturnType<Actions['channels']>>[number];
type Origin = 'welcome' | 'setup' | 'settings';

const originOf = (value: unknown): Origin => (value === 'welcome' || value === 'settings' ? value : 'setup');
const backTo = (from: Origin) =>
  from === 'welcome' ? '/welcome/channels?channel=whatsapp' : from === 'settings' ? '/settings?tab=channels' : '/setup?form=channels';
const anchor = '#whatsapp';

/** WhatsApp's 24-hour rule, as one short hint under the panel. */
export const WHATSAPP_WINDOW_HINT = 'Tenants message first; replies are free for 24 hours, then myEST8 uses SMS or email.';

/** True when the Agency's WhatsApp channel is already this server's number. */
function holds(current: string | undefined, number: string): boolean {
  return current !== undefined && normalizeAddress(current) === normalizeAddress(number);
}

/** WhatsApp's chip: not offered here, connected (proved: the number is the server's), or not connected yet. Optional, so never a warning. */
export function whatsappChip(number: string | null, current: AgencyChannel | undefined, o: { outline?: boolean } = {}): Html {
  if (number === null) return badge('Not available here', 'neutral', { wrap: true, outline: o.outline });
  if (current && holds(current.address, number)) return badge('Connected', 'success', { wrap: true });
  return badge('Not connected', 'neutral', { wrap: true, outline: o.outline });
}

/**
 * Not set up on this server: Connect WhatsApp, disabled, with the reason. Not connected: the
 * number Tenants message, and Connect WhatsApp. Connected: the number and Disconnect.
 * `current` is the Agency's WhatsApp address on file, if it has one. `outline` is for a chip straight on the Sand page.
 */
export function serverWhatsappPanel(o: { from: Origin; number: string | null; current?: string | undefined }): Html {
  const hint = html`<p class="mt-2 text-sm text-muted" data-whatsapp-window>${WHATSAPP_WINDOW_HINT}</p>`;
  if (o.number === null) {
    return html`<div data-server-whatsapp="unavailable">
      ${button('Connect WhatsApp', { variant: 'secondary', size: 'sm', type: 'button', disabled: true })}
      <p class="mt-2 text-sm text-muted" data-whatsapp-unavailable>WhatsApp isn't set up on this server yet, so it can't be connected.</p>
      ${hint}
    </div>`;
  }
  const shown = spokenNumber(o.number);
  if (holds(o.current, o.number)) {
    return html`<div data-server-whatsapp="connected">
      <p class="text-sm"><strong class="break-all">${shown}</strong> is the Agency's WhatsApp number. Tenants message it, and myEST8 replies from it.</p>
      ${hint}
      <form method="post" action="/server-whatsapp/disconnect" class="mt-3">
        <input type="hidden" name="from" value="${o.from}" />
        ${button('Disconnect', { variant: 'secondary', size: 'sm' })}
      </form>
    </div>`;
  }
  return html`<div data-server-whatsapp="none">
    <p class="text-sm">Tenants message <strong>${shown}</strong> on WhatsApp. This is the server's WhatsApp number.</p>
    ${hint}
    <form method="post" action="/server-whatsapp/connect" class="mt-3">
      <input type="hidden" name="from" value="${o.from}" />
      ${button('Connect WhatsApp', { variant: 'primary', size: 'sm' })}
    </form>
  </div>`;
}

/** The routes the component's buttons post to. Mounted only when the server has a WhatsApp number. */
export function serverWhatsappPages(number: string) {
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
      await actions.connectServerWhatsapp(number);
      return `${spokenNumber(number)} is now the Agency's WhatsApp number. Tenants can message it.`;
    }),
  );

  pages.post('/disconnect', (c) =>
    act(c, async (actions) => {
      await actions.disconnectServerWhatsapp(number);
      return 'The Agency has no WhatsApp number now.';
    }),
  );

  return pages;
}
