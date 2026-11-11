import { expect, test } from '@playwright/test';
import { signIn } from './support/actions.ts';

// The flash after an action is a toast (the React toaster island, client/toaster.tsx): the
// same soft alert as before, now over the page. An "ok" one has a close button and fades;
// an error stays until it is closed. Without JavaScript the flash stays in the page.

test('an ok flash shows as a toast over the page, and its close button dismisses it', async ({ page }) => {
  await signIn(page);
  await page.goto('/?ok=Details%20saved.');
  const toast = page.locator('[data-sonner-toaster]').getByRole('status');
  await expect(toast).toContainText('Details saved.');
  await expect(toast).toHaveClass(/alert-success/);
  await expect(page.locator('#main [data-flash]')).toHaveCount(0);
  await expect(page).not.toHaveURL(/ok=/);

  await toast.getByRole('button', { name: 'Dismiss message' }).click();
  await expect(toast).toHaveCount(0);
});

test('an error flash is an alert toast that stays until it is closed', async ({ page }) => {
  await signIn(page);
  await page.goto('/?error=That%20did%20not%20work.');
  const toast = page.locator('[data-sonner-toaster]').getByRole('alert');
  await expect(toast).toContainText('That did not work.');
  await expect(toast).toHaveClass(/alert-error/);
  await page.waitForTimeout(9_000);
  await expect(toast).toBeVisible();
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the flash stays in the page', async ({ page }) => {
    await signIn(page);
    await page.goto('/?ok=Details%20saved.');
    await expect(page.locator('#main [data-flash]')).toContainText('Details saved.');
  });
});
