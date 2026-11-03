import { expect, test, type Page } from '@playwright/test';
import { signIn } from './support/actions.ts';

// Settings must not send a Property Manager to another part of the app.
// Allowed outside /settings, and listed here so a new one has to be named:
// - Sign-out: the user menu posts to /logout (the page header, not a Settings control).
// - External docs and help: https links, such as Twilio's console.
// - Downloads: spreadsheet templates under /settings/templates, with the download attribute.
// - Contact and share: mailto, tel and sms links open the person's own mail or messages app.
// - Channel panels: connect and disconnect post to /sms-number, /server-sms and /server-whatsapp.
//   A typed SMS number is proved at /setup/channels?from=settings. Each comes back to the Channels tab.

const overflow = (page: Page) => page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth');

function allowed(value: string, download: boolean): boolean {
  if (value.startsWith('#') || value.startsWith('/settings')) return true;
  if (value === '/logout') return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^(mailto:|tel:|sms:)/i.test(value)) return true;
  if (download && value.startsWith('/settings/templates/')) return true;
  if (['/sms-number', '/server-sms', '/server-whatsapp', '/setup/channels'].some((path) => value.startsWith(path))) return true;
  return false;
}

/** href, action and formaction values in the Settings controls (main, without the page header). */
async function leaving(page: Page): Promise<string[]> {
  // A string, so the page's document stays out of the typecheck (the suite has no DOM lib).
  const found = await page.evaluate<{ value: string; download: boolean }[]>(`(() => {
    const main = document.querySelector('main');
    if (!main) return [];
    const root = main.cloneNode(true);
    const header = root.querySelector('header.page-header');
    if (header) header.remove();
    return [...root.querySelectorAll('a[href], form[action], [formaction]')].map((node) => ({
      value: node.getAttribute('href') || node.getAttribute('action') || node.getAttribute('formaction') || '',
      download: node.hasAttribute('download'),
    }));
  })()`);
  return found.filter((item) => !allowed(item.value, item.download)).map((item) => item.value);
}

test('nothing in Settings leaves Settings, and saving the Agency comes back with a flash', async ({ page }) => {
  await signIn(page);

  const paths = ['/settings', '/settings?tab=channels', '/settings?tab=team', '/settings?tab=import', '/settings/agency/edit'];
  for (const kind of ['owners', 'building-managers', 'properties', 'tenants', 'tradies']) paths.push(`/settings/import/${kind}`);

  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Settings' })).toBeVisible();
    expect(await leaving(page), path).toEqual([]);
  }

  await page.goto('/settings?tab=team');
  await page.getByRole('link', { name: 'Remove Bob Baker' }).click();
  await expect(page).toHaveURL(/\/settings\/team\/\d+\/remove/);
  expect(await leaving(page)).toEqual([]);
  await expect(page.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/settings?tab=team');

  // Sign-out is the one header form, and it is the listed exception.
  await page.goto('/settings');
  await expect(page.locator('header.page-header form')).toHaveAttribute('action', '/logout');

  await page.goto('/settings/agency/edit');
  await page.getByRole('textbox', { name: 'Agency name' }).fill('Harbour Realty Group');
  await page.getByLabel('Time zone').selectOption('Australia/Perth');
  await page.getByRole('button', { name: 'Save' }).click();
  // The page drops ?ok= from the address bar once the flash is showing, so a reload does not repeat it.
  await expect(page).toHaveURL(/\/settings(\?ok=|$)/);
  await expect(page.getByRole('status')).toContainText('Agency details saved.');
  await expect(page.getByText('Harbour Realty Group').first()).toBeVisible();
  await expect(page.getByText('Perth (WA)')).toBeVisible();
  expect(await leaving(page)).toEqual([]);
});

test('Settings does not scroll sideways on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  for (const path of ['/settings', '/settings?tab=channels', '/settings?tab=team', '/settings?tab=import', '/settings/agency/edit', '/settings/import/owners']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    expect(await overflow(page), path).toBeLessThanOrEqual(0);
  }

  await page.goto('/settings?tab=team');
  await page.getByRole('link', { name: 'Remove Bob Baker' }).click();
  await expect(page).toHaveURL(/\/settings\/team\/\d+\/remove/);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
