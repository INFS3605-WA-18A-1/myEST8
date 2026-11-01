// The dashboard's "Your day at a glance" bubbles in the browser: they sit inside their card
// at laptop, tablet and phone widths, and the page never scrolls sideways on a phone.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { signIn } from './support/actions.ts';
import { freePort, startDemo, uniqueSchema } from './support/server.ts';

const overflow = (page: Page) => page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth');

/** Each count bubble's box, and whether it sits inside the glance card. */
function bubbles(page: Page) {
  return page
    .getByRole('group', { name: 'Counts' })
    .getByRole('link')
    .evaluateAll((els) => {
      const card = els[0]?.closest('.glance')?.getBoundingClientRect();
      return els.map((el) => {
        const box = el.getBoundingClientRect();
        return {
          inside: !!card && box.left >= card.left - 1 && box.right <= card.right + 1 && box.top >= card.top - 1 && box.bottom <= card.bottom + 1,
          spills: el.scrollWidth > el.clientWidth + 1,
        };
      });
    });
}

test('on a laptop and a tablet the count bubbles sit inside their card, and none spills', async ({ page }) => {
  await signIn(page);
  for (const width of [1366, 1024, 800]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const laid = await bubbles(page);
    expect(laid.length, `${width}px`).toBeGreaterThanOrEqual(5);
    expect(laid.every((bubble) => bubble.inside), `${width}px`).toBe(true);
    expect(laid.every((bubble) => !bubble.spills), `${width}px`).toBe(true);
  }
});

test('the Inbox bubble opens a dialog, and Escape returns focus to the bubble', async ({ page }) => {
  // The bubble floats until it is asked not to, so a click waits forever for it to sit still.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/');
  const bubble = page.getByRole('group', { name: 'Counts' }).getByRole('link', { name: /Inbox/ });
  await bubble.click();
  const dialog = page.getByRole('dialog', { name: 'Inbox' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(bubble).toBeFocused();
});

test('choosing a day refreshes the visit list and leaves the greeting in place', async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/');
  const greeting = page.getByRole('heading', { level: 2, name: /^Hi,/ });
  await greeting.evaluate((el) => {
    Reflect.set(el, '__stay', 'greeting');
  });
  const week = nextSeven(page);
  const heading = week.getByRole('heading', { level: 3 });
  const before = ((await heading.textContent()) ?? '').trim();
  await week.getByRole('list').first().getByRole('link').nth(1).click();
  await expect(page).toHaveURL(/[?&]day=\d{4}-\d{2}-\d{2}/);
  await expect(heading).not.toHaveText(before);
  await expect(greeting).toHaveJSProperty('__stay', 'greeting');
  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'All' })).toHaveAttribute(
    'href',
    /[?&]day=\d{4}-\d{2}-\d{2}/,
  );
});

test('on a phone the bubbles stay inside their card, and the page never scrolls sideways', async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const phone = await bubbles(page);
  expect(phone.length).toBeGreaterThanOrEqual(5);
  expect(phone.every((bubble) => bubble.inside)).toBe(true);
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
