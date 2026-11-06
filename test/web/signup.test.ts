import { describe, expect, test } from 'vitest';
import { signUpFields, visible, webWorld } from '../support/web.ts';

describe('signing up', () => {
  test('the form asks for the Property Manager and their Agency, with Sydney time by default', async () => {
    const w = await webWorld();

    const page = await (await w.get('/signup')).text();

    for (const name of ['name', 'email', 'password', 'agencyName', 'timeZone']) expect(page).toContain(`name="${name}"`);
    expect(page).not.toContain('name="confirmPassword"');
    expect(page).toContain('data-reveal="field-password"');
    expect(page).toContain('aria-label="Show password"');
    // The label says what pressing it will do; there is no second pressed state.
    expect(page).not.toMatch(/data-reveal="field-password"[^>]*aria-pressed/);
    expect(page).toContain('The whole setup guide takes about 10 minutes.');
    expect(page).toContain('<option value="Australia/Sydney" selected>');
    expect(page).toContain('<option value="Australia/Perth"');
    expect(page).toContain('href="/login"');
  });

  test('a short password is refused next to the field, keeping everything else typed', async () => {
    const w = await webWorld();

    const res = await w.post('/signup', signUpFields({ password: 'tiny-pw' }));

    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
    const page = await res.text();
    expect(page).toMatch(/id="field-password-error"[^>]*>Use at least 10 characters</);
    expect(page).toContain('aria-invalid="true"');
    for (const kept of ['value="Sam Sun"', 'value="sam@sunrise.example"', 'value="Sunrise Realty"', '<option value="Australia/Brisbane" selected>']) {
      expect(page).toContain(kept);
    }
    expect(page).not.toContain('tiny-pw');
  });

  test('the password is typed only once, and the server never sends it back', async () => {
    const w = await webWorld();

    const res = await w.post('/signup', signUpFields({ password: 'sunrise-2027', email: 'not-an-email' }));

    expect(res.status).toBe(400);
    const page = await res.text();
    expect(visible(page)).toContain("not-an-email isn't an email address");
    expect(page).toContain('value="Sam Sun"');
    expect(page).not.toContain('sunrise-202');
  });

  test('an email that already has an account is refused', async () => {
    const w = await webWorld();

    const res = await w.post('/signup', signUpFields({ email: 'Alice@Harbour.example' }));

    expect(res.status).toBe(400);
    const page = await res.text();
    expect(page).toMatch(/id="field-email-error"[^>]*>An account with that email already exists</);
    expect(page).toContain('value="Alice@Harbour.example"');
    expect(page).toContain('value="Sunrise Realty"');
  });

  test('missing details are each refused against their own field', async () => {
    const w = await webWorld();

    const res = await w.post('/signup', signUpFields({ name: '', email: 'not-an-email', agencyName: ' ' }));

    expect(res.status).toBe(400);
    const page = await res.text();
    expect(page).toMatch(/id="field-name-error"[^>]*>Enter a name</);
    expect(page).toMatch(/id="field-email-error"[^>]*>not-an-email isn&#39;t an email address</);
    expect(page).toMatch(/id="field-agencyName-error"[^>]*>Enter your Agency&#39;s name</);
  });

  test('a complete sign-up creates the Agency, signs the Property Manager in, and starts the guide', async () => {
    const w = await webWorld();

    const res = await w.post('/signup', signUpFields());

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/welcome');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^myest8_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain('HttpOnly');

    const welcome = visible(await (await w.get('/welcome', cookie.split(';')[0])).text());
    expect(welcome).toContain('Welcome to myEST8, Sam');
    expect(welcome).toContain('Sunrise Realty');
    expect(welcome).toContain('Brisbane (QLD)');

    // The new account signs in like any other.
    expect(await w.signIn('sam@sunrise.example', 'sunrise-2026')).toMatch(/^myest8_session=/);
  });

  test('signing up from another site is refused', async () => {
    const w = await webWorld();

    const res = await w.web.request('/signup', { method: 'POST', body: new URLSearchParams(signUpFields()), headers: { origin: 'https://evil.example' } });

    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  test('a signed-in Property Manager is sent on from the sign-up page', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const res = await w.get('/signup', cookie);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/');
  });

  test('the four steps keep their four jobs apart, and the 10 minutes appear once', async () => {
    const w = await webWorld();

    const raw = await (await w.get('/signup')).text();
    const page = visible(raw).replace(/\s+/g, ' ');

    const steps = [
      'Create your account and your Agency. myEST8 signs you in.',
      'Connect the Agency’s email (required, about 2 minutes) so myEST8 can read what Tenants send.',
      'Add your team, your Tradies and your first Property.',
      'The first Tenant text arrives as a Maintenance Request to confirm.',
    ];
    for (const step of steps) expect(page).toContain(step);
    // Four numbered steps, not one step bundling four jobs.
    expect(raw.match(/class="au-step-num/g)).toHaveLength(4);
    // The estimate is said once, beside the lead, at every width.
    expect(page.match(/about 10 minutes/g)).toHaveLength(1);
  });

  test('creating an account agrees to the Terms of use and Privacy Policy, both public pages', async () => {
    const w = await webWorld();

    const page = await (await w.get('/signup')).text();

    expect(visible(page)).toContain('By creating an account you agree to the Terms of use and Privacy Policy.');
    expect(page).toMatch(/<a href="\/terms"[^>]*class="[^"]*btn[^"]*"[^>]*>Terms of use<\/a>/);
    expect(page).toMatch(/<a href="\/privacy"[^>]*class="[^"]*btn[^"]*"[^>]*>Privacy Policy<\/a>/);

    for (const [path, title, honest] of [
      ['/terms', 'Terms of use', 'university project'],
      ['/privacy', 'Privacy Policy', 'student project'],
    ] as const) {
      const res = await w.get(path);
      expect(res.status, path).toBe(200);
      const legal = await res.text();
      expect(legal).toContain(`<h1 class="page-title">${title}</h1>`);
      expect(legal).toContain(honest);
      // The public bar and a way home, as on every signed-out page.
      expect(legal).toContain('class="public-bar"');
      expect(legal).toMatch(/<a href="\/"[^>]*btn[^>]*>Home<\/a>/);
    }
  });

  test('the share label says what pressing it does', async () => {
    const w = await webWorld();

    const page = visible(await (await w.get('/signup')).text()).replace(/\s+/g, ' ');

    expect(page).toContain('Send them the sign-up link');
    expect(page).toContain('the button opens a panel to copy it, or send it by email or text');
    expect(page).not.toContain('Send this page to them');
  });
});
