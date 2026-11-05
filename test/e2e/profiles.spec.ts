import { expect, test, type Locator, type Page } from '@playwright/test';
import { signIn } from './support/actions.ts';

// Open Profiles from the side menu, add a Tenant, and check a phone doesn't scroll sideways.
// The Property photo is decorative (an empty alt), so the layout checks find the img itself.

const overflow = (page: Page) => page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth');

const rect = async (locator: Locator) => (await locator.boundingBox())!;

/** Where the photo's fade finishes and the picture is fully visible, in px from its left edge. */
async function fadeWidth(card: Locator): Promise<number> {
  return card.evaluate((el) => {
    const view = el.ownerDocument.defaultView;
    const probe = el.ownerDocument.createElement('div');
    probe.style.position = 'absolute';
    probe.style.width = (view?.getComputedStyle(el).getPropertyValue('--household-photo-fade') ?? '0').trim();
    el.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  });
}

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

test('a Property photo sits flush on the household card, clear of the Ticket text, and a phone does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page);
  await page.goto('/profiles?filter=all');

  const cards = page.locator('article.household');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  let photos = 0;
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const photo = card.locator('img.household-photo');
    if ((await photo.count()) === 0) continue;
    photos += 1;
    await card.scrollIntoViewIfNeeded();
    await expect(photo).toBeVisible();
    const cardBox = await rect(card);
    const photoBox = await rect(photo);
    expect(Math.abs(photoBox.y - cardBox.y), 'top').toBeLessThanOrEqual(1);
    expect(Math.abs(photoBox.y + photoBox.height - (cardBox.y + cardBox.height)), 'bottom').toBeLessThanOrEqual(1);
    expect(Math.abs(photoBox.x + photoBox.width - (cardBox.x + cardBox.width)), 'right').toBeLessThanOrEqual(1);

    const unfadedLeft = photoBox.x + (await fadeWidth(card));
    const list = card.getByRole('list', { name: 'Open Tickets' });
    if ((await list.count()) > 0) expect((await rect(list)).x + (await rect(list)).width, 'open Tickets').toBeLessThanOrEqual(unfadedLeft + 1);
    const calm = card.getByText('No open Tickets', { exact: true });
    if ((await calm.count()) > 0) expect((await rect(calm)).x + (await rect(calm)).width, 'no open Tickets').toBeLessThanOrEqual(unfadedLeft + 1);
    const more = card.getByRole('link', { name: /more open Ticket/ });
    if ((await more.count()) > 0) expect((await rect(more)).x + (await rect(more)).width, 'more open Tickets').toBeLessThanOrEqual(unfadedLeft + 1);
  }
  expect(photos).toBeGreaterThan(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cards.first()).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
