// The Schedule in the browser: the Week's time grid on a laptop and its list of days on a
// phone, the Day's lanes scrolling inside their frame, and the Month's table, none of which
// ever scrolls the page sideways.

import { expect, test } from '@playwright/test';
import { signIn } from './support/actions.ts';

const overflow = (page: import('@playwright/test').Page) => page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth');

test('on a laptop the Week is an hour grid of seven days, and the tabs switch to the Day and the Month', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page);
  await page.goto('/calendar?filter=all');

  const week = page.getByRole('list', { name: 'The week, Monday to Sunday' });
  await expect(week).toBeVisible();
  await expect(week.locator('> li')).toHaveCount(7);
  await expect(page.getByRole('region', { name: 'The week, hour by hour' })).toBeVisible();
  expect(await overflow(page)).toBe(0);

  // The day columns sit side by side, Monday first.
  const [monday, tuesday] = await Promise.all([week.locator('> li').nth(0).boundingBox(), week.locator('> li').nth(1).boundingBox()]);
  expect(tuesday!.x).toBeGreaterThan(monday!.x);
  expect(tuesday!.y).toBe(monday!.y);

  const views = page.getByRole('navigation', { name: 'Calendar views' });
  await views.getByRole('link', { name: 'Day' }).click();
  await expect(page).toHaveURL(/view=day/);
  await views.getByRole('link', { name: 'Month' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('columnheader')).toHaveCount(7);
  expect(await overflow(page)).toBe(0);
});

test('the toolbar is one row on a laptop, Next then Today returns to this week, and a phone does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page);
  await page.goto('/calendar?filter=all');

  await expect(page.getByRole('region', { name: 'The week, hour by hour' })).toBeVisible();
  const today = page.getByRole('link', { name: 'Today', exact: true });
  const week = page.getByRole('navigation', { name: 'Calendar views' }).getByRole('link', { name: 'Week' });
  const todayBox = await today.boundingBox();
  const weekBox = await week.boundingBox();
  expect(Math.abs(todayBox!.y - weekBox!.y)).toBeLessThan(8);
  expect(await overflow(page)).toBe(0);

  const period = page.locator('.schedule-period');
  const title = (await period.textContent())!.trim();
  await page.getByRole('link', { name: 'Next week' }).click();
  await expect(period).not.toHaveText(title);
  await today.click();
  await expect(period).toHaveText(title);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/calendar?filter=all');
  expect(await overflow(page)).toBe(0);
  const todayPhone = (await page.getByRole('link', { name: 'Today', exact: true }).boundingBox())!;
  const weekPhone = (await page.getByRole('navigation', { name: 'Calendar views' }).getByRole('link', { name: 'Week' }).boundingBox())!;
  expect(weekPhone.y).toBeGreaterThan(todayPhone.y + todayPhone.height - 4);
});

test('the Free today panel sits beside the Week on a laptop and above it on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page);
  await page.goto('/calendar?filter=all');

  const panel = page.getByRole('complementary', { name: /^Free today/ });
  const grid = page.getByRole('region', { name: 'The week, hour by hour' });
  await expect(panel).toBeVisible();
  const panelBox = (await panel.boundingBox())!;
  const gridBox = (await grid.boundingBox())!;
  // Beside: the panel's left edge is the grid's right edge, and they share a top.
  expect(panelBox.x).toBeGreaterThan(gridBox.x + gridBox.width - 2);
  expect(Math.abs(panelBox.y - gridBox.y)).toBeLessThan(8);
  expect(await overflow(page)).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const panelPhone = (await panel.boundingBox())!;
  // Under 768px the Week is the list of days; the hour grid is not on screen.
  const list = page.getByRole('list', { name: 'The week, Monday to Sunday' });
  const listBox = (await list.boundingBox())!;
  expect(panelPhone.y + panelPhone.height).toBeLessThanOrEqual(listBox.y + 4);
  expect(await overflow(page)).toBe(0);
});

test('on a phone the Week is a list of days, and no view scrolls the page sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  await page.goto('/calendar?filter=all');
  await expect(page.getByRole('region', { name: 'The week, hour by hour' })).toBeHidden();
  await expect(page.getByRole('list', { name: 'The week, Monday to Sunday' })).toBeVisible();
  expect(await overflow(page)).toBe(0);

  for (const view of ['day', 'month']) {
    await page.goto(`/calendar?view=${view}&filter=all`);
    expect(await overflow(page), view).toBe(0);
  }
});
