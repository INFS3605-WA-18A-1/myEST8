# Photos open in a viewer, and links stay in the same tab

Status: resolved

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

## Design plan

Checked against `docs/design-system.md`. The viewer is one `<dialog class="photo-viewer">` that `app.js` builds on first use and reuses for every `photoGrid` on every page.

### Tokens

Three new tokens on `:root` (no literal colour outside that block). The rest are existing tokens.

| Token | Value | Use | Measured |
|---|---|---|---|
| `--viewer-backdrop` (new) | `rgb(19 33 46 / 0.85)` (Night, 85 %) | the dialog's fill, so the page shows dimly through | over Sand it blends to `#35404A` |
| `--viewer-control` (new) | `rgb(255 255 255 / 0.16)` | the circle behind the arrows and Close | white icon 6.4:1 on it |
| `--viewer-control-hover` (new) | `rgb(255 255 255 / 0.28)` | the same, on hover | white icon 4.6:1 (a graphic needs 3:1) |
| `--surface` | white | the icons (`caret-left`, `caret-right`, `x`, 24 px, regular) | 10.3:1 on the blended backdrop |
| `--rail-text` | `#E6EBF0` | the caption, the counter, and the focus ring | 8.6:1 on the blended backdrop |

- **Focus ring: `--rail-text`, 2px, offset 2px.** Harbour is 1.4:1 on the blended backdrop (the design system already moves the ring to `--rail-text` on Night for the rail at 2.3:1). `--rail-muted` is 4.2:1 here, under AA for 13 px text, so nothing in the viewer uses it.
- **Shadow:** none. The dialog is flat and the circles are tinted, not lifted.
- **Motion: none.** The design system allows no entrance animation, and the spec only allows "at most a short fade", so the viewer opens and changes photo at once. `prefers-reduced-motion` has nothing to remove.
- **Type:** caption Public Sans 13 px 400 (the thumbnail caption is 12 px; 13 px reads better on a large photo), counter Public Sans 14 px 600 with tabular figures (`num`). Sentence case: "2 of 5".

### Sizes

- **Dialog:** the whole viewport (`100%` of both; `100dvh` so a phone's address bar doesn't hide the footer), `max-width` and `max-height` none, no border, no radius, no shadow. Padding 16 px, 24 px from 1024 px.
- **Buttons** (Previous photo, Next photo, Close): 48 px circles (the spec's minimum is 44 px, and the design system's touch target is 44 px). Icon 24 px.
- **Photo:** as large as the room left after the chrome, never cropped, never stretched. The page sets the `--photo-ratio` property (width over height) when the image loads, and the photo is `aspect-ratio: var(--photo-ratio)`, `width: min(100%, (100dvh - 12rem) * ratio)`. So a small photo grows to fit and a big one shrinks. `12rem` is the close row, the caption and the counter row with their gaps.
- **Radius:** 4 px on the photo (the design system's radius for rows and dockets), 50 % on the buttons.
- **Counter:** "2 of 5", under the caption on a laptop, between the two arrows on a phone.
- **Page behind:** no scrolling while it is open (`html:has(dialog.photo-viewer[open])` is `overflow: hidden`), and the dialog has `overscroll-behavior: contain`.

### Layout

The dialog is a grid, so every part is in the flow: nothing floats over the photo.

1366 px: three columns (48 px arrow, photo, 48 px arrow), three rows (Close, photo, counter). The arrows sit either side of the photo, centred on it.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Night 85 %, the page dimly behind it                                    ( x ) │  Close 48, top right
│                                                                              │
│  ( ‹ )     ┌────────────────────────────────────────────────┐     ( › )     │  arrows 48
│            │                                                │               │
│            │                     the photo                  │               │  fits 1174 × 632
│            │                                                │               │
│            └────────────────────────────────────────────────┘               │
│                Mon 12 Oct, 9:00 am · Photo taken before the tenancy          │  caption, 13 px, centred
│                                    2 of 5                                    │  counter, 14 px 600
└──────────────────────────────────────────────────────────────────────────────┘
```

390 px: one column. The arrows leave the photo's sides, which would take 96 px of 358, and share the footer row with the counter, so the photo gets the full width and nothing covers its middle.

```
┌────────────────────────────┐
│                      ( x ) │  Close 48
│ ┌────────────────────────┐ │
│ │                        │ │
│ │       the photo        │ │  358 wide
│ │                        │ │
│ └────────────────────────┘ │
│ Mon 12 Oct, 9:00 am        │  caption
│                            │
│ ( ‹ )     2 of 5     ( › ) │  footer, 48
└────────────────────────────┘
```

With one photo the arrows and the counter are `hidden`; the layout is the same without them. Under 640 px the footer row is the only thing that changes.

### Behaviour and markup

- Built with `createElement`, `textContent` and `createElementNS` (the three Phosphor paths are written out once in `app.js`, as `X_ICON` is). No `innerHTML`.
- The dialog's `aria-label` is "Photo 2 of 5" and follows the photo. The counter is a polite live region, so a screen reader hears the change. Buttons are named "Previous photo", "Next photo" and "Close". The photo's `alt` is the thumbnail's.
- One click handler on the document opens the viewer for a click on `[data-photo-grid] a`, unless it is a modified click (Ctrl, Cmd, Shift, Alt, middle button), which the browser handles as a new tab or window.
- `showModal()` gives the focus trap, Esc and an inert page. A click on the dialog that isn't on a button, the photo or the caption closes it. Focus goes back to the link that opened it.
- ← and → move (wrapping), and a horizontal swipe of more than 48 px on the photo moves too (pointer events, `touch-action: pan-y` so a vertical swipe still works).
