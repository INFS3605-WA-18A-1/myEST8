# Pick a Google listing to fill in the Tradie form

Status: resolved
Blocked by: 01
Spec: ../spec.md

## What to build

The flow in the spec, steps 1–4, using `actions.googleListing` from issue 01. It's one component shared by `/welcome/tradies`, `/setup#tradies` and `/tradies#add-tradie`, so replace `googleSearchForm`/`tradieFields`'s listing radio group in `src/web/pages/onboarding-forms.ts` rather than copying markup into each page.

- Results under the search bar as a list of links carrying `google` and `place`. The chosen one is marked `aria-current="true"`.
- With `place` set: the summary card, then the form filled in as the spec says, with a hidden `placeId`. Show Jev's Trades as ticked boxes, with "Suggested from their Google listing. Check them." under the group. When `tradesSuggested` is false, say "Choose their Trades." instead.
- "Not on Google? Enter their details yourself" (`?manual=1`): the empty form with a hidden `placeId` of `NOT_ON_GOOGLE`.
- No listing chosen and not manual: no form, just the search and results.
- A refused submit re-renders with the posted values and errors, keeping the chosen listing. Check how each of the three POST handlers redirects back today: `/setup` and `/tradies` go through `formAction` with a `back` URL, and the welcome step re-renders. Keep `place` in both.
- If Google fails while loading details, show the existing "Google search isn't working right now…" message and offer the manual form.
- Follow `docs/design-system.md` (tokens, the bordered-entry pattern from #21, field components) and update it with the new pattern. Run `npm run css` and commit `src/web/static/tw.css` if Tailwind classes change.

## Acceptance criteria

- [x] Page tests (`test/web/`): results are links under the search bar; choosing one shows the card and prefills the business name, mobile only when it's an AU mobile, ticked Trades and the hidden `placeId`; manual mode posts `NOT_ON_GOOGLE`; a failed submit keeps the listing and values; Jev failure shows "Choose their Trades."
- [x] An e2e test (`test/e2e/`) in the demo: search, pick a listing, fill in the contact name and rating, add, and see the Tradie in the table with its Trades.
- [x] Works at 390 px with no sideways scroll, and by keyboard alone.
- [x] `npm run check` passes.
