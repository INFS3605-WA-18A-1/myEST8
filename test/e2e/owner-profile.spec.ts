import { expect, test, type Page } from '@playwright/test';
import { signIn, unique } from './support/actions.ts';

// On a phone: open Owners, open an Owner, add an email with the pen and save.
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
  await page.getByRole('button', { name: 'Add Owner' }).click();
  await expect(page.getByText(`${name} added as an Owner`)).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await page.getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await page.getByRole('link', { name: 'Edit details' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Save details' }).click();

  await expect(page.getByText('Details saved.')).toBeVisible();
  await expect(page.getByRole('link', { name: email })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

// The panel that asks before an action answers in the action's colour: red to undo (Remove Owner), green to commit
// (Choose this Firm Quote, in inspections.spec.ts). Keep it leaves the Owner as they were.
test('Remove Owner asks first with a red Yes, and Keep it keeps them', async ({ page }) => {
  await signIn(page);
  const name = `Ezra ${unique()}`;
  await page.goto('/owners/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('textbox', { name: 'Mobile' }).fill(mobile());
  await page.getByRole('button', { name: 'Add Owner' }).click();
  await page.getByRole('link', { name }).click();

  await page.getByRole('button', { name: 'Remove Owner' }).click();
  const ask = page.getByRole('alertdialog');
  await expect(ask.getByRole('button', { name: 'Remove Owner' })).toHaveClass(/\bbtn-error\b/);
  await ask.getByRole('button', { name: 'Keep it' }).click();
  await expect(ask).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
});
