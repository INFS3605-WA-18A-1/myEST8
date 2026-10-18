// Closed Tickets, filtered like Tickets.
// Placeholder registered by the desk feedback round's foundation; its task replaces it.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { emptyState, page } from '../ui.ts';

export function archivePages() {
  const pages = new Hono<WebEnv>();
  pages.get('/', async (c) =>
    c.html(page({ title: 'Archive', pm: c.var.pm, active: 'archive', shell: await shellInfo(c), body: html`${emptyState('Coming soon.')}` })),
  );
  return pages;
}
