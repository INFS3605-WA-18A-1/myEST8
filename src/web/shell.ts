// What the page shell shows for a signed-in Property Manager: the Agency's name
// for the rail, today's date for the top bar, and the rail's counts, all from the
// request's actions.

import type { Context, MiddlewareHandler } from 'hono';
import type { WebEnv } from './env.ts';

/** The rail's counts: Maintenance Requests to review and Quotes waiting on a Property Owner. */
export type NavCounts = { requests: number; approvals: number };

/** The shell's facts, passed to `page()` as its `shell` option. */
export type ShellInfo = { agencyName: string; today: string; counts?: NavCounts };

/**
 * Reads the rail's counts once for the request, so every signed-in page can show
 * them without asking again. Mount it after the Property Manager is known. Files
 * (photos, PDFs) are not pages and skip it.
 */
export function loadNavCounts(): MiddlewareHandler<WebEnv> {
  return async (c, next) => {
    if (!c.req.path.startsWith('/files/')) c.set('navCounts', await c.var.actions.navCounts());
    await next();
  };
}

/** The Agency's name, today's date in its time zone ("Fri 9 Oct"), and the rail's counts. */
export function shellInfo(c: Context<WebEnv>): ShellInfo {
  const { actions } = c.var;
  const agency = actions.agency();
  const when = actions.now();
  const weekday = new Intl.DateTimeFormat('en-AU', { timeZone: agency.timeZone, weekday: 'short' }).format(when);
  const dayMonth = new Intl.DateTimeFormat('en-AU', { timeZone: agency.timeZone, day: 'numeric', month: 'short' }).format(when);
  return { agencyName: agency.name, today: `${weekday} ${dayMonth}`, counts: c.var.navCounts };
}
