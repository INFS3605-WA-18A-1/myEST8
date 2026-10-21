import { expect, test } from '@playwright/test';
import { signIn, unique } from './support/actions.ts';

// Property and Tradie dropdowns filter as you type, and Nominated Tradies are added
// one searchable row at a time. Roles and names only.

test('the Property dropdown finds a Property by its postcode and the Tenant is added to it', async ({ page }) => {
  await signIn(page);
  await page.goto('/tenants');
  await page.getByRole('link', { name: 'Add a Tenant' }).first().click();

  const name = `Tina ${unique()}`;
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('textbox', { name: 'Mobile' }).fill(`04${String(Date.now()).slice(-8)}`);
  const property = page.getByRole('combobox', { name: 'Property' });
  await property.fill('2037');
  const listbox = page.getByRole('listbox');
  await expect(listbox.getByRole('option')).toHaveText(['21 Glebe Point Rd, Glebe NSW 2037']);
  await property.press('Enter');
  await expect(property).toHaveValue('21 Glebe Point Rd, Glebe NSW 2037');
  await page.getByLabel('Tenancy start date').fill('2026-09-01');
  await page.getByRole('button', { name: 'Add Tenant' }).click();

  await expect(page.getByText(`${name} added as a Tenant`)).toBeVisible();
  // Glebe is another Property Manager's, so the Tenant shows under All.
  await page.getByRole('link', { name: 'All', exact: true }).click();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('21 Glebe Point Rd');
});

test('Nominated Tradies are added with Add Tradie, each found by typing, and removed again', async ({ page }) => {
  await signIn(page);
  await page.goto('/properties#add-property');
  const nominated = page.getByRole('group', { name: 'Nominated Tradies' });
  await expect(nominated.getByRole('checkbox')).toHaveCount(0);

  const first = nominated.getByRole('combobox').first();
  await first.fill('drip');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['Drip Doctors (Plumbing)']);
  await page.getByRole('listbox').getByRole('option', { name: 'Drip Doctors (Plumbing)' }).click();
  await expect(first).toHaveValue('Drip Doctors (Plumbing)');

  await nominated.getByRole('button', { name: 'Add Tradie' }).click();
  await expect(nominated.getByRole('combobox')).toHaveCount(2);
  await expect(nominated.getByRole('combobox').nth(1)).toBeFocused();
  await nominated.getByRole('combobox').nth(1).fill('pete park');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText(["Pete's Plumbing (Plumbing)"]);

  await nominated.getByRole('button', { name: 'Remove' }).nth(1).click();
  await expect(nominated.getByRole('combobox')).toHaveCount(1);
});
