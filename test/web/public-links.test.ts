import { describe, expect, test } from 'vitest';
import type { DemoControls } from '../../src/demo/controls.ts';
import { signUpFields, visible, webWorld } from '../support/web.ts';

const noDemo = (): DemoControls => ({
  contacts: async () => [],
  outbox: async () => [],
  inbound: async () => [],
  sendAs: async () => {},
  advance: async () => {},
  now: () => new Date(),
});

/** Every `<a ...>` opening tag on the page. */
function anchors(page: string): string[] {
  return [...page.matchAll(/<a\s[^>]*>/g)].map((m) => m[0]);
}

/** The anchors a public page may hold: a button-link, the skip link, or a channel in the share panel. */
function isAllowed(anchor: string): boolean {
  const cls = anchor.match(/class="([^"]*)"/)?.[1] ?? '';
  const classes = cls.split(/\s+/);
  return classes.includes('btn') || classes.includes('skip-link') || classes.includes('logotype') || classes.includes('share-option');
}

async function publicPages() {
  const plain = await webWorld();
  const demo = await webWorld({ demo: noDemo() });
  return [
    ['the landing page', await (await plain.get('/')).text()],
    ['the landing page in demo mode', await (await demo.get('/')).text()],
    ['the sign-in page', await (await plain.get('/login')).text()],
    ['the sign-in page after a refusal', await (await plain.web.request('/login', { method: 'POST', body: new URLSearchParams({ email: 'a@b.example', password: 'nope' }) })).text()],
    ['the sign-up page', await (await plain.get('/signup')).text()],
    ['the sign-up page after a refusal', await (await plain.post('/signup', signUpFields({ confirmPassword: 'different-1' }))).text()],
  ] as const;
}

describe('links on public pages', () => {
  test('no plain text with an inline link anywhere: every link is a button or part of the page frame', async () => {
    for (const [name, page] of await publicPages()) {
      expect(page, `${name} has a text link`).not.toMatch(/class="(?:[^"]*\s)?link(?:\s[^"]*)?"/);
      const stray = anchors(page).filter((a) => !isAllowed(a));
      expect(stray, `${name} has anchors that are not buttons`).toEqual([]);
    }
  });

  test('the page frame links are ghost buttons in the header', async () => {
    const w = await webWorld();

    const login = await (await w.get('/login')).text();
    const signup = await (await w.get('/signup')).text();
    const landing = await (await w.get('/')).text();

    expect(login).toMatch(/<a href="\/"[^>]*class="[^"]*btn-ghost[^"]*btn-sm[^"]*"[^>]*>Home<\/a>/);
    expect(signup).toMatch(/<a href="\/"[^>]*class="[^"]*btn-ghost[^"]*btn-sm[^"]*"[^>]*>Home<\/a>/);
    const bar = landing.match(/<header class="lp-bar">[\s\S]*?<\/header>/)?.[0] ?? '';
    expect(bar).toMatch(/<a href="\/login"[^>]*btn-ghost[^>]*>Sign in<\/a>/);
    expect(bar).toMatch(/<a href="\/signup"[^>]*btn-primary[^>]*>Create your Agency’s account<\/a>/);
  });

  test('the sign-in page has exactly one control named Sign in, and the sign-up and sign-in buttons are full width', async () => {
    const w = await webWorld();

    const login = await (await w.get('/login')).text();
    const signup = await (await w.get('/signup')).text();

    expect(login.match(/>Sign in<\/(button|a)>/g)).toEqual(['>Sign in</button>']);
    expect(login).toMatch(/<a href="\/signup"[^>]*btn-block[^>]*>Create your Agency’s account<\/a>/);
    expect(signup).toMatch(/<a href="\/login"[^>]*btn-block[^>]*>Sign in<\/a>/);
    expect(visible(signup)).toContain('Already have an account?');
  });

  test('in demo mode each demo user has a button that signs in, and the logins stay readable', async () => {
    const demo = await webWorld({ demo: noDemo() });
    const plain = await webWorld();

    const page = await (await demo.get('/')).text();

    for (const [label, email] of [
      ['Sign in as Alice Archer', 'alice@harbour.example'],
      ['Sign in as Bob Baker', 'bob@harbour.example'],
    ]) {
      const form = page.match(new RegExp(`<form method="post" action="/login"[^>]*>(?:(?!</form>)[\\s\\S])*>${label}</button>\\s*</form>`));
      expect(form, label).not.toBeNull();
      expect(form![0]).toContain(`name="email" value="${email}"`);
      expect(form![0]).toContain('name="password" value="demo1234"');
      expect(form![0]).toContain('name="next" value="/"');
    }
    expect(visible(page)).toContain('demo1234');
    const signedOut = await (await plain.get('/')).text();
    expect(signedOut).not.toContain('demo1234');
    expect(signedOut).not.toContain('Sign in as');
  });
});
