import { expect, test, type Page } from '@playwright/test';
import { signIn, unique } from './support/actions.ts';

// Editing a profile's details on a phone: open a Tradie, press the pen, change the mobile, save,
// and see it, with nothing scrolling sideways. The Tradie is this run's own (a unique business
// and mobile), so the spec can run beside the others. Roles and visible text only.

const overflow = (page: Page) => page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth');

/** An Australian mobile that no other run uses: 04 and eight random digits. */
const mobile = () => `04${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

test('on a phone, the pen opens the Tradie\'s details, a new mobile is saved and shown, and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  // A Tradie of this run's own, added from the empty form.
  const business = `Edit Plumbing ${unique()}`;
  const before = mobile();
  const after = mobile();
  await page.goto('/tradies?manual=1#add-tradie');
  await page.getByRole('textbox', { name: 'Business name' }).fill(business);
  await page.getByRole('textbox', { name: 'Contact name' }).fill(`Edie ${unique()}`);
  await page.getByRole('textbox', { name: 'Mobile' }).fill(before);
  await page.getByRole('checkbox', { name: 'Plumbing' }).check();
  await page.getByRole('combobox', { name: 'Starting rating' }).selectOption('3 / 5');
  await page.getByRole('button', { name: 'Add Tradie' }).click();
  await expect(page.getByText(`${business} added as a Tradie`)).toBeVisible();

  // Open the profile, and the pen opens the form in place of the contact details.
  await page.getByRole('link', { name: business }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: business })).toBeVisible();
  await expect(page.getByRole('link', { name: `+61${before.slice(1)}` })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole('link', { name: 'Edit details' }).click();
  await expect(page.getByRole('textbox', { name: 'Business name' })).toHaveValue(business);
  await expect(page.getByRole('textbox', { name: 'Mobile' })).toHaveValue(`+61${before.slice(1)}`);
  await expect(page.getByRole('checkbox', { name: 'Plumbing' })).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Starting rating' })).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // Cancel goes back to the plain profile; the pen opens it again.
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(page.getByRole('textbox', { name: 'Mobile' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Edit details' }).click();

  // A new mobile is saved, and the profile shows it.
  await page.getByRole('textbox', { name: 'Mobile' }).fill(after);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Details saved.')).toBeVisible();
  await expect(page.getByRole('link', { name: `+61${after.slice(1)}` })).toBeVisible();
  await expect(page.getByRole('link', { name: `+61${before.slice(1)}` })).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
