import { expect, test, type Page } from '@playwright/test';
import { signIn, unique } from './support/actions.ts';

// On a phone: open Property Owners, open an Owner, add an email with the pen and save.
// The Owner is this run's own, so the spec can run beside the others. Nothing scrolls sideways.

const overflow = (page: Page) => page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth');

/** An Australian mobile that no other run uses: 04 and eight random digits. */
const mobile = () => `04${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

test('on a phone, an Owner gets an email from the pen and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  const name = `Eden ${unique()}`;
  const email = `eden.${unique()}@example.com`;
  await page.goto('/owners/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('textbox', { name: 'Mobile' }).fill(mobile());
  await page.getByRole('button', { name: 'Add Property Owner' }).click();
  await expect(page.getByText(`${name} added as a Property Owner`)).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await page.getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await page.getByRole('link', { name: 'Edit details' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText('Details saved.')).toBeVisible();
  await expect(page.getByRole('link', { name: email })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
