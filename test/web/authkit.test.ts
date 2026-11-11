import { describe, expect, test } from 'vitest';
import type { AuthKit, AuthKitUser } from '../../src/adapters/workos.ts';
import { visible, webWorld } from '../support/web.ts';

/** A stand-in for WorkOS AuthKit: each code signs in the person it was handed out for. */
function fakeAuthKit() {
  const people = new Map<string, AuthKitUser>();
  const invited: string[] = [];
  let failInvites = false;
  const authKit: AuthKit = {
    secret: 'a-test-secret-that-is-long-enough-to-sign',
    signInUrl: (o) => `https://auth.workos.test/authorize?${new URLSearchParams({ redirect_uri: o.redirectUri, state: o.state, ...(o.screenHint ? { screen_hint: o.screenHint } : {}), ...(o.invitationToken ? { invitation_token: o.invitationToken } : {}) })}`,
    async authenticate(code) {
      const user = people.get(code);
      if (!user) throw new Error('invalid_grant');
      return user;
    },
    signOutUrl: (sessionId) => `https://auth.workos.test/logout?session_id=${sessionId}`,
    async invite(email) {
      if (failInvites) throw new Error('WorkOS is down');
      invited.push(email);
    },
  };
  return {
    authKit,
    invited,
    failInvites: () => (failInvites = true),
    /** The code AuthKit would hand back after `user` signs in. */
    codeFor(user: Partial<AuthKitUser> & { email: string }) {
      const code = `code-${people.size}`;
      people.set(code, { emailVerified: true, name: '', sessionId: `session_${people.size}`, ...user });
      return code;
    },
  };
}

/** Cookies as a browser keeps them across requests. */
function jar() {
  const cookies = new Map<string, string>();
  return {
    take(res: Response) {
      for (const line of res.headers.getSetCookie()) {
        const [pair, ...attrs] = line.split(';');
        const [name, value] = [pair!.slice(0, pair!.indexOf('=')), pair!.slice(pair!.indexOf('=') + 1)];
        if (!value || attrs.some((a) => /max-age=0/i.test(a))) cookies.delete(name.trim());
        else cookies.set(name.trim(), value);
      }
      return res;
    },
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
    has: (name: string) => cookies.has(name),
  };
}

async function setup() {
  const fake = fakeAuthKit();
  const w = await webWorld({ authKit: fake.authKit });
  const browser = jar();
  const go = async (path: string, init: RequestInit = {}) =>
    browser.take(await w.web.request(path, { ...init, headers: { cookie: browser.header(), ...(init.headers ?? {}) } }));
  /** Goes through AuthKit as `user`: /login, the hosted page, then back to /callback. */
  async function signInAs(user: Partial<AuthKitUser> & { email: string }, start = '/login') {
    const toAuthKit = await go(start);
    expect(toAuthKit.status).toBe(302);
    const hosted = new URL(toAuthKit.headers.get('location')!);
    expect(hosted.searchParams.get('redirect_uri')).toBe('https://myest8.test/callback');
    return go(`/callback?code=${fake.codeFor(user)}&state=${hosted.searchParams.get('state')}`);
  }
  return { ...w, fake, browser, go, signInAs };
}

describe('signing in and up through WorkOS AuthKit', () => {
  test('/login goes straight to AuthKit, the one page for signing in and signing up; /signup opens it on sign-up', async () => {
    const { go } = await setup();
    const login = await go('/login');
    expect(login.status).toBe(302);
    expect(login.headers.get('location')).toMatch(/^https:\/\/auth\.workos\.test\/authorize\?/);

    const signup = await go('/signup');
    expect(signup.status).toBe(303);
    expect(signup.headers.get('location')).toBe('/login?screen=sign-up');
    expect(new URL((await go('/login?screen=sign-up')).headers.get('location')!).searchParams.get('screen_hint')).toBe('sign-up');

    // No password form is left: posting one signs nobody in.
    const posted = await go('/login', { method: 'POST', body: new URLSearchParams({ email: 'alice@harbour.example', password: 'correct horse battery' }) });
    expect(posted.status).toBe(401);
    expect(posted.headers.getSetCookie()).toEqual([]);
  });

  test('an existing Property Manager comes back signed in, to the page they asked for', async () => {
    const { go, signInAs } = await setup();
    const asked = await go('/calendar');
    const back = await signInAs({ email: 'Alice@Harbour.example' }, asked.headers.get('location')!);
    expect(back.status).toBe(303);
    expect(back.headers.get('location')).toBe('/calendar');
    expect((await go('/calendar')).status).toBe(200);
  });

  test('a callback without the state its sign-in started with is refused', async () => {
    const { go, fake } = await setup();
    await go('/login');
    const res = await go(`/callback?code=${fake.codeFor({ email: 'alice@harbour.example' })}&state=forged`);
    expect(res.status).toBe(400);
    expect((await go('/calendar')).status).toBe(303);
  });

  test('an unverified email is not signed in', async () => {
    const { go, signInAs } = await setup();
    const res = await signInAs({ email: 'alice@harbour.example', emailVerified: false });
    expect(res.status).toBe(403);
    expect((await go('/calendar')).status).toBe(303);
  });

  test('someone new names their Agency, becomes its first Property Manager and starts the guide', async () => {
    const { go, signInAs, browser } = await setup();
    const back = await signInAs({ email: 'sam@sunrise.example', name: 'Sam Sun' });
    expect(back.headers.get('location')).toBe('/signup');

    const form = await (await go('/signup')).text();
    expect(visible(form)).toContain('signed in as sam@sunrise.example');
    expect(form).not.toContain('name="password"');
    expect(form).not.toContain('name="email"');
    expect(form).toContain('value="Sam Sun"');

    const done = await go('/signup', { method: 'POST', body: new URLSearchParams({ name: 'Sam Sun', agencyName: 'Sunrise Realty', timeZone: 'Australia/Brisbane' }) });
    expect(done.status).toBe(303);
    expect(done.headers.get('location')).toBe('/welcome');
    expect(browser.has('myest8_signup')).toBe(false);
    expect(visible(await (await go('/welcome/team')).text())).toContain('Sunrise Realty');

    // Signing out ends the AuthKit session too.
    const out = await go('/logout', { method: 'POST' });
    expect(out.headers.get('location')).toBe('https://auth.workos.test/logout?session_id=session_0');
    expect((await go('/calendar')).status).toBe(303);
  });

  test('/signup without a sign-up from AuthKit, or with a made-up one, goes to AuthKit and creates nothing', async () => {
    const { web, go } = await setup();
    const fields = new URLSearchParams({ name: 'Eve', email: 'eve@evil.example', password: 'long-enough-password', agencyName: 'Evil', timeZone: 'Australia/Sydney' });
    const forged = `myest8_signup=${Buffer.from(JSON.stringify({ email: 'eve@evil.example', exp: Date.now() + 60_000 })).toString('base64url')}.bad`;
    for (const cookie of ['', forged]) {
      const res = await web.request('/signup', { method: 'POST', body: fields, headers: { cookie } });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/login?screen=sign-up');
    }
    expect((await go('/signup')).headers.get('location')).toBe('/login?screen=sign-up');
  });

  test('an invitation link carries its token through /login to AuthKit', async () => {
    const { go } = await setup();
    const res = await go('/login?invitation_token=inv_123');
    expect(new URL(res.headers.get('location')!).searchParams.get('invitation_token')).toBe('inv_123');
  });
});

describe('adding colleagues with WorkOS AuthKit', () => {
  test('the guide invites a colleague by email instead of making a password, and they sign in through AuthKit', async () => {
    const { go, signInAs, fake, web } = await setup();
    await signInAs({ email: 'alice@harbour.example' });
    const team = await (await go('/welcome/team')).text();
    expect(visible(team)).toContain('emails them an invitation');

    const added = await go('/welcome/team', { method: 'POST', body: new URLSearchParams({ name: 'Casey Cole', email: 'casey@harbour.example' }) });
    expect(added.status).toBe(200);
    const page = await added.text();
    expect(visible(page)).toContain('Casey Cole invited as a Property Manager');
    expect(page).not.toContain('data-temporary-password');
    expect(fake.invited).toEqual(['casey@harbour.example']);

    // Casey accepts the invitation in another browser: AuthKit vouches for the email, and they land in Harbour Realty.
    const casey = jar();
    const start = casey.take(await web.request('/login'));
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const back = casey.take(await web.request(`/callback?code=${fake.codeFor({ email: 'casey@harbour.example' })}&state=${state}`, { headers: { cookie: casey.header() } }));
    expect(back.headers.get('location')).toBe('/');
    expect(visible(await (await web.request('/welcome/team', { headers: { cookie: casey.header() } })).text())).toContain('Casey Cole');
  });

  test('when the invitation fails to send, the colleague is still added and the page says to send the link', async () => {
    const { go, signInAs, fake } = await setup();
    await signInAs({ email: 'alice@harbour.example' });
    fake.failInvites();
    const page = visible(await (await go('/settings/team', { method: 'POST', body: new URLSearchParams({ name: 'Casey Cole', email: 'casey@harbour.example' }) })).text());
    expect(page).toContain('invitation not sent');
    expect(page).toContain('Casey Cole');
  });
});
