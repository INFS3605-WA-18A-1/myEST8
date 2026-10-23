// The photo viewer in a real browser: a photo on a Maintenance Request opens over the
// page, the arrows, the keyboard and a swipe step through the request's photos, and
// nothing opens a new tab. Roles and visible text only.

import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Locator } from '@playwright/test';
import { withExif } from '../../src/demo/photo-exif.ts';
import { signIn, unique } from './support/actions.ts';

const sample = (name: string) => readFileSync(`src/demo/sample-photos/${name}.jpg`);

/**
 * A Tenant texts in, answers the guided questions and sends `photos` from the upload link.
 * Returns the path of the Maintenance Request's review once it has arrived. The Tenants
 * used here are in no other spec, so these can run beside them.
 */
async function requestWithPhotos(browser: Browser, tenant: string, photos: Uint8Array[]): Promise<string> {
  // Not a kitchen tap or a shower: those phrases are already open on these properties
  // in other specs, and two shared words would make this message a duplicate of theirs.
  const report = `The bedroom window is stuck shut ${unique()}`;
  const page = await browser.newPage({ baseURL: `http://localhost:${process.env.E2E_PORT}` });
  await signIn(page);
  await page.goto('/demo');
  await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: new RegExp(`^${tenant}`) }).click();
  const phone = page.getByRole('region', { name: `${tenant}'s phone` });
  const messages = phone.getByRole('region', { name: `Messages with ${tenant}` });
  for (const text of [report, "Since Monday. It isn't getting worse. I'm home weekday mornings."]) {
    await phone.getByRole('textbox', { name: 'Message' }).fill(text);
    await phone.getByRole('button', { name: `Send as ${tenant}` }).click();
    await expect(messages.getByText(text, { exact: true }).last()).toBeVisible();
  }
  const uploadLink = messages.getByRole('link', { name: /\/u\// }).last();
  await expect(uploadLink).toBeVisible();
  const uploadUrl = (await uploadLink.getAttribute('href'))!;
  const upload = await browser.newPage();
  await upload.goto(uploadUrl);
  await upload.getByLabel('Photos of the issue').setInputFiles(photos.map((photo, i) => ({ name: `photo-${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(photo) })));
  await upload.getByRole('button', { name: 'Upload' }).click();
  await expect(upload.getByRole('status')).toContainText(/has your (\d+ )?photos?/i);
  await upload.close();

  await page.goto('/tickets?filter=all');
  const row = page.getByRole('article').filter({ hasText: report });
  await expect(async () => {
    await page.reload();
    await expect(row.first()).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await row.getByRole('link', { name: 'Review' }).click();
  await expect(page.getByRole('link', { name: /^Photo 1 of / }).first()).toBeVisible();
  const path = new URL(page.url()).pathname;
  await page.close();
  return path;
}

// One worker runs the whole file, so the two requests are made once and each Tenant reports once.
test.describe.configure({ mode: 'serial' });

let several: string;
let single: string;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  several = await requestWithPhotos(browser, 'Hana Ho', [sample('dripping-tap'), sample('cupboard-leak'), sample('basin-drain')].map((jpeg, i) => withExif(jpeg, i === 1 ? { takenAt: '2020:01:01 10:00:00' } : {})));
  single = await requestWithPhotos(browser, 'Priya Patel', [sample('water-stain')]);
});

test('a photo opens in the viewer over the page, at 1 of 3, and no new tab is opened', async ({ page, context }) => {
  await signIn(page);
  await page.goto(several);
  const pages = context.pages().length;

  await page.getByRole('link', { name: 'Photo 1 of 3' }).click();

  const viewer = page.getByRole('dialog', { name: 'Photo 1 of 3' });
  await expect(viewer).toBeVisible();
  const count = viewer.getByText('1 of 3');
  await expect(count).toBeVisible();
  await expect(count).toHaveAttribute('aria-live', 'polite');
  expect(context.pages().length).toBe(pages);
  await expect(page).toHaveURL(new RegExp(`${several}$`));
});

test('Next, Previous and the arrow keys step through the photos with their captions, and wrap round', async ({ page }) => {
  await signIn(page);
  await page.goto(several);
  await page.getByRole('link', { name: 'Photo 1 of 3' }).click();
  const viewer = page.getByRole('dialog');
  await expect(viewer).toHaveAccessibleName('Photo 1 of 3');
  await expect(viewer.getByRole('img', { name: 'Photo 1 of 3' })).toBeVisible();
  await expect(viewer.getByText('No metadata')).toBeVisible();

  await viewer.getByRole('button', { name: 'Next photo' }).click();
  await expect(viewer).toHaveAccessibleName('Photo 2 of 3');
  await expect(viewer.getByRole('img', { name: 'Photo 2 of 3' })).toBeVisible();
  await expect(viewer.getByText('2 of 3')).toBeVisible();
  await expect(viewer.getByText(/^Flagged: /)).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(viewer).toHaveAccessibleName('Photo 3 of 3');
  await expect(viewer.getByText('No metadata')).toBeVisible();

  // The last photo wraps to the first, and the first back to the last.
  await page.keyboard.press('ArrowRight');
  await expect(viewer).toHaveAccessibleName('Photo 1 of 3');
  await page.keyboard.press('ArrowLeft');
  await expect(viewer).toHaveAccessibleName('Photo 3 of 3');
  await viewer.getByRole('button', { name: 'Previous photo' }).click();
  await expect(viewer).toHaveAccessibleName('Photo 2 of 3');
  await expect(viewer.getByText('2 of 3')).toBeVisible();
});

test('Escape, Close and a click on the backdrop close the viewer, and focus goes back to the photo that opened it', async ({ page, context }) => {
  await signIn(page);
  await page.goto(several);
  const pages = context.pages().length;
  const photo = page.getByRole('link', { name: 'Photo 2 of 3' });
  const viewer = page.getByRole('dialog');

  await photo.click();
  await expect(viewer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(photo).toBeFocused();

  await photo.click();
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(viewer).toBeHidden();
  await expect(photo).toBeFocused();

  // Stepping on before closing still returns to the photo that opened it.
  await photo.click();
  await page.keyboard.press('ArrowRight');
  await viewer.click({ position: { x: 8, y: 8 } });
  await expect(viewer).toBeHidden();
  await expect(photo).toBeFocused();

  // A click on the photo itself is not a click on the backdrop.
  await photo.click();
  await viewer.getByRole('img').click();
  await expect(viewer).toBeVisible();
  expect(context.pages().length).toBe(pages);
});

test('a horizontal swipe of more than 48 px steps through the photos, and a short or vertical drag does not', async ({ page }) => {
  await signIn(page);
  await page.goto(several);
  await page.getByRole('link', { name: 'Photo 1 of 3' }).click();
  const viewer = page.getByRole('dialog');
  await expect(viewer).toHaveAccessibleName('Photo 1 of 3');

  const swipe = async (dx: number, dy: number) => {
    const box = (await viewer.getByRole('img').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy);
    await page.mouse.up();
  };

  // A finger moving left brings the next photo, the same as the right arrow.
  await swipe(-80, 0);
  await expect(viewer).toHaveAccessibleName('Photo 2 of 3');
  await swipe(80, 0);
  await expect(viewer).toHaveAccessibleName('Photo 1 of 3');

  await swipe(-40, 0);
  await expect(viewer).toHaveAccessibleName('Photo 1 of 3');
  await swipe(-80, 120);
  await expect(viewer).toHaveAccessibleName('Photo 1 of 3');
});

test('Ctrl-click and a middle-click leave the viewer closed, so the browser can open the photo its own way', async ({ page, context }) => {
  await signIn(page);
  await page.goto(several);
  const photo = page.getByRole('link', { name: 'Photo 1 of 3' });
  const pages = context.pages().length;

  const opened = context.waitForEvent('page');
  await photo.click({ modifiers: ['Control'] });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await (await opened).close();
  expect(context.pages().length).toBe(pages);

  await photo.click({ button: 'middle' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a request with one photo has no arrows and no counter', async ({ page }) => {
  await signIn(page);
  await page.goto(single);

  await page.getByRole('link', { name: 'Photo 1 of 1' }).click();

  const viewer = page.getByRole('dialog');
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveAccessibleName('Photo');
  await expect(viewer.getByRole('img', { name: 'Photo 1 of 1' })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Close' })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Previous photo' })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Next photo' })).toHaveCount(0);
  await expect(viewer.getByText(/\d of \d/)).toBeHidden();

  await page.keyboard.press('ArrowRight');
  await expect(viewer).toHaveAccessibleName('Photo');
});

const rect = async (locator: Locator) => (await locator.boundingBox())!;
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const [width, height] of [[1366, 768], [390, 844]]) {
  test(`at ${width} px the viewer fills the screen, its controls fit and clear the photo, and nothing scrolls`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await signIn(page);
    await page.goto(several);

    await page.getByRole('link', { name: 'Photo 2 of 3' }).click();
    const viewer = page.getByRole('dialog');
    await expect(viewer.getByRole('img')).toBeVisible();
    // Clicking brought the photo into view, so the page is scrolled down.
    const scrolled = await page.evaluate<number>('window.scrollY');

    expect(await rect(viewer)).toMatchObject({ x: 0, y: 0, width, height });
    const photo = await rect(viewer.getByRole('img'));
    expect(photo.x).toBeGreaterThanOrEqual(0);
    expect(photo.x + photo.width).toBeLessThanOrEqual(width);
    for (const name of ['Close', 'Previous photo', 'Next photo']) {
      const button = await rect(viewer.getByRole('button', { name }));
      expect(button.width, name).toBeGreaterThanOrEqual(44);
      expect(button.height, name).toBeGreaterThanOrEqual(44);
      expect(button.x, name).toBeGreaterThanOrEqual(0);
      expect(button.x + button.width, name).toBeLessThanOrEqual(width);
      expect(button.y + button.height, name).toBeLessThanOrEqual(height);
      expect(overlap(button, photo), name).toBe(false);
    }
    // The photo takes the room: the width on a phone, the height on a laptop.
    expect(width === 390 ? photo.width : photo.height).toBeGreaterThan(width === 390 ? 340 : 520);
    // The caption and the counter are under the photo, and on screen.
    const caption = await rect(viewer.getByText(/^Flagged: /));
    const count = await rect(viewer.getByText('2 of 3'));
    expect(caption.y).toBeGreaterThanOrEqual(photo.y + photo.height);
    expect(count.y + count.height).toBeLessThanOrEqual(height);
    expect(count.y).toBeGreaterThanOrEqual(photo.y + photo.height);

    expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBe(0);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(200);
    expect(await page.evaluate<number>('window.scrollY')).toBe(scrolled);
    await page.keyboard.press('Escape');
    await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate<number>('window.scrollY')).toBeGreaterThan(scrolled);
  });
}
