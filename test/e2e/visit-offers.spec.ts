import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fixtureJpeg } from '../../src/demo/photo-exif.ts';
import { signIn, unique } from './support/actions.ts';

// The Tradie offers two visit times, the Tenant opens one (which does not book it),
// then presses Book. Roles and visible text only.

/** Reloads the page until `check` passes: the background worker reads each reply a moment after it is sent. */
async function eventually(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 15_000 });
}

/**
 * The quote page link in this issue's Quote Request. The simulator is one shared
 * thread, so another test's link to the same Tradie is there too; the message names the issue.
 */
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

test('the Tradie offers visit times and the Tenant books one', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const report = `The kitchen tap is dripping ${unique()}`;
  await signIn(page);

  await page.goto('/demo');
  await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: /^Tom Tran/ }).click();
  const phone = page.getByRole('region', { name: "Tom Tran's phone" });
  const messages = phone.getByRole('region', { name: 'Messages with Tom Tran' });
  for (const text of [report, "Since Monday. It isn't getting worse. I'm home weekday mornings."]) {
    await phone.getByRole('textbox', { name: 'Message' }).fill(text);
    await phone.getByRole('button', { name: 'Send as Tom Tran' }).click();
    await expect(messages.getByText(text, { exact: true }).last()).toBeVisible();
  }
  const uploadLink = messages.getByRole('link', { name: /\/u\// }).last();
  await expect(uploadLink).toBeVisible();
  const uploader = await browser.newPage();
  await uploader.goto((await uploadLink.getAttribute('href'))!);
  await uploader.getByLabel('Photos of the issue').setInputFiles({
    name: 'tap.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(fixtureJpeg({ takenAt: '2026:10:08 08:30:00' })),
  });
  await uploader.getByRole('button', { name: 'Upload' }).click();
  await expect(uploader.getByRole('status')).toContainText(/has your photo/i);
  await uploader.close();

  await page.goto('/tickets');
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
    await tradie.getByLabel('Start date 1').fill('2026-10-27');
    await tradie.getByRole('button', { name: 'Send Firm Quote' }).click();
    await expect(tradie.getByRole('status')).toContainText('has your Firm Quote');
  }

  await page.goto(ticketUrl);
  await eventually(page, () => expect(page.getByRole('button', { name: 'Choose this Firm Quote' }).first()).toBeVisible({ timeout: 1_000 }));
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('row', { name: /Pete's Plumbing.*Replace the tap washer/ }).getByRole('button', { name: 'Choose this Firm Quote' }).click();
  await expect(page.getByText("Firm Quote from Pete's Plumbing chosen and approved", { exact: true })).toBeVisible();

  await tradie.goto(await quoteLink(page, 'Pete Park', report));
  await expect(tradie.getByRole('heading', { name: 'Offer visit times' })).toBeVisible();
  await tradie.getByLabel('Visit time 1').fill('2026-10-27T09:00');
  await tradie.getByLabel('Visit time 2').fill('2026-10-28T13:00');
  await tradie.getByRole('button', { name: 'Offer visit times' }).click();
  await expect(tradie.getByText('will ask the Tenant to pick a time')).toBeVisible();

  await page.goto('/demo');
  await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: /^Tom Tran/ }).click();
  const pick = messages.getByRole('link', { name: /pick=1/ }).last();
  await expect(async () => {
    await page.reload();
    await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: /^Tom Tran/ }).click();
    await expect(pick).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  const tenant = await browser.newPage();
  await tenant.goto((await pick.getAttribute('href'))!);
  await expect(tenant.getByRole('button', { name: 'Book Tuesday 27 Oct, 9:00 am' })).toBeVisible();

  await page.goto(ticketUrl);
  await expect(page.getByText('Tenant confirmed')).toHaveCount(0);

  await tenant.getByRole('button', { name: 'Book Tuesday 27 Oct, 9:00 am' }).click();
  await expect(tenant.getByText('This visit is booked for Tue 27 Oct, 9:00 am.')).toBeVisible();

  await page.goto(ticketUrl);
  await expect(page.getByText('Tenant confirmed').first()).toBeVisible();
  await tradie.close();
  await tenant.close();
});

// Maya Morris, whom no other spec texts, so this can run beside the Tom Tran flow.
test('none of the times work, so the Tenant says when they are home and the Tradie offers again', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const report = `The bathroom tap is dripping ${unique()}`;
  await signIn(page);

  await page.goto('/demo');
  await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: /^Maya Morris/ }).click();
  const phone = page.getByRole('region', { name: "Maya Morris's phone" });
  const messages = phone.getByRole('region', { name: 'Messages with Maya Morris' });
  for (const text of [report, "Since Monday. It isn't getting worse. I'm home weekday mornings."]) {
    await phone.getByRole('textbox', { name: 'Message' }).fill(text);
    await phone.getByRole('button', { name: 'Send as Maya Morris' }).click();
    await expect(messages.getByText(text, { exact: true }).last()).toBeVisible();
  }
  const uploadLink = messages.getByRole('link', { name: /\/u\// }).last();
  await expect(uploadLink).toBeVisible();
  const uploader = await browser.newPage();
  await uploader.goto((await uploadLink.getAttribute('href'))!);
  await uploader.getByLabel('Photos of the issue').setInputFiles({
    name: 'tap.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(fixtureJpeg({ takenAt: '2026:10:08 08:30:00' })),
  });
  await uploader.getByRole('button', { name: 'Upload' }).click();
  await expect(uploader.getByRole('status')).toContainText(/has your photo/i);
  await uploader.close();

  await page.goto('/tickets');
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
    await tradie.getByLabel('Start date 1').fill('2026-10-27');
    await tradie.getByRole('button', { name: 'Send Firm Quote' }).click();
    await expect(tradie.getByRole('status')).toContainText('has your Firm Quote');
  }

  await page.goto(ticketUrl);
  await eventually(page, () => expect(page.getByRole('button', { name: 'Choose this Firm Quote' }).first()).toBeVisible({ timeout: 1_000 }));
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('row', { name: /Pete's Plumbing.*Replace the tap washer/ }).getByRole('button', { name: 'Choose this Firm Quote' }).click();
  await expect(page.getByText("Firm Quote from Pete's Plumbing chosen and approved", { exact: true })).toBeVisible();

  const offerPath = await quoteLink(page, 'Pete Park', report);
  await tradie.goto(offerPath);
  await expect(tradie.getByRole('heading', { name: 'Offer visit times' })).toBeVisible();
  await tradie.getByLabel('Visit time 1').fill('2026-10-27T09:00');
  await tradie.getByLabel('Visit time 2').fill('2026-10-28T13:00');
  await tradie.getByRole('button', { name: 'Offer visit times' }).click();
  await expect(tradie.getByText('will ask the Tenant to pick a time')).toBeVisible();

  await page.goto('/demo');
  await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: /^Maya Morris/ }).click();
  const none = messages.getByRole('link', { name: /pick=none/ }).last();
  await expect(async () => {
    await page.reload();
    await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: /^Maya Morris/ }).click();
    await expect(none).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  const tenant = await browser.newPage();
  await tenant.goto((await none.getAttribute('href'))!);
  await expect(tenant.getByRole('heading', { name: 'None of these work' })).toBeVisible();
  await expect(tenant.getByRole('group', { name: 'When are you usually home?' })).toBeVisible();
  await tenant.getByRole('radio', { name: 'Saturdays' }).check();
  await tenant.getByLabel('A time that works').fill('Sunday 10 am works');
  await tenant.getByRole('button', { name: 'Ask for other times' }).click();
  await expect(tenant.getByText("We'll ask Pete's Plumbing for other times.")).toBeVisible();

  await page.goto(ticketUrl);
  await expect(page.getByText('The Tenant asked for other times')).toBeVisible();

  await tradie.goto(offerPath);
  await expect(tradie.getByText('Sunday 10 am works')).toBeVisible();
  await expect(tradie.getByText('usually home Saturdays')).toBeVisible();
  await tradie.getByLabel('Visit time 1').fill('2026-10-31T09:00');
  await tradie.getByLabel('Visit time 2').fill('2026-11-02T13:00');
  await tradie.getByRole('button', { name: 'Offer visit times' }).click();
  await expect(tradie.getByText('will ask the Tenant to pick a time')).toBeVisible();
  await tradie.close();
  await tenant.close();
});

// Noah Nair, whom no other spec texts. Screenshots of the open offer and the tracker are for review, not assertions.
test('a booked visit can ask for another time, and the Ticket can ask the Tradie to offer times', async ({ page, browser }) => {
  test.setTimeout(240_000);
  mkdirSync('.screenshots/visit-offers', { recursive: true });
  const report = `The laundry tap is dripping ${unique()}`;
  await signIn(page);

  await page.goto('/demo');
  await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: /^Noah Nair/ }).click();
  const phone = page.getByRole('region', { name: "Noah Nair's phone" });
  const messages = phone.getByRole('region', { name: 'Messages with Noah Nair' });
  for (const text of [report, "Since Monday. It isn't getting worse. I'm home weekday mornings."]) {
    await phone.getByRole('textbox', { name: 'Message' }).fill(text);
    await phone.getByRole('button', { name: 'Send as Noah Nair' }).click();
    await expect(messages.getByText(text, { exact: true }).last()).toBeVisible();
  }
  const uploadLink = messages.getByRole('link', { name: /\/u\// }).last();
  await expect(uploadLink).toBeVisible();
  const uploader = await browser.newPage();
  await uploader.goto((await uploadLink.getAttribute('href'))!);
  await uploader.getByLabel('Photos of the issue').setInputFiles({
    name: 'tap.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(fixtureJpeg({ takenAt: '2026:10:08 08:30:00' })),
  });
  await uploader.getByRole('button', { name: 'Upload' }).click();
  await expect(uploader.getByRole('status')).toContainText(/has your photo/i);
  await uploader.close();

  await page.goto('/tickets');
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
    await tradie.getByLabel('Start date 1').fill('2026-10-27');
    await tradie.getByRole('button', { name: 'Send Firm Quote' }).click();
    await expect(tradie.getByRole('status')).toContainText('has your Firm Quote');
  }

  await page.goto(ticketUrl);
  await eventually(page, () => expect(page.getByRole('button', { name: 'Choose this Firm Quote' }).first()).toBeVisible({ timeout: 1_000 }));
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('row', { name: /Pete's Plumbing.*Replace the tap washer/ }).getByRole('button', { name: 'Choose this Firm Quote' }).click();
  await expect(page.getByText("Firm Quote from Pete's Plumbing chosen and approved", { exact: true })).toBeVisible();

  await tradie.goto(await quoteLink(page, 'Pete Park', report));
  await expect(tradie.getByRole('heading', { name: 'Offer visit times' })).toBeVisible();
  // A different morning from the other specs, which book Pete for Tuesday 27 October.
  await tradie.getByLabel('Visit time 1').fill('2026-10-29T10:00');
  await tradie.getByLabel('Visit time 2').fill('2026-10-30T11:00');
  await tradie.getByRole('button', { name: 'Offer visit times' }).click();
  await expect(tradie.getByText('will ask the Tenant to pick a time')).toBeVisible();

  await page.goto(ticketUrl);
  const offer = page.locator('[id$="-work-order"]');
  await expect(offer.getByText('The Tenant is choosing.')).toBeVisible();
  await expect(offer.getByRole('button', { name: "Ask Pete's Plumbing to offer times" })).toBeVisible();
  await expect(offer.getByRole('button', { name: 'Send Work Order' })).toBeVisible();
  await page.setViewportSize({ width: 1366, height: 768 });
  await offer.screenshot({ path: '.screenshots/visit-offers/ticket-open-offer-1366.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(offer.getByRole('button', { name: "Ask Pete's Plumbing to offer times" })).toBeVisible();
  await offer.screenshot({ path: '.screenshots/visit-offers/ticket-open-offer-390.png' });
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto('/demo');
  await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: /^Noah Nair/ }).click();
  const pick = messages.getByRole('link', { name: /pick=1/ }).last();
  await expect(async () => {
    await page.reload();
    await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: /^Noah Nair/ }).click();
    await expect(pick).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  const progress = messages.getByRole('link', { name: /\/t\// }).last();
  const tenant = await browser.newPage();
  await tenant.goto((await pick.getAttribute('href'))!);
  await tenant.getByRole('button', { name: 'Book Thursday 29 Oct, 10:00 am' }).click();
  await expect(tenant.getByText('This visit is booked for Thu 29 Oct, 10:00 am.')).toBeVisible();

  await tenant.goto((await progress.getAttribute('href'))!);
  const another = tenant.getByRole('link', { name: 'Need another time?' });
  await expect(another).toBeVisible();
  for (const [width, height] of [
    [1366, 768],
    [390, 844],
  ] as const) {
    await tenant.setViewportSize({ width, height });
    await tenant.screenshot({ path: `.screenshots/visit-offers/tracker-need-another-time-${width}.png`, fullPage: true });
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(ticketUrl);
  await expect(page.getByText('Tenant asked for another time')).toHaveCount(0);

  await another.click();
  await tenant.getByRole('button', { name: 'Need another time?' }).click();
  await expect(tenant.getByText('This visit stays booked until you pick a new one.')).toBeVisible();

  await page.goto(ticketUrl);
  await expect(page.getByText('Tenant asked for another time').first()).toBeVisible();
  await tradie.close();
  await tenant.close();
});
