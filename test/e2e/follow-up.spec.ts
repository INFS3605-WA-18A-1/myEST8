import { expect, test } from '@playwright/test';
import { fixtureJpeg } from '../../src/demo/photo-exif.ts';
import { signIn, unique } from './support/actions.ts';

// Following up with a Tenant in a real browser, by keyboard: the Tenant texts in, the Property
// Manager opens the Maintenance Request, writes notes, drafts a message with AI (the demo's
// mock composer), edits it, sends it, and the message is in the Tenant's phone simulator.
// Nothing reaches the Tenant before Send. It texts from Liam Lee, whom no other spec uses, so it can run beside them. Roles and visible text only.

test('a Property Manager drafts a follow-up from notes, edits it, sends it, and the Tenant gets it', async ({ page, browser }) => {
  const report = `The shower is leaking ${unique()}`;
  await signIn(page);

  // Liam Lee texts in, answers the guided questions and sends a photo, so there is a Maintenance Request.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Simulator' }).click();
  await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: /^Liam Lee/ }).click();
  const phone = page.getByRole('region', { name: "Liam Lee's phone" });
  const messages = phone.getByRole('region', { name: 'Messages with Liam Lee' });
  for (const text of [report, 'Upstairs bathroom', 'Since Monday', 'No', '1']) {
    await phone.getByRole('textbox', { name: 'Message' }).fill(text);
    await phone.getByRole('button', { name: 'Send as Liam Lee' }).click();
    await expect(messages.getByText(text, { exact: true }).last()).toBeVisible();
  }
  const uploadUrl = (await messages.getByRole('link', { name: /\/u\// }).last().getAttribute('href'))!;
  const tenant = await browser.newPage();
  await tenant.goto(uploadUrl);
  await tenant.getByLabel('Photos of the issue').setInputFiles({ name: 'shower.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(fixtureJpeg({ takenAt: '2026:10:08 08:30:00' })) });
  await tenant.getByRole('button', { name: 'Upload' }).click();
  await expect(tenant.getByRole('status')).toContainText(/has your photo/i);
  await tenant.close();

  // The Property Manager opens it from the dashboard.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dashboard' }).click();
  const row = page.getByRole('article').filter({ hasText: report });
  await expect(async () => {
    await page.reload();
    await expect(row.first()).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await row.getByRole('link', { name: 'Review' }).click();
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Follow up with Liam' }) });
  await expect(panel).toBeVisible();

  // Notes, then Draft with AI, all from the keyboard.
  const notes = panel.getByRole('textbox', { name: 'What do you want to say to Liam?' });
  await notes.focus();
  await page.keyboard.type('Is the water still coming through? Please turn it off at the meter.');
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: 'Draft with AI' })).toBeFocused();
  await page.keyboard.press('Enter');

  // The draft is marked as AI's, the notes are still there, and nothing has been sent.
  await expect(panel.getByText('Written by AI. Check it before you send.')).toBeVisible();
  await expect(notes).toHaveValue('Is the water still coming through? Please turn it off at the meter.');
  const draft = panel.getByRole('textbox', { name: 'Message to Liam' });
  await expect(draft).toHaveValue(/Is the water still coming through\? Please turn it off at the meter\./);

  // Edit it, then Send to Liam.
  await draft.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\nThanks, Alice');
  const edited = await draft.inputValue();
  expect(edited).toContain('Thanks, Alice');
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: 'Send to Liam' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Follow-up sent to Liam Lee' })).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Message to Liam' })).toHaveCount(0);

  // It is in Liam's phone, as edited.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Simulator' }).click();
  await page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: /^Liam Lee/ }).click();
  const thread = page.getByRole('region', { name: 'Messages with Liam Lee' });
  await expect(thread.getByText('Thanks, Alice').last()).toBeVisible();
  await expect(thread.getByText(/Please turn it off at the meter\./).last()).toBeVisible();
});
