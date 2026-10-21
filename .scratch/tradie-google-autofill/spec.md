# Add a Tradie from their Google listing

Adding a Tradie today means searching Google, then filling in every field by hand and ticking the listing in a radio group at the bottom of the form (`tradieFields`, `src/web/pages/onboarding-forms.ts`). Instead, the Property Manager searches, picks the business from the results, and gets a form already filled in from Google, with Trades suggested by Jev. They complete what Google can't know and add the Tradie.

## The flow

1. **Search.** The search bar stays at the top. Results are listed directly below it, one entry per listing: business name and address. Each entry is a link (`?google=<query>&place=<placeId>`), so it works without JavaScript like the rest of the app. A "Not on Google? Enter their details yourself" link opens the empty form marked not on Google.
2. **Pick.** Choosing a listing loads its details from Google and shows a summary card above the form: name, address, phone, website, Google rating and review count, and the Trades Jev suggests.
3. **Complete.** The form below is filled in from the listing:
   - Business name: the listing's name.
   - Mobile: the listing's phone, only when it is an Australian mobile (04… or +614…). A landline is shown in the card but not put in the Mobile field, because myEST8 texts that number.
   - Trades: Jev's suggestions ticked. The Property Manager can change them.
   - The Google listing: a hidden `placeId`, no radio group.
   - Still needed from the Property Manager: contact name, an email if there's no mobile, the starting rating, and a check of the Trades.
4. **Add.** Submitting adds the Tradie exactly as now (`addTradieFrom` → `actions.addTradie`). Nothing is stored until then.

## Where

The same component on all three places that add a Tradie: the welcome wizard (`/welcome/tradies`), Setup (`/setup#tradies`) and the Tradies page (`/tradies#add-tradie`).

## Jev suggests Trades

- One **Noul** question per Trade in `TRADES` (`src/shared.ts`), asked together in one request, because a business can do several. Tick a Trade when its probability is at least 0.5.
- State: the listing's name, Google `types` and `primaryTypeDisplayName`, `editorialSummary` and website, as named JSON fields.
- Real contract (checked 2026-10-21, https://docs.typesafe.ai/api.md): `POST {JEV_API_URL}/v1/systemone`, `authorization: Bearer <JEV_API_KEY>`, body `{ "model": "jev-latest", "state": {...}, "questions": { "<name>": { "type": "noul", "instructions": "...", "criteria": { "true": "...", "false": "..." } } } }`, answer `{ "answers": { "<name>": { "type": "noul", "noul": 0.0–1.0 } } }`. 422 on validation errors.
- If Jev fails or isn't configured, the form still fills in, with no Trades ticked and a note saying to choose them. Suggesting Trades never blocks adding a Tradie.

## Non-goals

- No change to `addTradie`, `TradieInput` or the database.
- No change to the inbound-message classifier or `src/adapters/jev.ts` (the `jev-classifier` branch is rewriting it).
- No client-side JavaScript search-as-you-type.
