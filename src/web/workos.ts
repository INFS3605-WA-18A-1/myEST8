// Signing in through WorkOS AuthKit (ADR 0020). /login sends the browser to
// AuthKit's hosted page, the one page for signing in and signing up. /callback
// matches the verified email to a Property Manager and starts the same database
// session a password sign-in did. An email with no Property Manager is someone
// new: /signup asks them for their Agency, then signs them in.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono, type Context as HonoContext } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { html } from 'hono/html';
import type { AuthKit } from '../adapters/workos.ts';
import type { App } from '../app.ts';
import { authPage } from './auth-card.ts';
import { SIGNED_OUT_FOOTER, isHttps, safeNext, signedInId, startSession, type Sessions } from './auth.ts';
import { linkButton } from './ui.ts';

/** Carries a sign-in's state and where to go after it, from /login to /callback. */
const STATE_COOKIE = 'myest8_authkit_state';
/** The AuthKit session id, so signing out ends the AuthKit session too. */
const SID_COOKIE = 'myest8_authkit_sid';
/** Someone AuthKit signed in who has no Property Manager yet, while they name their Agency. */
const SIGNUP_COOKIE = 'myest8_signup';
/** How long someone has to finish naming their Agency. */
const SIGNUP_MAX_AGE_S = 30 * 60;

/** Someone AuthKit has signed in who is creating their Agency. */
export type PendingSignUp = { email: string; name: string; sessionId: string | null };

/**
 * GET /login, which goes to AuthKit (and is WorkOS's Initiate login URI), and GET /callback,
 * which is `publicUrl`/callback, registered as a Redirect URI in WorkOS.
 */
export function authKitRoutes(app: App, sessions: Sessions, authKit: AuthKit, publicUrl: string) {
  const redirectUri = `${publicUrl.replace(/\/$/, '')}/callback`;
  const routes = new Hono();

  routes.get('/login', async (c) => {
    const next = safeNext(c.req.query('next'));
    if ((await signedInId(app, sessions, c)) !== null) return c.redirect(next, 303);
    const state = randomBytes(16).toString('base64url');
    setCookie(c, STATE_COOKIE, `${state}|${next}`, cookieOptions(c, 600));
    // A sign-in started outside myEST8 (an invitation or a password-reset email) carries these through.
    const loginHint = c.req.query('login_hint');
    const invitationToken = c.req.query('invitation_token');
    const url = authKit.signInUrl({
      state,
      redirectUri,
      ...(c.req.query('screen') === 'sign-up' ? { screenHint: 'sign-up' as const } : {}),
      ...(loginHint ? { loginHint } : {}),
      ...(invitationToken ? { invitationToken } : {}),
    });
    return c.redirect(url, 302);
  });

  routes.get('/callback', async (c) => {
    const [expected, next] = splitState(getCookie(c, STATE_COOKIE));
    deleteCookie(c, STATE_COOKIE, { path: '/', secure: isHttps(c) });
    const code = c.req.query('code');
    if (!code || !expected || c.req.query('state') !== expected) return c.html(problemPage('That sign-in didn’t finish. Try again.'), 400);

    let user;
    try {
      user = await authKit.authenticate(code);
    } catch {
      return c.html(problemPage('WorkOS couldn’t confirm that sign-in. Try again.'), 401);
    }
    if (!user.emailVerified) return c.html(problemPage(`Confirm ${user.email} from the email WorkOS sent, then sign in again.`), 403);

    const propertyManagerId = await app.loginByVerifiedEmail(user.email);
    if (propertyManagerId === null) {
      setCookie(c, SIGNUP_COOKIE, seal(authKit.secret, { email: user.email, name: user.name, sessionId: user.sessionId }), cookieOptions(c, SIGNUP_MAX_AGE_S));
      return c.redirect('/signup', 303);
    }
    await startAuthKitSession(c, sessions, propertyManagerId, user.sessionId);
    return c.redirect(next, 303);
  });

  return routes;
}

/** The person creating their Agency, from the cookie /callback set, or null when there is none or it has expired. */
export function pendingSignUp(c: HonoContext, authKit: AuthKit): PendingSignUp | null {
  return unseal(authKit.secret, getCookie(c, SIGNUP_COOKIE));
}

/** Signs in a Property Manager AuthKit vouched for, remembering the AuthKit session for sign-out. Clears a pending sign-up. */
export async function startAuthKitSession(c: HonoContext, sessions: Sessions, propertyManagerId: number, sessionId: string | null) {
  deleteCookie(c, SIGNUP_COOKIE, { path: '/', secure: isHttps(c) });
  await startSession(c, sessions, propertyManagerId);
  if (sessionId) setCookie(c, SID_COOKIE, sessionId, cookieOptions(c));
}

/** Where /logout sends someone who signed in through AuthKit, ending that session too; null otherwise. */
export function authKitSignOutUrl(c: HonoContext, authKit: AuthKit | null): string | null {
  const sessionId = getCookie(c, SID_COOKIE);
  deleteCookie(c, SID_COOKIE, { path: '/', secure: isHttps(c) });
  return authKit && sessionId ? authKit.signOutUrl(sessionId) : null;
}

function cookieOptions(c: HonoContext, maxAge?: number) {
  return { httpOnly: true, sameSite: 'Lax' as const, path: '/', secure: isHttps(c), ...(maxAge ? { maxAge } : {}) };
}

function splitState(cookie: string | undefined): [string | null, string] {
  const at = cookie?.indexOf('|') ?? -1;
  if (!cookie || at < 0) return [null, '/'];
  return [cookie.slice(0, at), safeNext(cookie.slice(at + 1))];
}

const sign = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('base64url');

/** A pending sign-up as a cookie value: its JSON with an expiry, then an HMAC, so it can't be made up or edited. */
function seal(secret: string, pending: PendingSignUp): string {
  const body = Buffer.from(JSON.stringify({ ...pending, exp: Date.now() + SIGNUP_MAX_AGE_S * 1000 })).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

function unseal(secret: string, value: string | undefined): PendingSignUp | null {
  const [body, mac] = value?.split('.') ?? [];
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { email, name, sessionId, exp } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof exp !== 'number' || exp < Date.now() || typeof email !== 'string') return null;
    return { email, name: typeof name === 'string' ? name : '', sessionId: typeof sessionId === 'string' ? sessionId : null };
  } catch {
    return null;
  }
}

/** A sign-in that couldn't finish: what happened, and a way to start again. */
function problemPage(message: string) {
  return authPage({
    title: 'Sign in to myEST8',
    subtitle: 'For Property Managers. Tenants, Tradies and Owners never need an account.',
    flash: { kind: 'error', message },
    size: 'login',
    footer: SIGNED_OUT_FOOTER,
    form: html`<div class="au-form">${linkButton('Try again', '/login', { variant: 'primary', size: 'lg', block: true })}</div>`,
    steps: [],
  });
}
