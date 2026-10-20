// The filters a list page reads from its query: Mine/All (?filter=all), and the
// shared filter bar's Urgency, Trade and Property. Unknown values are dropped, so a
// stale or hand-typed link shows the unfiltered list rather than an error.

import type { Context } from 'hono';
import { TRADES, URGENCIES, type Trade, type Urgency } from '../shared.ts';

export type ListFilter = { scope: 'mine' | 'all'; urgency?: Urgency; trade?: Trade; propertyId?: number };

export function listFilterOf(c: Context): ListFilter {
  const q = (name: string) => c.req.query(name) ?? '';
  const urgency = URGENCIES.find((u) => u === q('urgency'));
  const trade = TRADES.find((t) => t === q('trade'));
  const propertyId = /^[1-9]\d*$/.test(q('property')) ? Number(q('property')) : undefined;
  return { scope: q('filter') === 'all' ? 'all' : 'mine', ...(urgency && { urgency }), ...(trade && { trade }), ...(propertyId && { propertyId }) };
}

/** The query string that reproduces `f` (with a leading "?", or "" when nothing is set), for links within the list. */
export function listFilterQuery(f: ListFilter): string {
  const params = new URLSearchParams();
  if (f.scope === 'all') params.set('filter', 'all');
  if (f.urgency) params.set('urgency', f.urgency);
  if (f.trade) params.set('trade', f.trade);
  if (f.propertyId) params.set('property', String(f.propertyId));
  const s = params.toString();
  return s ? `?${s}` : '';
}
