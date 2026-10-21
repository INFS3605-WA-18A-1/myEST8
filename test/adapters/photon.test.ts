import { describe, expect, test } from 'vitest';
import { createPhotonAddressSuggester } from '../../src/adapters/photon.ts';
import { json, stubFetch } from './stub-fetch.ts';

const USER_AGENT = 'myEST8 (https://myest8.example)';

const photon = (respond: () => Response, baseUrl = 'https://photon.example') => {
  const stub = stubFetch(respond);
  return { stub, suggester: createPhotonAddressSuggester({ baseUrl, userAgent: USER_AGENT, fetch: stub.fetch }) };
};

/**
 * A house Photon returned for "12 King Street" in Ashbury (live search, 2026-10-21).
 * `coordinates` are [longitude, latitude].
 */
const ASHBURY = {
  type: 'Feature',
  properties: {
    osm_key: 'building',
    osm_value: 'house',
    type: 'house',
    housenumber: '12',
    street: 'King Street',
    district: 'Ashbury',
    city: 'Sydney',
    state: 'New South Wales',
    country: 'Australia',
    postcode: '2193',
    countrycode: 'AU',
  },
  geometry: { type: 'Point', coordinates: [151.1205914, -33.8983619] },
};

const collection = (...features: unknown[]) => json({ type: 'FeatureCollection', features });

describe('Photon address suggestions', () => {
  test('searches houses and streets in Australia, naming the app in the User-Agent', async () => {
    const { stub, suggester } = photon(() => json({ type: 'FeatureCollection', features: [] }));

    await suggester.suggest('12 King Street');

    const request = stub.requests[0]!;
    const url = new URL(request.url);
    expect(request.method).toBe('GET');
    expect(url.origin + url.pathname).toBe('https://photon.example/api/');
    expect(url.searchParams.get('q')).toBe('12 King Street');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.searchParams.get('countrycode')).toBe('AU');
    expect(url.searchParams.getAll('layer')).toEqual(['house', 'street']);
    expect(request.headers.get('user-agent')).toBe(USER_AGENT);
  });

  test('a blank or under-3-character query is no suggestions, and no request', async () => {
    const { stub, suggester } = photon(() => collection(ASHBURY));

    expect(await suggester.suggest('')).toEqual([]);
    expect(await suggester.suggest('  ')).toEqual([]);
    expect(await suggester.suggest('a')).toEqual([]);
    expect(await suggester.suggest('  ab ')).toEqual([]);
    expect(stub.requests).toHaveLength(0);
  });

  test('an HTTP error throws', async () => {
    const { suggester } = photon(() => new Response('Internal error', { status: 500 }));
    await expect(suggester.suggest('12 King Street')).rejects.toThrow('Photon returned 500: Internal error');
  });

  test('reads a house into a suggestion, with latitude and longitude the right way round', async () => {
    const { suggester } = photon(() => collection(ASHBURY));

    expect(await suggester.suggest('12 King Street')).toEqual([
      {
        label: '12 King Street, Ashbury NSW 2193',
        address: '12 King Street',
        suburb: 'Ashbury',
        postcode: '2193',
        state: 'New South Wales',
        location: { lat: -33.8983619, lng: 151.1205914 },
      },
    ]);
  });

  test('leaves out suburbs, points of interest and anything that is not a house or a street', async () => {
    const { suggester } = photon(() =>
      collection(
        ASHBURY,
        {
          type: 'Feature',
          properties: {
            osm_key: 'amenity',
            osm_value: 'restaurant',
            type: 'house',
            name: 'Hanoi On King',
            housenumber: '120',
            street: 'King Street',
            district: 'Newtown',
            city: 'Sydney',
            state: 'New South Wales',
            postcode: '2042',
            countrycode: 'AU',
          },
          geometry: { type: 'Point', coordinates: [151.1840831, -33.8933278] },
        },
        {
          type: 'Feature',
          properties: {
            osm_key: 'place',
            osm_value: 'suburb',
            type: 'district',
            name: 'Newtown',
            city: 'Sydney',
            state: 'New South Wales',
            postcode: '2042',
            countrycode: 'AU',
          },
          geometry: { type: 'Point', coordinates: [151.1801893, -33.8961132] },
        },
        {
          type: 'Feature',
          properties: {
            osm_key: 'highway',
            osm_value: 'bus_stop',
            type: 'house',
            name: 'Illawarra Rd opp Marrickville Station',
            street: 'Illawarra Road',
            district: 'Marrickville',
            state: 'New South Wales',
            postcode: '2204',
            countrycode: 'AU',
          },
          geometry: { type: 'Point', coordinates: [151.1525218, -33.9144965] },
        },
        {
          type: 'Feature',
          properties: {
            osm_key: 'place',
            osm_value: 'house',
            type: 'house',
            housenumber: '12',
            street: 'King Street',
            district: 'Essendon',
            city: 'Melbourne',
            state: 'Victoria',
            postcode: '3040',
            countrycode: 'AU',
          },
          geometry: { type: 'Point', coordinates: [144.9083499, -37.7470927] },
        },
        {
          type: 'Feature',
          properties: {
            osm_key: 'highway',
            osm_value: 'trunk',
            type: 'street',
            name: 'King Street',
            district: 'Newtown',
            city: 'Sydney',
            state: 'New South Wales',
            postcode: '2042',
            countrycode: 'AU',
          },
          geometry: { type: 'Point', coordinates: [151.1875285, -33.8920597] },
        },
      ),
    );

    expect(await suggester.suggest('King')).toEqual([
      {
        label: '12 King Street, Ashbury NSW 2193',
        address: '12 King Street',
        suburb: 'Ashbury',
        postcode: '2193',
        state: 'New South Wales',
        location: { lat: -33.8983619, lng: 151.1205914 },
      },
      {
        label: '12 King Street, Essendon VIC 3040',
        address: '12 King Street',
        suburb: 'Essendon',
        postcode: '3040',
        state: 'Victoria',
        location: { lat: -37.7470927, lng: 144.9083499 },
      },
      {
        label: 'King Street, Newtown NSW 2042',
        address: 'King Street',
        suburb: 'Newtown',
        postcode: '2042',
        state: 'New South Wales',
        location: { lat: -33.8920597, lng: 151.1875285 },
      },
    ]);
  });
});
