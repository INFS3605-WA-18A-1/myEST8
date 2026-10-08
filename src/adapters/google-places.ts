// The PlacesLookup port over Google's real APIs:
// - Places API (New) Text Search: POST {placesBaseUrl}/v1/places:searchText
// - Places API (New) Place Details: GET {placesBaseUrl}/v1/places/{placeId}
// - Geocoding API: GET {geocodeBaseUrl}/maps/api/geocode/json?address=...&key=...
// The Places API takes the key in X-Goog-Api-Key and requires an X-Goog-FieldMask
// naming the fields to return (and to bill for). Geocoding takes the key as a query
// parameter and reports failures in `status` with HTTP 200.

import type { PlacesLookup } from '../ports.ts';
import { callJson, isObject, malformed } from './json-api.ts';

const SEARCH_FIELDS = 'places.id,places.displayName,places.formattedAddress';
const RATING_FIELDS = 'rating,userRatingCount';

/** The PlacesLookup port over Google Places API (New) and the Geocoding API. */
export function createGooglePlaces({
  apiKey,
  fetch: fetchImpl = fetch,
  placesBaseUrl = 'https://places.googleapis.com',
  geocodeBaseUrl = 'https://maps.googleapis.com',
}: {
  apiKey: string;
  fetch?: typeof fetch;
  placesBaseUrl?: string;
  geocodeBaseUrl?: string;
}): PlacesLookup {
  const placesHeaders = (fieldMask: string) => ({ 'x-goog-api-key': apiKey, 'x-goog-fieldmask': fieldMask });

  return {
    async findListings(query) {
      if (!query.trim()) return [];
      const service = 'Google Places Text Search';
      const body = await callJson(fetchImpl, service, `${placesBaseUrl}/v1/places:searchText`, {
        headers: placesHeaders(SEARCH_FIELDS),
        body: { textQuery: query },
      });
      // No matches comes back as {} with no places list.
      if (!isObject(body) || (body.places !== undefined && !Array.isArray(body.places))) malformed(service, 'expected a places list', body);
      return ((body.places ?? []) as unknown[]).map((place) => {
        if (!isObject(place) || typeof place.id !== 'string' || !isObject(place.displayName) || typeof place.displayName.text !== 'string') {
          malformed(service, 'a place without id and displayName', body);
        }
        const address = typeof place.formattedAddress === 'string' ? place.formattedAddress : '';
        return { placeId: place.id, name: place.displayName.text, address };
      });
    },

    async getRating(placeId) {
      const service = 'Google Place Details';
      const body = await callJson(fetchImpl, service, `${placesBaseUrl}/v1/places/${encodeURIComponent(placeId)}`, {
        headers: placesHeaders(RATING_FIELDS),
      });
      // A place nobody has reviewed comes back without rating or userRatingCount.
      if (!isObject(body)) malformed(service, 'expected an object', body);
      const { rating, userRatingCount } = body;
      if (rating !== undefined && typeof rating !== 'number') malformed(service, 'rating is not a number', body);
      if (userRatingCount !== undefined && !Number.isInteger(userRatingCount)) malformed(service, 'userRatingCount is not a whole number', body);
      return rating === undefined ? { rating: null, reviewCount: 0 } : { rating, reviewCount: (userRatingCount as number | undefined) ?? 0 };
    },

    async geocode(address) {
      // Google answers a blank address with INVALID_REQUEST; it has no location either way.
      if (!address.trim()) return null;
      const service = 'Google Geocoding';
      const params = new URLSearchParams({ address, key: apiKey });
      const body = await callJson(fetchImpl, service, `${geocodeBaseUrl}/maps/api/geocode/json?${params}`, { headers: {} });
      if (!isObject(body) || typeof body.status !== 'string') malformed(service, 'no status', body);
      if (body.status === 'ZERO_RESULTS') return null;
      if (body.status !== 'OK') {
        throw new Error(`${service} returned ${body.status}${typeof body.error_message === 'string' ? `: ${body.error_message}` : ''}`);
      }
      const location = Array.isArray(body.results) && isObject(body.results[0]) && isObject(body.results[0].geometry) ? body.results[0].geometry.location : undefined;
      if (!isObject(location) || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
        malformed(service, 'no geometry.location on the first result', body);
      }
      return { lat: location.lat, lng: location.lng };
    },
  };
}
