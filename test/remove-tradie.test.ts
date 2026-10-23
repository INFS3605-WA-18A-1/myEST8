import { describe, expect, test } from 'vitest';
import { jobView, NINA, tomsTapTicket, world } from './support/world.ts';

// Nina's Plumbing is a plumber, and one of the two Nominated Tradies of King St.

describe('removing a Tradie', () => {
  test('stamps when they left, and takes them out of the lists, the recommendations, Dispatch and Nominated Tradies', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const nina = w.tradies.nina.id;
    const tradieIds = async () => ({
      people: (await w.alice.people('tradie')).map((t) => t.id),
      directory: (await w.alice.tradieDirectory()).map((t) => t.tradieId),
      dispatch: (await w.alice.dispatch()).tradies.map((t) => t.tradieId),
      recommended: (await jobView(w, job)).recommendations.map((r) => r.tradieId),
      nominated: (await w.alice.property(w.ids.kingSt)).nominatedTradies.map((t) => t.tradieId),
    });
    const before = await tradieIds();
    for (const ids of Object.values(before)) expect(ids).toContain(nina);
    expect(before.nominated).toEqual([nina, w.ids.sam]);

    expect(await w.alice.removeTradie(nina)).toBe("Nina's Plumbing");

    const after = await tradieIds();
    for (const ids of Object.values(after)) expect(ids).not.toContain(nina);
    expect(after.nominated).toEqual([w.ids.sam]);
    // The other Tradies stay: four plumbers are left to recommend.
    expect(after.recommended).toHaveLength(4);
    expect(after.people).toHaveLength(5);
    // Tom's Ticket took two days from 9:00 am on Thursday 8 October, so 9:00 am on Saturday 10 October in Sydney.
    expect(await w.alice.tradie(nina)).toMatchObject({ businessName: "Nina's Plumbing", removedAt: '2026-10-09T22:00:00.000Z' });
  });
});
