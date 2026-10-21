// The Geocoder port over OpenStreetMap's Nominatim:
// - Search API: GET {baseUrl}/search?q=...&format=jsonv2&limit=1&countrycodes=au
// It needs no key. Its usage policy (operations.osmfoundation.org/policies/nominatim/)
// asks for a User-Agent naming the app. It answers with an array whose first item has
// `lat` and `lon` as strings.

import type { Geocoder } from '../ports.ts';
import { callJson, isObject, malformed } from './json-api.ts';

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
      const service = 'Nominatim';
      const params = new URLSearchParams({ q: address, format: 'jsonv2', limit: '1', countrycodes: 'au' });
      const body = await callJson(fetchImpl, service, `${baseUrl.replace(/\/+$/, '')}/search?${params}`, { headers: { 'user-agent': userAgent } });
      if (!Array.isArray(body)) malformed(service, 'expected a list of results', body);
      const first: unknown = body[0];
      if (!isObject(first)) malformed(service, 'a result that is not an object', body);
      return { lat: Number(first.lat), lng: Number(first.lon) };
    },
  };
}
