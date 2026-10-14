// Settings: a short page that points to where the Agency is set up.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { flashFrom, page, section } from '../ui.ts';

/** Settings under /settings. */
export function settingsPages() {
  const pages = new Hono<WebEnv>();
  pages.get('/', async (c) =>
    c.html(
      page({
        title: 'Settings',
        pm: c.var.pm,
        active: 'settings',
        shell: await shellInfo(c),
        flash: flashFrom(c.req.url),
        body: section({
          title: 'Your Agency',
          body: html`<ul class="flex flex-col gap-2 text-sm">
            <li><a class="link" href="/setup">Setup</a> <span class="text-muted">for channels, Property Owners, Building Managers and Tenants</span></li>
            <li><a class="link" href="/welcome">Step-by-step guide</a> <span class="text-muted">to set the Agency up from the start</span></li>
          </ul>`,
        }),
      }),
    ),
  );
  return pages;
}
