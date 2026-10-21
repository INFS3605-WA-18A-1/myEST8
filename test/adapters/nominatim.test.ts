import { describe, expect, test } from 'vitest';
import { createNominatimGeocoder } from '../../src/adapters/nominatim.ts';
import { json, stubFetch } from './stub-fetch.ts';

const USER_AGENT = 'myEST8 (https://myest8.example)';

const NEWTOWN = { lat: '-33.8970', lon: '151.1790', place_rank: 30, display_name: '12, King Street, Newtown, Sydney, New South Wales, 2042, Australia' };

const nominatim = (respond: () => Response, baseUrl = 'https://nominatim.example') => {
  const stub = stubFetch(respond);
  return { stub, geocoder: createNominatimGeocoder({ baseUrl, userAgent: USER_AGENT, fetch: stub.fetch }) };
};

describe('Nominatim geocoding', () => {
  test('searches for the address in Australia, naming the app in the User-Agent', async () => {
    const { stub, geocoder } = nominatim(() => json([NEWTOWN]));

    await geocoder.geocode('12 King St, Newtown NSW 2042');

    const request = stub.requests[0]!;
    const url = new URL(request.url);
    expect(request.method).toBe('GET');
    expect(url.origin + url.pathname).toBe('https://nominatim.example/search');
    expect(url.searchParams.get('q')).toBe('12 King St, Newtown NSW 2042');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(url.searchParams.get('countrycodes')).toBe('au');
    expect(request.headers.get('user-agent')).toBe(USER_AGENT);
  });

  test('a trailing slash on the base URL does not double up', async () => {
    const { stub, geocoder } = nominatim(() => json([NEWTOWN]), 'https://nominatim.example/');
    await geocoder.geocode('12 King St, Newtown NSW 2042');
    expect(stub.requests[0]!.url.startsWith('https://nominatim.example/search?')).toBe(true);
  });

  test('gives the first result as numbers, since Nominatim writes lat and lon as strings', async () => {
    const { geocoder } = nominatim(() => json([NEWTOWN]));
    expect(await geocoder.geocode('12 King St, Newtown NSW 2042')).toEqual({ lat: -33.897, lng: 151.179 });
  });

  test('no results is no location', async () => {
    const { geocoder } = nominatim(() => json([]));
    expect(await geocoder.geocode('1 Nowhere Rd')).toBeNull();
  });

  test('a blank address is not looked up', async () => {
    const { stub, geocoder } = nominatim(() => json([NEWTOWN]));
    expect(await geocoder.geocode('  ')).toBeNull();
    expect(stub.requests).toHaveLength(0);
  });

  test('a result only placed at the suburb (place_rank below 26) is no location', async () => {
    const { geocoder } = nominatim(() => json([{ lat: '-33.8983', lon: '151.1785', place_rank: 25, display_name: 'Newtown, Sydney, New South Wales, 2042, Australia' }]));
    expect(await geocoder.geocode('99 Madeup Lane, Newtown NSW 2042')).toBeNull();
  });

  test('a result placed at a street (place_rank 26) is a location', async () => {
    const { geocoder } = nominatim(() => json([{ lat: '-33.8970', lon: '151.1790', place_rank: 26, display_name: 'King Street, Newtown, Sydney, New South Wales, 2042, Australia' }]));
    expect(await geocoder.geocode('King St, Newtown NSW 2042')).toEqual({ lat: -33.897, lng: 151.179 });
  });
});
