import { describe, expect, test } from 'vitest';
import { DAY, HOUR } from './support/harness.ts';
import { world } from './support/world.ts';

const googleRating = async (w: Awaited<ReturnType<typeof world>>, tradieId: number) => (await w.alice.tradie(tradieId)).googleRating;

describe('weekly Google rating refresh', () => {
  test("every linked Tradie's rating is refreshed each week, and Tradies not on Google are left alone", async () => {
    const w = await world();
    const { h, ids } = w;
    expect(await googleRating(w, ids.pete)).toEqual({ rating: 4.8, reviewCount: 120 });

    h.places.listings.set('place-pete', { name: "Pete's Plumbing", address: 'Marrickville', rating: 4.7, reviewCount: 131 });
    h.places.listings.set('place-finn', { name: 'Flow Bros', address: 'Petersham', rating: null, reviewCount: 0 });

    await h.advance(6 * DAY);
    expect(await googleRating(w, ids.pete)).toEqual({ rating: 4.8, reviewCount: 120 });

    await h.advance(DAY + HOUR);
    expect(await googleRating(w, ids.pete)).toEqual({ rating: 4.7, reviewCount: 131 });
    expect(await googleRating(w, ids.finn)).toEqual({ rating: null, reviewCount: 0 });
    expect(await googleRating(w, ids.dana)).toBeNull();

    h.places.listings.set('place-pete', { name: "Pete's Plumbing", address: 'Marrickville', rating: 4.9, reviewCount: 140 });
    await h.advance(7 * DAY);
    expect(await googleRating(w, ids.pete)).toEqual({ rating: 4.9, reviewCount: 140 });
  });

  test('a failed lookup retries that Tradie alone, and the next week still runs', async () => {
    const w = await world();
    const { h, ids } = w;
    h.places.listings.delete('place-sam');
    h.places.listings.set('place-pete', { name: "Pete's Plumbing", address: 'Marrickville', rating: 4.6, reviewCount: 125 });

    h.clock.advance(7 * DAY + HOUR);
    const errors = await h.app.runWorker();
    expect(errors.map((e) => e.message)).toEqual(['FakePlaces: unknown place place-sam']);
    expect(await googleRating(w, ids.pete)).toEqual({ rating: 4.6, reviewCount: 125 });

    h.places.listings.set('place-sam', { name: 'Sparky Sam', address: 'Glebe', rating: 4.4, reviewCount: 61 });
    await h.advance(HOUR);
    expect(await googleRating(w, ids.sam)).toEqual({ rating: 4.4, reviewCount: 61 });

    h.places.listings.set('place-sam', { name: 'Sparky Sam', address: 'Glebe', rating: 4.3, reviewCount: 70 });
    await h.advance(7 * DAY);
    expect(await googleRating(w, ids.sam)).toEqual({ rating: 4.3, reviewCount: 70 });
  });
});
