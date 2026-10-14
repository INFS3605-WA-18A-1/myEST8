# De-slop brief (read this first, then only your files)

myEST8: maintenance coordination for small Sydney property agencies. The user is a Property Manager at a 1366–1440px laptop or on a phone. Domain words come from `CONTEXT.md` (Tenant, Tradie, Ticket, Maintenance Request, Urgent Repair, Property Owner, Job, Quote, Work Order). Keep the brand and tokens in `docs/design-system.md`. Don't invent new colours or fonts.

The UI was generated and reads that way. Your job is to make your pages look and read like a tool a person designed: calmer, denser where it's a list, and plainer in its words.

## Rules

1. **Say each fact once.** Today a Ticket page shows "Routine" three times and "Closed" twice, and the title "Ticket 1" repeats the docket's "#1". If a badge, title and stub carry the same fact, keep the clearest one.
2. **One frame deep.** `section()` is the only frame. Don't put `section()`/`card()` inside another section, and don't add Tailwind borders or `!important` overrides (`[&_.x]:!p-2` chains) to fight the components. Inside a section, group with a heading (`<h3 class="section-title">`) or a hairline (`border-t border-line pt-3`). Tables and empty states inside a section now sit flush automatically.
3. **No truncation of what you need to read.** Addresses and names must not be clipped to "27 Llew…". If space is tight, change the layout (stack, wrap, a full-width row), not the text.
4. **Plain words.** Sentence case. Name actions by what happens ("Confirm request", "Send Work Order", "Choose this Quote"). No internal or machine strings in the UI (no raw enum values, no "Demo check: photo received for '…'"). Use `humanise()`, `statusBadge()` and `jobStageLabel()` from `src/web/ui.ts`. An empty state says what will appear there and, if there is one, the next action.
5. **No template chrome.** No middle-dot joins (`' · '`): put separate facts in separate elements with `flex flex-wrap gap-x-3`. No `→` in labels, no all-caps, no eyebrows over headings, and no count badge beside every section title (the rail shows counts now).
6. **One primary action per view** (`variant: 'primary'`). Everything else is `secondary` or `ghost`. Wattle (`--hivis`) only marks "needs your decision".
7. **Tables for lists of like things** (`table()` from ui.ts), with text left-aligned and money/time right-aligned (`align`). Use 13px tables and tabular numbers (`num` class).
8. **Accessibility stays:** labels on fields, real `<a>`/`<button>`, one `<h1>` (the top bar), `<h2>` per section. Pages must work without JavaScript.

## Hard constraints

- **Do not edit** `src/web/ui.ts`, `src/web/static/app.css`, `src/web/pm-pages.ts`, `src/app.ts`, `src/views.ts`, or any file not in your list. If you need CSS, put it in your final report as a snippet (selector plus declarations, using tokens like `var(--line)`). The main agent merges it. Prefer Tailwind utilities already in use (`text-muted`, `border-line`, `bg-page`, `gap-*`).
- `shellInfo(c)` is async now: `shell: await shellInfo(c)`.
- Rail keys (`active`): `dashboard`, `requests`, `tickets`, `approvals`, `dispatch` (labelled Schedule), `properties`, `tradies`, `settings`.
- Data comes from `c.var.actions` (see `PropertyManagerActions` in `src/app.ts`). `actions.dashboard({ filter: 'mine' | 'all' })` returns `maintenanceRequests`, `tickets`, `urgentRepairs`, `inbox`, `alerts`, `calendar`. Don't add new queries to core modules.
- Keep existing POST endpoints and their behaviour. Tests in `test/` (unit and Playwright e2e) may assert on text: before renaming visible text, `grep -rn "<old text>" test` and update the assertion to the new wording in the same change.
- When done, run `npm run -s typecheck` (must pass). Don't run e2e or screenshots; the main agent does that once.
- Final report: what you changed (by file, 1 line each), any CSS snippets needed, and any test assertions you changed. Keep it under 250 words.
