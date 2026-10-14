import { describe, expect, test } from 'vitest';
import { FakeGmail } from '../support/fake-gmail.ts';
import { webWorld } from '../support/web.ts';

const INBOX = 'agency@gmail.example';

async function setup() {
  const gmail = new FakeGmail();
  const w = await webWorld({ gmailFetch: gmail.fetch });
  const cookie = await w.signIn();
  return { ...w, gmail, cookie };
}

/** Starts the Google sign-in and returns the state, the PKCE challenge and the cookies the callback needs. */
async function start(w: Awaited<ReturnType<typeof setup>>, path = '/oauth/google/start') {
  const res = await w.get(path, w.cookie);
  const location = new URL(res.headers.get('location')!);
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]!);
  return { res, location, cookies, cookie: [w.cookie, ...cookies].join('; ') };
}

describe('GET /oauth/google/start', () => {
  test('sends a signed-in Property Manager to Google with a state and a PKCE challenge, and remembers them in cookies', async () => {
    const w = await setup();
    const { res, location, cookies } = await start(w);
    expect(res.status).toBe(303);
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location.searchParams.get('redirect_uri')).toBe('https://myest8.test/oauth/google/callback');
    expect(location.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(cookies.map((c) => c.split('=')[0]).sort()).toEqual(['oauth_return', 'oauth_state', 'oauth_verifier']);
    const setCookie = res.headers.getSetCookie().join('\n');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/oauth\/google/);
  });

  test('is a 404 when Gmail is not set up on this server', async () => {
    const w = await webWorld();
    expect((await w.get('/oauth/google/start', await w.signIn())).status).toBe(404);
  });

  test('sends a signed-out visitor to sign in first', async () => {
    const w = await setup();
    const res = await w.get('/oauth/google/start');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/login\?next=/);
  });
});

describe('GET /oauth/google/callback', () => {
  test('connects the Agency’s email channel to the Gmail address and goes back to where it started', async () => {
    const w = await setup();
    const { location, cookie } = await start(w, '/oauth/google/start?return=/welcome/channels');
    const res = await w.get(`/oauth/google/callback?code=code-for-${INBOX}&state=${location.searchParams.get('state')}`, cookie);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/welcome\/channels\?ok=/);
    expect(await w.alice.gmailStatus()).toBe('connected');
    expect((await w.alice.channels()).find((c) => c.type === 'email')).toMatchObject({ address: INBOX });
    expect(w.gmail.exchanges).toEqual([{ code: `code-for-${INBOX}`, redirectUri: 'https://myest8.test/oauth/google/callback', codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43,}$/) }]);
    expect(res.headers.getSetCookie().join('\n')).toMatch(/oauth_state=;/);
  });

  test('a state that is not the one we sent is refused and nothing is stored', async () => {
    const w = await setup();
    const { cookie } = await start(w);
    const res = await w.get(`/oauth/google/callback?code=code-for-${INBOX}&state=forged`, cookie);
    expect(res.status).toBe(400);
    expect(w.gmail.exchanges).toEqual([]);
    expect(await w.alice.gmailStatus()).toBe('not_connected');
  });

  test('a callback without the cookies from our start is refused', async () => {
    const w = await setup();
    const res = await w.get(`/oauth/google/callback?code=code-for-${INBOX}&state=anything`, w.cookie);
    expect(res.status).toBe(400);
    expect(w.gmail.exchanges).toEqual([]);
  });

  test('a return path on another site is ignored', async () => {
    const w = await setup();
    const { location, cookie } = await start(w, '/oauth/google/start?return=//evil.example/steal');
    const res = await w.get(`/oauth/google/callback?code=code-for-${INBOX}&state=${location.searchParams.get('state')}`, cookie);
    expect(res.headers.get('location')).not.toMatch(/evil/);
  });

  test('declining on Google’s page comes back with a message and stores nothing', async () => {
    const w = await setup();
    const { location, cookie } = await start(w);
    const res = await w.get(`/oauth/google/callback?error=access_denied&state=${location.searchParams.get('state')}`, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/error=/);
    expect(await w.alice.gmailStatus()).toBe('not_connected');
  });

  test('a code Google rejects comes back with a message, not a crash', async () => {
    const w = await setup();
    const { location, cookie } = await start(w);
    const res = await w.get(`/oauth/google/callback?code=bad-code&state=${location.searchParams.get('state')}`, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/error=/);
    expect(await w.alice.gmailStatus()).toBe('not_connected');
  });
});
