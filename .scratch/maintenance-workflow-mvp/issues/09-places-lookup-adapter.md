# Places lookup adapter and Google rating refresh

Status: ready-for-human

## Goal

A real `PlacesLookup` (`src/ports.ts`) on the Google Places API, and a regular refresh of each Tradie's Google rating.

## What exists

- `PlacesLookup`: `findListings(query)`, `getRating(placeId)` (rating and review count), `geocode(address)`.
- `src/onboarding.ts` uses `findListings` for linking a Tradie and `src/profiles.ts` geocodes a Property when it's saved and has `refreshGoogleRating(tradieId)`.
- Tests use `FakePlaces`.

## Acceptance criteria

- [ ] Text search returns candidate listings (place id, name, address).
- [ ] Place details return the rating and number of reviews; a listing with no rating returns `null`.
- [ ] Geocoding returns latitude and longitude, or `null` when the address isn't found (the photo GPS check is then skipped).
- [ ] A scheduled worker task refreshes every linked Tradie's Google rating, e.g. weekly.
- [ ] The API key comes from configuration.

## Needs a human

- Google Cloud project, Places API and Geocoding API enabled, an API key with restrictions.

## Testing

- Adapter tests with recorded responses and a stubbed `fetch`; a scenario test for the refresh task using `FakePlaces` and the fake clock.
