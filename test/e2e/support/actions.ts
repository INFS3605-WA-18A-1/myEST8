// What a Property Manager does in the browser, by what they see: roles,
// labels and visible text, never CSS classes, so the tests survive redesigns.

import { expect, type Page } from '@playwright/test';

export const ALICE = { email: 'alice@harbour.example', password: 'demo1234' };

/** Signs in on /login and waits to leave it. */
export async function signIn(page: Page, { email, password } = ALICE) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** A suffix that makes this run's text and emails unique on the shared test server. */
export function unique(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A time `days` days after today in the demo Agency's zone (Sydney), at `hour`:`minute`: as a
 * date field takes it (`date`, "2026-11-16"), as a date-and-time field takes it (`input`), and
 * as pages show it (`long` "Monday 16 Nov, 9:00 am", `short` "Mon 16 Nov, 9:00 am"). The server
 * runs on the real clock and refuses past dates, so a spec never names a fixed one.
 */
export function daysAhead(days: number, hour = 9, minute = 0) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  const date = day.toISOString().slice(0, 10);
  const time = `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
  const weekday = DAYS[day.getUTCDay()]!;
  const rest = `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}, ${time}`;
  return {
    date,
    input: `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    long: `${weekday} ${rest}`,
    short: `${weekday.slice(0, 3)} ${rest}`,
  };
}

/** Fills in the sign-up form for a new Agency and submits it. */
export async function signUp(page: Page, agency: { agencyName: string; name: string; email: string; password: string }) {
  await page.goto('/signup');
  await page.getByRole('textbox', { name: 'Your name' }).fill(agency.name);
  await page.getByRole('textbox', { name: 'Work email' }).fill(agency.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(agency.password);
  await page.getByRole('textbox', { name: 'Confirm password' }).fill(agency.password);
  await page.getByRole('textbox', { name: 'Agency name' }).fill(agency.agencyName);
  await page.getByRole('button', { name: 'Create account' }).click();
}
