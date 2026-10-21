# Geocode with OpenStreetMap's Nominatim, not Google

Properties and Tradie business addresses are placed on the Dispatch map by geocoding their address. That goes through Google's Geocoding API (`PlacesLookup.geocode` in `src/adapters/google-places.ts`), which production's key can't use: Google answers `REQUEST_DENIED` until billing is enabled on the Cloud project (production logs, 2026-10-21). The Places API on the same key works, for listing search, details and ratings, and stays as it is.

OpenStreetMap's Nominatim geocodes for free with no key or account. Its data is the same OpenStreetMap the Dispatch map's basemap (OpenFreeMap) is drawn from.

## Decisions

- **A `Geocoder` port of its own** in `src/ports.ts`: `geocode(address): Promise<{ lat, lng } | null>`, with the doc comment `PlacesLookup.geocode` has now. `geocode` is removed from `PlacesLookup`, along with the Google Geocoding code, its tests and its mock routes. Google stays the Places provider only.
- **Nominatim's search API:** `GET {baseUrl}/search?q=<address>&format=jsonv2&limit=1&countrycodes=au`. It answers with an array whose first item has `lat` and `lon` as **strings** and a `place_rank`.
  - An empty array, or a blank address (with no request made), is `null`.
  - A result coarser than a street (`place_rank` below 26, for example only the suburb) is `null`, as Google's `APPROXIMATE` is today. A pin in the middle of a suburb is worse than none.
  - Any HTTP error, including 429, or a malformed body throws. Callers already treat a throw as "try again later" (`geocode` helper and `geocodeMissing` in `src/profiles.ts`).
- **Nominatim's usage policy** (https://operations.osmfoundation.org/policies/nominatim/):
  - Every request sends a `User-Agent` naming the app and its address: `myEST8 (<PUBLIC_URL>)`.
  - At most **one request per second**. The adapter queues its own requests so they start at least 1000 ms apart, even when `geocodeMissing` asks for several at once. The clock is injectable, so tests don't sleep.
  - Results are kept: a found location is stored on the Property or Tradie and never looked up again.
  - Attribution: the Dispatch map already shows OpenStreetMap's attribution through MapLibre's attribution control.
- **Configuration:** `NOMINATIM_URL`, the base URL.
  - Hosted (production) defaults to `https://nominatim.openstreetmap.org`. It needs no key, so it is never a missing setting.
  - The local demo and the tests use the mock unless `NOMINATIM_URL` is set, like every other provider in `src/demo/runtime.ts` (`pick`).
- **Existing Properties and Tradies without a location** are placed by `geocodeMissing` when a Property Manager presses **Look up missing addresses** on Dispatch. Nothing else is needed.

## Non-goals

- No change to Google Places: listing search, details, ratings and the Tradie autofill.
- No self-hosted Nominatim.
- No map pin for an address Nominatim can't find. The Property is still added, without a pin (#31).
