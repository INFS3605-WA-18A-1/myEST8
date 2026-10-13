// What the page shell shows for a signed-in Property Manager: the Agency's name
// and the counts for the rail, and today's date for the top bar, all from the
// request's actions.

import type { Context } from 'hono';
import type { WebEnv } from './env.ts';
import type { NavKey } from './ui.ts';

/** The shell's facts, passed to `page()` as its `shell` option. */
export type ShellInfo = { agencyName: string; today: string; counts?: Partial<Record<NavKey, number>> };

/** The Agency's name, today's date in its time zone ("Fri 9 Oct") and the rail's counts. */
export async function shellInfo(c: Context<WebEnv>): Promise<ShellInfo> {
  const { actions } = c.var;
  const agency = actions.agency();
  const when = actions.now();
  const weekday = new Intl.DateTimeFormat('en-AU', { timeZone: agency.timeZone, weekday: 'short' }).format(when);
  const dayMonth = new Intl.DateTimeFormat('en-AU', { timeZone: agency.timeZone, day: 'numeric', month: 'short' }).format(when);
  return { agencyName: agency.name, today: `${weekday} ${dayMonth}`, counts: await actions.navCounts() };
}
