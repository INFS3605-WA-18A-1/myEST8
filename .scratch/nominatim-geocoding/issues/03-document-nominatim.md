# Document geocoding with Nominatim

Status: resolved
Spec: ../spec.md

## What to write

- `docs/adr/0012-nominatim-for-geocoding.md`, in the style of the other ADRs. Cover:
  - **Context:** Google Geocoding is refused without billing, while Places works on the same key.
  - **Decision:** Nominatim, and why, matching the spec.
  - **Usage policy:** one request a second, a User-Agent, keeping results, attribution.
  - **What stays on Google:** listing search, details, ratings.
  - **Consequences:** no key needed. Rural or brand-new addresses may not be found, and those Properties are added without a pin. Switching to a self-hosted Nominatim is only a change of `NOMINATIM_URL`.
- `.env.example` and `deploy/live.env.example`: add an optional `NOMINATIM_URL`, with a comment giving the default.
- Everywhere the docs say Google geocodes addresses or that the key needs the Geocoding API (`docs/channels-setup.md`, `docs/design-system.md`, `docs/demo.md`, `docs/vercel.md`, `CONTEXT.md`, and anything `grep -rn -i "geocod" docs CONTEXT.md` finds): say Nominatim does it now. `GOOGLE_MAPS_API_KEY` now needs only **Places API (New)**.
- Don't change code or tests.

## Acceptance criteria

- [x] ADR 0012 exists, with the decision and its consequences.
- [x] No doc says the Google key needs the Geocoding API, or that Google places addresses on the map.
- [x] The env examples list `NOMINATIM_URL` as optional, with its default.
