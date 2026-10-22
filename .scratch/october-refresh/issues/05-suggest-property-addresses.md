# Suggest a Property's address as it is typed

Status: resolved
Branch: nominatim-geocoding
Spec: ../spec.md, and ADR 0012 on that branch

## Why

A Property's map pin comes from geocoding its address. On the `nominatim-geocoding` branch that is now OpenStreetMap's Nominatim, which is free; Google is kept for Tradie listings and ratings only. A typed address can still be ambiguous or mistyped and end up with no pin. Suggesting real addresses while the Property Manager types fills in the address and suburb correctly, and gives the location at the same moment.

Nominatim's usage policy forbids search-as-you-type, so suggestions use **Photon** (`https://photon.komoot.io`, Komoot's free geocoder over the same OpenStreetMap data, no key, fair use). Read its API docs before writing the adapter.

## What to build

- **A port and adapter.** An `AddressSuggester` port, `suggest(query) → [{ label, address, suburb, postcode?, state?, location: { lat, lng } }]` (at most 5), and `src/adapters/photon.ts`:
  - `GET {baseUrl}/api/?q=…&limit=5&lang=en`, limited to Australia with Photon's `bbox` (or a country filter if its docs offer one), and street-level results only (houses and streets, not suburbs or POIs)
  - a `User-Agent` like the Nominatim adapter's
  - `PHOTON_URL` configuration, set up the same way as `NOMINATIM_URL`: the public server when live, a mock in the demo and tests, and the demo mock answering from the demo's addresses
  - a blank or under-3-character query is `[]` with no request made. HTTP errors throw.
- **A route.** `GET /properties/address-suggestions?q=…` for a signed-in Property Manager only. It returns JSON with the suggestions, `[]` when the suggester throws (logged), and is covered by the app's existing rate limiting where one applies.
- **On the form.** On the Property forms (Properties page, welcome wizard and Setup, all through `onboarding-forms.ts`/`properties.ts`/`welcome.ts`), `app.js` turns the Address field into a combobox. Copy the searchable-select pattern in `app.js`: `role="combobox"`, a listbox, arrow keys, Enter, Escape, and 300 ms debounce. Choosing a suggestion fills Address and Suburb and two hidden fields, `lat` and `lng`.
- **Saving.** `addProperty` uses a posted `lat`/`lng` as the Property's location when both are numbers inside Australia's bounding box, instead of geocoding. Otherwise it geocodes as now (Nominatim). Without JavaScript the form is unchanged and still works.

## Acceptance criteria

- [x] Adapter tests (`test/adapters/photon.test.ts`):
  - the request's URL, parameters and User-Agent
  - features read into suggestions (Photon gives `[lon, lat]`, so assert lat and lng the right way round from a worked example)
  - non-street results left out
  - a short query makes no request
  - an HTTP error throws
- [x] Page and route tests:
  - the route needs a sign-in
  - it returns suggestions from the fake, and `[]` when the fake throws
  - posting a Property with valid `lat`/`lng` stores that location without calling the geocoder
  - out-of-range or missing `lat`/`lng` falls back to the geocoder
- [x] Browser test (demo): type part of a demo address, pick the suggestion by keyboard, see Address and Suburb filled, save, and the Property has a pin on Dispatch.
- [x] ADR 0012 gets a short section on Photon for suggestions, and the env examples list `PHOTON_URL` as optional.
- [x] `npm run check` passes.
