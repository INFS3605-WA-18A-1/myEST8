// Connecting the Agency's Gmail from Settings: send the Property Manager to Google,
// and finish when Google sends them back (docs/adr/0004). The state and the PKCE
// verifier wait in short-lived HttpOnly cookies, and the routes sit behind sign-in,
// so only the browser that started a sign-in can finish it.

import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { WebEnv } from './env.ts';
import { safeNext } from './auth.ts';
import { withFlash } from './ui.ts';

const PATH = '/oauth/google';
const MAX_AGE_SECONDS = 600;
const DEFAULT_RETURN = '/setup';

const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function googleOAuthRoutes(o: { publicUrl: string }) {
  const routes = new Hono<WebEnv>();
  const redirectUri = `${o.publicUrl.replace(/\/$/, '')}${PATH}/callback`;
  const cookie = (secure: boolean) => ({ httpOnly: true, sameSite: 'Lax' as const, path: PATH, secure });
  const isHttps = (url: string, proto: string | undefined) => new URL(url).protocol === 'https:' || proto?.split(',')[0]?.trim() === 'https';

  routes.get('/start', (c) => {
    const begun = c.var.actions.beginGmail(redirectUri);
    if (!begun) return c.text('Gmail is not set up on this server.', 404);
    const options = { ...cookie(isHttps(c.req.url, c.req.header('x-forwarded-proto'))), maxAge: MAX_AGE_SECONDS };
    const back = c.req.query('return');
    setCookie(c, 'oauth_state', begun.state, options);
    setCookie(c, 'oauth_verifier', begun.codeVerifier, options);
    setCookie(c, 'oauth_return', back && safeNext(back) !== '/' ? safeNext(back) : DEFAULT_RETURN, options);
    return c.redirect(begun.url, 303);
  });

  routes.get('/callback', async (c) => {
    const state = getCookie(c, 'oauth_state');
    const codeVerifier = getCookie(c, 'oauth_verifier');
    const back = safeNext(getCookie(c, 'oauth_return')) === '/' ? DEFAULT_RETURN : safeNext(getCookie(c, 'oauth_return'));
    const clear = cookie(isHttps(c.req.url, c.req.header('x-forwarded-proto')));
    for (const name of ['oauth_state', 'oauth_verifier', 'oauth_return']) deleteCookie(c, name, clear);

    const returned = c.req.query('state');
    if (!state || !codeVerifier || !returned || !sameText(state, returned)) return c.text('The Google sign-in could not be verified. Go back to Settings and connect Gmail again.', 400);

    const denied = c.req.query('error');
    if (denied) {
      const message = denied === 'access_denied' ? 'You did not allow access, so Gmail was not connected.' : 'Google did not connect Gmail. Try again.';
      return c.redirect(withFlash(back, 'error', message), 303);
    }
    const code = c.req.query('code');
    if (!code) return c.text('Google did not send a sign-in code.', 400);

    try {
      const address = await c.var.actions.connectGmail({ code, codeVerifier, redirectUri });
      return c.redirect(withFlash(back, 'ok', `Gmail connected: ${address} is now the Agency inbox.`), 303);
    } catch (error) {
      return c.redirect(withFlash(back, 'error', error instanceof Error ? error.message : 'Gmail could not be connected. Try again.'), 303);
    }
  });

  return routes;
}
