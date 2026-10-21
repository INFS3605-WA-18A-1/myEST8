# October refresh: dashboard, schedule and addresses

Five fixes shipped together in the next release. Each issue says which branch it lands on.

| # | Issue | Branch |
|---|---|---|
| 01 | The dashboard's count strip on one line | `dashboard-week-and-kpis` |
| 02 | Pick a day in Next 7 days | `dashboard-week-and-kpis` |
| 03 | A Teams-style schedule | `schedule-teams-calendar` |
| 04 | Free today as a panel, not a dropdown | `schedule-teams-calendar` |
| 05 | Suggest a Property's address as it is typed | `nominatim-geocoding` (on top of free geocoding with Nominatim, ADR 0012) |

## Ground rules for every issue

- **Test-first, one vertical slice at a time.** Write one failing test at an agreed seam, make it pass with the least code, then do the next. Don't write all the tests up front. A test checks behaviour someone can see, never internals. Expected values come from the spec or a worked example, never recomputed the way the code does it.
- **Agreed seams.** These are the repo's existing ones. Don't add others.
  - *Page tests* (`test/web/`, through `webWorld`): the HTML a request returns, its links, forms, `aria-*` and text. They catch what the page says and links to, and miss layout.
  - *Browser tests* (`test/e2e/`, Playwright on the demo): layout, clicks and keyboard at 1366 px and 390 px. They catch overflow, wrapping and interaction, and are slower, so keep to one or two per issue.
  - *Adapter tests* (`test/adapters/`, stubbed `fetch`): the request sent to an outside API and how its answer is read (issue 05 only).
- **Design.** Follow `docs/design-system.md`: its palette (Harbour, Wattle, Paper, Slate…), type, spacing, components and vocabulary. Update it for anything you change. The look is quiet and work-focused, for Property Managers on a laptop all day. If Tailwind classes change, run `npm run css` and commit `src/web/static/tw.css`.
- **No JavaScript needed.** Every page works without it, as the rest of the app does: links and forms with query parameters. JavaScript may only enhance, as `app.js` does for searchable selects.
- **Accessibility.** Keyboard reachable, visible focus, `prefers-reduced-motion` respected, nothing that scrolls the page sideways at 390 px.
- `npm run check` passes before each issue is marked resolved.
