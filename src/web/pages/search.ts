// The header search's suggestions, for the Dispatch search box. A GET so the
// browser can ask as the Property Manager types; the answer is JSON and only ever
// the signed-in Agency's own Properties and Tickets.

import { Hono } from 'hono';
import type { WebEnv } from '../env.ts';

/** `/search/suggest?q=`: matching Properties and Tickets, capped by the view. */
export function searchPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/suggest', async (c) => {
    const suggestions = await c.var.actions.searchSuggest(c.req.query('q') ?? '');
    return c.json(suggestions, 200, { 'cache-control': 'private, no-store' });
  });

  return pages;
}
