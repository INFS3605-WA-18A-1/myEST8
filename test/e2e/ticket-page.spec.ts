import { expect, test, type Page } from '@playwright/test';
import { signIn } from './support/actions.ts';
import { freePort, startDemo, uniqueSchema } from './support/server.ts';

// The Ticket page's own behaviour in a real browser, on the demo's stories: the Progress
// tabs show one view at a time and the cost tile opens Costs, Expand fills the screen until
// Escape, Edit the Summary opens its editor, and the message log can be opened out.
// Roles and visible text only.

/** Ticket 8 is one of the stories' Tickets, with every Job done and a message log. */
async function openFirstTicket(page: Page) {
  await signIn(page);
  await page.goto('/tickets/8');
  await expect(page.getByRole('heading', { level: 1, name: /^Ticket #\d+$/ })).toBeVisible();
}

test('the Progress tabs, Expand, Edit the Summary and the message log work on a Ticket', async ({ browser }) => {
  test.setTimeout(300_000);
  const server = await startDemo({ port: freePort(), schema: uniqueSchema(), stories: true });
  try {
    const context = await browser.newContext({ baseURL: server.url, viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await openFirstTicket(page);

    // One view at a time; the cost tile's link opens Costs.
    const progress = page.getByRole('region', { name: 'Progress' });
    const timeline = progress.getByRole('tabpanel', { name: 'Timeline' });
    const costs = progress.getByRole('tabpanel', { name: 'Costs' });
    await expect(progress.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true');
    await expect(timeline).toBeVisible();
    await expect(costs).toBeHidden();
    await progress.getByRole('tab', { name: 'Costs' }).click();
    await expect(costs).toBeVisible();
    await expect(timeline).toBeHidden();
    await progress.getByRole('tab', { name: 'Timeline' }).click();
    await page.getByRole('link', { name: /^Costs/ }).click();
    await expect(costs).toBeVisible();

    // Expand fills the screen; Escape puts it back.
    const expand = page.getByRole('button', { name: 'Expand the Progress' });
    await expand.click();
    await expect(expand).toHaveAttribute('aria-pressed', 'true');
    const box = (await progress.boundingBox())!;
    expect(box.width).toBeGreaterThan(1366 * 0.9);
    await page.keyboard.press('Escape');
    await expect(expand).toHaveAttribute('aria-pressed', 'false');

    // The Timeline can be dragged sideways with the mouse.
    await progress.getByRole('tab', { name: 'Timeline' }).click();
    const board = timeline.locator('.tl-board');
    await expect.poll(() => board.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    const at = (await board.boundingBox())!;
    await page.mouse.move(at.x + at.width / 2, at.y + 40);
    await page.mouse.down();
    await page.mouse.move(at.x + at.width / 2 - 200, at.y + 40, { steps: 8 });
    await page.mouse.up();
    expect(await board.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);

    // So can the slider under it.
    const slider = progress.getByRole('slider', { name: 'Scroll the Timeline sideways' });
    await expect(slider).toBeVisible();
    await slider.fill('0');
    expect(await board.evaluate((el) => el.scrollLeft)).toBe(0);
    await slider.press('End');
    expect(await board.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);

    // The Summary's editor opens from the pencil.
    await page.getByRole('link', { name: 'Edit the Summary' }).click();
    await expect(page.getByRole('textbox', { name: 'Summary' })).toBeVisible();

    // A long message log is kept short, and opens out.
    const toggle = page.getByRole('button', { name: 'Show the whole conversation' });
    if (await toggle.isVisible()) {
      await toggle.click();
      await expect(page.getByRole('button', { name: 'Show fewer messages' })).toHaveAttribute('aria-expanded', 'true');
    }
    await context.close();
  } finally {
    await server.stop();
  }
});
