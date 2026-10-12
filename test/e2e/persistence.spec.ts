import { expect, test } from '@playwright/test';
import { signUp, unique } from './support/actions.ts';
import { freePort, startDemo, uniqueSchema } from './support/server.ts';

// This test runs its own server (not the shared one) so it can stop and restart it.
test('with DATABASE_SCHEMA set, what a Property Manager adds survives a server restart', async ({ browser }) => {
  test.setTimeout(90_000);
  // Kept in the run's database, which the global teardown drops.
  const schema = uniqueSchema();
  const port = freePort();
  const id = unique();
  const agency = { agencyName: `Restart Realty ${id}`, name: 'Rae Start', email: `rae-${id}@restart.example`, password: 'restart-2026' };

  let server = await startDemo({ port, schema });
  try {
    const context = await browser.newContext({ baseURL: server.url });
    const page = await context.newPage();
    await signUp(page, agency);
    await expect(page.getByText(agency.agencyName).first()).toBeVisible();

    await server.stop();
    server = await startDemo({ port, schema });

    // The session survived: the same browser is still signed in to the new Agency.
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByText(agency.agencyName).first()).toBeVisible();

    // And the account itself survived: a fresh browser can sign in with it.
    const fresh = await browser.newContext({ baseURL: server.url });
    const again = await fresh.newPage();
    await again.goto('/login');
    await again.getByRole('textbox', { name: 'Email' }).fill(agency.email);
    await again.getByRole('textbox', { name: 'Password' }).fill(agency.password);
    await again.getByRole('button', { name: 'Sign in' }).click();
    await expect(again).not.toHaveURL(/\/login/);
    await expect(again.getByText(agency.agencyName).first()).toBeVisible();
    await Promise.all([context.close(), fresh.close()]);
  } finally {
    await server.stop();
  }
});
