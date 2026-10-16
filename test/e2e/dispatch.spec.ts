import { expect, test } from '@playwright/test';
import { signIn } from './support/actions.ts';

// The Dispatch map in a real browser: Leaflet draws the pins, and the table and the
// keyboard pick a Property just as the mouse does. Roles and names only.

const KING_ST = '12 King St, Newtown NSW 2042';

test('Dispatch shows the map with a pin per Property, and picking a Property in the table opens its panel', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dispatch' }).click();

  await expect(page.getByRole('heading', { name: 'Dispatch', level: 1 })).toBeVisible();
  const map = page.getByRole('region', { name: /^Map\./ });
  await expect(map).toBeVisible();
  // A pin is a button named by its Property: the map is as usable as the table.
  const pin = map.getByRole('button', { name: new RegExp(`^${KING_ST}`) });
  await expect(pin).toBeVisible();
  await expect(page.getByRole('heading', { name: KING_ST, level: 2 })).toBeHidden();

  // 12 King St has no open Tickets, so it sits in the folded table.
  await page.getByText(/^Show the \d+ Properties with no open Tickets/).click();
  await page.getByRole('table', { name: /^Properties with no open Tickets/ }).getByRole('link', { name: KING_ST }).click();

  await expect(page.getByRole('heading', { name: KING_ST, level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Nearest Tradies, within 15 km/, level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Open Tickets', level: 3 })).toBeVisible();
  await expect(page.getByRole('link', { name: KING_ST, exact: true })).toHaveAttribute('aria-current', 'true');
});

test('a pin can be picked with the keyboard, and Close puts the focus back on it', async ({ page }) => {
  await signIn(page);
  await page.goto('/dispatch');
  const pin = page.getByRole('region', { name: /^Map\./ }).getByRole('button', { name: new RegExp(`^${KING_ST}`) });

  await pin.focus();
  await page.keyboard.press('Enter');

  const panel = page.getByRole('heading', { name: KING_ST, level: 2 });
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
  await expect(pin).toBeFocused();
});
