# myEST8 slow page loads: investigation and fix plan

Scope: read-only. No config, env, push, merge or deploy was touched. Working tree is on
`restore-dispatch-desk-design`; I read the code at that HEAD (src/web/ui.ts identical on the branch).
Note: local `master` is stale (merge-base 2267eef); use `origin/master` (8e9e849) for diffs.

## 1. Root cause summary

Two independent problems multiply:

A. Function in iad1, DB in Seoul. Each sequential query = one trans-Pacific RTT (~190 ms).
   An authenticated page issues roughly 25-60 SEQUENTIAL queries, so 5-10 s. (PR #14 fixes the RTT.)
B. The browser re-does heavy work on every full-page navigation: a 1.1 MB (raw) daisyUI stylesheet,
   a 276 KB synchronous Tailwind *browser compiler* in `<head>`, and a 58 KB app.css, all of it served
   through the function with only `max-age=3600`.

Even with zero DB work the function path has a floor of ~0.4-0.9 s from Sydney.

## 2. Evidence (measured 2026-10-16 from Sydney)

Warm, no DB (`/assets/nope`, 404 from Hono, x-vercel-id `syd1::iad1`):
  ttfb 0.40 / 0.71 / 1.42 s   (noisy network; connect 0.05-0.45 s)
Static CDN hit (`/assets/favicon.svg` HIT): ttfb 0.17-0.24 s. vercel.com/robots.txt baseline: 0.17-0.21 s.
`/login` (no cookie, so NO DB query): ttfb 0.69-1.06 s, and 2.0-2.3 s (up to 5.2 s) in a burst of 4 sequential
curls: all `x-vercel-cache: MISS`, `syd1::iad1`. So the function hop alone is 0.5-2 s and variable;
a single warm instance seems to be under-provisioned or a fresh instance gets spun up for bursts.
Assets (br): daisyui.css 98 KB br / 1.14 MB raw, tailwind.js 74 KB br / 276 KB raw, app.css 13 KB br / 58 KB raw,
app.js 4 KB br. Cache-Control `public, max-age=3600`; x-vercel-cache MISS ttfb 0.9-3.8 s (!), HIT 0.15 s
(tailwind.js showed `age: 1391 HIT`; the others MISS in the same minute: the cache is per edge region and expires hourly).

Cold starts: `vercel logs --since 30m` shows `[hosted] Real: ...` (src/demo/runtime.ts:93, via checkHosted at :209)
on 4 requests in 15 min, from different edge regions (iad1 /assets/fonts, bom1 /assets/app.css, pdx1 fonts, syd1 /approvals).
That line is logged once per function INSTANCE, not per request (warm curls of mine produced no log line). Conclusion:
bootstrap is per cold start, not per request, BUT static asset bursts (browser fetches css+js+3 fonts in parallel)
fan out to extra instances, each paying a cold start with a fresh TLS+auth connect to Seoul. Every request's first
page load therefore risks 1-3 cold starts.

## 3. Per-request cost: bootstrap vs request

Bootstrap, per instance (api/index.ts:16-21 `hosted()` memoised; src/hosted.ts:27 -> createDemo, src/demo/runtime.ts:205+):
- hosted mode skips migrate (runtime.ts:138 comment) and seeding (`!hosted`). It opens the pool lazily (postgres.js connects on first query),
  builds mock APIs, providers, worker. No query at startup. Cost = module load (hono, postgres, ~all of src) + first connect.
- First connect from iad1 to Seoul pooler: TCP + TLS + SCRAM ~ 5 RTT ~ 1 s per connection, x2 (DB_POOL_MAX default 2, runtime.ts:143).
  From icn1 this is ~50 ms. `fetch_types:false` already set (src/db.ts:~100), good.

Per request (authenticated GET), sequential round trips, counted from code:

Middleware `requirePropertyManager` (src/web/auth.ts:112-126) = 6 queries before the handler:
- `sessions.find` (auth.ts:46-57): SELECT + UPDATE (2) (a write on every GET, extends the session)
- `signedInId` (auth.ts:140-150): `app.asPropertyManager(id)` -> propertyManager + agency (2), discarded
- then `app.asPropertyManager(id)` AGAIN at auth.ts:122 (2 more, src/app.ts:120-123)
Fix: cache `me` from signedInId or collapse into one query/join (saves 2-4 trips).

Dashboard `/` (src/web/pages/dashboard.ts:30-50), empty-agency lower bound:
- `actions.dashboard` (src/views.ts:44-90): object-literal fields are `await`ed one after another:
  propertyIdsOf, maintenanceRequests, openTickets, urgentRepairs, inbox, quotes.alerts (>=2: quote_requests, approvals),
  scheduling.alerts, scheduling.calendar = ~9 sequential
- `finishSetupBanner` (welcome.ts:102-110): channels, propertyManagers, properties, people = 4 sequential
- `shellInfo` -> `navCounts` (shell.ts:19, views.ts:79-88): propertyIdsOf AGAIN, openTickets AGAIN, quotes.alerts AGAIN,
  scheduling.alerts AGAIN, maintenanceRequests AGAIN, inbox AGAIN = ~8 sequential. Everything navCounts needs was already
  computed by `dashboard()` in the same request.
Total about 6 + 9 + 4 + 8 = 27 sequential trips with NO data; with data each item adds depth (N+1, below).
At 190 ms that is ~5 s. At icn1 (~1-3 ms) ~50-100 ms.

Ticket list `/tickets` (ticket-list.ts:33): calls `actions.dashboard()` (the full dashboard incl. calendar, alerts, inbox, urgent repairs) just to list
tickets, plus shellInfo (another ~8). Roughly 6 + 9 + 8 = 23+ and a heavy payload.

Ticket `/tickets/:id` (ticket.ts:93-118, views.ts:112-140): ticketInAgency, issue, property, ticketSummary (propertyLabel 2, person, issue, jobs, unread = ~6 sequential),
issueDetails (photos, person), frequentIssues, repairCost, per-job jobView (job, approval, recommend, quoteRequests, quotes, workOrderForJob),
timeline, messages (~25) + suggestionsFor + freeSlotsFor (extra recommend/availability queries) + shellInfo (~8) + 6 middleware = est. 40-60 trips.

`/login` no cookie: 0 queries. With a cookie: `signedInId` = 4. (Login page at least should be pure CPU.)

N+1 / sequential patterns (all hit the pool of 2 connections, so even `Promise.all` fan-outs are throttled to 2 concurrent):
- views.ts:7-10 `propertyLabel` = property then propertyManager (2 sequential per issue/ticket/urgent repair).
- views.ts:55-65, 18-21: per-item `ticketSummary` / maintenance request = 5-6 queries each, items parallel but pool-limited.
- views.ts:80-84 navCounts: `jobsOf` per open ticket.
- quotes.ts:433-445 `alerts`: `for` loop with `await mine()` (tickets.ticket), `tickets.job`, `confirmedCount`, `jobPlace` per quote request; second loop per approval (`profiles.person`). Awaits in loops.
- scheduling.ts:367-379 `alerts`: for loop, `hasRating` + `tickets.ticket` + `toView` per done work order.
- intake.ts:604-617 `inbox`: per item `received` + `person`.
- tickets.ts:603 `unreadCount`: one count query per issue (could be one GROUP BY).

## 4. Static assets and Tailwind

- Every path including `/assets/*` is rewritten to the function (vercel.json:4). Assets are read with readFileSync on first hit per instance
  (src/web/assets.ts:35-43) and served `public, max-age=3600` (assets.ts:68), fonts immutable 1 y (assets.ts:57). Vercel's edge does cache them (HIT seen) but per region,
  hourly, and every MISS invokes the function (possibly cold) - measured 0.9-3.8 s per asset MISS.
- The page loads `tailwind.js` (@tailwindcss/browser, 276 KB) synchronously in `<head>` (src/web/ui.ts:98) together with an inline `<style type="text/tailwindcss">` theme
  (ui.ts:41-81). On EVERY navigation it parses 276 KB, scans the DOM, and generates CSS at runtime (typically 100-500 ms main-thread, FOUC risk), BLOCKING rendering.
- `daisyui.css` is the full 1.14 MB library (all components, all themes) loaded render-blocking (ui.ts:96); 98 KB over the wire, ~1.1 MB to parse per page.
- `app.css` 58 KB (ui.ts:97), fonts preloaded (good: ui.ts:94-95). Nothing is hashed, so nothing can be cached for long.
- Existing issue `.scratch/dispatch-desk-redesign/issues/24-tenant-pages-without-tailwind-runtime.md` shows the team already wants to drop the runtime.
- Navigation is full page reload (no client router; app.js only enhances forms/uploads). So the costs above are paid on every click.

## 5. Pool and connection settings

- `DB_POOL_MAX` default 2 (runtime.ts:143); `max` default 10 elsewhere (db.ts openDb). With the page-level `Promise.all`s the pool of 2 serialises most parallelism.
  Supabase transaction pooler tolerates many clients; raise to 5-8 once queries are parallelised (watch Supabase pooler client limit on the free tier: 200).
- `prepare:false` is correctly derived for :6543 (db.ts `prepare: !pooled`). `idle_timeout:30` means connections are dropped after 30 s idle; the next request after a lull pays reconnect
  (5 RTT) - cheap in icn1, ~1 s in iad1. `connect_timeout:10`.
- `transaction()` takes an advisory lock (db.ts) only on writes; reads are unaffected.
- A write (UPDATE sessions) on every authenticated GET holds a pooler transaction slot and a row lock; throttle (see fix 5).

## 6. Ranked fixes (impact x effort)

### 1. Merge PR #14 (pin function to icn1). Impact: very high. Effort: trivial (already written)
- Files: vercel.json (`"regions": ["icn1"]`), docs/vercel.md. Deploy path: .github/workflows/ci.yml:135-137 (`vercel build/deploy --prebuilt`) honours vercel.json regions.
- Expected: each DB trip ~190 ms -> ~2-5 ms. Dashboard 27 trips: ~5 s -> ~0.1-0.2 s server time. Connect on cold start ~1 s -> ~0.05 s.
  Page TTFB from Sydney becomes (Sydney<->Seoul ~130 ms RTT x ~2 + render) ~0.3-0.5 s instead of 5+ s. It does NOT fix the client-side cost (fix 3) or the asset MISS latency (fix 2) (they just get faster by the same Seoul factor).
- Risks: Hobby allows one region (OK). Outbound calls to Resend/Anthropic/Meta/Supabase Storage now originate in Seoul (fine). Users far from Seoul pay a longer edge->function hop (AU users: 130 ms vs 200 ms now, so still an improvement).
- Verify after deploy: `curl -sI https://myest8.vercel.app/login | grep -i x-vercel-id` -> `...::icn1::...`;
  `for i in 1 2 3; do curl -s -o /dev/null -w '%{time_starttransfer}\n' https://myest8.vercel.app/login; done`; with a session cookie (copy from browser):
  `curl -s -o /dev/null -w '%{time_starttransfer}\n' -H 'cookie: myest8_session=...' https://myest8.vercel.app/` expect < 0.6 s.

### 2. Serve CSS/JS/fonts as real static files with long cache. Impact: high. Effort: small (cache headers) to medium (static output)
Quick win (no build): in src/web/assets.ts append a content hash to the URL and make responses immutable.
- Files: src/web/assets.ts (compute `sha256(file).slice(0,8)` per asset, export `assetUrl(name)`), src/web/ui.ts head() (use `assetUrl` for lines 96-99 and the favicon),
  and the other places that reference `/assets/` (grep `"/assets/` in src/web/pages/*.ts, src/demo/*.ts, tenant-pages.ts).
  Headers: `cache-control: public, max-age=31536000, immutable` + `s-maxage` (and `Vercel-CDN-Cache-Control` if desired). Keep un-hashed URLs working with the current 1 h header.
- Better: output to a static dir so the function is never invoked: add `public/assets/` populated by a build step (copy fonts + hashed css/js; `vercel build` in ci.yml:136 would run `buildCommand`),
  Vercel serves filesystem matches before the `/(.*)` rewrite (vercel.json:4). Then drop the asset `includeFiles` entries from vercel.json (smaller function, faster cold start).
- Expected: removes 5-8 function invocations (and the cold starts they trigger) per first load; repeat visits make zero asset requests. Asset MISS 0.9-3.8 s -> ~0.15 s.
- Risks: stale asset if hash not tied to content (use content hash); public/ vs rewrites ordering (verify on a preview-less deploy: curl the asset and check no `x-vercel-id ...::iad1/icn1` function id and `x-vercel-cache: HIT/PRERENDER`).
- Verify: `curl -sI https://myest8.vercel.app/assets/app.css?v=<hash> | grep -i 'cache-control\|x-vercel-cache'` twice: second must be HIT; DevTools Network disk-cache on reload.

### 3. Replace the Tailwind browser runtime and full daisyUI with prebuilt CSS. Impact: high (client). Effort: medium
- Files: package.json (add `@tailwindcss/cli`, a `build:css` script; keep `tailwindcss` in devDependencies), new `src/web/static/tailwind.input.css` (`@import "tailwindcss"; @plugin "daisyui" {themes: ...}`; move the `@theme inline reference` block from ui.ts:41-81 here; `@source "../**/*.ts"`),
  src/web/ui.ts head() (delete `<script src="/assets/tailwind.js">` line 98 and `${TAILWIND_THEME}`; link the built, minified css), src/web/assets.ts (drop `tailwind.js`, `daisyui.css`), vercel.json (drop `@tailwindcss/browser` and `daisyui` from `includeFiles`), .github/workflows/ci.yml (run build before deploy).
- Expected: ~1.1 MB + 276 KB of parse/execute -> one ~40-80 KB (10-15 KB br) stylesheet; no runtime class scanning; no FOUC; removes render-blocking script. Typically 200-600 ms saved per navigation on mid-range hardware, more on phones.
- Risks: Tailwind JIT must see every class string, including ones built dynamically in TS (`@source` + safelist); verify visually on every page (e2e screenshots in test/e2e). CONFLICT: another engineer is editing src/web/** (restore-dispatch-desk-design); land AFTER that branch merges, coordinate on ui.ts (head()) and .scratch issue 24.
- Verify: Lighthouse / `curl -s https://myest8.vercel.app/login | grep -c tailwind.js` -> 0; `curl -s -o /dev/null -w '%{size_download}\n' -H 'accept-encoding: br' <css url>` < 20 KB; Chrome performance trace shows no "Compile CSS" long task.

### 4. Cut the repeated per-request queries (sequential round trips). Impact: high even after #1; Effort: medium
Benefits grow with data volume and DB distance; after PR #14 it moves a page from ~100-200 ms toward ~50 ms and protects against load.
- a) Auth middleware (src/web/auth.ts:112-126, 140-150): reuse the `asPropertyManager` result from `signedInId` instead of calling it twice (-2 queries); fold agency+PM into one JOIN in `profiles.propertyManager`/`agency` (src/profiles.ts:268,344) (-1); `sessions.find` do SELECT and UPDATE in one `UPDATE ... RETURNING` (-1), and only extend when `expires_at` is >5 min stale (removes a write from most GETs). Net 6 -> 1-2 trips.
- b) Compute nav counts once per request: make `dashboard()` return the pieces and derive `navCounts` from them, or memoise `navCounts`/`alerts`/`openTickets` on the `actions` object per request (src/app.ts:120+, src/views.ts:79). Removes ~8 duplicate trips on `/`.
- c) `/tickets` (src/web/pages/ticket-list.ts:33): use a narrow `actions.ticketList()` (openTickets + summaries) instead of the whole `dashboard()`.
- d) Parallelise independent awaits: in `dashboard()` (views.ts:44-90) use `Promise.all([...])` for the top-level fields; same in `finishSetupBanner`/`setupProgress` (welcome.ts:102-110) and ticket view fields (views.ts:112-140). Raise `DB_POOL_MAX` to ~5 so they really run concurrently (Fix 6).
- e) Kill N+1: batch `unreadCount` (tickets.ts:603) as one `GROUP BY issue_id`; join property+property manager in `propertyLabel` (views.ts:7-10); in quotes.alerts / scheduling.alerts replace per-row `tickets.ticket/job/jobPlace` awaits (quotes.ts:433-445, scheduling.ts:367-379) with one JOINed query; `inbox` (intake.ts:604) batch people. See .scratch/dispatch-desk-redesign/issues/26-dashboard-board-query.md which already targets the dashboard board query.
- Risks: behaviour/regression in dashboard numbers; cover with the existing test/web and test/http tests plus a query-count test (wrap `openDb` and assert the number of `.unsafe` calls for GET `/` with seeded data).
- Verify: a vitest asserting `<= 12` queries for `/`; in prod: `curl -w '%{time_starttransfer}'` with cookie before/after; Supabase `query_logs` (pg_stat) call counts per page.

### 5. Warm instance and cold-start trimming. Impact: medium. Effort: small
- The 5-minute `.github/workflows/worker-ping.yml` already keeps one instance warm; ensure it hits the icn1 function (it will after #1). Static assets off the function (fix 2) removes the burst that forces extra instances.
- In `api/index.ts` kick off `hosted()` at module scope (`void hosted()`) so bootstrap + pool connect overlaps with the first request path; optionally `db.sql.unsafe('select 1')` warm-up to open one connection eagerly.
- Trim `includeFiles` once assets are static (vercel.json:8) - the 1.1 MB daisyui and fonts bloat the function bundle.
- Verify: `vercel logs ... --since 1h | grep -c 'Real:'` falls (fewer cold starts).

### 6. Pool tuning. Impact: low-medium. Effort: trivial but needs an env change (do not do from here)
- `DB_POOL_MAX` 2 -> 5 (Vercel env; runtime.ts:143) once fix 4d parallelises; consider `idle_timeout` 60+ (src/db.ts openDb) to survive short lulls.
- Keep `prepare:false` and `fetch_types:false` as is.

### 7. Perceived navigation speed. Impact: low-medium. Effort: small
- Document-level cross-fade and instant-feeling clicks: add `@view-transition { navigation: auto; }` to src/web/static/app.css and a `<script type="speculationrules">{"prefetch":[{"where":{"href_matches":"/*"},"eagerness":"moderate"}]}</script>` in ui.ts head() for signed-in pages.
- Risk: prefetch fires GETs; ensure no GET has side effects (note sessions.find UPDATE is benign) and that `/logout` is POST (it is). Cut the 5-minute session UPDATE first.
- `defer` app.js is already done (ui.ts:100); add `<link rel="preconnect">` not needed (same origin).
- Add `cache-control: private, no-cache` on HTML so back/forward uses bfcache properly; currently none set on pages.

## 7. Expected impact of PR #14 alone
- Server time per authenticated page: ~25-60 sequential trips x ~190 ms (iad1<->Seoul) = 5-11 s today -> x ~3 ms = 75-180 ms. This is the entire "seconds per page change" for logged-in pages, so PR #14 alone should bring TTFB from several seconds to roughly 0.4-0.8 s from Sydney (edge->Seoul ~130 ms RTT each way + render + 0.1 s DB).
- NOT changed: `/login` and static assets (no DB); they only gain the shorter Sydney-Seoul vs Sydney-iad hop (~70 ms). The 0.4-0.9 s function floor and the client-side CSS/JS cost (fix 2/3) remain, so navigation will still feel like ~0.8-1.5 s until fixes 2-3 land.
- Cold start: connect from 5 RTT x 190 ms ~ 1 s per connection (x2) -> ~0.05 s.
- I could not measure authenticated pages (no credentials); numbers are computed from the query counts above and the measured RTT. Re-measure after merge.

## 8. Code review of PR #14 (skill mattpocock-skills:code-review, `vercel-region-icn1` since `origin/master`)
Local `master` is behind origin; reviewed against `origin/master` (8e9e849): 1 commit 0e74cd5, 2 files, +2 lines.
Spec source: PR #14 body (pin function to icn1; document it; verify via x-vercel-id). No issue file; no spec doc.

### Standards
- No documented coding standards apply to JSON/Markdown config changes (AGENTS.md only covers the issue tracker, triage labels and domain docs). No smell baseline hits (no code).
- Docs style: the new bullet in docs/vercel.md:11 follows the existing bold-lead bullet format and says "Move both together", good. One judgement call: it narrates the incident ("made every page take seconds") rather than only the rule; fine but may rot. Not blocking.
- Commit trailer says "Co-Authored-By: Claude Opus 5.5"; the session's attribution rule says Sonnet 5.5. Cosmetic.
- Findings: 0 hard violations, 2 nits.

### Spec
- Requirement "pin to icn1": `"regions": ["icn1"]` present (vercel.json:4). Valid Vercel region id, allowed on Hobby (single region). Functions block untouched, so `maxDuration`/`includeFiles` still apply. CI deploy path (`vercel build --prod` + `deploy --prebuilt`, ci.yml:135-137) reads vercel.json so the setting is honoured. A dashboard "Function Region" setting is overridden by vercel.json.
- Requirement "document it": done, and it states the DB region (`ap-northeast-2`) and the DB pooler coupling.
- Gaps (non-blocking):
  1. No automated check: the PR's own verify step is manual (`x-vercel-id ::icn1`). Suggest adding it to the `smoke` job (ci.yml:150): `curl -sI "$APP_URL/login" | grep -i 'x-vercel-id' | grep -q icn1`.
  2. Docs should say the DB and function regions must be changed together and name the Supabase region setting where it can be checked; also mention that `vercel.json` overrides the dashboard setting.
  3. Not addressed by the PR (by design): static assets still go through the function, client CSS/JS cost, sequential queries. Say so in the description so reviewers expect ~0.4-0.8 s, not 100 ms.
- Findings: 0 blockers, 3 suggestions.

Verdict: APPROVE / safe to merge. Smallest possible change, correct mechanism, CI is green (test passed; deploy jobs correctly skipped on the PR).
Merge note: merging to master triggers `migrate-prod` + `deploy-prod` automatically (ci.yml) - that is the deploy, so it needs the owner's go-ahead.

## 9. Suggested order
1. Merge PR #14 (hours; expected: seconds -> ~0.5 s).
2. Fix 2 hashed immutable assets (+ public/ static output later). Quick, no UX change.
3. Fix 4a/4b/4c (auth double lookup, duplicate navCounts, tickets list) - small, big win left on server.
4. Fix 3 prebuilt CSS after the `restore-dispatch-desk-design` branch merges (conflicts in ui.ts).
5. Fix 4d/4e, pool bump, warm-up, prefetch.
