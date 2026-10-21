import { describe, expect, test } from 'vitest';
import { world } from './support/world.ts';

const PETES = {
  placeId: 'place-pete',
  name: "Pete's Plumbing",
  address: 'Marrickville',
  phone: '+61 412 555 018',
  website: 'https://petes-plumbing.example',
  types: ['plumber'],
  primaryType: 'Plumber',
  summary: 'Local plumbers.',
  rating: 4.8,
  reviewCount: 120,
};

describe('a Google listing to fill in a Tradie', () => {
  test("gives the listing's details with the Trades Jev suggests", async () => {
    const { h, alice } = await world();
    h.places.listings.set('place-pete', { name: "Pete's Plumbing", address: 'Marrickville', rating: 4.8, reviewCount: 120, phone: PETES.phone, website: PETES.website, types: PETES.types, primaryType: 'Plumber', summary: 'Local plumbers.' });
    h.tradeSuggester.next = ['plumbing', 'roofing'];

    expect(await alice.googleListing('place-pete')).toEqual({ ...PETES, suggestedTrades: ['plumbing', 'roofing'], tradesSuggested: true });
    expect(h.tradeSuggester.calls).toEqual([PETES]);
  });

  test('a listing no Trade fits is still a suggestion: none ticked, and no note to say Jev failed', async () => {
    const { h, alice } = await world();
    h.tradeSuggester.next = [];

    expect(await alice.googleListing('place-pete')).toMatchObject({ suggestedTrades: [], tradesSuggested: true });
  });

  test("when Jev fails the listing's details still come back, with no Trades and a flag to say so", async () => {
    const { h, alice } = await world();
    h.tradeSuggester.next = new Error('Jev returned 500: down');

    expect(await alice.googleListing('place-pete')).toEqual({
      ...PETES,
      address: 'Marrickville',
      phone: null,
      website: null,
      types: [],
      primaryType: null,
      summary: null,
      suggestedTrades: [],
      tradesSuggested: false,
    });
  });

  test("when Google fails the lookup fails, and Jev isn't asked", async () => {
    const { h, alice } = await world();

    await expect(alice.googleListing('place-nobody')).rejects.toThrow('FakePlaces: unknown place place-nobody');
    expect(h.tradeSuggester.calls).toEqual([]);
  });

  test('looking a listing up adds nothing: no Tradie is stored until the form is submitted', async () => {
    const { h, alice } = await world();
    const before = (await alice.tradieDirectory()).length;
    h.places.listings.set('place-new', { name: 'New Plumbing', address: 'Newtown', rating: null, reviewCount: 0 });

    await alice.googleListing('place-new');
    expect((await alice.tradieDirectory()).length).toBe(before);
  });
});
