# Edit profiles, remove Tradies, and fix Quote Requests

Three notes from using production. One issue each, built in parallel.

| # | Issue | Main files |
|---|---|---|
| 01 | Asking for Quotes fails with a 500 when the Agency has no SMS channel | `src/notifications.ts`, `src/quotes.ts`, `src/web/pages/dispatch.ts` |
| 02 | A pen button to edit a Tenant's, Property's or Tradie's details | `src/profiles.ts`, `src/onboarding.ts`, `src/app.ts`, `src/web/pages/tenants.ts`, `properties.ts`, `tradie.ts` |
| 03 | Remove a Tradie from the Agency | a migration, `src/profiles.ts`, the lists and pickers that show Tradies, `src/web/pages/tradie.ts` |

## Ground rules

- **Test-first, one vertical slice at a time,** at the repo's existing seams only:
  - module/action tests through the harness (`test/support/harness.ts`)
  - page tests (`test/web/`)
  - a browser test only where layout or interaction needs one

  Expected values come from worked examples. Never weaken an existing test.
- **Design:** follow `docs/design-system.md` and update it for anything new. Reuse what exists before inventing: the pencil the Maintenance Request's Summary already uses (`src/web/pages/requests.ts`, an `icon-btn` link with `pencil-simple` that opens the edit form in the page with `?edit=…`, no JavaScript), `formAction`, `field`, the flash messages and the confirm pattern of removing a Tenant (`POST /tenants/:id/remove`). If Tailwind classes change, run `npm run css` and commit `src/web/static/tw.css`.
- **Pages work without JavaScript,** are keyboard reachable and don't scroll sideways at 390 px.
- **Every action is scoped to the signed-in Property Manager's Agency** (`personInAgency` and the like), as the existing actions are.
- **Migrations only add** (nullable columns, new tables). Name them after the latest in `supabase/migrations/`.
- `npm run check` passes before an issue is marked resolved.
