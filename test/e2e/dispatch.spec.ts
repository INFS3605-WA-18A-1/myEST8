import { expect, test, type Locator, type Page } from '@playwright/test';
import { signIn } from './support/actions.ts';

// The Dispatch map in a real browser: MapLibre draws the basemap, the pins are real
// buttons laid over it, overlapping pins are grouped until zoomed in, and the table and
// the keyboard pick a Property just as the mouse does. Roles and names only, and nothing
// here reads canvas pixels or waits on a tile download: the pins are DOM markers.

const KING_ST = '12 King St, Newtown NSW 2042';
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/** An empty style (just the background), so the map loads without the network. */
const BLANK_STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f2f3f0' } }] };

/**
 * Answers the basemap's requests without the network: the style is a blank one, anything else
 * OpenFreeMap would send (tiles, sprites, fonts) is refused. Records every URL the page asks for.
 */
async function stubBasemap(page: Page, { style = true } = {}) {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  await page.route(/^https:\/\/tiles\.openfreemap\.org\//, (route) => {
    if (style && route.request().url() === STYLE_URL) return route.fulfill({ json: BLANK_STYLE });
    return route.abort();
  });
  return urls;
}

/** Whether this browser can run MapLibre. If not, the map's place must say so, and that is all there is to check. */
async function canDrawMap(page: Page) {
  const webgl = await page.evaluate<boolean>("!!document.createElement('canvas').getContext('webgl2') || !!document.createElement('canvas').getContext('webgl')");
  if (!webgl) await expect(page.getByText(/^The map could not load/)).toBeVisible();
  return webgl;
}

const theMap = (page: Page) => page.getByRole('region', { name: /^Map\./ });
const pinOf = (map: Locator, address: string) => map.getByRole('button', { name: new RegExp(`^${address}`) });
const groups = (map: Locator) => map.getByRole('button', { name: /^Group of \d+ pins/ });
/** Every pin and group on the map, whatever its kind. */
const everyPin = (map: Locator) => map.getByRole('button', { name: /^Group of \d+ pins|^Tradie: |, \d+ open Tickets?/ });
const zoomIn = (map: Locator) => map.getByRole('button', { name: 'Zoom in', exact: true });
const zoomOut = (map: Locator) => map.getByRole('button', { name: 'Zoom out', exact: true });

/** How many Properties and Tradies the pins and groups on the map stand for. */
async function pinsDrawn(map: Locator) {
  const names = await everyPin(map).evaluateAll((pins) => pins.map((pin) => pin.getAttribute('aria-label') ?? ''));
  return names.reduce((sum, name) => sum + Number(/^Group of (\d+) pins/.exec(name)?.[1] ?? 1), 0);
}

/** Zooms the map in with its + button until the pin shows on its own. */
async function zoomInUntilVisible(map: Locator, pin: Locator) {
  for (let i = 0; i < 8 && !(await pin.isVisible()); i++) {
    await zoomIn(map).click();
    await pin.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {});
  }
  await expect(pin).toBeVisible();
}

test('Dispatch draws a pin or group for every Property and Tradie with a location, on OpenFreeMap Positron and nothing else', async ({ page }) => {
  const urls = await stubBasemap(page);
  await signIn(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dispatch' }).click();
  await expect(page.getByRole('heading', { name: 'Dispatch', level: 1 })).toBeVisible();
  if (!(await canDrawMap(page))) return;

  const map = theMap(page);
  await expect(map).toBeVisible();
  await expect(everyPin(map).first()).toBeVisible();

  // The Tradies may be spread beyond the first view, which frames the Properties: zoom out until every one is in.
  const located = await page.evaluate<number>(
    "(() => { const data = JSON.parse(document.getElementById('dispatch-data').textContent); return data.properties.length + data.tradies.length; })()",
  );
  expect(located).toBeGreaterThan(1);
  for (let i = 0; i < 3; i++) await zoomOut(map).click();
  await expect.poll(() => pinsDrawn(map)).toBe(located);

  expect(urls).toContain(STYLE_URL);
  expect(urls.filter((url) => /tile\.openstreetmap\.org|basemaps\.cartocdn\.com|arcgisonline\.com/.test(url))).toEqual([]);
});

test('pins that overlap are grouped with a count, and a group splits when it is activated', async ({ page }) => {
  await stubBasemap(page);
  await signIn(page);
  await page.goto('/dispatch');
  if (!(await canDrawMap(page))) return;
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

  // A click does the same, and from the first view 12 King St ends up standing on its own.
  await page.reload();
  await expect(groups(map).first()).toBeVisible();
  await zoomInUntilVisible(map, pinOf(map, KING_ST));
});

test('picking a Property in the table opens its panel and shows its pin, even when it was in a group', async ({ page }) => {
  await stubBasemap(page);
  await signIn(page);
  await page.goto('/dispatch');
  if (!(await canDrawMap(page))) return;
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

test('Enter on a focused pin opens its panel, and Close puts the focus back on the pin', async ({ page }) => {
  await stubBasemap(page);
  await signIn(page);
  await page.goto('/dispatch');
  if (!(await canDrawMap(page))) return;
  const map = theMap(page);
  const pin = pinOf(map, KING_ST);
  await zoomInUntilVisible(map, pin);

  await pin.focus();
  await page.keyboard.press('Enter');

  const panel = page.getByRole('heading', { name: KING_ST, level: 2 });
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
  await expect(pin).toBeFocused();
});

test('without WebGL the map is replaced by a note that points to the table, and the table still picks a Property', async ({ page }) => {
  await stubBasemap(page);
  await page.addInitScript('HTMLCanvasElement.prototype.getContext = () => null;');
  await signIn(page);
  await page.goto('/dispatch');

  await expect(page.getByText(/^The map could not load/)).toBeVisible();
  await expect(page.getByText(/The table below lists the same Properties/)).toBeVisible();
  await expect(page.getByText('The map needs JavaScript')).toBeHidden();

  await page.getByText(/^Show the \d+ Properties with no open Tickets/).click();
  await page.getByRole('table', { name: /^Properties with no open Tickets/ }).getByRole('link', { name: KING_ST }).click();
  await expect(page.getByRole('heading', { name: KING_ST, level: 2 })).toBeVisible();
});

test('when the basemap style does not load the map is replaced by the same note', async ({ page }) => {
  await stubBasemap(page, { style: false });
  await signIn(page);
  await page.goto('/dispatch');
  if (!(await canDrawMap(page))) return;

  await expect(page.getByText(/^The map could not load/)).toBeVisible();
  await expect(everyPin(theMap(page))).toHaveCount(0);
});

test('on a phone the page never scrolls sideways, and the panel opens under the map', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubBasemap(page);
  await signIn(page);
  await page.goto('/dispatch');
  await page.getByText(/^Show the \d+ Properties with no open Tickets/).click();

  const overflow = () => page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  expect(await overflow()).toBe(0);

  await page.getByRole('table', { name: /^Properties with no open Tickets/ }).getByRole('link', { name: KING_ST }).click();
  const heading = page.getByRole('heading', { name: KING_ST, level: 2 });
  await expect(heading).toBeInViewport();
  // Measured together, as the page may still be scrolling to the panel.
  const map = await theMap(page).elementHandle();
  const gap = () => heading.evaluate((h, m) => h.getBoundingClientRect().top - m!.getBoundingClientRect().bottom, map);
  await expect.poll(gap).toBeGreaterThan(0);
  expect(await overflow()).toBe(0);
});
