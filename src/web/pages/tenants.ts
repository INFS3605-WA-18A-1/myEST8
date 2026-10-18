// Each Tenant's Property, Tickets and Reimbursement Requests.
// Placeholder registered by the desk feedback round's foundation; its task replaces it.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { emptyState, page } from '../ui.ts';

export function tenantProfilePages() {
  const pages = new Hono<WebEnv>();
  pages.get('/', async (c) =>
    c.html(page({ title: 'Tenants', pm: c.var.pm, active: 'tenants', shell: await shellInfo(c), body: html`${emptyState('Coming soon.')}` })),
  );
  return pages;
}
