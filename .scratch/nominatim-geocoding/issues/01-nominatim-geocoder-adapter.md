# The Geocoder port and its Nominatim adapter

Status: ready-for-agent
Spec: ../spec.md

## What to build

- The `Geocoder` port in `src/ports.ts`, exactly as the spec says. For now, leave `PlacesLookup.geocode` in place; issue 02 removes it.
- `src/adapters/nominatim.ts`: `createNominatimGeocoder({ baseUrl, userAgent, fetch?, clock?, wait? })` implementing it. Follow `src/adapters/google-places.ts` and `src/adapters/json-api.ts` for style, error messages (`malformed`, the service name), and how a fetch is injected.
- The one-request-per-second queue lives inside the adapter. Its timing comes from an injected clock and wait function, so tests can check the spacing without sleeping.

## Acceptance criteria

`test/adapters/nominatim.test.ts`, with a stubbed fetch (see `test/adapters/stub-fetch.ts`):
- [ ] The request is `GET {baseUrl}/search` with `q`, `format=jsonv2`, `limit=1` and `countrycodes=au`, and the `User-Agent` header. A trailing slash on `baseUrl` is handled.
- [ ] `lat`/`lon` strings come back as numbers.
- [ ] An empty result is `null`. A blank address is `null` with no request made. A `place_rank` below 26 is `null`.
- [ ] HTTP 429 and 500 throw, and so do a body that isn't an array and a non-numeric `lat`.
- [ ] Three geocodes started together are sent at least 1000 ms apart, in order, checked with the fake clock and wait function.
- [ ] `npm run typecheck` and the new tests pass.
