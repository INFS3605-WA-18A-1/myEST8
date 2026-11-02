import { expect, test, type Page } from '@playwright/test';
import { signIn } from './support/actions.ts';

// Open Profiles from the side menu, add a Tenant, and check a phone doesn't scroll sideways.

const overflow = (page: Page) => page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth');

test('Profiles opens from the side menu, and Add profile leads to a new Tenant', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'Profiles', exact: true }).click();
  await expect(page).toHaveURL(/\/profiles$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Profiles' })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // The summary is a disclosure, like the user menu, so it is not a button role.
  await page.locator('summary', { hasText: 'Add profile' }).click();
  await page.getByRole('link', { name: 'Tenant', exact: true }).click();
  await expect(page).toHaveURL(/\/tenants\/new$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Add a Tenant' })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
