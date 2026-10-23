# Photos open in a viewer, and links stay in the same tab

Status: ready-for-agent

## What's wrong

- **Photos open new tabs.** Clicking a photo on a Ticket or a Maintenance Request opens the full image in a new tab, because `photoGrid` in `src/web/ui.ts` links each photo with `target="_blank"`. With several photos, that's a tab per photo and no way to step through them.
- **Other links decide for the user too.** These open a new tab on their own (`git grep 'target="_blank"' -- src/web`):
  - links inside messages (`src/web/messages.ts`)
  - links in plain text (`linkify` in `src/web/ui.ts`)
  - a Tradie's website on the listing card (`src/web/pages/onboarding-forms.ts`)
  - receipt and quote files (`src/web/pages/reimbursement.ts`)
  - the Twilio help links (`src/web/pages/sms-number.ts`)

  The Property Manager wants everything to stay in one tab, unless *they* choose to open a link in a new one (middle-click, Ctrl/Cmd-click, or the context menu, which every normal link already allows).

## What to build

### 1. No link opens a new tab by itself
- Remove `target="_blank"` from every link in `src/web`, and the "(opens in a new tab)" / "(opens full size in a new tab)" hints that went with it.
- Keep `rel="noopener noreferrer"` on external links: it does no harm and covers someone opening them in a new tab.
- A test fails if any page's HTML contains `target="_blank"`. Render the main Property Manager pages through `webWorld` and check their HTML, or grep the rendered output.

### 2. A photo viewer
Clicking a photo in any `photoGrid` opens a viewer over the page.
- **The overlay:** the page dims behind a tinted backdrop: Night (`--ink`, `#13212E`) at about 85 % opacity, using the design system's tokens. The photo is shown as large as fits, kept in proportion, with its caption (the existing `figcaption`: when it was taken, flags) under it.
- **Moving between photos:** with more than one photo in that grid, there are **left and right arrow buttons** at the sides (`caret-left` / `caret-right` Phosphor icons, white on a translucent circle, at least 44 px) and a counter ("2 of 5"). The arrows wrap from the last photo to the first. With one photo there are no arrows and no counter.
- **Closing:** a Close button (`x` icon) at the top right, Esc, or clicking the backdrop. Focus returns to the photo that opened the viewer.
- **Keyboard:** ← and → move between photos, Esc closes, and Tab stays inside the viewer. Build it on a `<dialog>` with `showModal()`, which gives the focus trap and Esc for free. The dialog has an accessible name ("Photo 2 of 5"), and the arrow buttons are labelled "Previous photo" and "Next photo".
- **Phones:** swiping left and right also moves between photos. It's optional, but small with pointer events. The controls never cover the photo's middle, and the page doesn't scroll behind the viewer.
- **No animation** under `prefers-reduced-motion`; otherwise at most a short fade.
- **Without JavaScript:** a photo is still a normal link to its full image, opening **in the same tab** (the browser's Back returns). `src/web/static/app.js` enhances every `photoGrid` it finds (mark the grid with a `data-` attribute) and builds the viewer with DOM calls and `textContent`, never `innerHTML`, as the rest of `app.js` does.
- One viewer for the whole app: it works on every page that uses `photoGrid` (the Ticket, the Maintenance Request review, Archive, and wherever else `grep -rn photoGrid src/web` shows).
- `docs/design-system.md` gets a "Photo viewer" entry, and the photo grid's description changes.

## Test seams

- **Page tests** (`test/web/`): the photo links have no `target`, the grid carries the viewer's `data-` attribute, and no Property Manager page renders `target="_blank"`.
- **One browser test** (`test/e2e/`, Playwright on the demo) on a Ticket or Maintenance Request with several photos:
  - clicking a photo opens the viewer with "1 of N"
  - Next and → reach photo 2, and the arrows wrap
  - Esc closes it and focus returns to the photo
  - no new page or tab was opened (`context.pages().length` unchanged)
  - one with a single photo has no arrows
  - at 390 px the controls fit and the page doesn't scroll sideways

Test-first, one slice at a time, with expected values from worked examples. Never weaken an existing test. If Tailwind classes change, run `npm run css` and commit `src/web/static/tw.css`.

## Non-goals

- Zooming or panning inside a photo, downloading, or deleting photos from the viewer.
