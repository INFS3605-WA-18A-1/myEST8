import { generateKeyPairSync } from 'node:crypto';
import type { DemoControls } from '../../src/demo/controls.ts';
import type { SmsNumbers } from '../../src/ports.ts';
import { createSessions } from '../../src/web/auth.ts';
import type { ChannelModes } from '../../src/web/env.ts';
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

/** The standard world behind the web app, with helpers to sign in and click through pages. */
export async function webWorld(options: { demo?: DemoControls; gmailFetch?: typeof fetch; smsNumbers?: SmsNumbers; channels?: ChannelModes } = {}) {
  const w = await world({ ...(options.gmailFetch ? { gmailFetch: options.gmailFetch } : {}), ...(options.smsNumbers ? { smsNumbers: options.smsNumbers } : {}) });
  const web = createWebApp({
    app: w.h.app,
    sessions: createSessions(w.h.db, w.h.clock),
    clock: w.h.clock,
    publicUrl: 'https://myest8.test',
    twilioAuthToken: 'test-token',
    sendgridPublicKey: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    demo: options.demo,
    channels: options.channels,
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

  /** Connects the signed-up Agency's email by typing its address, as the wizard's first step asks: until then every other page leads there. */
  async function connectEmail(cookie: string, address = 'inbox@sunrise.example') {
    const res = await post('/welcome/email', { address }, cookie);
    if (res.status !== 303 || res.headers.get('location')?.includes('error=')) throw new Error(`Connecting email failed: ${res.status} ${res.headers.get('location')}`);
  }

  return { ...w, web, signIn, signUp, connectEmail, get, post };
}
