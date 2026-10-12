// What a Property Manager does in the browser, by what they see: roles,
// labels and visible text, never CSS classes, so the tests survive redesigns.

import { expect, type Page } from '@playwright/test';

export const ALICE = { email: 'alice@harbour.example', password: 'demo1234' };

/** Signs in on /login and waits to leave it. */
export async function signIn(page: Page, { email, password } = ALICE) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** A suffix that makes this run's text and emails unique on the shared test server. */
export function unique(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Fills in the sign-up form for a new Agency and submits it. */
export async function signUp(page: Page, agency: { agencyName: string; name: string; email: string; password: string }) {
  await page.goto('/signup');
  await page.getByRole('textbox', { name: 'Your name' }).fill(agency.name);
  await page.getByRole('textbox', { name: 'Work email' }).fill(agency.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(agency.password);
  await page.getByRole('textbox', { name: 'Confirm password' }).fill(agency.password);
  await page.getByRole('textbox', { name: 'Agency name' }).fill(agency.agencyName);
  await page.getByRole('button', { name: 'Create account' }).click();
}
