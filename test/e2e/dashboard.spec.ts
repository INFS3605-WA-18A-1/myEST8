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

/** The issue text on each visit the Day view shows for `day`, from the schedule rather than the dashboard list. */
async function issuesOnDay(page: Page, day: string): Promise<string[]> {
  const html = await page.evaluate(async (day) => {
    const res = await fetch(`/calendar?view=day&date=${day}`);
    if (!res.ok) throw new Error(`Calendar for ${day} returned ${res.status}`);
    return res.text();
  }, day);
  return [...html.matchAll(/class="schedule-block-issue"[^>]*>[\s\S]*?title="([^"]*)"/g)].map((found) =>
    found[1]!.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&apos;', "'"),
  );
}

/** `YYYY-MM-DD` from a day chip's href. */
function dayOfHref(href: string) {
  const day = new URL(href, 'http://localhost').searchParams.get('day');
  if (!day) throw new Error(`No day in ${href}`);
  return day;
}

test('a visit time keeps a column wide enough for 12:30 pm', async ({ browser }) => {
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
    await (await laterBookedDay(week)).click();
    const time = week.locator('.visit-time').first();
    await expect(time).toBeVisible();
    const measured = await time.evaluate((el) => {
      const doc = el.ownerDocument;
      const view = doc.defaultView;
      if (!view) throw new Error('No window');
      const probe = doc.createElement('span');
      const style = view.getComputedStyle(el);
      probe.textContent = '12:30 pm';
      probe.style.font = style.font;
      probe.style.fontWeight = style.fontWeight;
      probe.style.fontVariantNumeric = style.fontVariantNumeric;
      probe.style.position = 'absolute';
      probe.style.whiteSpace = 'nowrap';
      probe.style.visibility = 'hidden';
      doc.body.appendChild(probe);
      const needed = probe.getBoundingClientRect().width;
      probe.remove();
      return { column: el.getBoundingClientRect().width, needed };
    });
    expect(measured.column).toBeGreaterThanOrEqual(measured.needed - 1);

    const edges = await week.locator('.visit-what').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
    expect(new Set(edges).size).toBe(1);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await week.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);

    await context.close();
  } finally {
    await server.stop();
  }
});

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
    const todayChip = week.getByRole('list').first().locator('[aria-current="date"]');
    const todayIssues = await issuesOnDay(page, dayOfHref((await todayChip.getAttribute('href'))!));
    const later = await laterBookedDay(week);
    const href = (await later.getAttribute('href'))!;
    const chosenIssues = await issuesOnDay(page, dayOfHref(href));
    expect(chosenIssues.length).toBeGreaterThan(0);
    for (const issue of todayIssues) expect(chosenIssues, issue).not.toContain(issue);

    await later.click();
    await expect(page).toHaveURL(/[?&]day=\d{4}-\d{2}-\d{2}/);
    await expect(page).toHaveURL(/#next-7-days/);
    await expect(heading).not.toHaveText(today);
    const chosen = await visitsText(week);
    for (const issue of chosenIssues) expect(chosen).toContain(issue);
    for (const issue of todayIssues) expect(chosen).not.toContain(issue);
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
