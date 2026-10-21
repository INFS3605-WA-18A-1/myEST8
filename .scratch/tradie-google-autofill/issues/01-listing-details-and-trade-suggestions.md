# Listing details from Google and Trade suggestions from Jev

Status: resolved
Spec: ../spec.md

## What to build

The two lookups the form needs, behind ports, with the demo's HTTP mocks. No UI in this issue.

1. **Listing details.** Extend `PlacesLookup` (`src/ports.ts`) with `listingDetails(placeId)` returning `{ placeId, name, address, phone: string | null, website: string | null, types: string[], primaryType: string | null, summary: string | null, rating: number | null, reviewCount: number }`. Implement it in `src/adapters/google-places.ts` with Place Details (New) and a field mask of only the fields used (`id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,types,primaryTypeDisplayName,editorialSummary,rating,userRatingCount`). Prefer the international number for `phone`.
2. **Trade suggestions.** A new port, `TradeSuggester`, with `suggestTrades(listing) → Promise<Trade[]>`, implemented over Jev in a new file `src/adapters/jev-trades.ts` with the real System One contract from the spec (one Noul per Trade, threshold 0.5). Redact the API key from any error, as `src/adapters/jev.ts` does on the `jev-classifier` branch. Add it to `Context` ports and build it in `src/demo/runtime.ts` from `JEV_API_URL`/`JEV_API_KEY`, falling back to the mock base URL like the classifier does.
3. **One action.** `findGoogleListings` sits in `src/onboarding.ts`. Add beside it `googleListing(placeId)`, which returns the details plus `suggestedTrades`. If the suggester throws, return `suggestedTrades: []` and `tradesSuggested: false`; don't fail the lookup. Wire it through `src/app.ts`'s Property Manager actions like `findGoogleListings`.
4. **Mocks.** In `src/demo/mock-apis.ts`, have the Place Details mock return the new fields for the demo places, and add `POST /jev/v1/systemone` answering Noul questions about Trades from keywords in the state (for example "plumb" → plumbing). Keep the existing `/jev/v1/classify` route.

## Acceptance criteria

- [x] `test/adapters/google-places.test.ts`: details are read from a stubbed response, with the field mask asserted; a missing phone, website or summary is null.
- [x] `test/adapters/jev-trades.test.ts`: the request has one Noul per Trade with the listing as state and the bearer key; Trades at or above 0.5 come back; a malformed answer throws; the key never appears in an error.
- [x] An onboarding test: `googleListing` returns details with suggested Trades, and with `suggestedTrades: []` and `tradesSuggested: false` when the suggester throws.
- [x] `test/demo/mock-apis.test.ts` covers the new mock routes.
- [x] `npm run check` passes.
