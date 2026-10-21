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

  test.each([
    ['rate limiting (429)', () => new Response('Too many requests', { status: 429 }), 'Nominatim returned 429: Too many requests'],
    ['a server error', () => new Response('Internal error', { status: 500 }), 'Nominatim returned 500: Internal error'],
    ['a body that is not JSON', () => new Response('<html>Bad gateway</html>'), 'Nominatim returned a body that is not JSON'],
    ['a body that is not a list', () => json({ error: 'Unable to geocode' }), 'Nominatim returned a malformed response (expected a list of results)'],
    ['a result that is not an object', () => json(['12 King St']), 'Nominatim returned a malformed response (a result that is not an object)'],
    ['a latitude that is not a number', () => json([{ ...NEWTOWN, lat: 'north' }]), 'Nominatim returned a malformed response (lat or lon is not a number)'],
    ['a longitude that is missing', () => json([{ lat: '-33.8970', place_rank: 30 }]), 'Nominatim returned a malformed response (lat or lon is not a number)'],
    ['a result without a place_rank', () => json([{ lat: '-33.8970', lon: '151.1790' }]), 'Nominatim returned a malformed response (place_rank is not a number)'],
  ])('throws on %s', async (_, respond, message) => {
    const { geocoder } = nominatim(respond);
    await expect(geocoder.geocode('12 King St, Newtown NSW 2042')).rejects.toThrow(message);
  });
});

describe('Nominatim usage policy: one request per second', () => {
  /** A clock that only moves when the adapter waits, so no test sleeps. */
  const fakeTime = () => {
    let now = 5_000;
    const waits: number[] = [];
    return {
      clock: { now: () => new Date(now) },
      wait: async (ms: number) => {
        waits.push(ms);
        now += ms;
      },
      waits,
      advance: (ms: number) => (now += ms),
      at: () => now,
    };
  };

  /** A geocoder whose requests are stamped with the fake time they were sent at. */
  const timed = (respond: (request: Request) => Response = () => json([NEWTOWN])) => {
    const time = fakeTime();
    const sentAt: { q: string | null; at: number }[] = [];
    const stub = stubFetch((request) => {
      sentAt.push({ q: new URL(request.url).searchParams.get('q'), at: time.at() });
      return respond(request);
    });
    const geocoder = createNominatimGeocoder({ baseUrl: 'https://nominatim.example', userAgent: USER_AGENT, fetch: stub.fetch, clock: time.clock, wait: time.wait });
    return { geocoder, time, sentAt };
  };

  test('three geocodes started together are sent in order, at least 1000 ms apart', async () => {
    const { geocoder, sentAt } = timed();

    await Promise.all([geocoder.geocode('1 King St, Newtown'), geocoder.geocode('2 King St, Newtown'), geocoder.geocode('3 King St, Newtown')]);

    expect(sentAt.map((sent) => sent.q)).toEqual(['1 King St, Newtown', '2 King St, Newtown', '3 King St, Newtown']);
    expect(sentAt[1]!.at - sentAt[0]!.at).toBeGreaterThanOrEqual(1000);
    expect(sentAt[2]!.at - sentAt[1]!.at).toBeGreaterThanOrEqual(1000);
  });

  test('the first request, and one after a quiet second, go straight out', async () => {
    const { geocoder, time } = timed();

    await geocoder.geocode('1 King St, Newtown');
    time.advance(1000);
    await geocoder.geocode('2 King St, Newtown');

    expect(time.waits).toEqual([]);
  });

  test('a request only waits for what is left of the second', async () => {
    const { geocoder, time } = timed();

    await geocoder.geocode('1 King St, Newtown');
    time.advance(400);
    await geocoder.geocode('2 King St, Newtown');

    expect(time.waits).toEqual([600]);
  });

  test('a failed lookup still holds its place in the queue, and does not stop the next', async () => {
    let calls = 0;
    const { geocoder, sentAt } = timed(() => (++calls === 1 ? new Response('Too many requests', { status: 429 }) : json([NEWTOWN])));

    const [first, second] = await Promise.allSettled([geocoder.geocode('1 King St, Newtown'), geocoder.geocode('2 King St, Newtown')]);

    expect(first.status).toBe('rejected');
    expect(second).toEqual({ status: 'fulfilled', value: { lat: -33.897, lng: 151.179 } });
    expect(sentAt[1]!.at - sentAt[0]!.at).toBeGreaterThanOrEqual(1000);
  });
});
