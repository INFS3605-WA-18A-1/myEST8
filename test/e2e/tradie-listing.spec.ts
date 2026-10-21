import { expect, test, type Page } from '@playwright/test';
import { signIn, unique } from './support/actions.ts';

// Adding a Tradie by picking their Google listing in the demo: the results are links, the
// chosen one fills in the form (Jev suggests the Trades), and the Property Manager adds the
// rest. Roles and names only.

const search = (page: Page) => page.getByRole('textbox', { name: 'First, find their Google listing' });
const results = (page: Page) => page.getByRole('list', { name: 'Google listings' });

test('search, pick a listing, fill in the contact name and rating, and the Tradie is added with their Trades', async ({ page }) => {
  await signIn(page);
  await page.goto('/tradies#add-tradie');
  await expect(page.getByRole('textbox', { name: 'Business name' })).toHaveCount(0);

  await search(page).fill('handy');
  await page.getByRole('button', { name: 'Search Google' }).click();
  await expect(results(page).getByRole('link')).toHaveCount(1);
  await results(page).getByRole('link', { name: /Handy Harry's/ }).click();

  await expect(results(page).getByRole('link', { name: /Handy Harry's/ })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('heading', { name: "Handy Harry's" })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Business name' })).toHaveValue("Handy Harry's");
  await expect(page.getByRole('checkbox', { name: 'General handyman' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Plumbing' })).not.toBeChecked();
  await expect(page.getByText('Suggested from their Google listing. Check them.')).toBeVisible();

  // Harry's listing has no phone, so the contact name, an email and the rating are for us to give.
  const contact = `Harry ${unique()}`;
  await page.getByRole('textbox', { name: 'Contact name' }).fill(contact);
  await page.getByRole('textbox', { name: 'Email' }).fill(`${unique()}@harry.example`);
  await page.getByRole('combobox', { name: 'Starting rating' }).selectOption('4 / 5');
  await page.getByRole('button', { name: 'Add Tradie' }).click();

  await expect(page.getByText("Handy Harry's added as a Tradie")).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(contact) })).toContainText('General handyman');
});

test('a listing with a mobile fills it in, and a refused form comes back to the same listing', async ({ page }) => {
  await signIn(page);
  await page.goto('/tradies?google=pete');
  await results(page).getByRole('link', { name: /Pete's Plumbing/ }).click();

  await expect(page.getByRole('textbox', { name: 'Mobile' })).toHaveValue('+61 412 555 018');
  await expect(page.getByRole('checkbox', { name: 'Plumbing' })).toBeChecked();
  await page.getByRole('textbox', { name: 'Contact name' }).fill(`Pete ${unique()}`);
  await page.getByRole('combobox', { name: 'Starting rating' }).selectOption('4 / 5');
  // No Trade left ticked: the server refuses, and the page comes back with the listing still chosen.
  await page.getByRole('checkbox', { name: 'Plumbing' }).uncheck();
  await page.getByRole('button', { name: 'Add Tradie' }).click();

  await expect(page.getByRole('alert').first()).toContainText('Choose Trades from');
  await expect(results(page).getByRole('link', { name: /Pete's Plumbing/ })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('textbox', { name: 'Business name' })).toHaveValue("Pete's Plumbing");
});

test('a Tradie that is not on Google is added from the empty form', async ({ page }) => {
  await signIn(page);
  await page.goto('/tradies#add-tradie');

  await page.getByRole('link', { name: 'Not on Google? Enter their details yourself' }).click();
  await expect(page.getByRole('textbox', { name: 'Business name' })).toHaveValue('');
  const business = `Cash Plumbing ${unique()}`;
  await page.getByRole('textbox', { name: 'Business name' }).fill(business);
  await page.getByRole('textbox', { name: 'Contact name' }).fill(`Cash ${unique()}`);
  await page.getByRole('textbox', { name: 'Mobile' }).fill(`04${String(Date.now()).slice(-8)}`);
  await page.getByRole('checkbox', { name: 'Plumbing' }).check();
  await page.getByRole('combobox', { name: 'Starting rating' }).selectOption('3 / 5');
  await page.getByRole('button', { name: 'Add Tradie' }).click();

  await expect(page.getByText(`${business} added as a Tradie`)).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(business) })).toContainText('Not on Google');
});

test('on a phone nothing scrolls sideways, and a listing can be picked with the keyboard alone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/tradies?google=plumbing');
  const overflow = () => page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  expect(await overflow()).toBeLessThanOrEqual(0);

  await search(page).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Search Google' })).toBeFocused();
  await page.keyboard.press('Tab');
  const first = results(page).getByRole('link').first();
  await expect(first).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(results(page).getByRole('link', { name: /Chosen/ })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('textbox', { name: 'Business name' })).not.toHaveValue('');
  expect(await overflow()).toBeLessThanOrEqual(0);
});
