# Fixes from reviewing #37, #38 and #39

Status: resolved
Branch: october-refresh-fixes
Spec: ../spec.md (the same ground rules: test-first in vertical slices, the agreed seams, the design system, no JavaScript required)

Three Claude Sonnet reviewers read the merged changes. These are the findings that hold up, checked against the code. Each part is for one agent and touches only its own area.

## A. Dashboard (#37: issues 01 and 02)

1. **A visit that finished today disappears.** `src/views.ts` fetches the calendar `from: now`, and `scheduling.calendar` keeps only visits ending after `from`. At 4 pm, a 9–11 am visit is missing from today's list and its dot, and an otherwise empty day says "Nothing booked on Thursday." Fetch from the start of today in the Agency's time zone (`startOfDay` in `src/zoned-time.ts`). Test: a visit earlier today that has ended is listed under today.
2. **The chosen day is lost.** The Mine and All links on the dashboard drop `day`. Open calendar drops `filter=all`. Keep both: the Mine and All links keep `day` and the fragment, and Open calendar keeps `filter=all`.
3. **Today has no cue but colour** when another day is chosen. Add visually hidden text ("today") inside today's chip, so a screen reader says which chip is today.
4. **A browser test that can't fail.** The "pressing a later day" e2e test checks only that the text differs from today's. Assert that the chosen day's own visit (by its issue text) is listed and today's visit is not.
5. **Page tests depend on attribute order** (`href="…" aria-current="date"`, `class="day-chip is-today" href=`). Check each attribute on its own: find the chip's link by its `href`, then check `aria-current` and the class separately.
6. **Times don't line up.** `.visit-row`'s first column is `auto`, so "9:00 am" and "12:30 pm" push the text to different edges. Give the time column a fixed minimum width that fits "12:30 pm".

## B. Addresses (#38: issue 05 and Nominatim)

1. **Importing Properties can time out.** `src/imports.ts` adds each Property with `onboarding.addProperty`, which geocodes each one in turn at Nominatim's one request a second. A 70-row sheet takes about 70 s, over Vercel's 60 s limit, so the import is cut off part-way. Imported Properties are added with `location: null` (no lookup). **Look up missing addresses** on Dispatch places them, at most 10 a press. The import's success message says so. Test: importing Properties makes no geocoder call.
2. **The suggestion list comes back after you've moved on.** In `app.js`, a response is dropped only if a newer request has started. Shortening the query below 3 characters, choosing a suggestion, Escape and blur must all make any in-flight response stale, and `render` must do nothing while the input isn't focused.
3. **No selected state for screen readers.** `setActive` toggles a class only. Set `aria-selected="true"` on the active option and `"false"` on the rest, as the searchable select does.
4. **The welcome wizard's posted pin is untested.** Add a page test posting a Property with `lat` and `lng` to the welcome step, and check the pin is stored without a geocoder call.
5. **Docs.** ADR 0012, `docs/demo.md` and `.env.example` say "hosted mode" uses the public servers. `npm start` (`src/main.ts`) does too, so say "hosted mode and `npm start`". ADR 0012 also gets two sentences:
   - the one-request-a-second queue holds per server instance, and Vercel can run several, which is accepted at this app's traffic
   - a posted pin inside the box is trusted as the Property Manager's choice, and isn't checked against the address

## C. Schedule (#39: issues 03 and 04)

1. **Day view lost information.** It now renders `visitBlock`, so the Property address, the Property Manager under All, the Tradie's profile link and the "Reschedule requested" link to the Ticket are gone. The Day test was weakened to hide it.
   - Restore that content in the Teams-style Day blocks: the lanes are wide enough. Restore the deleted assertion (`"The kitchen tap is dripping Pete's Plumbing 12 King St, Newtown"`, or its exact equivalent in the new markup).
   - Include the address in each Day block's accessible name.
   - Week blocks may stay compact.
2. **The current-time line in the browser can disagree with the server.**
   - The server writes the time it used (`data-now`, epoch ms from `actions.now()`) and today's date (`data-today`) on the line.
   - `app.js` works out the offset from `Date.now()` once, moves the line every minute by server time plus elapsed time, and doesn't move it on load.
   - It hides the line when the Agency's date is no longer `data-today`.
   - The server always renders the line on today's column, hidden when outside the grid's hours, so it can appear when the hours begin without a reload.
3. **Tab order runs through every free Tradie before the schedule** at 1024 px and up, because the panel comes first in the page and CSS moves it right. Add a "Skip to the schedule" link as the panel's first item, visible on focus, pointing at the grid.
4. **Titles without a year.** A week spanning two years reads "28 December – 3 January 2027". Give both dates their year when the years differ. The Day title and its share text include the year ("Tuesday 13 October 2026").
5. **Toolbar accessibility.**
   - The Mine/All `nav` is labelled "Whose visits", not "Views".
   - The period title is a heading (`h2`).
   - `aria-current="date"` goes on one element per day: the link when there is one, otherwise the cell, never both.
6. **Current-time tests restate the formula.** Add page tests with expected values worked out by hand:
   - a non-:00 minute (9:40 am → row and fraction)
   - a time before the grid's first hour (no visible line)
   - an Agency outside Sydney's time zone (Perth)

   Add one browser test using Playwright's `page.clock`: the line moves after a minute, and is hidden after midnight.

## Acceptance criteria

- [x] A, B and C each done test-first, every new test failing before its fix.
- [x] `npm run check` passes on the branch with all three parts merged.
