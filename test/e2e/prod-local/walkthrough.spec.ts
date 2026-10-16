import { expect, test, type Page } from '@playwright/test';
import { unique } from '../support/actions.ts';

// What a new Property Manager does on production (api/index.ts), by what they see:
// no demo Agency, no stories, no phone simulator. One serial journey on one server.

test.describe.configure({ mode: 'serial' });

const id = unique();
const PM = { name: 'Sam Sun', email: `sam-${id}@sunrise.example`, password: 'sunrise-2026', agencyName: `Sunrise Realty ${id}` };
const ADDRESS = '1 George St';
const main = (page: Page) => page.getByRole('navigation', { name: 'Main' });

test('the landing page offers sign-up and sign-in, with no demo Agency on it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tenants text the problem');
  await expect(page.getByRole('link', { name: /Create your Agency/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
  await expect(page.getByText('Harbour Realty')).toHaveCount(0);
  await expect(page.getByText('alice@harbour.example')).toHaveCount(0);
});

test('the Twilio webhook is off without a token', async ({ page }) => {
  expect((await page.request.post('/webhooks/twilio', { form: { From: '+61400000001' } })).status()).toBe(404);
});

test('the worker route needs the CRON_SECRET', async ({ request }) => {
  expect((await request.get('/api/cron/worker')).status()).toBe(401);
  expect((await request.get('/api/cron/worker', { headers: { authorization: 'Bearer wrong' } })).status()).toBe(401);
  const ok = await request.get('/api/cron/worker', { headers: { authorization: 'Bearer prod-local-cron-secret' } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toEqual({ ok: true });
});

test('signing up lands in the welcome wizard, and the setup sections open in order', async ({ page }) => {
  await page.goto('/signup');
  await page.getByRole('textbox', { name: 'Your name' }).fill(PM.name);
  await page.getByRole('textbox', { name: 'Work email' }).fill(PM.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PM.password);
  await page.getByRole('textbox', { name: 'Confirm password' }).fill(PM.password);
  await page.getByRole('textbox', { name: 'Agency name' }).fill(PM.agencyName);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome to myEST8, Sam' })).toBeVisible();
  await expect(main(page)).toHaveCount(0);

  await page.getByRole('link', { name: "Let's start" }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your team' })).toBeVisible();
  await page.getByRole('link', { name: 'Skip for now' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Channels' })).toBeVisible();
  // No real channel is connected: the SMS and email sections are the only way in. WhatsApp is not offered.
  await expect(page.getByRole('heading', { name: 'SMS' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Email' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'WhatsApp' })).toHaveCount(0);
  // Neither channel can work on this server, so nothing is left to wait for: the step reads as done.
  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Tradies' })).toBeVisible();
});

test('a Tradie and a Property are added, and setup shows what is done', async ({ page }) => {
  await signInAs(page);
  await page.goto('/welcome/tradies');
  await page.getByLabel('Business name').fill('Bondi Plumbing');
  await page.getByLabel('Contact name').fill('Bo Bondi');
  await page.getByLabel('Mobile').fill('0400 111 222');
  await page.getByLabel('Email').fill('bo@bondi.example');
  await page.getByLabel('Plumbing').check();
  await page.getByLabel('Starting rating').selectOption('4');
  await page.getByLabel('Not on Google').check();
  await page.getByRole('button', { name: 'Add Tradie' }).click();
  await expect(page.getByText('Bondi Plumbing').first()).toBeVisible();

  await page.goto('/welcome/property');
  await page.getByLabel('Address').fill(ADDRESS);
  await page.getByLabel('Suburb').fill('Sydney');
  await page.getByLabel('Max Repair Cost').fill('500');
  const names = page.getByLabel('Name');
  await names.nth(0).fill('Olive Owner');
  await names.nth(1).fill('Tina Tenant');
  const mobiles = page.getByLabel('Mobile');
  await mobiles.nth(0).fill('0400 333 444');
  await mobiles.nth(1).fill('0400 555 666');
  const emails = page.getByLabel('Email');
  await emails.nth(0).fill('olive@owner.example');
  await emails.nth(1).fill('tina@tenant.example');
  await page.getByLabel('Tenancy start date').fill('2026-01-01');
  await page.getByRole('button', { name: 'Add the Property' }).click();
  await expect(page.getByText(`${ADDRESS} is set up with Property Owner Olive`)).toBeVisible();

  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Your setup' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add Tradies' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Add a Property' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Go to your dashboard' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('the dashboard and rail show the new Agency, empty of work', async ({ page }) => {
  await signInAs(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  for (const section of ['Dashboard', 'Dispatch', 'Requests', 'Tickets', 'Approvals', 'Schedule', 'Properties', 'Tradies', 'Settings']) {
    await expect(main(page).getByRole('link', { name: section })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Maintenance Requests to review' })).toBeVisible();
  await expect(page.getByText('Harbour Realty')).toHaveCount(0);
  // Signed in, the phone simulator's route is still not there.
  expect((await page.request.get('/demo')).status()).toBe(404);

  await main(page).getByRole('link', { name: 'Properties' }).click();
  await expect(page.getByRole('link', { name: ADDRESS }).first()).toBeVisible();
  await main(page).getByRole('link', { name: 'Tradies' }).click();
  await expect(page.getByText('Bondi Plumbing').first()).toBeVisible();
});

test('the Dispatch map draws, with a pin for the Property', async ({ page }) => {
  await signInAs(page);
  await main(page).getByRole('link', { name: 'Dispatch' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dispatch' })).toBeVisible();
  const map = page.getByRole('region', { name: /^Map\./ });
  await expect(map).toBeVisible();
  await expect(map.getByRole('button', { name: new RegExp(`^${ADDRESS}`) })).toBeVisible();
  // Leaflet and its assets are served by the function itself, as on Vercel.
  await expect(page.locator('.leaflet-container')).toBeVisible();
});

test('signing out ends the session, and signing in again returns to the page they asked for', async ({ page }) => {
  await signInAs(page);
  await page.getByText(PM.name, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/(login)?$/);
  await page.goto('/properties');
  await expect(page).toHaveURL(/\/login/);

  await page.getByRole('textbox', { name: 'Email' }).fill(PM.email);
  await page.getByRole('textbox', { name: 'Password' }).fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/don.t match/)).toBeVisible();

  await page.getByRole('textbox', { name: 'Password' }).fill(PM.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Back to the page they asked for, signed in.
  await expect(page).toHaveURL(/\/properties$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Properties' })).toBeVisible();
});

test('a no-login Tenant link that does not exist says so, without a sign-in', async ({ page }) => {
  // Real upload links come from an inbound message, which needs a connected channel; the bogus token is the part reachable here.
  const upload = await page.goto('/u/not-a-real-token');
  expect(upload?.status()).toBeLessThan(500);
  await expect(page).toHaveURL(/\/u\/not-a-real-token/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect((await page.request.get('/t/not-a-real-token')).status()).toBeLessThan(500);
});

test('the rail has no link to the phone simulator', async ({ page }) => {
  await signInAs(page);
  await expect(main(page).getByRole('link', { name: /Phone simulator/ })).toHaveCount(0);
  await expect(page.locator('a[href="/demo"]')).toHaveCount(0);
});

test('with no SMS provider the channel page says so instead of offering a code that can only fail', async ({ page }) => {
  await signInAs(page);
  await page.goto('/welcome/channels');
  await expect(page.getByText("SMS isn't available on this server yet.")).toBeVisible();
  await expect(page.getByLabel('Agency SMS number')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send code' })).toHaveCount(0);
});

async function signInAs(page: Page) {
  await page.goto('/login');
  if (!/\/login/.test(page.url())) return;
  await page.getByRole('textbox', { name: 'Email' }).fill(PM.email);
  await page.getByRole('textbox', { name: 'Password' }).fill(PM.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
