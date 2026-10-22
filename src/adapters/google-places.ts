// The PlacesLookup port over Google's Places API (New):
// - Text Search: POST {placesBaseUrl}/v1/places:searchText
// - Place Details: GET {placesBaseUrl}/v1/places/{placeId}
// It takes the key in X-Goog-Api-Key and requires an X-Goog-FieldMask naming the
// fields to return (and to bill for).

import type { PlacesLookup } from '../ports.ts';
import { callJson, isObject, malformed } from './json-api.ts';

const SEARCH_FIELDS = 'places.id,places.displayName,places.formattedAddress';
const RATING_FIELDS = 'rating,userRatingCount';
const DETAIL_FIELDS =
  'id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,types,primaryTypeDisplayName,editorialSummary,rating,userRatingCount';

/** The `text` of a Google localized text ({ text, languageCode }), or null when it is absent or blank. */
const localizedText = (value: unknown) => (isObject(value) && typeof value.text === 'string' && value.text.trim() ? value.text : null);

/** A string field that may be missing or blank: its text, or null. */
const optionalText = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);

/** The PlacesLookup port over Google Places API (New). */
export function createGooglePlaces({
  apiKey,
  fetch: fetchImpl = fetch,
  placesBaseUrl = 'https://places.googleapis.com',
}: {
  apiKey: string;
  fetch?: typeof fetch;
  placesBaseUrl?: string;
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

    async listingDetails(placeId) {
      const service = 'Google Place Details';
      const body = await callJson(fetchImpl, service, `${placesBaseUrl}/v1/places/${encodeURIComponent(placeId)}`, {
        headers: placesHeaders(DETAIL_FIELDS),
      });
      // Google leaves out every field the place has no value for, so only the id and name are required.
      if (!isObject(body) || typeof body.id !== 'string') malformed(service, 'a place without an id', body);
      const name = localizedText(body.displayName);
      if (name === null) malformed(service, 'a place without a displayName', body);
      if (body.types !== undefined && (!Array.isArray(body.types) || body.types.some((t) => typeof t !== 'string'))) malformed(service, 'types is not a list of text', body);
      const { rating, userRatingCount } = body;
      if (rating !== undefined && typeof rating !== 'number') malformed(service, 'rating is not a number', body);
      if (userRatingCount !== undefined && !Number.isInteger(userRatingCount)) malformed(service, 'userRatingCount is not a whole number', body);
      return {
        placeId: body.id,
        name,
        address: optionalText(body.formattedAddress) ?? '',
        phone: optionalText(body.internationalPhoneNumber) ?? optionalText(body.nationalPhoneNumber),
        website: optionalText(body.websiteUri),
        types: (body.types ?? []) as string[],
        primaryType: localizedText(body.primaryTypeDisplayName),
        summary: localizedText(body.editorialSummary),
        rating: rating === undefined ? null : rating,
        reviewCount: (userRatingCount as number | undefined) ?? 0,
      };
    },
  };
}
