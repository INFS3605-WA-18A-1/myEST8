import { expect, test, type Page } from '@playwright/test';
import { fixtureJpeg } from '../../src/demo/photo-exif.ts';
import { signIn, unique } from './support/actions.ts';

// A High repair, start to finish in a real browser: the Tenant texts in, the Property
// Manager confirms it, asks two Tradies for Quotes, books a site quote visit with each,
// sees both on the calendar, then checks the revised price and chooses. Roles and
// visible text only.

/** Sends `text` from `person`'s phone in the simulator and waits for it to appear. */
async function say(page: Page, person: string, text: string) {
  await page.goto('/demo');
  await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: new RegExp(`^${person}`) }).click();
  const phone = page.getByRole('region', { name: `${person}'s phone` });
  await phone.getByRole('textbox', { name: 'Message' }).fill(text);
  await phone.getByRole('button', { name: `Send as ${person}` }).click();
  await expect(phone.getByRole('region', { name: `Messages with ${person}` }).getByText(text, { exact: true }).last()).toBeVisible();
}

/** Reloads the page until `check` passes: the background worker reads each reply a moment after it is sent. */
async function eventually(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 15_000 });
}

test('a High request gets site quote visits from two Tradies, a revised price, and a chosen Quote', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const report = `The kitchen tap is leaking ${unique()}`;
  await signIn(page);

  // Tom Tran texts in and sends a photo from his upload link.
  await page.goto('/demo');
  await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: /^Tom Tran/ }).click();
  const phone = page.getByRole('region', { name: "Tom Tran's phone" });
  const messages = phone.getByRole('region', { name: 'Messages with Tom Tran' });
  for (const text of [report, 'Kitchen sink', 'Since Monday', 'No', '1']) {
    await phone.getByRole('textbox', { name: 'Message' }).fill(text);
    await phone.getByRole('button', { name: 'Send as Tom Tran' }).click();
    await expect(messages.getByText(text, { exact: true }).last()).toBeVisible();
  }
  const uploadLink = messages.getByRole('link', { name: /\/u\// }).last();
  await expect(uploadLink).toBeVisible();
  const tenant = await browser.newPage();
  await tenant.goto((await uploadLink.getAttribute('href'))!);
  await tenant.getByLabel('Photos of the issue').setInputFiles({
    name: 'tap.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(fixtureJpeg({ takenAt: '2026:10:08 08:30:00' })),
  });
  await tenant.getByRole('button', { name: 'Upload' }).click();
  await expect(tenant.getByRole('status')).toContainText(/has your photo/i);
  await tenant.close();

  // The Maintenance Request arrives; the Property Manager makes it High and confirms it.
  await page.goto('/requests');
  await eventually(page, () => expect(page.getByText(report).first()).toBeVisible({ timeout: 1_000 }));
  await page.getByRole('link', { name: new RegExp(report) }).first().click();
  await page.getByLabel('Urgency').selectOption('high');
  await page.getByRole('button', { name: 'Change Urgency' }).click();
  await expect(page.getByLabel('Urgency')).toHaveValue('high');
  const confirm = page.getByRole('button', { name: /^Confirm( anyway)?$/ });
  if (!(await confirm.isVisible())) await page.getByText('Confirm', { exact: true }).click(); // photos in doubt: the disclosure asks first
  await confirm.click();
  await expect(page).toHaveURL(/\/tickets\/\d+/);
  const ticketUrl = page.url().split('?')[0]!;

  // Quote Requests to two Tradies, not the ticked three.
  const asked = [
    { business: "Pete's Plumbing", person: 'Pete Park' },
    { business: 'Drip Doctors', person: 'Dana Drip' },
  ];
  const boxes = page.getByRole('checkbox', { name: /^\d+\. / });
  for (const box of await boxes.all()) if (await box.isEnabled()) await box.uncheck();
  for (const { business } of asked) await page.getByRole('checkbox', { name: new RegExp(business) }).check();
  await page.getByRole('button', { name: 'Send Quote Requests' }).click();
  await expect(page.getByText(/Quote Requests? sent/i).first()).toBeVisible();

  // Both Tradies reply with a price; the Property Manager checks and confirms each.
  await say(page, 'Pete Park', '$300, Tue 9am');
  await say(page, 'Dana Drip', '$340 Wednesday 10am');
  await page.goto(ticketUrl);
  for (let i = 0; i < asked.length; i++) {
    const check = page.getByText('Check and confirm', { exact: true }).first();
    await expect(async () => {
      await page.reload();
      await expect(check).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await check.click();
    await page.getByRole('button', { name: 'Confirm Quote' }).click();
    await expect(page.getByText(/Quote from .* confirmed/)).toBeVisible();
  }

  // A High repair with two confirmed Quotes leads with booking site quotes, with the first free times filled in.
  await expect(page.getByText(/Book site quotes: 2 confirmed Quotes/).first()).toBeVisible();
  for (const { business } of asked) await expect(page.getByLabel(business, { exact: true })).not.toHaveValue('');
  await page.getByRole('button', { name: 'Book site quotes' }).click();
  await expect(page.getByText('Site quotes booked with 2 Tradies')).toBeVisible();
  await expect(page.getByText('Site quote', { exact: true }).first()).toBeVisible();

  // The Schedule shows both visits as Site inspections, in the week they fall in. Booked at
  // the same time, they fold into one "2 Jobs booked" block that opens their Day, side by side.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Schedule' }).click();
  const week = page.getByRole('list', { name: 'The week, Monday to Sunday' });
  const visits = week.getByText('Site inspection', { exact: true });
  const together = week.getByRole('link', { name: /Jobs booked/ });
  for (let w = 0; w < 4 && (await visits.count()) < 2 && !(await together.count()); w++) await page.getByRole('link', { name: 'Next week' }).click();
  if (await together.count()) {
    await together.first().click();
    await expect(page.getByRole('region', { name: /hour by hour/ }).getByText('Site inspection', { exact: true })).toHaveCount(2);
  } else {
    expect(await visits.count()).toBeGreaterThanOrEqual(2);
  }

  // Pete looks at the job and sends a lower price; it needs checking again, and the first price is still shown.
  await say(page, 'Pete Park', 'After looking, $280 all in');
  await page.goto(ticketUrl);
  await eventually(page, () => expect(page.getByText('Check and confirm', { exact: true }).first()).toBeVisible({ timeout: 1_000 }));
  await page.getByText('Check and confirm', { exact: true }).first().click();
  await expect(page.getByLabel('Price ($)')).toHaveValue('280.00');
  await page.getByRole('button', { name: 'Confirm Quote' }).click();
  await expect(page.getByText(/Quote from Pete's Plumbing confirmed/)).toBeVisible();
  await expect(page.getByText(/\$300/).first()).toBeVisible();

  // Choosing Pete's revised Quote.
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('row', { name: /Pete's Plumbing/ }).getByRole('button', { name: 'Choose this Quote' }).click();
  await expect(page.getByText("Quote from Pete's Plumbing chosen and approved", { exact: true })).toBeVisible();
});
