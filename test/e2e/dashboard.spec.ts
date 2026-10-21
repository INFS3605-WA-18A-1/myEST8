// The dashboard's count strip in the browser: six counts on one line on a laptop,
// each tile holding its own label, and the page never scrolling sideways on a phone.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { signIn } from './support/actions.ts';
import { freePort, startDemo, uniqueSchema } from './support/server.ts';

const overflow = (page: Page) => page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth');

/** Each count tile's top, and whether its content spills past the tile. */
function tiles(page: Page) {
  return page
    .getByRole('navigation', { name: 'Counts' })
    .getByRole('link')
    .evaluateAll((els) =>
      els.map((el) => ({
        top: Math.round(el.getBoundingClientRect().top),
        spills: el.scrollWidth > el.clientWidth,
      })),
    );
}

test('on a laptop the six counts sit on one line, and none spills out of its tile', async ({ page }) => {
  await signIn(page);
  for (const width of [1366, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const laid = await tiles(page);
    expect(laid, `${width}px`).toHaveLength(6);
    expect(new Set(laid.map((tile) => tile.top)).size, `${width}px`).toBe(1);
    expect(laid.every((tile) => !tile.spills), `${width}px`).toBe(true);
  }
});

/** How many tiles share each row, top to bottom. */
function rowCounts(laid: { top: number }[]) {
  const counts = new Map<number, number>();
  for (const tile of laid) counts.set(tile.top, (counts.get(tile.top) ?? 0) + 1);
  return [...counts.values()];
}

test('the counts are three across from 640px and two across on a phone, with no sideways scroll', async ({ page }) => {
  await signIn(page);

  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/');
  const tablet = await tiles(page);
  expect(tablet).toHaveLength(6);
  expect(rowCounts(tablet)).toEqual([3, 3]);
  expect(tablet.every((tile) => !tile.spills)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await tiles(page);
  expect(phone).toHaveLength(6);
  expect(rowCounts(phone)).toEqual([2, 2, 2]);
  expect(phone.every((tile) => !tile.spills)).toBe(true);
  expect(await overflow(page)).toBe(0);
});

function nextSeven(page: Page) {
  return page.getByRole('heading', { level: 2, name: 'Next 7 days' }).locator('xpath=ancestor::section[1]');
}

/** The first day chip after today that has a visit. */
async function laterBookedDay(week: Locator) {
  const chips = week.getByRole('list').first().getByRole('link');
  for (let i = 0; i < (await chips.count()); i++) {
    const chip = chips.nth(i);
    if ((await chip.getAttribute('aria-current')) === 'date') continue;
    if ((await chip.getByRole('img', { name: 'Has a visit' }).count()) === 0) continue;
    return chip;
  }
  throw new Error('No later day in the next 7 has a visit');
}

/** The chosen day's visits, or the empty sentence when that day has none. */
async function visitsText(week: Locator) {
  const lists = week.getByRole('list');
  if ((await lists.count()) < 2) return ((await week.getByText(/^Nothing booked on /).textContent()) ?? '').trim();
  return (await lists.nth(1).innerText()).trim();
}

test("pressing a later day shows that day's visit and not today's, by mouse and by keyboard", async ({ browser }) => {
  test.setTimeout(300_000);
  const server = await startDemo({ port: freePort(), schema: uniqueSchema(), stories: true });
  try {
    const context = await browser.newContext({ baseURL: server.url });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await signIn(page);
    await page.goto('/');

    const week = nextSeven(page);
    const heading = week.getByRole('heading', { level: 3 });
    const today = ((await heading.textContent()) ?? '').trim();
    const todayVisits = await visitsText(week);
    const later = await laterBookedDay(week);
    const href = (await later.getAttribute('href'))!;

    await later.click();
    await expect(page).toHaveURL(/[?&]day=\d{4}-\d{2}-\d{2}/);
    await expect(page).toHaveURL(/#next-7-days/);
    await expect(heading).not.toHaveText(today);
    const chosen = await visitsText(week);
    expect(chosen).not.toBe(todayVisits);
    expect(chosen).not.toContain(today);
    await expect(week.getByRole('list').nth(1).getByRole('link').first()).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await week.getByRole('list').first().evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/');
    await expect(heading).toHaveText(today);
    for (let i = 0; i < 160; i++) {
      await page.keyboard.press('Tab');
      if ((await page.locator(':focus').getAttribute('href')) === href) break;
      if (i === 159) throw new Error(`Tab never reached ${href}`);
    }
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/[?&]day=\d{4}-\d{2}-\d{2}/);
    await expect(heading).not.toHaveText(today);
    expect(await visitsText(week)).toBe(chosen);

    await context.close();
  } finally {
    await server.stop();
  }
});
