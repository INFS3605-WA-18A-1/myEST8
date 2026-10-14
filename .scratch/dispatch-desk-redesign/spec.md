# Dispatch desk redesign, Supabase Postgres, integrations and the Dispatch map

Status: ready-for-agent

The production build of the "myEST8 dispatch desk" canvas from Claude Design
(https://claude.ai/artifact/Khib1SgGaTPzoY59zycvVW), plus the work that makes
myEST8 runnable against real services. The design is a mockup: build it as a
production system and improve it where it falls short (below).

## Source of truth

- The design: `.scratch/dispatch-desk-redesign/design/*.dc.html` (one file per artboard; inline styles carry every value; `canvas.json` names them):
  - `Main.dc.html` landing page
  - `Dashboard.dc.html` dashboard
  - `Dispatch.dc.html` Dispatch: map, Tradies for a Ticket, Tradie schedule (NEW page)
  - `Settings.dc.html` Settings with 8 tabs (NEW page, replaces Setup)
  - `Import.dc.html` reviewing a spreadsheet upload
  - `Tracker.dc.html` Tenant tracker with the Share sheet open
  - `Brand.dc.html` logo, palette, type
- The domain language: `CONTEXT.md`. The current design system: `docs/design-system.md` (update it to the new brand; keep its rules that still hold).
- Existing integration issues: `.scratch/maintenance-workflow-mvp/issues/05, 06, 09, 10, 14`.

## Decisions made with the user (2026-10-10)

1. **Supabase: full port, local only.** The data layer becomes async Postgres (`postgres` = postgres.js 3.4.9, already installed). Schema in `supabase/migrations/` (Supabase CLI `supabase` is a devDependency). Files stay `bytea`. One engine: SQLite is removed; unit tests, `npm run dev` and e2e run on a local Postgres in Docker; CI gets a Postgres service. Nothing is applied to the hosted project (`rbqorfxwromdfjacnpfh`); the user applies migrations there.
2. **Settings: make every setting in the design real**, stored per Agency and read by the workflow: Agency name, time zone, message sign-off; channels (with a "Send a test message" action); Max Repair Cost for new Properties, Quote Requests per Job, Tradie quote reminder delay, "invite more Tradies" delay, Quotes needed before a Work Order, the Tradie search radius (the Dispatch map's ring), starting rating for a new Tradie, "allow a Work Order with fewer Quotes with a reason"; owner-approval reminder and PM alert delays; confidence presets (80/70/60%); photo age and distance; message templates editable; Team (add a Property Manager); import from a spreadsheet. The NSW Urgent Repair cap ($1,000) is fixed by law and shown read-only.
3. **Navigation: Dashboard, Dispatch, Requests, Tickets, Approvals, Schedule, then Properties and Tradies, then Settings** (plus the demo's Phone simulator). Revised 2026-10-13: the user overrode the original three-item rail (Dashboard, Dispatch, Settings) so that each queue the Property Manager works has its own place. Requests and Approvals carry a count badge on every signed-in page. Schedule is the rail's name for the calendar (`/schedule` leads to `/calendar`, which stays), Tickets is a new list at `/tickets`, Approvals lists Quotes waiting on a Property Owner and Urgent Repairs waiting on a receipt, Properties and Tradies are new directories, and Settings opens into the Setup content (Agency, Channels, Team, Import). The Setup pages move into Settings tabs and old URLs redirect to their new home, as before.
4. **Credentials:** `.env` is empty. Build every adapter against stubbed `fetch` and the fakes; the live smoke check runs when keys are added.
5. **Map: Leaflet 1.9.4 (installed) with OpenStreetMap tiles**, served from `/assets` like daisyUI (offline-capable JS/CSS, tiles from the network), no API key. Positions come from geocoding (`PlacesLookup.geocode`), already stored on Properties; Tradies need a stored location too (geocode their business address). The tile URL and attribution are one config value with the OSM default, because OSM's public tiles are not for heavy production use.

## The new brand (from Brand.dc.html)

- Palette "Harbour and Wattle": Night `#13212E` (text, side menu), Harbour `#1F5C8B` (buttons, links, focus; hover `#174A70`), Wattle `#FFC233` (needs your decision, logo on dark), Paper `#F2F4F6` (page), Slate `#55636F` (secondary text), Line `#D8DEE4` (hairlines), control border `#7D8A95`, rail text `#E6EBF0`, rail muted `#9AA8B4`. Status pairs keep Urgent `#B42318`/`#FDECEA`, High `#9A4A0B`/`#FDF1E3`, Done `#2F5A3E`/`#E8F1EA`; info tint `#E8F0F7`.
- Type: Lexend (wordmark, headings, buttons, nav; 400/600/700) and Red Hat Text (body, tables, forms; 400/500/600), self-hosted via `@fontsource/lexend` and `@fontsource/red-hat-text` (installed). Scale 12/13/14/16/20/26, landing 36 to 52; line height 1.45 body, 1.15 headings.
- Logo: the key tag, a house-shaped tag with an 8 cut out (SVG path in the artboards), wordmark "myEST8" with a light "my". Favicon is the tag.

## Improvements over the mockup (the design lead's notes)

- No middle-dot joins ("#11 · 2/31 Australia St", "8:00 am · Proposed"): separate elements with a gap, per the design system.
- The mockup hard-codes colours inline; the build uses tokens and the shared components in `src/web/ui.ts`.
- Every interactive state the mockup fakes (Book, Undo, Save changes, tabs) is a real server action with progressive enhancement: pages work without JavaScript; JS only enhances (map, copy link).
- The map must have a non-map equivalent: the Tradie list and the Ticket list carry the same facts (distance, availability, Quote), so the page works with tiles blocked and for screen-reader users.
- Keyboard focus visible everywhere; 44px touch targets; works at 390px; `prefers-reduced-motion` respected.

## Non-goals

- Applying migrations to the hosted Supabase project; real provider sign-ups.
- Routing/turn-by-turn, live Tradie tracking, clustering beyond what a small Agency needs.
