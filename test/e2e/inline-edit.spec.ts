import { expect, test, type Page } from '@playwright/test';
import { signIn, unique } from './support/actions.ts';

// The pencil turns a value into its input where it sits. The tick saves without
// leaving the page, the cross and Escape put the old value back, a refused save
// shows under the field, and without JavaScript the pen still opens ?edit=.

const mobile = () => `04${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function addTenant(page: Page, name: string, phone: string) {
  await page.goto('/tenants/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('textbox', { name: 'Mobile' }).fill(phone);
  const property = page.getByRole('combobox', { name: 'Property' });
  await property.fill('12 King');
  await page.getByRole('option', { name: '12 King St, Newtown NSW 2042' }).click();
  await page.getByLabel('Tenancy start date').fill('2026-09-01');
  await page.getByRole('button', { name: 'Add Tenant' }).click();
  await expect(page.getByText(`${name} added as a Tenant`)).toBeVisible();
  await page.getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

test('the pencil edits in place: tick saves, cross and Escape restore, a refusal stays under the field', async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  const name = `Ada ${unique()}`;
  const phone = mobile();
  const email = `ada.${unique()}@example.com`;
  const other = `ada.other.${unique()}@example.com`;
  await addTenant(page, name, phone);
  const profile = page.url();

  const pen = page.getByRole('link', { name: 'Edit details' });
  await pen.click();
  await expect(page).toHaveURL(profile);
  const emailBox = page.getByRole('textbox', { name: 'Email' });
  await expect(emailBox).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Save details' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cancel editing' })).toBeVisible();

  await emailBox.fill(email);
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Details saved.')).toBeVisible();
  await expect(page).toHaveURL(profile);
  await expect(page.getByRole('link', { name: email })).toBeVisible();
  await expect(emailBox).toBeHidden();

  await pen.click();
  await emailBox.fill(other);
  await page.getByRole('link', { name: 'Cancel editing' }).click();
  await expect(page).toHaveURL(profile);
  await expect(page.getByRole('link', { name: email })).toBeVisible();
  await expect(page.getByRole('link', { name: other })).toHaveCount(0);
  await expect(emailBox).toBeHidden();
  await expect(pen).toBeFocused();

  await pen.click();
  await emailBox.fill(other);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: email })).toBeVisible();
  await expect(page.getByRole('link', { name: other })).toHaveCount(0);
  await expect(emailBox).toBeHidden();

  await pen.click();
  await page.getByRole('textbox', { name: 'Mobile' }).fill('');
  await emailBox.fill('');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Enter a mobile number or email address')).toBeVisible();
  await expect(emailBox).toBeVisible();
  await expect(page).toHaveURL(profile);
  await page.getByRole('link', { name: 'Cancel editing' }).click();
  await expect(page.getByRole('link', { name: email })).toBeVisible();
  await expect(page.getByRole('link', { name: `+61${phone.slice(1)}` })).toBeVisible();
});

test('without JavaScript the pencil opens the server form and Save still posts', async ({ browser, baseURL }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ baseURL: baseURL!, javaScriptEnabled: false });
  const page = await context.newPage();
  await signIn(page);
  const name = `Ned ${unique()}`;
  const email = `ned.${unique()}@example.com`;
  await page.goto('/tenants/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('textbox', { name: 'Mobile' }).fill(mobile());
  await page.getByRole('combobox', { name: 'Property' }).selectOption({ label: '12 King St, Newtown NSW 2042' });
  await page.getByLabel('Tenancy start date').fill('2026-09-01');
  await page.getByRole('button', { name: 'Add Tenant' }).click();
  await expect(page.getByText(`${name} added as a Tenant`)).toBeVisible();
  await page.getByRole('link', { name }).click();

  await page.getByRole('link', { name: 'Edit details' }).click();
  await expect(page).toHaveURL(/\/tenants\/\d+\?edit=details/);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Details saved.')).toBeVisible();
  await expect(page).not.toHaveURL(/edit=/);
  await expect(page.getByRole('link', { name: email })).toBeVisible();
  await context.close();
});
