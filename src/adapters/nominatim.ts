// The Geocoder port over OpenStreetMap's Nominatim:
// - Search API: GET {baseUrl}/search?q=...&format=jsonv2&limit=1&countrycodes=au
// It needs no key. Its usage policy (operations.osmfoundation.org/policies/nominatim/)
// asks for a User-Agent naming the app. It answers with an array whose first item has
// `lat` and `lon` as strings.

import type { Geocoder } from '../ports.ts';
import { callJson, isObject, malformed } from './json-api.ts';

/** Nominatim's `place_rank` for a street: 26. Lower ranks are suburbs, cities and regions. */
const MIN_PLACE_RANK = 26;

/** A `lat` or `lon` field: Nominatim writes them as strings. NaN when it is anything else, or blank. */
const coordinate = (value: unknown) => (typeof value === 'string' && value.trim() ? Number(value) : NaN);

/** The Geocoder port over Nominatim's search API. */
export function createNominatimGeocoder({
  baseUrl,
  userAgent,
  fetch: fetchImpl = fetch,
}: {
  baseUrl: string;
  /** Names the app and how to reach it: "myEST8 (https://myest8.example)". */
  userAgent: string;
  fetch?: typeof fetch;
}): Geocoder {
  return {
    async geocode(address) {
      // Nominatim answers a blank query with an error; it has no location either way.
      if (!address.trim()) return null;
      const service = 'Nominatim';
      const params = new URLSearchParams({ q: address, format: 'jsonv2', limit: '1', countrycodes: 'au' });
      const body = await callJson(fetchImpl, service, `${baseUrl.replace(/\/+$/, '')}/search?${params}`, { headers: { 'user-agent': userAgent } });
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
