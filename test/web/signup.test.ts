import { describe, expect, test } from 'vitest';
import { signUpFields, visible, webWorld } from '../support/web.ts';

describe('signing up', () => {
  test('the form asks for the Property Manager and their Agency, with Sydney time by default', async () => {
    const w = await webWorld();

    const page = await (await w.get('/signup')).text();

    for (const name of ['name', 'email', 'password', 'confirmPassword', 'agencyName', 'timeZone']) expect(page).toContain(`name="${name}"`);
    expect(page).toContain('<option value="Australia/Sydney" selected>');
    expect(page).toContain('<option value="Australia/Perth"');
    expect(page).toContain('href="/login"');
  });

  test('a short password is refused next to the field, keeping everything else typed', async () => {
    const w = await webWorld();

    const res = await w.post('/signup', signUpFields({ password: 'tiny-pw', confirmPassword: 'tiny-pw' }));

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

  test("passwords that don't match are refused, and never shown again", async () => {
    const w = await webWorld();

    const res = await w.post('/signup', signUpFields({ confirmPassword: 'sunrise-2027' }));

    expect(res.status).toBe(400);
    const page = await res.text();
    expect(visible(page)).toContain("The passwords don't match");
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
});
