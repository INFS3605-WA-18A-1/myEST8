import { generateKeyPairSync } from 'node:crypto';
import type { DemoControls } from '../../src/demo/controls.ts';
import { createSessions } from '../../src/web/auth.ts';
import { createWebApp } from '../../src/web/server.ts';
import { PASSWORD, world } from './world.ts';

/** The standard world behind the web app, with helpers to sign in and click through pages. */
export async function webWorld(options: { demo?: DemoControls } = {}) {
  const w = await world();
  const web = createWebApp({
    app: w.h.app,
    sessions: createSessions(w.h.db, w.h.clock),
    clock: w.h.clock,
    publicUrl: 'https://myest8.test',
    twilioAuthToken: 'test-token',
    sendgridPublicKey: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    demo: options.demo,
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

  return { ...w, web, signIn, get, post };
}
