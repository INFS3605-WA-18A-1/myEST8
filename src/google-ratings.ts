// The weekly refresh of every linked Tradie's Google rating (issue 09). A Tradie's
// rating is read when they're linked to their Google listing; this keeps it current.
// Each Tradie is refreshed in a task of its own, so a failed lookup retries alone.

import type { Context } from './context.ts';
import { all } from './db.ts';
import { HOUR_MS } from './shared.ts';

export const GOOGLE_RATING_REFRESH_INTERVAL_MS = 7 * 24 * HOUR_MS;

export function createGoogleRatingRefresh({ db, worker, modules }: Context) {
  worker.on<{ tradieId: number }>('google_rating.refresh', ({ tradieId }) => modules.profiles.refreshGoogleRating(tradieId));

  worker.every('google_rating.refresh_all', GOOGLE_RATING_REFRESH_INTERVAL_MS, async () => {
    const tradies = await all<{ id: number }>(db, `SELECT id FROM people WHERE role = 'tradie' AND google_place_id IS NOT NULL ORDER BY id`);
    for (const { id } of tradies) await worker.schedule('google_rating.refresh', { tradieId: id });
  });
}
