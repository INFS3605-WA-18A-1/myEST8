# Public, auth, onboarding and tenant pages: the `ac2f5ea` dispatch-desk design

Scope: landing `/`, sign-in `/login`, sign-up `/signup`, onboarding wizard `/welcome/*`, setup `/setup`, tenant upload and tracker `/u/:token` and `/t/:token`, Google OAuth connect, and the demo simulator (skim).

Sources: `git show ac2f5ea:<path>` for the design. Current tree is `HEAD` (branch `restore-dispatch-desk-design`). Line numbers below are for `ac2f5ea` unless marked HEAD.

Read-only. Nothing in the repo was edited, committed or checked out.

---

## 0. Shared frame

### 0.1 Tokens and fonts (ac2f5ea `src/web/static/app.css` L64-97)

| Token | Hex | Use |
|---|---|---|
| `--ink` | #13212e | body text, Night (landing close band, auth Night panel, footer) |
| `--page` | #f2f4f6 | Paper, page behind sections, bubbles |
| `--surface` | #ffffff | sections, rows, cards, inputs |
| `--muted` | #55636f | secondary text, hints, timestamps |
| `--line` | #d8dee4 | hairlines, section borders |
| `--control` | #7d8a95 | input and secondary-button borders |
| `--action` | #1f5c8b | Harbour: primary buttons, links, focus, "Filled in" underline |
| `--action-hover` | #174a70 | primary hover |
| `--hivis` | #ffc233 | Wattle: decision stripe, "You" chip, "You decide." stripe |
| `--info-bg` | #e8f0f7 | Harbour tint: avatar bg, `.lp-found`, info badges |
| `--done` / `--done-bg` | #2f5a3e / #e8f1ea | done ticks, tracker "Done" circles |
| `--rail-text` / `--rail-muted` | #e6ebf0 / #9aa8b4 | text on Night |
| `--shadow-lift` | `0 8px 24px rgb(19 33 46 / .18)` | the Maintenance Request card on the hero and auth panel |

Fonts: `--font-head` = Lexend (weights 400, 600, 700 self-hosted), `--font-body` = Red Hat Text (400, 500, 600, italic 400). `head()` preloads Red Hat 400 and Lexend 600 (ui.ts L107-108).

Design-system spec for these pages: `docs/design-system.md` L156-166 (landing and sign-in/up), L191 (button sizes), L211 (steps: 24px circles; done = `--done` tick; current = Harbour; to come = white on hairline), L250, L256 (import uploads).

### 0.2 Document shell

`head()` (ui.ts L101-115) emits, in order: charset, viewport, `<title>{title} - myEST8</title>`, favicon, a small inline script that adds `js` to `<html>`, two font preloads, `daisyui.css`, `app.css`, optional extra stylesheets from `o.css`, then **`tailwind.js` (blocking)**, then the `TAILWIND_THEME` `<style type="text/tailwindcss">` block (ui.ts L54-95, `@theme inline reference` mapping `--color-*` to the tokens), then `app.js` deferred.

`data-theme="myest8"` on `<html lang="en-AU">`. `<a class="skip-link" href="#main">` first in `<body>`.

### 0.3 `publicPage()` (ui.ts L273-320) — used by tenant pages and landing

- Bar: `header.public-bar > .public-bar-inner` (max 560px, `min-height: 56px`, padding 12/16), logo on the left or `headerActions` on the right.
- With `brand` (tenant pages only): `.public-brand` (Lexend 600, 18px) carries the Agency's name, and a small muted `logotype` (`.public-brand + .logotype`, 16px mark) sits at the right.
- Width: `width: 'narrow' | 'default' | 'wide'` gives `is-narrow` (400px), default (560px), `is-wide` (1120px; 24px gutters from 768px). Applied to bar, main and footer.
- Main: `.public-main` column, 24px gap, padding 24/16/32, 16px at ≤40rem. Then `.app-body-stack > .page-head > h1.page-title` (Lexend 600 26px, 22px on phones) or `.page-title.is-hero` (clamp 36px–52px, weight 700, max 22ch) plus `p.page-subtitle` (14px muted).
- Footer `.public-footer`: 12px muted, centred, default text `TENANT_FOOTER` = "Questions? Reply to the message your Property Manager sent you." (TENANT_FOOTER, ui.ts L262).
- `css: string[]` option (ui.ts L285): loads extra sheets after app.css. Used with `landing.css` and `auth.css`.

Phone-first: all the layout classes above are in `app.css`, so this shell works without the Tailwind runtime.

### 0.4 Components reused from `ui.ts` (ac2f5ea)

- `button(label, {variant, size, block})` (L373): `class="btn btn-{variant}"`; variant map `primary→btn-primary`, `secondary→btn-outline`, `danger→btn-danger`, `ghost→btn-ghost` (L363). Sizes `sm` 32px, default 36px, `lg` 44px; all 44px on phones and touch (app.css L245-282). `block` adds `btn-block`.
- `linkButton(label, href, …)` (L381): same classes on an `<a>`. Default variant is `secondary` (outline).
- `field({label, name, type, hint, error, options…})`: wraps `field-label`, `field-hint`, `field-error` (app.css L438-450), inputs use daisyUI `input`/`select`.
- `card({title, body, id})` (L411) and `section()` (L416): both are `panel()` (L398) — `section.section > .section-head > h2.section-title + .section-actions`, then `.section-body`. Surface, 1px line border (app.css L509-540).
- `badge(text, tone)` (L431): `badge badge-soft badge-{tone} whitespace-nowrap`. `urgencyBadge` (L441): urgent→error, high→warning, routine→`badge-muted`.
- `alert(body, tone, {title})`, `flashMessage(flash)` (L336).
- `steps(items, {horizontal, current})` (L649): daisyUI `steps-horizontal` with Tailwind text/spacing classes (`pb-2 px-1 text-center text-xs sm:text-sm`).
- `docket({number, urgency, address, issue, meta})` (L849): `.docket`, `.docket-stub`, `.docket-perf`, `.docket-body`, `.docket-foot` (app.css L776-900). Fully app.css-styled.
- `logo({size})` (L1074): `span.logo.is-md > svg.logo-mark + span.logo-word` (`my` + `EST8`).
- `icon(name, {weight, size})` (icons.ts L40-48): writes `width`/`height` attributes from the size class, so SVGs render correctly without Tailwind.
- `table(headers, rows, {caption})`, `dl()`, `emptyState()`, `formatMoney`, `formatWhen`.
- `shareButton()` lives in `share.ts` (not read in depth): a `<details>` disclosure, server-rendered links only.

---

## 1. Landing page `/` (signed out)

### 1.1 Route and purpose

- `landingRoutes(app, sessions, {demo})` (landing.ts L25-32). GET `/`: a signed-in PM falls through to the dashboard; otherwise `landingPage(o)` (L37-62).
- Purpose (L1-9): who myEST8 is for, one repair played through (hero + workflow), which calls stay with the PM, the two ways in (create account, sign in), and demo sign-ins when `demo` is true.
- Builds its own document (does not use `publicPage`), so the bands run full width. Body class `lp`; loads `landing.css` only here (landing.ts L41).

### 1.2 Layout, top to bottom (landing.ts L37-62)

1. `header.lp-bar > .lp-wrap.lp-bar-inner`: logo left; `nav.lp-bar-actions`: ghost small "Sign in" → `/login`; primary small "Create your Agency's account" → `/signup` (hidden under 40rem via `.lp-bar-signup`).
2. `main#main`:
   - `section.lp-hero` (see 1.3).
   - `aside.lp-demo` only if `demo` (see 1.4).
   - `div.lp-band.is-paper` containing the workflow `section.flow` (see 1.5).
   - `section.lp-band.is-surface.lp-roles` — "What waits for you, and what doesn't" (see 1.6).
   - `section.lp-close` — the closing Night band (see 1.7).
3. `footer.lp-footer > .lp-wrap` with `SIGNED_OUT_FOOTER` (auth.ts L205).

### 1.3 Hero (landing.ts L71-96, CSS landing.css L100-207)

Grid: one column; from 64rem `minmax(0,1fr) minmax(0,560px)`, column-gap 64px. Padding 40/56 mobile, 52/88 from 64rem.

- **Headline** `h1.lp-headline` (Lexend 700, `clamp(38px, 4.2vw + 6px, 64px)`, line-height 1.04, letter-spacing -0.025em, colour `--ink`). Three `span.lp-line` (display block). Copy: "Tenants text the problem." / "You decide." / "myEST8 does the chasing."
  - `.lp-line.is-you` carries the Wattle stripe: `::before`, absolute, `left: -12px` (-22px from 48rem), width 4px (6px from 48rem), `--hivis`, sitting in the gutter so the lines stay aligned.
- **Intro column** `.lp-intro` (flex column, gap 24px):
  - `p.lp-lead`: 18px / 1.55, max 54ch, colour ink (17px on phones). Copy: "A maintenance desk for Property Managers at small Agencies…"
  - `.lp-actions`: primary lg "Create your Agency's account" → `/signup`, secondary lg "Sign in" → `/login`. On phones each `.btn` goes full width (landing.css L94-98).
  - `ul.lp-channels`: three items, icon + label, icons `chat-text` (SMS), `whatsapp-logo` (WhatsApp), `envelope-simple` (Email), Harbour-coloured icons, 500 weight, gap 8px 20px.
  - `p.lp-note`: 14px muted, max 54ch, top hairline. Copy: "Tenants, Tradies and Property Owners never need an account. They reply by text or a link."
- **Scene** `figure.lp-scene` (landing.ts L106-151; CSS L210-263, L313-337, L340-359, L419-428):
  - `.lp-thread`: surface card, 1px line border, radius 8px, padding 16/72 (20/88 from 40rem), `margin-right: 24px` (72px from 40rem).
    - `.lp-thread-head`: 36px circle avatar `.lp-avatar` ("PS", `--info-bg` background, Harbour text, Lexend 600 13px), who-block `.lp-thread-who` (name 600, meta 13px muted "Tenant at 12 King St, Newtown"), `badge('SMS')`, bottom hairline.
    - `ol.lp-msgs`: three messages, gap 14px. Tenant bubbles `.lp-msg.is-in` align left; myEST8 bubble `.lp-msg.is-out` aligns right.
      - `.lp-bubble`: padding 10/14, radius `14 14 14 4` (inbound) / `14 14 4 14` (outbound), inbound bg `--page`, outbound bg `--action` with surface text. Meta line 12px muted.
      - `.lp-found` marks the words the intake found: bg `--info-bg`, inset underline `box-shadow: inset 0 -2px 0 var(--action)`, so it does not rest on colour alone.
      - Copy: Tenant "hi the [tap under the kitchen sink] keeps dripping…"; myEST8 "Thanks Priya. Is the water near any power points…"; Tenant "no [just the cupboard], nowhere near power. pic attached".
  - `.lp-request`: the Maintenance Request card, laid over the thread's bottom-left corner: `margin: -56px 0 0 24px` (-64px / 72px from 40rem), z-index 1, surface, 1px line border, **4px hivis left border** (decision row), radius 8, `--shadow-lift`, padding 16/18 (18/22 from 40rem).
    - `.lp-request-kind` ("Maintenance Request" left, "Waiting for you" right; Lexend 13px muted, age in ink Red Hat).
    - `.lp-request-address` Lexend 600 19px; `.lp-request-issue` ink.
    - `dl.lp-request-fields` with dashed top hairline, grid rows `72px minmax(0,1fr)`: Trade → `badge('Plumbing')` + italic `.lp-from` "from 'tap under the kitchen sink'"; Urgency → `urgencyBadge('routine')` + "from 'just the cupboard'"; Photos → `tapPhoto()`.
    - `.lp-request-actions`: two `.lp-fake-btn` spans ("Confirm" primary, "Review") — 36px high, radius 6, `aria-hidden`. These are pictures, not controls.
  - `tapPhoto()` (landing.ts L154-166): 160×112 SVG, 96px wide, classes `p-wall`, `p-shelf`, `p-pipe`, `p-valve`, `p-drop`, `p-puddle`, `p-puddle-hi`, each filled from a token (wall ink, pipe `--control`, valve action, drops/highlight `--info-bg`, puddle action).
  - `figcaption.lp-caption` (13px muted): "The marked words are where myEST8 found the Trade and the Urgency."

### 1.4 Demo sign-ins (landing.ts L181-210, CSS L453-522) — only when `o.demo`

- `aside.lp-demo`: surface, top hairline. Inner grid: 64rem splits `minmax(0,1fr) minmax(0,560px)`.
- Left: `h2.lp-h3` "Try the demo Agency"; copy "Harbour Realty has two Property Managers…"; password shown in plain text (`.lp-demo-password`, 600 ink).
- Right: `ul.lp-demo-people` with a 1px line border and radius 8; rows separated by hairlines; each row: name (600) and email (14px muted, `overflow-wrap: anywhere`), then a POST form to `/login` with hidden `email`, `password`, `next=/` and a secondary `button("Sign in as {name}")`. Full-width on phones.
- `DEMO_LOGINS` exported (L19): alice and bob `@harbour.example`, password `demo1234`.

### 1.5 Workflow: "One repair, start to finish" (landing.ts L212-357; CSS L524-879)

- Heading `h2.lp-h2` (Lexend 600, clamp 26–38px, max 24ch) with `p.flow-summary` (17px muted): "Reported on Monday at 7:42 am, fixed on Wednesday morning. The Property Manager made two decisions."
- Pause button `button.btn.btn-ghost.btn-sm.flow-pause` with pause/play icons and `data-flow-pause`, `hidden` by default. app.js (L220-228 at ac2f5ea) shows it and toggles `data-paused` on `[data-flow]`.
- `ol.flow-stages`: eight `li.flow-stage` items with `style="--i: N"` and an optional `.is-decision`. Each stage = `flow-node` (number circle, 32px, 1px control border, surface) + `.flow-text` (when, title, who) + `.flow-picture` (the picture).
  - Stages (landing.ts L221-323): Mon 7:42 Tenant texts (mini thread bubble); Mon 7:46 myEST8 makes a Maintenance Request (`.lp-card`); Mon 9:10 **You** confirms (decision, `lp-card is-decision is-row` with Confirm); Mon 9:10 myEST8 makes a Ticket (`docket(...)`); Mon 9:11 Quote Requests go to 3 Tradies (list with `paper-plane-tilt` icons); Mon 3:20 pm **Tradies, then you** — a Quote comes back (decision: $180 Drip Doctors vs $240 Flow Bros, "Under the Property's $500 Max Repair Cost, so no Property Owner approval needed"); Mon 3:24 pm Work Order sent (`check-circle` in `--done`); Wed 9:35 am Tradie — Job done, four `steps` horizontal all done.
- Animation: `.flow { --cycle: 20.8s; --slot: 2.6s }`. Each stage animates with `animation-delay: calc(var(--i) * var(--slot))`. Keyframes:
  - `flow-now` (L828): stage background goes `--surface` plus `--line` border for 0–11.5% of the cycle, then transparent.
  - `flow-now-decision` (L840): same plus `inset 4px 0 0 var(--hivis)` (the Wattle stripe).
  - `flow-node` (L854): node fills with `--action` and surface text for 0–11.5%, then returns to surface with `--control` border.
  - One stage "lifts" at a time. Eight stages of 2.6s make the cycle.
- Grid per breakpoint:
  - Mobile: `32px minmax(0,1fr)`; picture in column 2.
  - From 48rem: `32px 220px minmax(0,1fr)`; picture in column 3, spanning both rows.
  - From 64rem: `84px 32px 280px minmax(0,1fr)` with time in column 1 (right-aligned, nowrap, 14px), node column 2, title and who column 3, picture column 4. A track line runs down the node column (`left: 135px`).
- `.flow-who` is a 1px-line chip; `.flow-who.is-you` is a Wattle chip (hivis fill, ink, 600).
- `prefers-reduced-motion: reduce` (L870-879): animations off, pause button hidden (`display:none !important`). Every stage is still shown.
- `.flow-pause` is 44px tall.

### 1.6 "What waits for you, and what doesn't" (landing.ts L362-425; CSS L883-985)

- Band `.lp-band.is-surface.lp-roles` (padding 56/64; 88/96 from 64rem). Heading `.lp-h2` with 40px bottom margin.
- Grid `.lp-roles-grid`: one column; from 64rem `5fr 6fr`, column-gap 64px.
- Left "Waiting for your decision" (`h3.lp-h3`): two `li` cards in `.lp-decisions`, each `surface`, 1px line border, **4px hivis left border**, radius 4, padding 16/20. Titles: "Confirm each Maintenance Request" and "Choose the Quote".
- Right "Handled by myEST8": `ul.lp-chores` with hairline separators, five rows, each with an icon (`chat-circle-dots`, `siren`, `paper-plane-tilt`, `signature`, `calendar-check`, Harbour, `size-5`).
- Below, `div.lp-people` (56px top margin, 32px padding-top, hairline): "Nobody else needs an account" — three columns from 48rem (`repeat(3, minmax(0,1fr))`, gap 32px): Tenants (`user`), Tradies (`wrench`), Property Owners (`house-line`); each has an icon + name (Lexend 600) and muted text.

### 1.7 Closing band (landing.ts L429-439; CSS L988-1043)

- `section.lp-close` background `--ink`, text `--rail-text`. Padding 56 (80 from 64rem). From 64rem, copy and actions sit in a row aligned to the bottom.
- `h2.lp-h2` "Put your Agency's repairs on one desk" (in `--rail-text`), 17px `--rail-muted` copy: "Create the Agency's account, add your Properties and Tradies, and give Tenants the number to text."
- Actions: primary lg "Create your Agency's account" and an outline lg "Sign in". `.lp-close .btn-outline` is overridden to a transparent background, `--rail-muted` border, and `--rail-text` text; hover uses `--rail-hover`. Focus ring is `--rail-text` because Harbour is too dark on Night (L1029-1032).
- `footer.lp-footer`: background `--ink`, top border `--rail-current`, 13px `--rail-muted`.

---

## 2. Sign-in `/login` (and `/logout`)

### 2.1 Route and purpose

- `authRoutes(app, sessions)` (auth.ts L74-106). GET `/login?next=` redirects if already signed in, otherwise `signInPage`. POST `/login` checks `sameOrigin`, calls `app.login`, and on a bad match returns 401 with "That email and password don't match. Try again." POST `/logout` ends the session and redirects to `/login`.
- `safeNext()` (L155-159) only allows same-site paths.

### 2.2 Layout (the auth card, auth-card.ts L21-57, CSS auth.css)

`authPage({title, subtitle, flash, size, form, steps, footer})` builds its own document with `head(title, {css: ['auth.css']})` and `body.au`.

- `div.au-frame.is-{login|signup}`: grid, `min-height: 100dvh`. Column width `--au-col` is **400px for login**, **600px for signup** (auth.css L66-75).
- Bar `header.au-bar`: 64px high, logo (`span.logotype.au-logo`), and a ghost small "Home" link at the right.
- `main#main.au-main` (padding 32/16/48): `div.au-form-col` with the optional flash, `div.au-head` (h1 `.au-title`, Lexend 700, clamp 30–40px; `p.au-lead` 16px muted), then the form.
- `aside.au-panel` — the **Night panel** (see 2.3).
- `footer.au-footer`: Night background, `--rail-muted` text, padded to line up with the form column.

Phone and tablet (below 64rem): one column — bar, form, Night panel, footer. The panel's contents sit inside a centred column of width `--au-col + 32px`.

From 64rem (auth.css L98-145): frame becomes `minmax(0,5fr) minmax(0,7fr)`. The bar becomes a grid over the same two columns, the logo sits on the Night side in `--rail-text` with the mark in Wattle (`.au-logo .logo-mark`). Panel spans full height and is sticky (`position: sticky; min-height: 100dvh; padding 112px 48px 56px`). Form is column 2 with 32/48/56 padding. Footer goes back to column 2 with `--muted` text and no background. From 80rem: wider paddings (64px).

### 2.3 Night panel (auth-card.ts L63-87; auth.css L253-392)

- `p.au-thesis`: the landing headline in miniature, Lexend 700, `clamp(26px, 7.6cqi, 46px)` (container query units on `.au-panel-inner`), line-height 1.06. Same three lines and the same Wattle stripe on "You decide." (`.au-line.is-you::before`, left -12px / -20px).
- `div.au-next`: `h2.au-next-title` "What happens next" (16px, `--rail-muted`), then `ol.au-steps`. Each step: 28px numbered circle (`.au-step-num`, 1px `--rail-muted` border), body text 15px `--rail-text`, and a 1px vertical track between steps (`color-mix(... 45%)`).
- A step with `request: true` shows `request()` (auth-card.ts L94-104): `.au-request`, surface, **4px hivis left border**, radius 8, max 400px, containing the kind line, address (Lexend 600 17px), issue (14px), and a foot row with `badge('Plumbing')`, `urgencyBadge('routine')`, and a `.au-fake-btn` (Harbour, "Confirm") that is `aria-hidden`.
- The only motion: `.au-request` animates `au-arrive` (520ms, 400ms delay, translateY 10px to 0, fade), but only under `prefers-reduced-motion: no-preference` (auth.css L457-472).

### 2.4 Sign-in content (auth.ts L182-202)

- Title "Sign in to myEST8". Subtitle "For Property Managers. Tenants, Tradies and Property Owners never need an account."
- Form `.au-form` (flex column, gap 24px): hidden `next`; Email (`type=email`, autocomplete `username`); Password (`current-password`); `button('Sign in', {size:'lg', block:true})`.
- `otherWay({text: 'New to myEST8?', button: linkButton('Create your Agency's account', '/signup', {variant:'secondary', block:true})})` — a hairline, a muted sentence, then a full-width outline button (`.au-other`, auth.css L229-240).
- Night steps: (1) "Your dashboard lists each Maintenance Request waiting for your decision." with the request card; (2) "Confirm one and it becomes a Ticket."; (3) "Quotes come back from Tradies for you to choose between."

### 2.5 Current tree (HEAD)

- `auth.ts` `signInPage` (HEAD L181-202) is `publicPage` with `width: 'narrow'`, a "Home" ghost link in `headerActions`, form `space-y-4` with the same fields, and a text paragraph "New to myEST8? Create your Agency's account" plus "Back to the front page" as plain links (`a.link`). **No `auth-card`, no Night panel, no `auth.css`, no steps.**
- Note the design-system rule (docs L160) that every link on a public page is a button. HEAD's plain text links break that rule.
- `auth.ts` is 34 lines changed overall. I compared the sign-in page only. Session and `requirePropertyManager` code was not re-verified.

---

## 3. Sign-up `/signup`

### 3.1 Route and purpose

- `signupRoutes(app, sessions, {channels})` (signup.ts L32-77). GET redirects a signed-in user to `/`. POST checks `sameOrigin`, validates the time zone against `TIME_ZONES` (L19-27: Sydney, Melbourne, Brisbane, Adelaide, Perth, Hobart, Darwin, default Sydney), checks password confirmation, then calls `app.signUp`. On `ActionError`, it re-renders with 400 and field errors.
- If `o.channels` is set, `connectSimulatedChannels` runs (L70-71). Then `startSession` and redirect `303 /welcome`.

### 3.2 Layout (signup.ts L86-164, using `authPage` size `signup`)

- Title "Create your Agency's account". Subtitle "You become its first Property Manager. A short guide then helps you set up the rest."
- Form `.au-form`, two `fieldset.au-fieldset` groups, each with an `legend.au-legend` (Lexend 600 17px):
  - **About you**: `.au-pair` row (Your name; Work email with hint "You sign in with this."), `.au-pair` row (Password with hint "At least {MIN_PASSWORD_LENGTH} characters."; Confirm password). Pairs are 2 columns from 40rem, 1 column below.
  - **Your Agency**: `.au-pair` (Agency name; Time zone select with hint "Bookings, reminders and the calendar use this time.").
- `button('Create account', {size:'lg', block:true})`.
- `otherWay({text:'Already have an account?', button: linkButton('Sign in', '/login', {variant:'secondary', block:true})})`.
- `aside.au-share` "Someone else setting up the Agency": a muted sentence ("One Property Manager creates the account, then adds the rest…") and a `shareButton` labelled "Send this page to them", `align: 'start'`.
- Night steps (signup.ts L159-163): (1) "Your account and your Agency are created, and you are signed in." (2) "The setup guide connects your Agency's email first, then adds your team, SMS and WhatsApp, your Tradies and your first Property." (3) "Tenants can then text in a repair, and it reaches you as a Maintenance Request to confirm." with the request card.

Step 2's copy is channel-specific. It describes the email-first gate (see section 5.2), which HEAD no longer has.

### 3.3 Current tree (HEAD `signup.ts`, 158 lines)

- `publicPage` with `headerActions` "Home", default width, and `signup-share` class under the form. Fields use `grid items-start gap-x-4 gap-y-3 md:grid-cols-2` and `legend.text-base font-semibold`.
- A plain-text "Already have an account? Sign in" paragraph sits above the footer (not a button; same design-doc rule issue).
- No Night panel, no steps, no `au-*` classes. Fields and layout are Tailwind utilities (needs the runtime).
- `signupRoutes(app, sessions)` takes no `channels` option in HEAD. So no simulated-channel auto-connect at sign-up.
- Still has `TIME_ZONES` and `shareButton`.

---

## 4. Auth card: what it depends on

- `auth.css` is loaded only on sign-in and sign-up (`css: ['auth.css']`). It is not layered, so it wins over app.css and daisyUI for `au-*` classes.
- Everything in the card is `au-*` or the shared `field-*`, `btn`, `badge`, `logo` helpers. No Tailwind-only utility is needed for the card layout. `urgencyBadge` uses `whitespace-nowrap`, which is a minor loss without the runtime.

---

## 5. Onboarding wizard `/welcome/*` (ac2f5ea)

### 5.1 Route and purpose (welcome.ts L1-15, L78-109, L158-259)

Guided setup for a new Agency, one task per screen, with Back, Continue and "Skip for now". Progress is read from data (`setupProgress`, L100-109), not from a stored flag, so setup can be resumed. Sub-routes:

| Step | Path | Purpose |
|---|---|---|
| 1 Email | `/welcome` (GET), `/welcome/email` (POST connect), `/welcome/email/test` | Agency inbox, required |
| 2 Your team | `/welcome/team` (GET, POST) | Colleagues as PMs, optional |
| 3 SMS and WhatsApp | `/welcome/channels` (GET), `/channels/whatsapp`, `/channels/sms`, `/channels/test` (POST) | Phone channels with test messages |
| 4 Tradies | `/welcome/tradies` (GET, POST) | Tradies, with optional Google listing search |
| 5 First Property | `/welcome/property` (GET, POST) | Property with Owner, Tenant, optional Building Manager |
| 6 Done | `/welcome/done` | Checklist and next step |

Labels (STEPS, L79-86): "Email", "Your team", "SMS and WhatsApp", "Tradies", "First Property", "Done".

### 5.2 Gate (welcome.ts L113-130)

- `BEFORE_EMAIL` allows `/welcome`, `/welcome/email/*` and `/oauth/google/*`.
- `requireEmailFirst()` redirects every other PM page to `/welcome` until email is connected.
- `NEEDED = ['email', 'channels', 'tradies', 'property']` (L89). `STILL_TO_DO` copy at L92-97.

**Current tree:** none of this exists. `BEFORE_EMAIL` count is 0 in HEAD `welcome.ts`, and `NEEDED = ['channels','tradies','property']` (HEAD L90). The Email step is gone.

### 5.3 Frame: `wizardPage()` (welcome.ts L263-304)

- `page({title, subtitle, pm, fullPage: true, shell: shellInfo(c), flash, body})`. `fullPage: true` means **no rail**: the wizard is a full page, as the design doc says ("the wizard fills the page, with no rail", welcome.ts L6-7).
- Subtitle: `span.flex.flex-wrap.gap-x-4` → "Step {n} of 6" and "Setting up {agency.name}".
- Body wrapper `mx-auto flex w-full max-w-[720px] flex-col gap-4`.
- `nav[aria-label="Setup steps"]`: `steps(…, {current: index, horizontal: true})` with `done` and `href` per step, so completed steps are links.
- Footer row `flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4`:
  - Left: "Back" (secondary) to the previous step, or "Set up later" (ghost, to `/`) on step 1 once email is connected.
  - Right: "Continue" (primary) when the step is done; "Skip for now" (ghost) when not done; **no skip on the Email step**.

**Current tree:** `wizardPage` (HEAD L215-) uses `page({ active: 'settings', shell: await shellInfo(c) })`, so the rail **is** shown. No `fullPage` in HEAD ui.ts or welcome.ts. The "Continue" label for the welcome step is "Let's start" in HEAD (L227).

### 5.4 Step-by-step

**Email (welcome.ts L306-337)** — ac2f5ea only.

- Title "Welcome to myEST8, {firstName}".
- Paragraph: "Let's get {agency} ready for its first maintenance message. It takes about 5 minutes…" plus a bold "First, connect the Agency's email."
- `div#email` with a `card({title:'Email', body: channelRow(EMAIL, …, badge=true)})`. This is Gmail-or-simulated, see 5.5.
- `details` "What comes after email" with an ordered list of the four steps.

**Your team (welcome.ts L339-406)** — same in both trees.

- Paragraph: "Add the other Property Managers at {agency}…".
- After an add: `alert` (success) listing "Sign in at {origin}/login", email, and the **temporary password** in `code[data-temporary-password]`, shown once. The response sets `Cache-Control: no-store`.
- `shareButton` "Send {name} their sign-in link" (the password is never in the share text).
- `table(['Name','Email'], …, {caption:'Property Managers'})` with a "You" badge on the current user.
- `card({title:'Add a colleague'})`: `fieldGrid` with Name and "Work email" (hint "They sign in with this. myEST8 makes them a temporary password."), then "Add colleague".

**SMS and WhatsApp (welcome.ts L408-525 ac; L377-450 HEAD)**

- Paragraph with count: "{n} of 2 connected, {m} tested." (ac L448).
- One row per phone channel: a `grid gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0 md:grid-cols-[9rem_minmax(0,1fr)]`. Left column: `h2.section-title` channel name and `channelBadge` chip. Right column: `channelRow`.
- `channelRow` (ac L470-525): result flash; connected address line; a connect form `mt-2 grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto]` (field + "Connect {name}" or "Change {name}"); a test form once connected (field "Send a test message to" + "Send a test message", primary until tested, then secondary); `channelGuide` folded at the bottom.
- In demo, the address is pre-filled by `simulatedAddress`. If `channels` modes are set, `modeChannelBody` renders instead.

**Tradies (welcome.ts L527-560)** — both trees have this shape.

- Paragraph: add Tradies "with their Trades and how good they've been so far…". Linking a Google listing shows their Google rating next to ours.
- `tradiesTable` (business, name, trades badges, myEST8 rating, Google rating).
- `importCard(c, 'Add many Tradies from a spreadsheet', ['tradies'])`.
- `card#add-tradie` "Add a Tradie": `googleSearchForm` (GET, field "First, find their Google listing" + "Search Google"), then the form with `tradieFields` (Business name; contact fields; Trades checkboxes in 4 columns; Starting rating select 5 to 1 with hint; Google listing radio group including "Not on Google"), then "Add Tradie".

**First Property (welcome.ts L562-747)** — ac2f5ea.

- Paragraph: a Property is one rentable dwelling with its own lease; add it with its Property Owner and Tenant.
- After add: success `alert` "Property added" ("Repairs up to {$500} go ahead without asking the Property Owner").
- Table: Address, Property Owner, Tenants, Max Repair Cost.
- `importCard` with three kinds (owners, properties, tenants) in an ordered list `ol.import-steps` (numbered step titles).
- `card#add-property` "Add a Property" with groups (`fieldset.min-w-0.space-y-3` with `legend.text-sm.font-semibold.text-ink`):
  - "The Property": Address, Suburb, "Max Repair Cost ($)" number, step 0.01, hint "Repairs over this need the Property Owner's approval.", Property Manager select if more than one PM.
  - "Property Owner": contact fields (name, mobile, email; hint "Already on another Property? The same mobile or email links them.").
  - "Tenant": contact fields and "Tenancy start date" (hint "Photos taken before this date are flagged."). Note "More Tenants on the same lease can be added in Setup."
  - `details` "Add a Building Manager (strata only, optional)" — folded unless it holds values or was refused.
  - Nominated Tradies checkboxes (hint "Who the Tenant can call for an Urgent Repair.").
  - "Add the Property".
- The form posts through `readPropertyForm`, which turns `maxRepairCost` into cents and maps refusals to field names (`formField`, L598-603).

**Done (welcome.ts L785-862)** — both trees.

- Title "You're set up" or "Nearly there". Body paragraph (finished vs. still-to-do wording).
- `card` "Your setup": `ul[aria-label="Setup checklist"]` with rows: a green ✓ (`text-done`) or muted – (`text-muted`), `sr-only` "Done:"/"To do:", the item text, and a small fix link where incomplete.
  - Items: agency created; team size (fix "Add colleagues"); each channel connected/tested (ac: email plus SMS and WhatsApp); Tradies count; Properties with Tenants count.
- `card` "Try it": demo copy with a link "Open the phone simulator" to `/demo`, or in production the SMS number to text.
- "Go to your dashboard" primary.

### 5.5 Channel-specific vs visual (for the welcome wizard)

**Keep: visual design (carry over as-is)**

- Frame `wizardPage` layout: 720px column, steps nav, body, footer row with Back / Continue / Skip. Also the Night-free, full-page presentation, if the team wants the no-rail look (see 5.3).
- Card and section surfaces, fields, `fieldGrid`, `choiceGroup` (checkbox/radio), `table` and `dl`.
- Channel row grid (`9rem` label column, form on the right; `1fr auto` form row).
- Done checklist with ✓ and – marks.
- Folded `details.import-details.section` for spreadsheet uploads, with numbered import steps.
- Property form grouping (legend + fields) and the folded Building Manager details.

**Channel-specific (do not copy as-is; replace with current behaviour)**

- **Email step**: the whole Email-first gate (`requireEmailFirst`, `BEFORE_EMAIL`, `/welcome/email`, `/welcome/email/test`), the Gmail connect path (`modeChannelBody` with `/oauth/google/start`, `gmailStatus`), and the Night-copy claim "email first". In HEAD, email is part of the Channels step and has no gate.
- **SMS**: "Get an SMS number" (`/welcome/channels/sms`, `getSmsNumber`, Twilio number purchase), and the Twilio console steps in `channelGuide` (ac onboarding-forms.ts L173-208: buy a number, set `/webhooks/twilio`).
- **WhatsApp**: `/welcome/channels/whatsapp` with a server-configured number and the Twilio **sandbox** instructions (`channelGuide('whatsapp')`: "Each Tenant joins the sandbox once…").
- **Email guide**: SendGrid Inbound Parse steps (MX to `mx.sendgrid.net`, `/webhooks/sendgrid`). Replaced in HEAD by Resend and an inbound address with a Copy button (`inboundEmailField`, HEAD onboarding-forms.ts L144-152).
- **Placeholders and example addresses**: ac `+1 415 523 8886` (sandbox), `maintenance@parse.youragency.com.au`. HEAD placeholders are in `CHANNELS` (HEAD L30-32).
- **Demo copy**: "In the demo it shows under 'What myEST8 sent'…" (welcome.ts L197).

**Current replacements (behaviour, not the design)**

- Channels: `CHANNELS` is `sms`, `whatsapp`, `email` (HEAD onboarding-forms.ts L29-33). Channel states are `missing / waiting / verified / connected` (`channelState`, HEAD L66-72), with a 6-digit code flow for SMS and WhatsApp (`phoneChannelForm`, HEAD L102-142; `src/channel-verification.ts` L1-3: "start sends a 6-digit code; confirm stores the address … only after the code matches"). The code expires in 10 minutes and allows 5 attempts (channel-verification.ts L13-14).
- Email is inbound through Resend (`src/adapters/resend-mailer.ts`, `resend.ts`) with an inbound address field. Gmail still exists through `src/web/pages/oauth-google.ts` (`googleOAuthPages`, `gmailControls`). WhatsApp uses `whatsappControls` with a note that Meta's test number reaches up to 5 phones.
- `oauth-google.ts` lives at `src/web/pages/oauth-google.ts`, not `src/web/google-oauth.ts`.

### 5.6 Current welcome, step by step (HEAD)

- Welcome step (HEAD L255-287): title "Welcome to myEST8, {firstName}", paragraph "This takes about 5 minutes…", card "Steps ahead" (four items; the Channels item now says "SMS number, WhatsApp and email inbox… and test each one"), card "Your Agency" with a `dl` (Agency, Time zone, First Property Manager). This replaces the ac email-first step.
- Channels step (HEAD L377-438): paragraph ("Verify SMS and WhatsApp with a code sent to the number. Email arrives at the address below…"), count "{n} of 3 connected, {m} verified", rows per channel with `id` anchors, `inboundEmailField` for email, and `phoneChannelForm` for SMS and WhatsApp.
- Team, Tradies, Property, Done: same shape as ac2f5ea, with Tailwind classes and `fullPage` removed.

---

## 6. Setup `/setup` (ac2f5ea setup.ts L1-511)

### 6.1 Route and purpose

`setupPages(o)` (L72-221). GET `/` renders `page({title:'Set up myEST8', active:'settings', subtitle:'Work through these areas once. Come back any time to add more.', actions: linkButton('Use the step-by-step guide', '/welcome'), …})`. The page is inside the app shell (rail present). Sub-routes POST to `/setup/channels`, `/channels/whatsapp`, `/channels/sms`, `/channels/test`, `/owners`, `/building-managers`, `/tradies`, `/properties`, `/tenants`. Refusals come back with `?form=<key>` and the error shows beside its fields (`formAction`).

### 6.2 Layout (ac L95-115)

- In-page nav `nav[aria-label="Setup areas"]`: a flex list of anchor links (text-sm, gap 16/4) to five areas: Channels, Property Owners and Building Managers, Tradies, Properties, Tenants (`AREAS`, L63-69).
- Each area is a `section()` with an id: `channels`, `people`, `tradies`, `properties`, `tenants`.
- Sub-blocks are `.section` `div`s with `.section-head` (`h3.section-title`) and `.section-body`. Folded "Add" forms are `details.mt-4` with a `summary.text-action`, opened when refused.
- Import: `details.import-details#import-{kind}` with a `file-xls` icon summary "Add many from a spreadsheet".
- Channels: `grid gap-4 md:grid-cols-3`; a `channelCard` per channel with its chip (`Not connected` warning, `Connected` info, `Tested` success), `channelLine`, `channelGuide`, the connect form and the test form (ac L262-307).
- People: two-column grid (`md:grid-cols-2`) for Property Owners and Building Managers. Each has a table, an "Add" fold, and an import fold.
- Tradies: table, "Add a Tradie" fold (open when a Google search is in progress), Google search and the full form.
- Properties: a table with 7 columns (Address, Property Manager, Property Owner, Max Repair Cost, Tenants, Nominated Tradies, Building Manager), an empty state, and an "Add a Property" fold: selects for Owner and Property Manager, Max Repair Cost with hint "The most a Ticket's Repair Cost can reach before the Property Owner must approve.", Building Manager (strata only, optional), Nominated Tradies checkboxes.
- Tenants: table (Name, Property, Mobile, Email, Tenancy start), "Add a Tenant" fold (property select, tenancy start date).

### 6.3 Current tree (HEAD setup.ts)

- `AREAS` (HEAD L56-60) has three entries only: channels, people, tenants. **Tradies and Properties are not sections on `/setup` in HEAD.** Their routes are elsewhere (`src/web/pages/tradie.ts`, `properties.ts`; not read).
- `channelsArea` takes `connectors`, `email`, `pending` (HEAD L98). Email shows the inbound address with the Waiting/Verified states, with the channel-verification code forms.
- The Google connect path is through `oauth-google.ts`.

---

## 7. Shared onboarding form parts (`onboarding-forms.ts`, ac2f5ea)

- `fieldGrid(fields)` (L211): `grid gap-x-4 gap-y-3 md:grid-cols-2`.
- `contactFields(id, {scope, values, errors, nameLabel, hint, optional})` (L220-239): Name (required unless optional), Mobile (`type=tel`, placeholder 0412 345 678), Email; default hint "A mobile number, an email address, or both." Posted names are scoped (`ownerName`, `tenantMobile`).
- `choiceGroup({type:'checkbox'|'radio', columns: 2|4, …})` (L252-285): daisyUI `checkbox checkbox-primary checkbox-sm` or `radio radio-primary radio-sm`, legend `field-label mb-1`, `md:grid-cols-2` or `md:grid-cols-4`, labels `flex cursor-pointer items-start gap-2 py-1 text-sm`.
- `googleSearchForm` (L288-295) and `tradieFields` (L308-350): Starting rating `[5,4,3,2,1]` with the "{n} / 5" labels; Google listing as a radio group with "Not on Google" (value `none`).
- `importPanel(kind, {from, error, compact})` (L413-440): `.import-panel` → `.import-upload` form with `enctype="multipart/form-data"`, file input `accept=".xlsx,.csv,…"`, hint "{MAX_IMPORT_ROWS} rows and {MAX_SHEET_BYTES} MB", "Upload and review" button, and a "Download template" link (`download-simple` icon). Template path `/setup/templates/{kind}.csv`.
- `IMPORT_NOUNS` (L374-380): owners, building-managers, tradies, properties, tenants.
- `valuesOf`/`valueOf` (L36-50) keep posted values for re-display, skipping passwords.

These use `field-*`, `btn`, `badge` and `section` classes, plus Tailwind grid classes (`grid`, `gap-*`, `md:grid-cols-*`, `space-y-*`, `mt-*`, `text-muted`). **The grid layouts need the runtime.**

---

## 8. Tenant pages `/u/:token` and `/t/:token` (ac2f5ea `src/web/tenant-pages.ts`)

### 8.1 Routes and purpose (L48-115)

- GET `/u/:token`: upload page. Unknown link → 404 `badLinkPage(null)`. Known but closed → 410 `badLinkPage(link)`. Otherwise `uploadPage`, with `?ok=N` showing a thank-you block.
- POST `/u/:token`: body limit 105 MB (10 files of 10 MB plus framing). Too large → 413 with "That was too much in one go. Send up to 10 files at a time, each under 10 MB." Refusal from the core → `uploadPage` with the error. Success → 303 `/u/{token}?ok=N`.
- GET `/t/:token`: progress tracker. Unknown → 404 "We couldn't find that link". Otherwise `trackerPage`.
- Purpose (L1-6): no-login links, phone first. Both name the Agency and the Property address "because a stranger's link is only trustworthy if it says so."

### 8.2 Upload page (L155-191, L201-239)

- `publicPage({brand: link.agencyName, title, subtitle: link.address, footer: 'Questions? Reply to any message from {agency}.'})`.
  - Title: "Send photos of the issue" (photos link) or "Send your Urgent Repair receipt" (receipt link).
  - Bar: the Agency name in `.public-brand` (Lexend 600 18px), with the small muted logo at the right.
- `doneBox` (L242-244): `role="status"` block, `border-done bg-done-bg text-done`, shown after an upload.
- `card` titled "Choose your photos", "Choose your receipt", or "Add more" (after an upload), with the error alert above the form.
- Form `enctype="multipart/form-data"` with `space-y-4`:
  - `.tenant-issue`: 2px line left border, 12px padding; muted "The issue you told us about" and the bold `link.description`.
  - Drop zone: `label#field-files`, `rounded-lg border border-control bg-page p-4 text-center`, with focus styled via `has-focus-visible:outline-2 …`. Inside: bold "Photos of the issue" or "Photos, or a PDF receipt"; a button-like span (`min-h-14 rounded-md border border-control bg-surface … font-semibold`) with the camera icon and "Take or choose photos"; hint "Up to 10 files at a time, each under 10 MB." (`field-hint`); a visually hidden `input#field-files[multiple][required]` (`sr-only`, `accept="image/*"` or `image/*,application/pdf`).
  - `#files-chosen` (`.tenant-chosen`, aria-live polite) filled by an inline script (L217-239): "{n} photos selected" and a list of file names. Without script the form still works.
  - Primary block button "Upload" or "Upload more".
- Card "Tips": bullets. Photos: angles and a wide shot; camera photos keep their details. Receipt: whole receipt in frame; a PDF from the tradie is acceptable.

### 8.3 Bad-link pages (L131-147)

- Unknown token: title "This link has expired or isn't right", no brand, body telling the Tenant to check the whole link or reply.
- Known but closed: brand = Agency, title "This link has expired", subtitle = address, footer reply line, body "{agency} has already dealt with this issue…".

### 8.4 Progress tracker (L294-362)

- `publicPage({brand: progress.agencyName, title: progress.description, subtitle: progress.address, footer: reply line})`.
- `p.tracker-now` (Lexend 600 20px, line-height 1.35): a plain sentence per stage (`statusLine`, L273-292), e.g. "{agency} has confirmed the repair and is arranging a tradie." or "{who} is booked for {time}." Time is in the Agency's time zone.
- `card` "Progress": `progressList` (L334-362).
  - `ol.m-0.list-none.p-0`. Each `li.relative.flex.gap-3.pb-6.last:pb-0`, with `aria-current="step"` on the current one.
  - Connector: `span.absolute.top-6.bottom-0.left-[11px].w-0.5` in `bg-done` (reached) or `bg-line`.
  - Circle: `span.relative.z-10.flex.size-6.shrink-0.rounded-full.border-2.text-xs.font-semibold`:
    - current (not finished): `border-action bg-surface text-action`, shows the step number;
    - reached: `border-done bg-done text-[var(--surface)]`, shows the tick (`CHECK` icon, size-3.5);
    - to come: `border-control bg-surface text-muted`, shows the number.
  - Label: `p` in `font-semibold text-ink` when reached, otherwise `text-muted`. `sr-only` status "(Now)", "(Done)" or "(To come)".
  - Detail line (`text-sm text-muted`): the tradie and visit time, or the time it happened.
- Stage labels (`STAGE_LABEL`, L26-34): Reported, Confirmed, Getting quotes, **Repair approved** (not "Approved", which would read as the owner's say-so), Booked, Fixed, Closed.
- `tenantSteps` (L254-262) collapses Done and Closed into one final step "Fixed". A ticket closed without a Job done ends at "Closed", so the page never says something was fixed when it was not.
- Share `aside.tracker-share` (app.css L1920-1928, border-top hairline): "Live with someone? Send them this page so they can follow the repair too." and a `shareButton` with note "Anyone with this link can see this page, so only send it to people you live with."

### 8.5 Does it work without the Tailwind runtime? (the question asked)

**No, not as written at ac2f5ea.** The tenant pages still load `tailwind.js` (ui.ts head(), L112), and the progress circles and connector lines depend on Tailwind utilities that are not defined anywhere in app.css:

- Tracker `progressList`: `relative flex gap-3 pb-6 last:pb-0`, `absolute top-6 bottom-0 left-[11px] w-0.5`, `relative z-10 flex size-6 shrink-0 … border-2 …`, `min-w-0 pt-0.5`, `text-sm text-muted`. Without the runtime the circles lose their size and the connector lines don't position, which is the failure issue 24 describes (`.scratch/web-app-improvements/issues/24-tenant-pages-without-tailwind-runtime.md`).
- Drop zone: `rounded-lg border border-control bg-page p-4`, `min-h-14`, `has-focus-visible:…`. Without the runtime the zone is unstyled, but the native input is `sr-only` (app.css has `.sr-only`), so the form still works.
- What does work without the runtime: `.public-bar`, `.public-main`, `.page-title`, `.card` (`section.section`), `.btn`, `.alert`, `.badge`, `.field-*`, `.public-brand`, `.tracker-now`, `.tenant-issue`, `.tenant-chosen`, `.tracker-share`, `.docket`, and the logo. These are defined in app.css (L1497-1630, L2788-2836, L1920-1928).
- Verdict: the ac2f5ea design is **not** Tailwind-independent for the tracker and upload zone. The fix the scratch issue asks for is to move the utilities those two components use into app.css (for example `.tracker-list`, `.tracker-circle`, `.tracker-line`, `.drop-zone`) and drop `tailwind.js` on tenant pages.

**Current tree (HEAD):** the same problem, and also no `brand`, `tenantSteps`, or `tracker-now` styling. The tracker is "Now: {stage}" in `text-2xl leading-snug font-semibold`, and `progressList` uses the same Tailwind classes. The upload drop zone has no `CHOSEN_SCRIPT` (no file-name list). Direct upload is handled by `data-direct-upload` in `app.js` (HEAD app.js L251).

---

## 9. Google OAuth connect (`src/web/google-oauth.ts`, ac2f5ea)

- `googleOAuthRoutes({publicUrl})` (L19-62): GET `/start` begins the flow, sets `oauth_state`, `oauth_verifier` (PKCE) and `oauth_return` cookies (HttpOnly, SameSite=Lax, path `/oauth/google`, max-age 600s), and redirects. GET `/callback` checks state, handles `access_denied`, then calls `connectGmail` and redirects to `withFlash(return, 'ok', 'Gmail connected: {address} is now the Agency inbox.')`.
- No design of its own: pages are flash redirects back to `/setup` or `/welcome/channels`.
- **Current tree:** `src/web/google-oauth.ts` does not exist. Its role is in `src/web/pages/oauth-google.ts` (`googleOAuthPages(gmail)` with `/start`, `/callback`, `/disconnect`; `gmailControls`, `whatsappControls`). That file is 106 lines in HEAD and uses Tailwind classes for the controls.

---

## 10. Demo simulator `/demo` (skim, `src/demo/simulator-pages.ts`)

- `simulatorPages(demo)` (L65): GET `/` renders inside `page({title:'Phone simulator', pm, active:'settings'…})` (the app shell with rail). POST `/demo/send` and `/demo/advance` (clock).
- Phone frame `PHONE_FRAME` (L50-51): flex column, `min-h-[560px]`, `h-[calc(100dvh_-_200px)]`, `rounded-[28px]`, `border-control`, `bg-surface`, shadow `0 8px 24px rgb(50 50 51/.18)`. On laptops `lg:w-[380px] lg:h-[min(760px, calc(100dvh - 108px))]`.
- Header with contact name and the channel badges; feed of `chatBubble` items; composer form with quick-reply chips (`btn btn-outline btn-sm`) in a horizontal scroll row.
- **Current:** `PHONE_FRAME` is `lg:h-[min(720px,calc(100dvh_-_140px))]` (HEAD L55). The header is stacked, with channel badges in a second row. The composer padding changed from `pb-3` to `py-3`.
- Tailwind-only (arbitrary values, `shadow-[…]`, `rounded-[28px]`). Not part of the public pages.

---

## 11. Current tree vs ac2f5ea: what changed

| Surface | ac2f5ea | HEAD |
|---|---|---|
| Landing | Own document, `landing.css` (1043 lines), hero with thread and request card, 8-stage workflow, roles band, Night close | `publicPage` `wide`, `landing-intro` + lead + two buttons, 8-stage `flow` in app.css (`.flow-stage`, `.flow-picture`, `.flow-card`); no hero scene, no roles band, no close band |
| Landing headline | "Tenants text the problem. / You decide. / myEST8 does the chasing." | "From a Tenant's first text to the finished repair." |
| Sign-in | `authPage` with Night panel and `au-*` (auth.css 472 lines) | `publicPage` narrow, plain links |
| Sign-up | `authPage` (600px), two fieldsets, Night steps | `publicPage`, Tailwind grid, no panel |
| Wizard frame | `fullPage` (no rail), 6 steps, Email step first, gate | rail shown, 6 steps (Welcome first), no gate, no Email step |
| Welcome step | none (Email step instead) | "Steps ahead" and "Your Agency" cards |
| Channels | Email with Gmail; SMS via Twilio number; WhatsApp sandbox; SendGrid guide | SMS and WhatsApp with 6-digit code verification; Email inbound via Resend with Copy button; Gmail via `oauth-google.ts` |
| Setup | sections: channels, people, tradies, properties, tenants | sections: channels, people, tenants |
| Tenant upload | brand bar (agency name), `tenant-issue`, file-name list script, "Photos of the issue" | no brand, direct upload by JS, no file-name list |
| Tenant tracker | `tracker-now` sentence, "Repair approved", Fixed/Closed, brand | "Now: {stage}" in text-2xl, same progress list with Tailwind |
| ui.ts `head()` | font preloads, rail script, `css` option, `publicPage` `brand` and `css` | no preloads, no `css`, no `brand`; still loads `tailwind.js` |
| Simulator | `PHONE_FRAME` 760px, single-row header | 720px, stacked header with channel badges |

---

## 12. Summary table

"Design-only" = markup and CSS in the design alone. "Needs backend not present now" = routes or data in ac2f5ea that the HEAD tree lacks. Sizes are rough line counts of the ac2f5ea file.

| Page | Design-only (markup and CSS) | Needs backend not present now (vs HEAD) | Rough size |
|---|---|---|---|
| Landing `/` | Yes: hero, thread, request card, workflow pictures, roles, close band. CSS in `landing.css` (1043 lines) | Demo logins are data-only (present). No backend gap. Workflow copy names Gmail-era terms only in the scene | 440 TS + 1043 CSS |
| Sign-in `/login` | Yes: `authPage` frame, Night panel, steps | None. Uses `app.login`, present | 205 TS (auth.ts, sign-in part) + 472 CSS (shared) |
| Sign-up `/signup` | Yes: two fieldsets, Night steps | Simulated-channel auto-connect (`o.channels`, `connectSimulatedChannels`) is not in HEAD's `signupRoutes` | 165 TS |
| Auth card (`auth-card.ts`) | Yes: panel, request card, `otherWay` | None | 112 TS |
| Welcome wizard `/welcome/*` | Visual frame, cards, channel row, checklist, property form: yes. Email step, SMS number buy, WhatsApp sandbox: channel-specific, needs old backend (Email-first gate, Gmail, Twilio buy) | Email gate and step, `ensureInboundEmail` flow in HEAD differs; `/welcome/channels/sms` buy action; `connectSimulatedChannels` | 882 TS |
| Setup `/setup` | Visual sections, folds, tables, channel cards: yes. Tradies and Properties sections on `/setup` are not in HEAD | HEAD removed the Tradies and Properties areas from `/setup` (routes elsewhere) | 511 TS |
| Onboarding form parts | Field grid, contact fields, choice groups, import panel: design-only. Channel guides and modes are channel-specific | Twilio, SendGrid and Meta guide copy; Gmail mode body; `getSmsNumber` | 440 TS |
| Tenant upload `/u/:token` | Yes: brand bar, drop zone, done box, bad-link pages, Tailwind needed for drop zone styling | Brand (`agencyName`) and `description` on the link are core data; present in HEAD? Brand not in HEAD `publicPage` | ~190 TS (of 364) |
| Tenant tracker `/t/:token` | Visual yes: `tracker-now`, circles, lines, Fixed/Closed. Circles and lines need Tailwind (issue 24) | `tenantSteps` collapse and `statusLine` depend on `progress.stages` and time zone (present); "Repair approved" label | ~170 TS |
| Google OAuth connect | Not a page. Flash redirects only | `src/web/google-oauth.ts` gone; Gmail connector in `oauth-google.ts` | 63 TS |
| Simulator `/demo` (skim) | Frame and composer classes only | Header channel badges and frame height changed | 494 TS |

Fix list for "must work without Tailwind" (from section 8.5): move the tracker list and drop-zone utilities into app.css, and stop loading `tailwind.js` on `publicPage` tenant pages. Scratch issue 24 is still open in both trees.

---

## 13. Verification notes

- Every ac2f5ea file was read with `git show ac2f5ea:<path>`. The HEAD comparisons come from `git show HEAD:<path>` and `git grep HEAD`.
- Not read in depth: `share.ts` (`shareButton`), `icons.ts` beyond `icon()`, `import.ts`, `tradie.ts`, `properties.ts`, `connectors.ts`, `app.js` beyond the flow pause (L220-228) and direct upload (HEAD L251).
- Line numbers were checked against the files as printed. Where a claim relies on a grep (for example `BEFORE_EMAIL` count 0 in HEAD, no `fullPage` in HEAD), the grep is the evidence.
