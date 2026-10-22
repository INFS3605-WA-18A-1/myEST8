# Geocode through Nominatim everywhere, and drop Google Geocoding

Status: resolved
Blocked by: 01
Spec: ../spec.md

## What to build

- Add `geocoder: Geocoder` to `Ports` in `src/context.ts`. `src/profiles.ts` geocodes through `ports.geocoder`: its `geocode` helper (used by `addProperty`, `setTradieAddress` and `geocodeMissing`) and anything else that calls `ports.places.geocode`. Use `grep -rn "geocode" src` to find every caller.
- Remove `geocode` from `PlacesLookup` and from `src/adapters/google-places.ts` (the function, `geocodeBaseUrl` and `region`), together with their tests in `test/adapters/google-places.test.ts`.
- `src/demo/runtime.ts` and the hosted entry point (`src/hosted.ts`) build `createNominatimGeocoder` from `NOMINATIM_URL`:
  - hosted defaults to `https://nominatim.openstreetmap.org`
  - the demo uses the mock unless `NOMINATIM_URL` is set (`pick`)
  - `userAgent` is `myEST8 (<PUBLIC_URL or the demo's base URL>)`

  Check how hosted mode lists real versus mocked providers (the `[hosted] Real: ...` log line) and add the geocoder to it.
- `src/demo/mock-apis.ts`: replace the Google geocode routes with `GET /nominatim/search`, answering from the same demo address data the Google mock uses today (`geocodeResponse`), in Nominatim's jsonv2 shape with a `place_rank` of 30. Update `test/demo/mock-apis.test.ts`.
- `test/support/fakes.ts` and `test/support/harness.ts`: move the fake's `geocode` and `locations` off the places fake onto a geocoder fake. Update every test that sets `h.places.geocode` or `h.places.locations`.
- Don't touch docs, ADRs, `.env.example` or `deploy/live.env.example`. Issue 03 does those.

## Acceptance criteria

- [x] Nothing calls Google's Geocoding API any more: `grep -rn "geocode/json\|geocodeBaseUrl" src test` finds nothing.
- [x] The existing geocoding behaviour tests still pass against the geocoder fake: a Property added with a geocoder that fails, `geocodeMissing`, Tradie addresses, and the Dispatch tests.
- [x] A hosted test shows the hosted app builds a Nominatim geocoder pointed at `https://nominatim.openstreetmap.org` when `NOMINATIM_URL` is unset, and doesn't name it as a missing setting.
- [x] `npm run demo` still places the demo Properties on the Dispatch map (the e2e Dispatch tests cover this).
- [x] `npm run check` passes.
