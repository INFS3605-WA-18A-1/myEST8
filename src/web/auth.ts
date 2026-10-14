// Property Manager sign-in: sessions kept in the database, the sign-in page,
// and the guard in front of every signed-in page. Only Property Managers have
// accounts (ADR-0002).

import { createHash, randomBytes } from 'node:crypto';
import { Hono, type Context as HonoContext, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { html } from 'hono/html';
import type { App } from '../app.ts';
import { one, run, type Db } from '../db.ts';
import type { Clock } from '../ports.ts';
import { iso } from '../shared.ts';
import type { WebEnv } from './env.ts';
import { authPage, otherWay } from './auth-card.ts';
import { button, field, linkButton, type Flash } from './ui.ts';

/** The session cookie's name. */
export const SESSION_COOKIE = 'myest8_session';

/** A session ends after this long without a request. */
const SESSION_IDLE_MS = 12 * 3_600_000;

/** Only the token's hash is stored, so a copy of the database can't be used to sign in. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

/** Signed-in Property Manager sessions, stored in the `sessions` table. Each one slides 12 hours from its last use. */
export function createSessions(db: Db, clock: Clock) {
  const expiry = () => iso(new Date(clock.now().getTime() + SESSION_IDLE_MS));

  return {
    /** Starts a session for a Property Manager and returns its token for the cookie. */
    async start(propertyManagerId: number): Promise<string> {
      const now = iso(clock.now());
      await run(db, 'DELETE FROM sessions WHERE expires_at <= ?', now);
      const token = randomBytes(32).toString('base64url');
      await run(
        db,
        'INSERT INTO sessions (token_hash, property_manager_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
        hashToken(token),
        propertyManagerId,
        now,
        expiry(),
      );
      return token;
    },

    /** The Property Manager signed in with this token, or null when it is unknown or expired. Extends the session. */
    async find(token: string): Promise<number | null> {
      if (!token) return null;
      const hash = hashToken(token);
      const row = await one<{ property_manager_id: number; expires_at: string }>(
        db,
        'SELECT property_manager_id, expires_at FROM sessions WHERE token_hash = ?',
        hash,
      );
      if (!row) return null;
      if (row.expires_at <= iso(clock.now())) {
        await run(db, 'DELETE FROM sessions WHERE token_hash = ?', hash);
        return null;
      }
      await run(db, 'UPDATE sessions SET expires_at = ? WHERE token_hash = ?', expiry(), hash);
      return row.property_manager_id;
    },

    /** Signs the session out. */
    async end(token: string) {
      await run(db, 'DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
    },
  };
}
export type Sessions = ReturnType<typeof createSessions>;

/** GET/POST /login and POST /logout. */
export function authRoutes(app: App, sessions: Sessions) {
  const routes = new Hono();

  routes.get('/login', async (c) => {
    const next = safeNext(c.req.query('next'));
    if ((await signedInId(app, sessions, c)) !== null) return c.redirect(next, 303);
    return c.html(signInPage({ next }));
  });

  routes.post('/login', async (c) => {
    if (!sameOrigin(c)) return c.text('Cross-site request refused', 403);
    const form = await c.req.parseBody();
    const email = String(form.email ?? '').trim();
    const password = String(form.password ?? '');
    const next = safeNext(String(form.next ?? ''));
    const propertyManagerId = email && password ? await app.login(email, password) : null;
    if (propertyManagerId === null) {
      return c.html(signInPage({ next, email, flash: { kind: 'error', message: 'That email and password don’t match. Try again.' } }), 401);
    }
    await startSession(c, sessions, propertyManagerId);
    return c.redirect(next, 303);
  });

  routes.post('/logout', async (c) => {
    if (!sameOrigin(c)) return c.text('Cross-site request refused', 403);
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await sessions.end(token);
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isHttps(c) });
    return c.redirect('/login', 303);
  });

  return routes;
}

/**
 * Lets a request through only with a valid session; sets `pm` and `actions`.
 * Otherwise a GET is redirected to /login and anything else gets 401. A
 * state-changing request whose Origin (or Referer) is another site gets 403.
 */
export function requirePropertyManager(app: App, sessions: Sessions): MiddlewareHandler<WebEnv> {
  return async (c, next) => {
    const reading = c.req.method === 'GET' || c.req.method === 'HEAD';
    if (!reading && !sameOrigin(c)) return c.text('Cross-site request refused', 403);
    const propertyManagerId = await signedInId(app, sessions, c);
    if (propertyManagerId === null) {
      if (!reading) return c.text('Sign in to continue', 401);
      const { pathname, search } = new URL(c.req.url);
      return c.redirect(`/login?next=${encodeURIComponent(pathname + search)}`, 303);
    }
    const actions = await app.asPropertyManager(propertyManagerId);
    c.set('pm', actions.me());
    c.set('actions', actions);
    await next();
  };
}

/** Signs a Property Manager in: starts a session and sets its HttpOnly cookie on the response. */
export async function startSession(c: HonoContext, sessions: Sessions, propertyManagerId: number) {
  setCookie(c, SESSION_COOKIE, await sessions.start(propertyManagerId), {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: isHttps(c),
  });
}

/** The signed-in Property Manager's id, or null. A session for a Property Manager who no longer exists counts as signed out. */
export async function signedInId(app: App, sessions: Sessions, c: HonoContext): Promise<number | null> {
  const token = getCookie(c, SESSION_COOKIE);
  const id = token ? await sessions.find(token) : null;
  if (id === null) return null;
  try {
    await app.asPropertyManager(id);
    return id;
  } catch {
    await sessions.end(token!);
    return null;
  }
}

/** Where to go after signing in: a path on this site, never another site. */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || /[\u0000-\u001f\\]/.test(next)) return '/';
  if (next === '/login' || next.startsWith('/login?') || next === '/logout') return '/';
  return next;
}

function isHttps(c: HonoContext) {
  return new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https';
}

/**
 * False when the browser says the request came from another site. Browsers send
 * Origin on cross-site form posts; Referer is the fallback. Neither present is let through.
 */
export function sameOrigin(c: HonoContext): boolean {
  const source = c.req.header('origin') ?? c.req.header('referer');
  if (!source) return true;
  let sourceHost: string;
  try {
    sourceHost = new URL(source).host;
  } catch {
    return false; // "null" or garbage
  }
  const hosts = [new URL(c.req.url).host, c.req.header('host'), c.req.header('x-forwarded-host')?.split(',')[0]?.trim()];
  return hosts.some((host) => !!host && host.toLowerCase() === sourceHost.toLowerCase());
}

function signInPage(o: { next: string; email?: string; flash?: Flash }) {
  return authPage({
    title: 'Sign in to myEST8',
    subtitle: 'For Property Managers. Tenants, Tradies and Property Owners never need an account.',
    flash: o.flash ?? null,
    size: 'login',
    footer: SIGNED_OUT_FOOTER,
    form: html`<form method="post" action="/login" class="au-form">
        <input type="hidden" name="next" value="${o.next}" />
        ${field({ label: 'Email', name: 'email', type: 'email', value: o.email ?? '', required: true, autocomplete: 'username' })}
        ${field({ label: 'Password', name: 'password', type: 'password', required: true, autocomplete: 'current-password' })}
        ${button('Sign in', { size: 'lg', block: true })}
      </form>
      ${otherWay({ text: 'New to myEST8?', button: linkButton('Create your Agency’s account', '/signup', { variant: 'secondary', block: true }) })}`,
    steps: [
      { text: 'Your dashboard lists each Maintenance Request waiting for your decision.', request: true },
      { text: 'Confirm one and it becomes a Ticket.' },
      { text: 'Quotes come back from Tradies for you to choose between.' },
    ],
  });
}

/** The footer on the pages a signed-out Property Manager sees. */
export const SIGNED_OUT_FOOTER = 'myEST8, maintenance for small property management Agencies';
