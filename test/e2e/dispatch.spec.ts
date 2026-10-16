import { expect, test, type Locator, type Page } from '@playwright/test';
import { signIn } from './support/actions.ts';

// The Dispatch map in a real browser: Leaflet draws the pins, overlapping pins are
// grouped until zoomed in, and the table and the keyboard pick a Property just as the
// mouse does. Roles and names only.

const KING_ST = '12 King St, Newtown NSW 2042';

/** A 1×1 transparent PNG, so tile requests are answered without the network. */
const BLANK_TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** Answers the map's tile requests with a blank tile and records every URL the page asks for. */
async function recordRequests(page: Page) {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  await page.route(/basemaps\.cartocdn\.com/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_TILE }));
  return urls;
}

const theMap = (page: Page) => page.getByRole('region', { name: /^Map\./ });
const pinOf = (map: Locator, address: string) => map.getByRole('button', { name: new RegExp(`^${address}`) });
const groups = (map: Locator) => map.getByRole('button', { name: /^Group of \d+ pins/ });

/** Zooms the map in with its + button until the pin shows on its own. */
async function zoomInUntilVisible(page: Page, pin: Locator) {
  for (let i = 0; i < 8 && !(await pin.isVisible()); i++) {
    await theMap(page).getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.waitForTimeout(400); // the zoom animation
  }
  await expect(pin).toBeVisible();
}

test('Dispatch draws its pins on CARTO tiles and never asks tile.openstreetmap.org', async ({ page }) => {
  const urls = await recordRequests(page);
  await signIn(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dispatch' }).click();

  await expect(page.getByRole('heading', { name: 'Dispatch', level: 1 })).toBeVisible();
  const map = theMap(page);
  await expect(map).toBeVisible();
  // Every Property is on the map, as its own pin or inside a group.
  await expect(map.getByRole('button', { name: /^(Group of \d+ pins|.+ NSW \d{4}, \d+ open Tickets?)/ }).first()).toBeVisible();
  await expect(page.getByText('CARTO', { exact: true })).toBeVisible();

  expect(urls.some((url) => /^https:\/\/[abcd]\.basemaps\.cartocdn\.com\/light_all\//.test(url))).toBe(true);
  expect(urls.filter((url) => url.includes('tile.openstreetmap.org'))).toEqual([]);
});

test('pins that overlap are grouped with a count until the map is zoomed in', async ({ page }) => {
  await recordRequests(page);
  await signIn(page);
  await page.goto('/dispatch');
  const map = theMap(page);

  // The inner-west Properties and Tradies sit close together: at the first view they are groups.
  await expect(groups(map).first()).toBeVisible();
  await expect(pinOf(map, KING_ST)).toHaveCount(0);

  // Enter on a group of Properties zooms in to it, so it splits up.
  const group = map.getByRole('button', { name: /^Group of \d+ pins: \d+ Propert/ }).first();
  const name = (await group.getAttribute('aria-label'))!;
  await group.focus();
  await page.keyboard.press('Enter');
  await expect(map.getByRole('button', { name, exact: true })).toHaveCount(0);

  // Zoomed in from the first view, 12 King St stands on its own.
  await page.reload();
  await zoomInUntilVisible(page, pinOf(map, KING_ST));
});

test('picking a Property in the table opens its panel and shows its pin, even when it was in a group', async ({ page }) => {
  await recordRequests(page);
  await signIn(page);
  await page.goto('/dispatch');
  const map = theMap(page);
  await expect(groups(map).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: KING_ST, level: 2 })).toBeHidden();

  // 12 King St has no open Tickets, so it sits in the folded table.
  await page.getByText(/^Show the \d+ Properties with no open Tickets/).click();
  await page.getByRole('table', { name: /^Properties with no open Tickets/ }).getByRole('link', { name: KING_ST }).click();

  await expect(page.getByRole('heading', { name: KING_ST, level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Nearest Tradies, within 15 km/, level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Open Tickets', level: 3 })).toBeVisible();
  await expect(page.getByRole('link', { name: KING_ST, exact: true })).toHaveAttribute('aria-current', 'true');
  // The map zooms in until the picked pin stands on its own.
  await expect(pinOf(map, KING_ST)).toBeVisible();
});

test('a pin can be picked with the keyboard, and Close puts the focus back on it', async ({ page }) => {
  await recordRequests(page);
  await signIn(page);
  await page.goto('/dispatch');
  const pin = pinOf(theMap(page), KING_ST);
  await zoomInUntilVisible(page, pin);

  await pin.focus();
  await page.keyboard.press('Enter');

  const panel = page.getByRole('heading', { name: KING_ST, level: 2 });
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
  await expect(pin).toBeFocused();
});

test('on a phone the page never scrolls sideways, and the panel opens under the map', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await recordRequests(page);
  await signIn(page);
  await page.goto('/dispatch');
  await page.getByText(/^Show the \d+ Properties with no open Tickets/).click();
  await page.getByText(/^Show all \d+ Tradies/).click();

  const overflow = () => page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  expect(await overflow()).toBe(0);

  await page.getByRole('table', { name: /^Properties with no open Tickets/ }).getByRole('link', { name: KING_ST }).click();
  const heading = page.getByRole('heading', { name: KING_ST, level: 2 });
  await expect(heading).toBeInViewport();
  const mapBox = (await theMap(page).boundingBox())!;
  expect((await heading.boundingBox())!.y).toBeGreaterThan(mapBox.y + mapBox.height);
  expect(await overflow()).toBe(0);
});
