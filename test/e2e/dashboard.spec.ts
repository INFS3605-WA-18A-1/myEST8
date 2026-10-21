// The dashboard's count strip in the browser: six counts on one line on a laptop,
// each tile holding its own label, and the page never scrolling sideways on a phone.

import { expect, test, type Page } from '@playwright/test';
import { signIn } from './support/actions.ts';

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
