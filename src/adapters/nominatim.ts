// The Geocoder port over OpenStreetMap's Nominatim:
// - Search API: GET {baseUrl}/search?q=...&format=jsonv2&limit=1&countrycodes=au
// It needs no key. Its usage policy (operations.osmfoundation.org/policies/nominatim/)
// asks for a User-Agent naming the app. It answers with an array whose first item has
// `lat` and `lon` as strings. The policy also allows at most one request a second, so
// the adapter queues its own requests to start at least that far apart.

import type { Clock, Geocoder } from '../ports.ts';
import { callJson, isObject, malformed } from './json-api.ts';

/** OpenStreetMap's public Nominatim, which needs no key. Live use defaults to it when NOMINATIM_URL is unset. */
export const PUBLIC_NOMINATIM_URL = 'https://nominatim.openstreetmap.org';

/** Nominatim's `place_rank` for a street: 26. Lower ranks are suburbs, cities and regions. */
const MIN_PLACE_RANK = 26;

/** The usage policy's limit: one request a second. */
const MIN_INTERVAL_MS = 1000;

/** A `lat` or `lon` field: Nominatim writes them as strings. NaN when it is anything else, or blank. */
const coordinate = (value: unknown) => (typeof value === 'string' && value.trim() ? Number(value) : NaN);

/** The Geocoder port over Nominatim's search API. */
export function createNominatimGeocoder({
  baseUrl,
  userAgent,
  fetch: fetchImpl = fetch,
  clock = { now: () => new Date() },
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: {
  baseUrl: string;
  /** Names the app and how to reach it: "myEST8 (https://myest8.example)". */
  userAgent: string;
  fetch?: typeof fetch;
  /** Times the gap between requests. Tests pass a fake one. */
  clock?: Clock;
  /** Sleeps for the given milliseconds. Tests pass one that moves the fake clock instead. */
  wait?: (ms: number) => Promise<void>;
}): Geocoder {
  let queue: Promise<unknown> = Promise.resolve();
  let lastStartedAt: number | undefined;

  /** Runs `request` once every earlier one has started and a second has passed since the last. A failure doesn't hold up the next. */
  const inTurn = <T>(request: () => Promise<T>): Promise<T> => {
    const turn = queue.then(async () => {
      if (lastStartedAt !== undefined) {
        const remaining = lastStartedAt + MIN_INTERVAL_MS - clock.now().getTime();
        if (remaining > 0) await wait(remaining);
      }
      lastStartedAt = clock.now().getTime();
      return request();
    });
    queue = turn.catch(() => undefined);
    return turn;
  };

  return {
    async geocode(address) {
      // Nominatim answers a blank query with an error; it has no location either way.
      if (!address.trim()) return null;
      const service = 'Nominatim';
      const params = new URLSearchParams({ q: address, format: 'jsonv2', limit: '1', countrycodes: 'au' });
      const url = `${baseUrl.replace(/\/+$/, '')}/search?${params}`;
      const body = await inTurn(() => callJson(fetchImpl, service, url, { headers: { 'user-agent': userAgent } }));
      if (!Array.isArray(body)) malformed(service, 'expected a list of results', body);
      // No match is an empty list.
      if (body.length === 0) return null;
      const first: unknown = body[0];
      if (!isObject(first)) malformed(service, 'a result that is not an object', body);
      const lat = coordinate(first.lat);
      const lng = coordinate(first.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) malformed(service, 'lat or lon is not a number', body);
      if (typeof first.place_rank !== 'number') malformed(service, 'place_rank is not a number', body);
      // Below a street (a suburb, a postcode) is not the address: a pin in the
      // middle of a suburb is worse than none.
      if (first.place_rank < MIN_PLACE_RANK) return null;
      return { lat, lng };
    },
  };
}
