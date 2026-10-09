// What the page shell shows for a signed-in Property Manager: the Agency's name
// for the rail and today's date for the top bar, both from the request's actions.

import type { Context } from 'hono';
import type { WebEnv } from './env.ts';

/** The shell's facts, passed to `page()` as its `shell` option. */
export type ShellInfo = { agencyName: string; today: string };

/** The Agency's name, and today's date in its time zone ("Fri 9 Oct"). */
export function shellInfo(c: Context<WebEnv>): ShellInfo {
  const { actions } = c.var;
  const agency = actions.agency();
  const when = actions.now();
  const weekday = new Intl.DateTimeFormat('en-AU', { timeZone: agency.timeZone, weekday: 'short' }).format(when);
  const dayMonth = new Intl.DateTimeFormat('en-AU', { timeZone: agency.timeZone, day: 'numeric', month: 'short' }).format(when);
  return { agencyName: agency.name, today: `${weekday} ${dayMonth}` };
}
