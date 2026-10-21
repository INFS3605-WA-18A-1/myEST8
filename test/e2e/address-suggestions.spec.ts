import { expect, test, type Page } from '@playwright/test';
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

// A reply that is still on its way must not open the list once the Property
// Manager has moved on. The held suggestion is a fixed example, not one the
// page worked out.
const LATE = {
  label: '12 King Street, Ashbury NSW 2193',
  address: '12 King Street',
  suburb: 'Ashbury',
  postcode: '2193',
  state: 'New South Wales',
  location: { lat: -33.8983619, lng: 151.1205914 },
};

/** Holds the next suggestion response until `arrive` lets it through. */
async function holdSuggestions(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/properties/address-suggestions**', async (route) => {
    await gate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([LATE]) });
  });
  return {
    /** Lets the reply land, and reports whether its option then showed. */
    async arrive() {
      const response = page.waitForResponse('**/properties/address-suggestions**');
      release();
      await response;
      return page
        .getByRole('option', { name: LATE.label })
        .waitFor({ state: 'visible', timeout: 800 })
        .then(() => true, () => false);
    },
    async stop() {
      await page.unroute('**/properties/address-suggestions**');
    },
  };
}

test('a suggestion that arrives after you have moved on stays closed', async ({ page }) => {
  await signIn(page);
  await page.goto('/properties#add-property');
  const address = page.getByRole('combobox', { name: 'Address' });

  // Shortening below 3 characters closes the list before the reply.
  const shortened = await holdSuggestions(page);
  await address.fill('King');
  await page.waitForRequest('**/properties/address-suggestions**');
  await address.fill('Ki');
  expect(await shortened.arrive()).toBe(false);
  await shortened.stop();

  // Choosing, Escape and blur each drop a reply that started after the list opened.
  const open = async () => {
    await address.fill('Parramatta');
    await expect(page.getByRole('option', { name: '3 Parramatta Rd, Annandale NSW 2038' })).toBeVisible();
  };
  const typeMore = async () => {
    const held = await holdSuggestions(page);
    await address.press('x');
    await page.waitForRequest('**/properties/address-suggestions?q=Parramattax**');
    return held;
  };

  await open();
  const chosen = await typeMore();
  await page.getByRole('option', { name: '3 Parramatta Rd, Annandale NSW 2038' }).click();
  expect(await chosen.arrive()).toBe(false);
  await expect(address).toHaveValue('3 Parramatta Rd');
  await chosen.stop();

  await open();
  const escaped = await typeMore();
  await address.press('Escape');
  expect(await escaped.arrive()).toBe(false);
  await escaped.stop();

  await open();
  const left = await typeMore();
  await address.blur();
  expect(await left.arrive()).toBe(false);
  await left.stop();
});
