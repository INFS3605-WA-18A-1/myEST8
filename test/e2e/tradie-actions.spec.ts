import { expect, test, type Page } from '@playwright/test';
import { fixtureJpeg } from '../../src/demo/photo-exif.ts';
import { daysAhead, signIn, unique } from './support/actions.ts';

// A Work Order email's View job, Mark job done and Need another time? each open
// their page. Opening them changes nothing. Mark job done records the completion.

async function eventually(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 15_000 });
}

async function quoteLink(page: Page, person: string, issue: string) {
  let href: string | null = null;
  await expect(async () => {
    await page.goto('/demo');
    await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: new RegExp(`^${person}`) }).click();
    const thread = page.getByRole('region', { name: `Messages with ${person}` });
    await expect(thread.getByText(issue)).toBeVisible({ timeout: 1_000 });
    href = await thread.evaluate((root, issue) => {
      for (const anchor of root.querySelectorAll('a')) {
        const link = anchor.getAttribute('href') ?? '';
        if (link.includes('/q/') && (anchor.closest('div')?.textContent ?? '').includes(issue)) return link;
      }
      return null;
    }, issue);
    expect(href).toBeTruthy();
  }).toPass({ timeout: 15_000 });
  return href!;
}

const USUALLY_HOME = "Since Monday. It isn't getting worse. I'm home weekday mornings.";

async function photoLink(page: Page, person: string, report: string) {
  let href: string | null = null;
  let resent = false;
  await expect(async () => {
    await page.goto('/demo');
    await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: new RegExp(`^${person}`) }).click();
    const phone = page.getByRole('region', { name: `${person}'s phone` });
    const thread = phone.getByRole('region', { name: `Messages with ${person}` });
    const found = await thread.evaluate((root, report) => {
      let seen = false;
      let text = '';
      let href: string | null = null;
      for (const el of root.querySelectorAll('div, a')) {
        if (el.tagName === 'DIV' && el.childElementCount === 0 && el.textContent === report) {
          seen = true;
          text = '';
          href = null;
        } else if (!seen) {
          continue;
        } else if (el.tagName === 'A' && (el.getAttribute('href') ?? '').includes('/u/')) {
          href = el.getAttribute('href');
        } else if (el.tagName === 'DIV' && el.childElementCount === 0) {
          text += ` ${el.textContent ?? ''}`;
        }
      }
      return { href, text };
    }, report);
    href = found.href;
    const questionAt = found.text.search(/where in the property|when did it start/i);
    const answerAt = found.text.lastIndexOf('Since Monday');
    if (!href && !resent && questionAt >= 0 && (answerAt < 0 || questionAt > answerAt)) {
      resent = true;
      await phone.getByRole('textbox', { name: 'Message' }).fill(USUALLY_HOME);
      await phone.getByRole('button', { name: `Send as ${person}` }).click();
    }
    expect(href).toBeTruthy();
  }).toPass({ timeout: 20_000 });
  return href!;
}

/** A datetime-local value in the Agency's time zone. */
function sydneyLocal(at: Date) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/**
 * Books the visit at the first whole minute at least 20 seconds after the demo clock. The
 * Start field takes whole minutes, so a time a few seconds ahead would be cut back into the
 * past. Another test may move that clock, so a past time is tried again.
 */
async function bookWorkOrder(page: Page, ticketUrl: string) {
  const sent = page.getByText(/Work Order sent to Pete's Plumbing for/);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto('/demo');
    const iso = await page.locator('time.num').getAttribute('datetime');
    if (!iso) throw new Error('The demo clock is not on the page');
    await page.goto(ticketUrl);
    const minute = 60 * 1000;
    const start = Math.ceil((new Date(iso).getTime() + 20 * 1000) / minute) * minute;
    await page.getByLabel('Start').fill(sydneyLocal(new Date(start)));
    await page.getByRole('button', { name: 'Send Work Order' }).click();
    const refused = page.getByText('Pick a start time in the future');
    await expect(sent.or(refused)).toBeVisible();
    if (await sent.isVisible()) return;
  }
  throw new Error('The start time stayed in the past');
}

test("a Work Order email's buttons open their pages, and Mark job done records it", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const report = `The kitchen tap is dripping ${unique()}`;
  await signIn(page);

  await page.goto('/demo');
  await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: /^Ethan Evans/ }).click();
  const phone = page.getByRole('region', { name: "Ethan Evans's phone" });
  const messages = phone.getByRole('region', { name: 'Messages with Ethan Evans' });
  for (const text of [report, USUALLY_HOME]) {
    await phone.getByRole('textbox', { name: 'Message' }).fill(text);
    await phone.getByRole('button', { name: 'Send as Ethan Evans' }).click();
    await expect(messages.getByText(text, { exact: true }).last()).toBeVisible();
  }
  const uploader = await browser.newPage();
  await uploader.goto(await photoLink(page, 'Ethan Evans', report));
  await uploader.getByLabel('Photos of the issue').setInputFiles({
    name: 'tap.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(fixtureJpeg({ takenAt: '2026:10:08 08:30:00' })),
  });
  await uploader.getByRole('button', { name: 'Upload' }).click();
  await expect(uploader.getByRole('status')).toContainText(/has your photo/i);
  await uploader.close();

  await page.goto('/tickets');
  // Ethan Evans's Property is Bob's, so it is under All rather than Alice's Mine.
  await page.getByRole('link', { name: 'All', exact: true }).click();
  // All swaps the list in place; a reload before the address changes would show Mine again.
  await expect(page).toHaveURL(/filter=all/);
  await eventually(page, () => expect(page.getByText(report).first()).toBeVisible({ timeout: 1_000 }));
  await page.getByRole('link', { name: new RegExp(report) }).first().click();
  const confirm = page.getByRole('button', { name: /^Confirm( anyway)?$/ });
  if (!(await confirm.isVisible())) await page.getByText('Confirm', { exact: true }).click();
  await confirm.click();
  await expect(page).toHaveURL(/\/tickets\/\d+/);
  const ticketUrl = page.url().split('?')[0]!;

  const boxes = page.getByRole('checkbox', { name: /^\d+\. / });
  for (const box of await boxes.all()) if (await box.isEnabled()) await box.uncheck();
  await page.getByRole('checkbox', { name: /Pete's Plumbing/ }).check();
  await page.getByRole('checkbox', { name: /Drip Doctors/ }).check();
  await page.getByRole('button', { name: 'Send Quote Requests' }).click();
  await expect(page.getByText(/Quote Requests? sent/i).first()).toBeVisible();

  const tradie = await browser.newPage();
  for (const [person, price, scope] of [
    ['Pete Park', '150', 'Replace the tap washer'],
    ['Dana Drip', '400', 'Replace the mixer tap'],
  ] as const) {
    await tradie.goto(await quoteLink(page, person, report));
    await tradie.getByLabel('Estimate ($)').fill(price);
    await tradie.getByRole('button', { name: 'Send Estimate' }).click();
    await expect(tradie.getByRole('heading', { name: 'Give your Firm Quote' })).toBeVisible();
    await tradie.getByLabel('Firm price ($)').fill(price);
    await tradie.getByLabel('Scope of work').fill(scope);
    await tradie.getByLabel('How many days it takes').fill('1');
    await tradie.getByLabel('Preferred date and time').fill(daysAhead(3).date + 'T09:00');
    await tradie.getByRole('button', { name: 'Send Firm Quote' }).click();
    await expect(tradie.getByRole('status')).toContainText('has your Firm Quote');
  }

  await page.goto(ticketUrl);
  await eventually(page, () => expect(page.getByRole('button', { name: 'Choose this Firm Quote' }).first()).toBeVisible({ timeout: 1_000 }));
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('row', { name: /Pete's Plumbing.*Replace the tap washer/ }).getByRole('button', { name: 'Choose this Firm Quote' }).click();
  await expect(page.getByText("Firm Quote from Pete's Plumbing chosen and approved", { exact: true })).toBeVisible();

  await bookWorkOrder(page, ticketUrl);

  let doneHref = '';
  let anotherHref = '';
  let viewHref = '';
  await expect(async () => {
    await page.goto('/demo');
    await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: /^Pete Park/ }).click();
    const thread = page.getByRole('region', { name: 'Messages with Pete Park' });
    const hrefs = await thread.evaluate((root, report) => {
      const found: string[] = [];
      for (const anchor of root.querySelectorAll('a')) {
        const href = anchor.getAttribute('href') ?? '';
        if (href.includes('/q/') && (anchor.closest('div')?.textContent ?? '').includes(report)) found.push(href);
      }
      return found;
    }, report);
    doneHref = hrefs.find((href) => href.endsWith('/done')) ?? '';
    anotherHref = hrefs.find((href) => href.endsWith('/another')) ?? '';
    viewHref = doneHref.replace(/\/done$/, '');
    expect(doneHref).toBeTruthy();
    expect(anotherHref).toBeTruthy();
  }).toPass({ timeout: 15_000 });

  await tradie.goto(viewHref);
  await expect(tradie.getByText('A Work Order with the visit time will follow.')).toBeVisible();

  await tradie.goto(anotherHref);
  await expect(tradie.getByRole('button', { name: 'Need another time?' })).toBeVisible();

  await tradie.goto(doneHref);
  await expect(tradie.getByRole('heading', { name: /done/i })).toBeVisible();

  await page.goto(ticketUrl);
  await expect(page.getByText("Pete's Plumbing finished the Job")).toHaveCount(0);
  await expect(page.getByText('asked for another')).toHaveCount(0);

  // The visit was booked up to 80 seconds ahead of the demo clock, which keeps running.
  // Opening the page did not finish the job; the button does, once the visit has started.
  await expect(async () => {
    await tradie.goto(doneHref);
    await expect(tradie.getByRole('button', { name: 'Mark job done' })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 90_000 });
  await tradie.getByRole('button', { name: 'Mark job done' }).click();
  await expect(tradie.getByRole('status')).toContainText('Marked done on');
  await expect(tradie.getByRole('button', { name: 'Mark job done' })).toBeDisabled();

  await page.goto(ticketUrl);
  await expect(page.getByText("Pete's Plumbing finished the Job")).toBeVisible();
  await tradie.close();
});
