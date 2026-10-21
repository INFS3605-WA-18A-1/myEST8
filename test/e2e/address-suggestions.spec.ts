import { expect, test } from '@playwright/test';
import { signIn } from './support/actions.ts';

// A Property's address can be picked from suggestions. The keyboard does it, and
// the saved Property is on the Dispatch map at that suggestion's point.

test.use({ viewport: { width: 1366, height: 768 } });

test('typing a demo address offers it, and choosing it by keyboard places the Property', async ({ page }) => {
  await signIn(page);
  await page.goto('/properties#add-property');

  const address = page.getByRole('combobox', { name: 'Address' });
  await address.fill('Parramatta');
  const option = page.getByRole('option', { name: '3 Parramatta Rd, Annandale NSW 2038' });
  await expect(option).toBeVisible();
  await address.press('ArrowDown');
  await address.press('Enter');

  await expect(address).toHaveValue('3 Parramatta Rd');
  await expect(page.getByRole('textbox', { name: 'Suburb' })).toHaveValue('Annandale');

  await page.getByLabel('Property Owner').selectOption({ label: 'Olivia Owens' });
  await page.getByLabel('Max Repair Cost ($)').fill('500');
  await page.getByRole('button', { name: 'Add Property' }).click();
  await expect(page.getByText('3 Parramatta Rd added')).toBeVisible();

  await page.goto('/dispatch');
  // A Property with no open Tickets is folded away; the map still pins it.
  await page.getByText(/^Show the \d+ Properties with no open Tickets$/).click();
  await expect(page.getByRole('link', { name: '3 Parramatta Rd' })).toBeVisible();
  const data = JSON.parse((await page.locator('#dispatch-data').textContent()) ?? '{}') as {
    properties: { address: string; lat: number; lng: number }[];
  };
  expect(data.properties.find((property) => property.address === '3 Parramatta Rd')).toMatchObject({ lat: -33.885, lng: 151.183 });
});
