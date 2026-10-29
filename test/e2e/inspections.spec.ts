import { expect, test, type Browser, type Page } from '@playwright/test';
import { fixtureJpeg } from '../../src/demo/photo-exif.ts';
import { signIn, unique } from './support/actions.ts';

// Staged quoting in a real browser: the Tenant texts in, the Property Manager confirms
// it and asks two Tradies, both text an Estimate, the Property Manager asks one of them
// for a Site Inspection on their own row and books it, sees it on the calendar, the
// Tradie's DONE counts only once the visit has started, each Tradie gives a Firm Quote on
// their own quote page, and the Property Manager chooses one. Roles and visible text only.

const TIME_ZONE = 'Australia/Sydney'; // the demo Agency's

/** The demo clock's time, from the simulator's top bar. */
async function demoNow(page: Page) {
  await page.goto('/demo');
  return new Date((await page.locator('time[datetime]').first().getAttribute('datetime'))!);
}

/** An instant as a datetime-local value in the Agency's time zone. */
function localValue(at: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Sends `text` from `person`'s phone in the simulator and waits for it to appear. */
async function say(page: Page, person: string, text: string) {
  await page.goto('/demo');
  await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: new RegExp(`^${person}`) }).click();
  const phone = page.getByRole('region', { name: `${person}'s phone` });
  await phone.getByRole('textbox', { name: 'Message' }).fill(text);
  await phone.getByRole('button', { name: `Send as ${person}` }).click();
  await expect(phone.getByRole('region', { name: `Messages with ${person}` }).getByText(text, { exact: true }).last()).toBeVisible();
}

/** The quote page link the Tradie's Quote Request carried, from their thread in the simulator. */
async function quoteLink(page: Page, person: string) {
  await page.goto('/demo');
  await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: new RegExp(`^${person}`) }).click();
  const link = page.getByRole('region', { name: `Messages with ${person}` }).getByRole('link', { name: /\/q\// }).first();
  await expect(link).toBeVisible();
  return (await link.getAttribute('href'))!;
}

/** The Tradie gives a Firm Quote on their quote page, in a browser of their own. */
async function giveFirmQuote(browser: Browser, link: string, price: string, scope: string) {
  const tradie = await browser.newPage();
  await tradie.goto(link);
  await expect(tradie.getByRole('heading', { name: 'Give your Firm Quote' })).toBeVisible();
  await tradie.getByLabel('Firm price ($)').fill(price);
  await tradie.getByLabel('Scope of work').fill(scope);
  await tradie.getByLabel('How many days it takes').fill('1');
  await tradie.getByLabel('Preferred date and time').fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16));
  await tradie.getByRole('button', { name: 'Send Firm Quote' }).click();
  await expect(tradie.getByRole('status')).toContainText('has your Firm Quote');
  await tradie.close();
}

/** Reloads the page until `check` passes: the background worker reads each reply a moment after it is sent. */
async function eventually(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 15_000 });
}

test('two Tradies on their own paths: one inspects first, both give Firm Quotes, and one is chosen', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const report = `The kitchen tap is leaking ${unique()}`;
  await signIn(page);

  // Tom Tran texts in and sends a photo from his upload link.
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

  // The Maintenance Request arrives; the Property Manager confirms it.
  await page.goto('/tickets');
  await eventually(page, () => expect(page.getByText(report).first()).toBeVisible({ timeout: 1_000 }));
  await page.getByRole('link', { name: new RegExp(report) }).first().click();
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

  // Both Tradies text a ballpark price, an Estimate each; the Property Manager checks and confirms each.
  await say(page, 'Pete Park', '$300, Tue 9am');
  await say(page, 'Dana Drip', '$340 Wednesday 10am');
  await page.goto(ticketUrl);
  for (let i = 0; i < asked.length; i++) {
    const check = page.getByText('Check Estimate', { exact: true }).first();
    await expect(async () => {
      await page.reload();
      await expect(check).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await check.click();
    await page.getByRole('button', { name: 'Confirm Estimate' }).click();
    await expect(page.getByText(/Estimate from .* confirmed/)).toBeVisible();
  }

  // Two confirmed Estimates are not Quotes to choose from. On Dana's own row, the Property Manager asks her to inspect first and books it.
  const dana = page.getByRole('list', { name: /Tradies quoting/ }).getByRole('listitem').filter({ hasText: 'Drip Doctors' });
  await dana.getByRole('button', { name: 'Ask for a Site Inspection' }).click();
  await expect(page.getByText('Drip Doctors will give a Firm Quote after a Site Inspection').first()).toBeVisible();
  await expect(page.getByText('Book a Site Inspection with Drip Doctors').first()).toBeVisible();
  const when = dana.getByLabel('Site Inspection with Drip Doctors');
  await expect(when).not.toHaveValue('');
  // Booked for a few minutes from now on the demo clock, so the visit can start within the test.
  const soon = localValue(new Date((await demoNow(page)).getTime() + 10 * 60_000));
  await page.goto(ticketUrl);
  await when.fill(soon);
  await dana.getByRole('button', { name: 'Book Site Inspection' }).click();
  await expect(page.getByText('Site Inspection booked with Drip Doctors. They and the Tenant have been told.')).toBeVisible();
  await expect(dana.getByText('Site inspection', { exact: true })).toBeVisible();
  await expect(dana.getByText('Mark it inspected once the visit has started.')).toBeVisible();

  // The calendar shows the visit with the Site inspection badge, in the week it falls in.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Schedule' }).click();
  const visits = page.getByRole('list', { name: 'The week, Monday to Sunday' }).getByText('Site inspection', { exact: true });
  for (let week = 0; week < 4 && (await visits.count()) < 1; week++) await page.getByRole('link', { name: 'Next week' }).click();
  await expect(visits.first()).toBeVisible();

  // Pete quotes firm straight away; Dana does after her visit, which she reports DONE once it has started.
  await giveFirmQuote(browser, await quoteLink(page, 'Pete Park'), '310', 'Replace the tap cartridge and both washers');
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Move the clock +1 hour' }).click();
  await expect(page.getByText(/Clock moved to/)).toBeVisible();
  await say(page, 'Dana Drip', 'Done');
  await giveFirmQuote(browser, await quoteLink(page, 'Dana Drip'), '360', 'Replace the mixer tap');

  // Two Firm Quotes, compared apart from the Estimates; choosing Pete's.
  await page.goto(ticketUrl);
  await eventually(page, () => expect(page.getByText('Choose a Firm Quote: 2 in').first()).toBeVisible({ timeout: 1_000 }));
  await expect(page.getByText('Superseded by Firm Quote').first()).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('row', { name: /Pete's Plumbing.*Replace the tap cartridge/ }).getByRole('button', { name: 'Choose this Firm Quote' }).click();
  await expect(page.getByText("Firm Quote from Pete's Plumbing chosen and approved", { exact: true })).toBeVisible();
});
