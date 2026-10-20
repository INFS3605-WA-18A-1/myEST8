# Front-end refinement: the dispatch desk, finished

Status: ready-for-agent

Owner decisions (2026-10-16): refine the dispatch-desk identity (no new direction); the Dispatch map uses
CARTO Positron tiles; tests sit at four seams (below). `docs/design-system.md` is the source of truth for
tokens, type, shape, motion and copy. Read it fully before changing anything; change it when you change a rule.

## The brief

myEST8 is a maintenance dispatch desk for Australian property managers: Tenants report repairs by SMS or
email, the Property Manager confirms, gets Quotes, asks the Owner, books a Tradie and closes the Ticket.
The audience works through a queue all day on a laptop and checks it on a phone between inspections.
The page's job is "what needs me now, and what is moving".

## The plan (tokens are already in `app.css :root`; don't add colours)

- Colour: Night `#13212e` (text, rail), Paper `#f2f4f6` (page), Harbour `#1f5c8b` (action, links, focus),
  Wattle `#ffc233` (needs your decision: only that), urgency red `#b42318` / High `#9a4a0b` / done `#2f5a3e`.
- Type: Lexend for headings, nav, buttons, table heads and numbers people scan; Red Hat Text for reading.
  Scale 12 / 13 / 14 / 16 / 20 / 22 / 26 px (36–52 landing only), body 1.45, headings 1.15, tabular numbers.
- Layout: left rail, top bar with the page title, content in sections on Paper. Left-aligned throughout.
  Desktop is dense but calm; phones stack: one column, nothing scrolls sideways, 44 px targets.
- Principles:
  1. Wattle is the one loud thing. If something isn't waiting on the Property Manager, it isn't yellow.
  2. Every page answers "what needs me now" in its first screen at 1366×768: the decision first, the record second.
  3. Quiet structure: hairlines, 8 px section radius, one shadow (menus/dialogs). No card mosaics,
     no gradients, no eyebrows, no all-caps, no arrows on links, no middle-dot meta, no entrance animations.
  4. One spacing rhythm (4/8/12/16/24/32). Section gap 24 (16 on the dashboard). Align label columns.
  5. Empty and error states say what to do next, in plain words (see the Copy section of the design doc).
  6. Accessibility floor: visible focus on everything, 4.5:1 text contrast, `prefers-reduced-motion`.

## The Dispatch map

- Tiles: CARTO Positron, `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`, subdomains abcd,
  attribution `&copy; OpenStreetMap contributors &copy; CARTO` (both linked). No requests to tile.openstreetmap.org.
- Pins read clearly on the grey base: urgency shapes (Urgent triangle red, High diamond brown, Routine circle
  Harbour/Slate, no open Tickets hollow), Tradies as small Night squares. Overlapping pins are grouped with a
  count until zoomed in; the map fits the Agency's Properties on load, not all of Sydney.
- The selected Property's panel sits beside the map on desktop and below it on phones; the radius ring is quiet.
- Phones: map ~55vh, legend wraps, tables stack.

## Test seams (agreed)

1. Map config (unit): the tile provider and attribution the page uses.
2. HTTP pages (web tests, `test/web/*`): pages render the right regions, labels, links, legend and map data.
3. Browser (Playwright): Dispatch draws pins, never requests tile.openstreetmap.org, groups overlapping pins,
   picking a pin or a table row opens the panel, nothing scrolls sideways at 390 px.
4. Visual: before/after screenshots at 1440 and 390 px of every page an agent touches, reviewed against this plan.

Pure styling is verified by screenshots, not unit tests. Behaviour changes go red → green, one slice at a time.

## Areas (one agent each)

| Area | Owns |
|---|---|
| Dispatch map | `pages/dispatch.ts`, `map-config.ts`, `static/dispatch-map.js`, the Dispatch section of `app.css`, dispatch tests, `test/e2e/dispatch.spec.ts` |
| Foundation | `ui.ts`, `shell.ts`, `forms.ts`, the shared/component sections of `app.css`, `app.js`, `docs/design-system.md` |
| Desk pages | `pages/dashboard.ts`, `ticket-list.ts`, `ticket.ts`, `requests.ts`, `approvals.ts` + their `app.css` sections |
| Places and people | `pages/calendar.ts`, `properties.ts`, `tradie.ts`, `settings.ts`, `import.ts` + their `app.css` sections |
| Public and onboarding | `pages/landing.ts`, `signup.ts`, `auth.ts`, `auth-card.ts`, `welcome.ts`, `setup.ts`, `onboarding-forms.ts`, `tenant-pages.ts`, `landing.css`, `auth.css`, `tenant.css` |

Page agents must not change shared components; if a shared component is wrong, describe it in the report
(file:line, what and why) and work around it locally only if the page is unusable.
