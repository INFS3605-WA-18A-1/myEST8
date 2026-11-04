import { expect, test, type Page } from '@playwright/test';
import { signUp, unique } from './support/actions.ts';
import { freePort, startDemo, uniqueSchema } from './support/server.ts';

const LATER = ['Messenger', 'Telegram', 'WeChat', 'LINE'];
const HINT = 'Tenants message first; replies are free for 24 hours, then myEST8 uses SMS or email.';
const SPOKEN = '+1 555 123 4567';

/** The four placeholders: disabled buttons that say Coming later, and not links. */
async function expectLaterChannels(page: Page) {
  const later = page.locator('#later-channels');
  await expect(later.getByRole('link')).toHaveCount(0);
  for (const name of LATER) {
    const control = later.getByRole('button', { name });
    await expect(control).toBeDisabled();
    await expect(control).toContainText('Coming later');
  }
}

test('onboarding offers WhatsApp disabled, and the later channels are not links', async ({ page }) => {
  const id = unique();
  await signUp(page, { agencyName: `Sunrise Realty ${id}`, name: 'Sam Sun', email: `sam-${id}@sunrise.example`, password: 'sunrise-2026' });
  await page.goto('/welcome/channels');

  await expect(page.getByRole('heading', { level: 1, name: 'Channels' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'WhatsApp' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect WhatsApp' })).toBeDisabled();
  await expect(page.getByText("WhatsApp isn't set up on this server yet, so it can't be connected.")).toBeVisible();
  await expect(page.getByText(HINT)).toBeVisible();
  await expectLaterChannels(page);
});

test('Connect WhatsApp gives the Agency the server number, and Disconnect takes it back', async ({ page }) => {
  test.setTimeout(90_000);
  const port = freePort();
  const server = await startDemo({
    port,
    schema: uniqueSchema(),
    env: {
      // Fakes. The demo does not deliver unless DEMO_SEND_TO names the recipient, so Meta is never called.
      META_WHATSAPP_NUMBER: '+15551234567',
      META_WHATSAPP_PHONE_NUMBER_ID: 'fake-phone-id',
      META_WHATSAPP_ACCESS_TOKEN: 'fake-token',
    },
  });
  const origin = `http://localhost:${port}`;
  try {
    const id = unique();
    await page.goto(`${origin}/signup`);
    await page.getByRole('textbox', { name: 'Your name' }).fill('Sam Sun');
    await page.getByRole('textbox', { name: 'Work email' }).fill(`sam-${id}@sunrise.example`);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('sunrise-2026');
    await page.getByRole('textbox', { name: 'Confirm password' }).fill('sunrise-2026');
    await page.getByRole('textbox', { name: 'Agency name' }).fill(`Sunrise Realty ${id}`);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/welcome$/);

    await page.goto(`${origin}/welcome/channels`);
    await expect(page.getByRole('button', { name: 'Connect WhatsApp' })).toBeEnabled();
    await expect(page.getByText(HINT)).toBeVisible();
    await expectLaterChannels(page);

    await page.getByRole('button', { name: 'Connect WhatsApp' }).click();
    await expect(page.getByText(`${SPOKEN} is the Agency's WhatsApp number.`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect WhatsApp' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByRole('button', { name: 'Connect WhatsApp' })).toBeEnabled();
    await expect(page.getByText('The Agency has no WhatsApp number now.')).toBeVisible();
  } finally {
    await server.stop();
  }
});
