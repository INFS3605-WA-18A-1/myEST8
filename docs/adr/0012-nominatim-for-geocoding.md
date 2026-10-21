# Nominatim for geocoding, Google for listings

Properties and Tradie business addresses are placed on the Dispatch map by geocoding their address. That went through Google's Geocoding API, which production's key can't use: Google answers `REQUEST_DENIED` until billing is enabled on the Cloud project (production logs, 2026-10-21). The Places API on the same key works.

Geocoding now goes through OpenStreetMap's Nominatim, which is free and needs no key or account. Its data is the same OpenStreetMap the Dispatch map's basemap (OpenFreeMap) is drawn from, so a pin and the map under it agree. It sits behind a `Geocoder` port in `src/ports.ts` of its own, apart from `PlacesLookup`.

A request is `GET {NOMINATIM_URL}/search` with the address as `q`, `format=jsonv2`, `limit=1` and `countrycodes=au`.

- No result, or a blank address, is no location. A result coarser than a street (`place_rank` below 26, for example only the suburb) is no location either, as Google's `APPROXIMATE` was. A pin in the middle of a suburb is worse than none.
- An HTTP error, including 429, or a malformed answer throws. Callers already treat that as "try again later".

**Usage policy** ([Nominatim's](https://operations.osmfoundation.org/policies/nominatim/)):

- Every request sends a `User-Agent` of `myEST8 (<PUBLIC_URL>)`.
- At most one request a second. The adapter queues its own requests so they start at least 1000 ms apart, even when several are asked for at once.
- Results are kept. A found location is stored on the Property or Tradie and never looked up again.
- Attribution: the Dispatch map already shows OpenStreetMap's credit through its attribution control.

**What stays on Google:** the Places API (New), for listing search, details and ratings, and the Tradie autofill. `GOOGLE_MAPS_API_KEY` needs only that API enabled.

**Configuration:** `NOMINATIM_URL` is the base URL. It is optional. Hosted mode defaults to `https://nominatim.openstreetmap.org`, so it is never a missing setting. The local demo and the tests use the in-process mock unless it is set.

**Address suggestions** use [Photon](https://photon.komoot.io) (`PHOTON_URL`), Komoot's geocoder over the same OpenStreetMap data. Nominatim's usage policy forbids search-as-you-type, and Photon allows it. No key. The public server is fair use and may throttle.

A request is `GET {PHOTON_URL}/api/?q=…&limit=5&lang=en&countrycode=AU&layer=house&layer=street`. Photon's API offers `countrycode` (a 2-letter country code; checked on the public server, which accepts `AU`), so suggestions are limited to Australia that way rather than with `bbox`. `layer` asks for houses and streets. Photon still returns some points of interest as `house` when they have a street number (a restaurant, a bus stop), so the adapter keeps a house only when its OSM key is `building` or `place`, and keeps a `street` by its name. A result's coordinates are `[longitude, latitude]`. A blank or under-3-character query makes no request.

Choosing a suggestion fills the Property's Address and Suburb and a hidden pin. `addProperty` stores that pin when both numbers sit inside mainland Australia and Tasmania (about 10°S–44°S, 112°E–154°E). Otherwise, and when the form is used without JavaScript, the address is geocoded with Nominatim as before.

`PHOTON_URL` is optional. Hosted mode defaults to `https://photon.komoot.io`, so it is never a missing setting. The local demo and the tests use the in-process mock unless it is set. The mock answers from the demo's addresses.

## Consequences

- No key to get, restrict or pay for.
- Rural or brand-new addresses may not be found. Those Properties are still added, without a pin, and show "Address not found" on Dispatch.
- Properties and Tradies with no location are placed by `geocodeMissing` (Dispatch's **Look up missing addresses**), so nothing needs migrating.
- The public Nominatim server is for light use. If myEST8 outgrows it, a self-hosted Nominatim is only a change of `NOMINATIM_URL`.
