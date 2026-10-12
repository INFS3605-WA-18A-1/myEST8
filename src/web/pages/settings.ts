// Settings: the Agency, channels, Quotes, approvals, messages, the team and
// imports, in tabs. A placeholder until the page is built (dispatch-desk redesign,
// phase 2): it points to Setup, where those settings live for now.

import { Hono } from 'hono';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { emptyState, flashFrom, linkButton, page } from '../ui.ts';

/** Settings under /settings. */
export function settingsPages() {
  const pages = new Hono<WebEnv>();
  pages.get('/', (c) =>
    c.html(
      page({
        title: 'Settings',
        pm: c.var.pm,
        active: 'settings',
        shell: shellInfo(c),
        flash: flashFrom(c.req.url),
        body: emptyState('Your Agency’s settings are moving here. Until then, add Properties, Tradies and your team on the Setup page.', linkButton('Open Setup', '/setup')),
      }),
    ),
  );
  return pages;
}
