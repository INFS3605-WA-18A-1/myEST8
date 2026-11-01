# UI polish: hover fills, Dispatch layout, loading and in-page navigation

Status: ready-for-agent

Found by two browser audits of production (https://myest8.vercel.app, a throwaway
Agency) and the seeded local demo, at 1440×900 and 390×844.

## 1. Hover doesn't fill the box

| Where | Cause | Fix |
| --- | --- | --- |
| Stacked tables on phones (Tickets, Properties, Owners, Approvals, Archive, Tradies) | The phone rule clears the cells' hover tint and nothing paints the row card | Paint the `tr` on hover |
| Stacked tables on wider screens | Only the cells are tinted, square inside the rounded frame | Paint the `tr`, leave cells transparent |
| Dashboard queue rows | Only the title link underlines; the card never changes | Stretch the title link over the row like stacked rows, tint the row |
| Dispatch Tradie entries (pick) | Hover changes the border only | Tint the background as well |
| Tradies trade filter chips, setup listing results | Border-only hover | Tint the background |
| Ghost buttons (Sign out, See all) | Sets daisyUI's `--btn-bg` but not `background`, so the fill is unreliable | Set `background` as `.btn-secondary` does; Sign out fills the menu's width |

## 2. Dispatch layout

- With nothing picked, the side panel is a short hint beside a 32rem map, leaving an empty band. The side column now matches the map's height and centres the hint.
- The Work Order start time defaulted to the Quote's proposed time even when that time had passed. It now falls back to the Tradie's first free slot.

## 3. Loading feedback

- A thin progress bar at the top of the window while any page or form is loading.
- A form being sent (`aria-busy`, already set by app.js) dims and shows its button as busy.

## 4. In-page navigation

A link or GET form that stays on the same page and only changes the query (Schedule Day/Week/Month, previous/next and Mine/All;
Settings tabs; Mine/All toggles; Tradie trade filters; Ticket and Archive filter bars) fetches the page and swaps `#main`'s content
instead of loading a new document. The address bar and Back/Forward follow. Page scripts are re-run on the new content. Anything else,
a failed fetch, or a page with its own script (Dispatch's map) falls back to an ordinary navigation, and pages still work without JavaScript.
