import { expect, test } from '@playwright/test';
import { signIn } from './support/actions.ts';

test('the skip link is the first stop and jumps past the navigation into the page', async ({ page }) => {
  await signIn(page);
  await page.goto('/');

  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('main').locator(':focus')).toHaveCount(1);
});

test('every main navigation link can be reached with Tab', async ({ page }) => {
  await signIn(page);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  const links = await nav.getByRole('link').all();
  expect(links.length).toBeGreaterThan(0);

  const reached = new Set<string>();
  for (let i = 0; i < 20 && reached.size < links.length; i++) {
    await page.keyboard.press('Tab');
    const focused = nav.locator(':focus');
    if ((await focused.count()) === 1) reached.add((await focused.textContent())!.trim());
  }
  expect([...reached].sort()).toEqual((await Promise.all(links.map(async (l) => (await l.textContent())!.trim()))).sort());
});
