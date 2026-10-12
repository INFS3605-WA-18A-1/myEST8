import { expect, test } from '@playwright/test';
import { signIn, signUp, unique } from './support/actions.ts';

test('a new Agency signs up and lands signed in', async ({ page }) => {
  const id = unique();
  await signUp(page, { agencyName: `Sunrise Realty ${id}`, name: 'Sam Sun', email: `sam-${id}@sunrise.example`, password: 'sunrise-2026' });

  await expect(page).not.toHaveURL(/\/signup/);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByText(`Sunrise Realty ${id}`).first()).toBeVisible();

  // Signed in, the sign-in page sends them straight back in.
  await page.goto('/login');
  await expect(page).not.toHaveURL(/\/login/);
});

test('a demo Property Manager signs in and sees the dashboard', async ({ page }) => {
  await signIn(page);

  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Harbour Realty').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Maintenance Requests to review' })).toBeVisible();
});

test('a wrong password is refused with a message', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill('alice@harbour.example');
  await page.getByRole('textbox', { name: 'Password' }).fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(/don.t match/)).toBeVisible();
});
