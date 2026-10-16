// Connecting an Agency's Gmail by OAuth (ADR 0004): the round trip to Google and
// back, plus the controls the Channels step and Setup show for it. The session
// cookie is SameSite=Lax, so it comes back on Google's redirect (a top-level GET).

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { html } from 'hono/html';
import { ActionError } from '../../shared.ts';
import type { GmailConnector } from '../connectors.ts';
import type { WebEnv } from '../env.ts';
import { button, linkButton, withFlash, type Html } from '../ui.ts';

const STATE_COOKIE = 'google_oauth_state';

type Origin = 'welcome' | 'setup';

const backTo = (from: Origin) => (from === 'welcome' ? '/welcome/channels' : '/setup');
const anchor = '#email';

export function googleOAuthPages(gmail: GmailConnector) {
  const pages = new Hono<WebEnv>();

  pages.get('/start', (c) => {
    const from: Origin = c.req.query('from') === 'welcome' ? 'welcome' : 'setup';
    const state = `${randomBytes(24).toString('base64url')}.${from}`;
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/oauth/google',
      maxAge: 600,
      secure: new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https',
    });
    return c.redirect(gmail.authUrl(state), 302);
  });

  pages.get('/callback', async (c) => {
    const expected = getCookie(c, STATE_COOKIE) ?? '';
    deleteCookie(c, STATE_COOKIE, { path: '/oauth/google' });
    const given = c.req.query('state') ?? '';
    const from: Origin = expected.endsWith('.welcome') ? 'welcome' : 'setup';
    const back = (kind: 'ok' | 'error', message: string) => c.redirect(`${withFlash(backTo(from), kind, message)}${anchor}`, 303);

    const sameState = expected.length > 0 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!sameState) return back('error', 'That Gmail connection expired. Choose Connect Gmail to try again.');
    if (c.req.query('error') === 'access_denied') return back('error', 'Gmail was not connected because access was declined.');
    const code = c.req.query('code');
    if (!code) return back('error', 'Google did not send back a code. Choose Connect Gmail to try again.');

    try {
      const { address } = await gmail.connect(c.var.actions.agency().id, code);
      await c.var.actions.connectChannel('email', address);
      return back('ok', `Gmail connected to ${address}. Mail sent to it now becomes Maintenance Requests.`);
    } catch (error) {
      if (error instanceof ActionError) return back('error', error.message);
      console.error('Gmail connect failed', error);
      return back('error', 'Gmail could not be connected. Try again.');
    }
  });

  pages.post('/disconnect', async (c) => {
    await gmail.disconnect(c.var.actions.agency().id);
    const from: Origin = (await c.req.parseBody()).from === 'welcome' ? 'welcome' : 'setup';
    return c.redirect(`${withFlash(backTo(from), 'ok', 'Gmail disconnected.')}${anchor}`, 303);
  });

  return pages;
}

/** The email channel's Gmail controls, in place of the SendGrid instructions. */
export async function gmailControls(gmail: GmailConnector, agencyId: number, from: Origin): Promise<Html> {
  const status = await gmail.status(agencyId);
  const start = `/oauth/google/start?from=${from}`;
  if (!status) {
    return html`<div class="mt-2">
      <p class="mb-2 text-sm">Sign in with the Google account Tenants write to. myEST8 reads new mail there and replies from it.</p>
      ${linkButton('Connect Gmail', start, { variant: 'secondary', size: 'sm' })}
    </div>`;
  }
  const disconnect = html`<form method="post" action="/oauth/google/disconnect">
    <input type="hidden" name="from" value="${from}" />
    ${button('Disconnect', { variant: 'ghost', size: 'sm' })}
  </form>`;
  if (status.status === 'reconnect') {
    return html`<div class="mt-2">
      <p class="mb-2 text-sm">Google stopped accepting the saved sign-in for ${status.address}, so new mail isn't being read.</p>
      <div class="flex flex-wrap items-center gap-3">${linkButton('Reconnect Gmail', start, { variant: 'primary', size: 'sm' })}${disconnect}</div>
    </div>`;
  }
  return html`<div class="mt-2 flex flex-wrap items-center gap-3">
    <p class="text-sm">Connected to ${status.address}</p>
    ${disconnect}
  </div>`;
}
