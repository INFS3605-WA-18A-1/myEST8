// The AddressSuggester port over Komoot's Photon (photon.komoot.io):
// - Search API: GET {baseUrl}/api/?q=...&limit=5&lang=en&countrycode=AU&layer=house&layer=street
// It needs no key. Nominatim's usage policy forbids search-as-you-type, so suggestions
// go here instead, over the same OpenStreetMap data. Photon answers with a GeoJSON
// FeatureCollection whose coordinates are [lon, lat].

import type { AddressSuggestion, AddressSuggester } from '../ports.ts';
import { callJson, isObject, malformed } from './json-api.ts';

/** Komoot's public Photon, which needs no key. Live use defaults to it when PHOTON_URL is unset. */
export const PUBLIC_PHOTON_URL = 'https://photon.komoot.io';

/** At most this many suggestions. Photon is also asked for this many. */
const LIMIT = 5;

/** Photon's English state names, as a Property Manager would write them on an address. */
const STATE_ABBR: Record<string, string> = {
  'New South Wales': 'NSW',
  Victoria: 'VIC',
  Queensland: 'QLD',
  'South Australia': 'SA',
  'Western Australia': 'WA',
  Tasmania: 'TAS',
  'Northern Territory': 'NT',
  'Australian Capital Territory': 'ACT',
};

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : '');

/** The AddressSuggester port over Photon's search API. */
export function createPhotonAddressSuggester({
  baseUrl,
  userAgent,
  fetch: fetchImpl = fetch,
}: {
  baseUrl: string;
  /** Names the app and how to reach it: "myEST8 (https://myest8.example)". */
  userAgent: string;
  fetch?: typeof fetch;
}): AddressSuggester {
  return {
    async suggest(query) {
      // Photon has nothing useful for a letter or two, and a blank query is an error there.
      const q = query.trim();
      if (q.length < 3) return [];
      const service = 'Photon';
      const params = new URLSearchParams({ q, limit: String(LIMIT), lang: 'en', countrycode: 'AU' });
      params.append('layer', 'house');
      params.append('layer', 'street');
      const url = `${baseUrl.replace(/\/+$/, '')}/api/?${params}`;
      const body = await callJson(fetchImpl, service, url, { headers: { 'user-agent': userAgent } });
      if (!isObject(body) || !Array.isArray(body.features)) malformed(service, 'expected a FeatureCollection', body);
      const suggestions: AddressSuggestion[] = [];
      for (const feature of body.features) {
        const suggestion = readFeature(feature);
        if (!suggestion) continue;
        suggestions.push(suggestion);
        if (suggestions.length === LIMIT) break;
      }
      return suggestions;
    },
  };
}

/** The line shown in the list: "12 King Street, Ashbury NSW 2193". */
function labelOf(address: string, suburb: string, state: string, postcode: string) {
  const region = [STATE_ABBR[state] ?? state, postcode].filter(Boolean).join(' ');
  return [address, [suburb, region].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

/**
 * One feature as a suggestion, or null when it isn't a house or a street.
 * Photon calls some points of interest `house` when they have a number (a
 * restaurant, a bus stop), so a house also has to be an OSM building or place.
 * Photon writes the point as [longitude, latitude].
 */
function readFeature(feature: unknown): AddressSuggestion | null {
  if (!isObject(feature) || !isObject(feature.properties) || !isObject(feature.geometry)) return null;
  const props = feature.properties;
  const layer = text(props.type);
  const osmKey = text(props.osm_key);
  let address = '';
  if (layer === 'house' && (osmKey === 'building' || osmKey === 'place')) {
    const housenumber = text(props.housenumber);
    const street = text(props.street);
    if (!housenumber || !street) return null;
    address = `${housenumber} ${street}`;
  } else if (layer === 'street') {
    address = text(props.name);
    if (!address) return null;
  } else return null;
  const suburb = text(props.district) || text(props.locality) || text(props.city);
  if (!suburb) return null;
  const coordinates = feature.geometry.coordinates;
  if (!Array.isArray(coordinates) || typeof coordinates[0] !== 'number' || typeof coordinates[1] !== 'number') return null;
  const postcode = text(props.postcode);
  const state = text(props.state);
  return {
    label: labelOf(address, suburb, state, postcode),
    address,
    suburb,
    ...(postcode ? { postcode } : {}),
    ...(state ? { state } : {}),
    location: { lat: coordinates[1], lng: coordinates[0] },
  };
}
