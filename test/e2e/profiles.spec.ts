import { expect, test, type Locator, type Page } from '@playwright/test';
import { signIn } from './support/actions.ts';

// Open Profiles from the side menu, add a Tenant, and check a phone doesn't scroll sideways.
// The Property photo is decorative (an empty alt), so the layout checks find its slot.

const overflow = (page: Page) => page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth');

const rect = async (locator: Locator) => (await locator.boundingBox())!;

test('Profiles opens from the side menu, and Add profile leads to a new Tenant', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'Profiles', exact: true }).click();
  await expect(page).toHaveURL(/\/profiles$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Profiles' })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // The summary is a disclosure, like the user menu, so it is not a button role.
  await page.locator('summary', { hasText: 'Add profile' }).click();
  await page.getByRole('link', { name: 'Tenant', exact: true }).click();
  await expect(page).toHaveURL(/\/tenants\/new$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Add a Tenant' })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test('a Property photo is a strip on the right of the household card, the words clear of all but its fade, and a phone does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page);
  await page.goto('/profiles?filter=all');

  const cards = page.locator('article.household');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  let slots = 0;
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    await card.scrollIntoViewIfNeeded();
    const slot = card.locator('.household-photo-slot');
    // A Property with a photo shows it; one without shows a link to add one. Either way the slot is there.
    await expect(slot).toBeVisible();
    slots += 1;
    const cardBox = await rect(card);
    const slotBox = await rect(slot);
    // A photo's words may run 1rem into the start of its fade; an empty slot keeps clear.
    const keep = (await slot.evaluate((el) => el.classList.contains('is-empty'))) ? 0 : 16;
    expect(slotBox.x + slotBox.width, 'inside the card on the right').toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
    expect(slotBox.y, 'inside the card at the top').toBeGreaterThanOrEqual(cardBox.y);
    for (const part of ['.household-main', '.household-status']) {
      const box = await rect(card.locator(part));
      expect(box.x, `${part} stays in the card`).toBeGreaterThanOrEqual(cardBox.x);
      expect(box.x + box.width, `${part} clear of the photo`).toBeLessThanOrEqual(slotBox.x + keep + 1);
    }
  }
  expect(slots).toBeGreaterThan(0);

  // Ticket history opens the open Tickets, each a link to its Ticket.
  const toggle = page.locator('.household-history-toggle').first();
  if ((await toggle.count()) > 0) {
    await toggle.click();
    await expect(page.locator('.household-history-panel:not([hidden]) a.household-ticket').first()).toBeVisible();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cards.first()).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
