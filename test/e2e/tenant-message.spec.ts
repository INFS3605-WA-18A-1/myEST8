import { expect, test } from '@playwright/test';
import { fixtureJpeg } from '../../src/demo/photo-exif.ts';
import { signIn, unique } from './support/actions.ts';

test('a Tenant texting from the phone simulator becomes a Maintenance Request the Property Manager can review', async ({ page, browser }) => {
  const report = `The shower is leaking ${unique()}`;
  await signIn(page);

  // Wei Zhang (7 Wilson St, Alice's Property) texts in from the simulator and answers the guided questions.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Simulator' }).click();
  await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: /^Wei Zhang/ }).click();
  const phone = page.getByRole('region', { name: "Wei Zhang's phone" });
  const messages = phone.getByRole('region', { name: 'Messages with Wei Zhang' });
  for (const text of [report, 'Upstairs bathroom', 'Since Monday', 'No', '1']) {
    await phone.getByRole('textbox', { name: 'Message' }).fill(text);
    await phone.getByRole('button', { name: 'Send as Wei Zhang' }).click();
    await expect(messages.getByText(text, { exact: true }).last()).toBeVisible();
  }

  // myEST8 replies with a no-login upload link; Wei opens it on "his phone" and sends a photo.
  const uploadLink = messages.getByRole('link', { name: /\/u\// }).last();
  await expect(uploadLink).toBeVisible();
  const uploadUrl = (await uploadLink.getAttribute('href'))!;
  const tenant = await browser.newPage();
  await tenant.goto(uploadUrl);
  await expect(tenant.getByRole('heading', { level: 1 })).toContainText('Send photos');
  await tenant.getByLabel('Photos of the issue').setInputFiles({
    name: 'shower.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(fixtureJpeg({ takenAt: '2026:10:08 08:30:00' })),
  });
  await tenant.getByRole('button', { name: 'Upload' }).click();
  await expect(tenant.getByRole('status')).toContainText(/has your photo/i);
  await tenant.close();

  // The background worker turns it into a Maintenance Request on Alice's dashboard.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dashboard' }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(report).first()).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
});
