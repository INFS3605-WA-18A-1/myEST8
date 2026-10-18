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
