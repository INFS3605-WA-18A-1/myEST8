import { describe, expect, test } from 'vitest';
import { HOUR } from '../support/harness.ts';
import { webWorld } from '../support/web.ts';
import { PASSWORD } from '../support/world.ts';

function login(web: Awaited<ReturnType<typeof webWorld>>['web'], fields: Record<string, string>, url = '/login') {
  return web.request(url, { method: 'POST', body: new URLSearchParams(fields) });
}

/** True when the response sends the browser back to sign in. */
function toSignIn(res: Response) {
  return res.status === 303 && (res.headers.get('location') ?? '').startsWith('/login');
}

describe('signing in', () => {
  test('a signed-out visit to a page goes to the sign-in page and back afterwards', async () => {
    const { get } = await webWorld();
    const res = await get('/tickets/1?tab=quotes');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/tickets/1?tab=quotes')}`);

    const page = await get('/login?next=%2Ftickets%2F1');
    expect(page.status).toBe(200);
    const body = await page.text();
    expect(body).toContain('name="email"');
    expect(body).toContain('name="password"');
    expect(body).toContain('value="/tickets/1"');
  });

  test('signed out, / is the landing page; every other page needs a signed-in Property Manager', async () => {
    const { get } = await webWorld();
    const landing = await get('/');
    expect(landing.status).toBe(200);
    expect(await landing.text()).toContain('href="/signup"');

    const res = await get('/calendar');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login?next=%2Fcalendar');
  });

  test('the sign-in page links to sign-up and back to the landing page', async () => {
    const { get } = await webWorld();
    const page = await (await get('/login')).text();
    expect(page).toContain('href="/signup"');
    expect(page).toContain('href="/"');
  });

  test('a wrong password is refused without saying which field was wrong', async () => {
    const { web } = await webWorld();
    const wrongPassword = await login(web, { email: 'alice@harbour.example', password: 'nope' });
    const unknownEmail = await login(web, { email: 'nobody@harbour.example', password: PASSWORD });
    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.headers.get('set-cookie')).toBeNull();
    }
    const [a, b] = [await wrongPassword.text(), await unknownEmail.text()];
    expect(a).toContain('role="alert"');
    expect(a.replace('alice@harbour.example', '')).toBe(b.replace('nobody@harbour.example', ''));
  });

  test('the right password starts a session in an HttpOnly cookie', async () => {
    const { web, get, signIn } = await webWorld();
    const res = await login(web, { email: 'Alice@Harbour.example', password: PASSWORD });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^myest8_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Secure');

    const signedIn = await get('/calendar', await signIn());
    expect(toSignIn(signedIn)).toBe(false);
    expect(toSignIn(await get('/login', await signIn()))).toBe(false);
  });

  test('the cookie is Secure over https', async () => {
    const { web } = await webWorld();
    const res = await login(web, { email: 'alice@harbour.example', password: PASSWORD }, 'https://myest8.test/login');
    expect(res.headers.get('set-cookie')).toContain('Secure');
  });

  test('after signing in, the Property Manager goes back to the page they asked for, but never to another site', async () => {
    const { web } = await webWorld();
    const go = async (next: string) =>
      (await login(web, { email: 'alice@harbour.example', password: PASSWORD, next })).headers.get('location');
    expect(await go('/tickets/7?tab=quotes')).toBe('/tickets/7?tab=quotes');
    expect(await go('//evil.example/phish')).toBe('/');
    expect(await go('https://evil.example')).toBe('/');
    expect(await go('/\\evil.example')).toBe('/');
    expect(await go('/login')).toBe('/');
  });
});

describe('sessions', () => {
  test('signing out ends the session', async () => {
    const { web, get, signIn } = await webWorld();
    const cookie = await signIn();
    const res = await web.request('/logout', { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login');
    expect(res.headers.get('set-cookie')).toMatch(/^myest8_session=;.*Max-Age=0/);
    expect(toSignIn(await get('/calendar', cookie))).toBe(true);
  });

  test('a session ends after 12 hours without use, and each request extends it', async () => {
    const { h, get, signIn } = await webWorld();
    const cookie = await signIn();
    h.clock.advance(11 * HOUR);
    expect(toSignIn(await get('/calendar', cookie))).toBe(false);
    h.clock.advance(11 * HOUR);
    expect(toSignIn(await get('/calendar', cookie))).toBe(false);
    h.clock.advance(12 * HOUR + 1);
    expect(toSignIn(await get('/calendar', cookie))).toBe(true);
  });

  test('a made-up session cookie is ignored', async () => {
    const { get } = await webWorld();
    expect(toSignIn(await get('/calendar', 'myest8_session=made-up'))).toBe(true);
  });

  test('a signed-out post is refused with 401', async () => {
    const { web } = await webWorld();
    const res = await web.request('/tickets/1/close', { method: 'POST', body: new URLSearchParams({}) });
    expect(res.status).toBe(401);
  });
});

describe('cross-site requests', () => {
  test('a signed-in post from another site is refused', async () => {
    const { web, signIn } = await webWorld();
    const cookie = await signIn();
    const post = (headers: Record<string, string>) =>
      web.request('/tickets/1/close', { method: 'POST', body: new URLSearchParams({}), headers: { cookie, ...headers } });

    expect((await post({ origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ referer: 'https://evil.example/page' })).status).toBe(403);
    expect((await post({ origin: 'null' })).status).toBe(403);
    expect((await post({ origin: 'http://localhost' })).status).not.toBe(403);
    expect((await post({ referer: 'http://localhost/tickets/1' })).status).not.toBe(403);
    expect((await post({})).status).not.toBe(403);
  });

  test('signing in or out from another site is refused', async () => {
    const { web, signIn } = await webWorld();
    const cookie = await signIn();
    const loginRes = await web.request('/login', {
      method: 'POST',
      body: new URLSearchParams({ email: 'alice@harbour.example', password: PASSWORD }),
      headers: { origin: 'https://evil.example' },
    });
    expect(loginRes.status).toBe(403);
    expect(loginRes.headers.get('set-cookie')).toBeNull();
    const logoutRes = await web.request('/logout', { method: 'POST', headers: { cookie, origin: 'https://evil.example' } });
    expect(logoutRes.status).toBe(403);
  });
});
