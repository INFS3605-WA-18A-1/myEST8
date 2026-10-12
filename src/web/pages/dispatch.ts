// Dispatch: the map of Tickets and Tradies, the Tradies for a Ticket and the
// Tradie schedule. A placeholder until the page is built (dispatch-desk redesign,
// phase 2): it points to the calendar, where bookings live for now.

import { Hono } from 'hono';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { emptyState, flashFrom, linkButton, page } from '../ui.ts';

/** Dispatch under /dispatch. */
export function dispatchPages() {
  const pages = new Hono<WebEnv>();
  pages.get('/', (c) =>
    c.html(
      page({
        title: 'Dispatch',
        pm: c.var.pm,
        active: 'dispatch',
        shell: shellInfo(c),
        flash: flashFrom(c.req.url),
        body: emptyState('The map of Tickets and Tradies is on its way. Until then, every booking is on the calendar.', linkButton('Open the calendar', '/calendar')),
      }),
    ),
  );
  return pages;
}
