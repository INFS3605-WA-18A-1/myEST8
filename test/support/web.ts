import { generateKeyPairSync } from 'node:crypto';
import type { DemoControls } from '../../src/demo/controls.ts';
import type { ChannelConnectors } from '../../src/web/connectors.ts';
import { createSessions } from '../../src/web/auth.ts';
import { createWebApp } from '../../src/web/server.ts';
import { PASSWORD, world } from './world.ts';

/** A new Agency's complete, valid sign-up form, with `changes` applied. */
export function signUpFields(changes: Record<string, string> = {}) {
  return {
    name: 'Sam Sun',
    email: 'sam@sunrise.example',
    password: 'sunrise-2026',
    confirmPassword: 'sunrise-2026',
    agencyName: 'Sunrise Realty',
    timeZone: 'Australia/Brisbane',
    ...changes,
  };
}

/** A page's visible text: tags dropped, entities decoded, spaces collapsed. */
export function visible(page: string) {
  return page
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** The green confirmed block on a no-login page (`doneBox`), as visible text, or null when there is none. */
export function confirmedBlock(page: string) {
  const block = /<div role="status" class="tenant-done">([\s\S]*?)<\/div>/.exec(page);
  return block ? visible(block[1]!).trim() : null;
}

/** Each button on a page by its visible label, and whether it is disabled. */
export function buttonsOn(page: string) {
  return [...page.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ label: visible(m[2]!).trim(), disabled: /\sdisabled\b/.test(m[1]!) }));
}

/** The standard world behind the web app, with helpers to sign in and click through pages. */
export async function webWorld(
  options: { demo?: DemoControls; connectors?: ChannelConnectors; composer?: null; composeEmails?: boolean; smsNumbers?: NonNullable<Parameters<typeof world>[0]>['smsNumbers'] } = {},
) {
  const w = await world({
    ...(options.composer === null ? { composer: null } : {}),
    ...(options.composeEmails ? { composeEmails: true } : {}),
    ...(options.smsNumbers ? { smsNumbers: options.smsNumbers } : {}),
  });
  const web = createWebApp({
    app: w.h.app,
    sessions: createSessions(w.h.db, w.h.clock),
    clock: w.h.clock,
    publicUrl: 'https://myest8.test',
    twilioAuthToken: 'test-token',
    sendgridPublicKey: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    demo: options.demo,
    ...(options.connectors ? { connectors: options.connectors } : {}),
  });

  /** Signs in and returns the session cookie to pass to `get` and `post`. */
  async function signIn(email = 'alice@harbour.example', password = PASSWORD) {
    const res = await web.request('/login', { method: 'POST', body: new URLSearchParams({ email, password }) });
    const cookie = res.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error(`Sign-in failed for ${email}: ${res.status}`);
    return cookie;
  }

  async function get(path: string, cookie?: string) {
    return web.request(path, { headers: cookie ? { cookie } : {} });
  }

  /** Posts a form, then lets the background worker catch up. Arrays post repeated fields. */
  async function post(path: string, fields: Record<string, string | number | (string | number)[]>, cookie?: string) {
    const body = new URLSearchParams();
    for (const [name, value] of Object.entries(fields)) {
      for (const v of Array.isArray(value) ? value : [value]) body.append(name, String(v));
    }
    const res = await web.request(path, { method: 'POST', body, headers: cookie ? { cookie } : {} });
    await w.h.drain();
    return res;
  }

  /** Signs a new Agency up through /signup and returns its first Property Manager's session cookie. */
  async function signUp(changes: Record<string, string> = {}) {
    const res = await web.request('/signup', { method: 'POST', body: new URLSearchParams(signUpFields(changes)) });
    const cookie = res.headers.get('set-cookie')?.split(';')[0];
    if (res.status !== 303 || !cookie) throw new Error(`Sign-up failed: ${res.status}`);
    return cookie;
  }

  return { ...w, web, signIn, signUp, get, post };
}
