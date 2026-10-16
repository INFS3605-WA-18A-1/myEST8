# Restore the dispatch-desk design, then make it fast

Status: needs-triage

## Why

The home server runs `ac2f5ea`, the "dispatch-desk" redesign (commits `27afd2d`..`ac2f5ea`). Merge `ca3f079`
("Merge master into remote-rework-backup, keeping the host-server rework's code") resolved every conflict
toward the rework branch, so `master` lost the redesign while keeping the rework's real behaviour (hosted
mode on Vercel, Supabase Storage uploads, Resend email, Meta WhatsApp, channel verification codes,
`oauth-google.ts`, rate limits). Nothing is lost: the design is in history at `ac2f5ea`.

Separately, the Vercel app takes seconds per page (`research/perf-plan.md`).

Research (read these before working; all line refs are at `ac2f5ea` unless marked HEAD):
- `research/foundation.md`: tokens, shell, every `ui.ts` component, 17 visual differences (section 6).
- `research/public-pages.md`: landing, auth card, sign-up, welcome wizard, setup, tenant pages (table in section 12).
- `research/pm-pages.md`: property-manager pages, backend gaps and a per-page table (end of file).
- `research/perf-plan.md`: ranked speed fixes with evidence.

## Rule for every task: design from `ac2f5ea`, behaviour from `master`

- Take markup, CSS, component structure and copy from `ac2f5ea` (`git show ac2f5ea:<path>`).
- Keep `master`'s routes, data flow and channel code. Never bring back Gmail/Twilio-number/WhatsApp-sandbox/SendGrid
  code or its migrations; restyle `master`'s Resend, Meta WhatsApp and verification-code flows in the design instead.
- Tokens and fonts already match (foundation.md §6.1): the work is structure and components, not colours.
- Tests in `test/web/**` at `ac2f5ea` describe the designed markup; port the assertions that still apply.

## Phases

### 0. Speed: region (merged 2026-10-16, PR #14)
The function runs in `icn1` beside the Seoul database. Expected: server time per page 5-10 s → 0.1-0.2 s.

Phase 1 is two agents in parallel (1a web, 1b data); phase 2 starts when both are merged.

### 1b. Data and backend (one agent, parallel with 1a)
Files: `src/tickets.ts`, `src/quotes.ts`, `src/scheduling.ts`, `src/profiles.ts`, `src/views.ts`, `src/zoned-time.ts`,
`src/geo.ts` (restore), a NEW migration `supabase/migrations/2026101606xxxx_tradie_locations.sql` (same SQL as
`ac2f5ea`'s `20261013000100_tradie_locations.sql`, which production never ran), tests under `test/` for each.
Everything in pm-pages.md "Data and backend gaps": `tickets.list`, board facts (`quotingOf`, `visitsOfTickets`,
`jobsOfTickets`, `issuesWithUnread`) as set-based queries (no N+1), `quotes.waitingOnOwner`, `quotes.quoteCount`,
richer `previousQuotes` and `scheduling.bookings`, Booking fields, `views.ticket.propertyId`, Tradie business address
and lat/lng, `profiles.geocodeMissing` / `setTradieAddress` (use the existing `ports.places.geocode`), and the views
`dispatch`, `property`, `propertyOverviews`, `tradies`, `approvals`, `requests`.

### 1a. Foundation (one agent, parallel with 1b)
Files: `src/web/ui.ts`, `src/web/shell.ts`, `src/web/pm-pages.ts`, `src/web/assets.ts`, `src/web/icons.ts`,
`src/web/static/app.css`, `src/web/static/app.js`, `docs/design-system.md`.
- Rail: three groups with 12 px gaps, collapse to a 64 px icon strip from 1024 px with tooltips and waiting dot,
  `localStorage` memory in app.js; drawer under 1024 px (foundation.md §3).
- `page({ fullPage })` so onboarding has no rail; `publicPage({ brand, css })` so a Tenant's Agency name leads the bar.
- Dockets read issue → address → perforation → status → foot, with `decision` (Wattle stripe) and `age`.
- Count strip: only decision counts are Wattle; others Paper.
- `table({ stack })` + `.is-stacked` + `ticketCell()`: phones never scroll sideways.
- `.facts` container-query label/value lists.
- `NavCounts` loaded once per request by middleware (also speed fix 4: the shell currently re-queries per render).
- `data-autosubmit` in app.js; keep `master`'s copy and direct-upload handlers.
- Bring `docs/design-system.md` back in step with the code.
- Pure web modules restored here so pages can use them: `src/web/bookings.ts`, `src/web/request-checks.ts`,
  `src/web/map-config.ts`, `src/web/static/dispatch-map.js`, Leaflet served from `/assets` (allowlist + `vercel.json`
  `includeFiles`). Rail: Dashboard, Dispatch (`/dispatch`, the map), Requests, Tickets, Approvals, Schedule (`/calendar`).

### 2. Pages (parallel agents, disjoint files, after phase 1)
- **2a Public and auth**: `pages/landing.ts`, `auth.ts`, `auth-card.ts` (restore), `pages/signup.ts`, `tenant-pages.ts`;
  stylesheets `landing.css`/`auth.css` or the matching `app.css` sections. Tenant pages must work without the
  Tailwind runtime (scratch issue 24): move the tracker and drop-zone utilities into CSS, stop loading `tailwind.js` there.
- **2b Onboarding**: `pages/welcome.ts`, `pages/setup.ts`, `pages/onboarding-forms.ts`: the full-page wizard frame,
  cards, checklist and channel row, wrapped around `master`'s channel steps. No Email-first gate. `/setup` gets its
  Tradies and Properties sections back.
- **2c PM desk**: `pages/dashboard.ts` (board), `pages/ticket-list.ts`, `pages/ticket.ts`, `pages/requests.ts`, `pages/approvals.ts`.
- **2d PM places and people**: `pages/dispatch.ts` (restore: the map), `pages/calendar.ts` (Schedule at `/calendar`),
  `pages/properties.ts` (+ profile), `pages/tradie.ts` (+ trade filter, Previous Quotes, address form), `pages/settings.ts`
  (four tabs), `pages/import.ts`.

### 3. Integrate and check
- Full `npm run typecheck`, `npm run test:unit`, `npm run test:e2e` (Postgres: `TEST_DATABASE_URL`).
- Screenshots of each page at 1280 and 390 px against the home server's same page.
- One PR to `master`; CI must pass. Merge deploys.

### 4. Speed: the rest (after phase 3 merges, since it touches `ui.ts`)
From `research/perf-plan.md`, in order:
1. Static assets out of the function: content-hashed URLs, `immutable` cache, served from `public/`.
2. Build CSS at deploy time (`@tailwindcss/cli` + daisyUI plugin); drop the 276 KB in-browser Tailwind compiler and
   the 1.1 MB full daisyUI CSS from every page.
3. Fewer sequential queries: one PM/agency lookup per request in auth, `sessions.find` as one `UPDATE ... RETURNING`,
   narrow query for `/tickets`, `Promise.all` in `dashboard()`, fix awaits-in-loops in `quotes.alerts`,
   `scheduling.alerts`, `inbox`, `unreadCount`.
4. Warm `hosted()` at module scope; raise `DB_POOL_MAX` to about 5 (Vercel env change).
5. Perceived speed: `@view-transition`, speculation-rules prefetch.

## Decisions (owner, 2026-10-16)

1. **Dispatch map: restore it**, with its backend (geo, tradie locations migration, Leaflet).
2. **Email-first gate: drop it.** Keep `master`'s wizard order, restyled.
3. **Tradies and Properties sections on `/setup`: bring them back.**
