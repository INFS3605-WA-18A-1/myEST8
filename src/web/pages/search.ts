// The header search's suggestions, for the Dispatch search box and the Profiles search. A GET so the
// browser can ask as the Property Manager types; the answer is JSON and only ever
// the signed-in Agency's own Properties and Tickets.

import { Hono } from 'hono';
import type { WebEnv } from '../env.ts';

/** `/search/suggest?q=`: matching Properties and Tickets, capped by the view. `kind=property` (the Profiles search) asks for Properties only. */
export function searchPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/suggest', async (c) => {
    const suggestions = await c.var.actions.searchSuggest(c.req.query('q') ?? '', c.req.query('kind') === 'property' ? 'property' : undefined);
    return c.json(suggestions, 200, { 'cache-control': 'private, no-store' });
  });

  return pages;
}
