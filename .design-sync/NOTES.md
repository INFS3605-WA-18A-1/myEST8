# design-sync notes (claude.ai/design project "myEST8 Dispatch Desk")

## How this repo syncs (off-script: the DS is not React)
- myEST8's design system is server-rendered HTML strings (`src/web/ui.ts`, Hono `html`), styled by daisyUI 5 + `src/web/static/app.css` + Tailwind's browser build. Claude Design needs React, so `.design-sync/react/` is a small package of React wrappers that call the real ui.ts functions and inject their HTML (`src/runtime/host.tsx`). React-content props become `<ds-slot>` placeholders that children are portalled into, so they stay live.
- Build: `npm --prefix .design-sync/react ci && npm --prefix .design-sync/react run build` (cfg.buildCmd), then the converter with
  `--node-modules .design-sync/react/node_modules --entry .design-sync/react/dist/index.js --out ./ds-bundle`.
- `build.mjs` type-checks the wrappers against ui.ts (`src/parity.ts` fails if Tone/Variant/NavKey/FieldType/IconWeight drift), reads ui.ts's `TAILWIND_THEME` block from source, bundles with an esbuild shim that replaces `node:fs`/`node:module` in `src/web/icons.ts` with a map of every Phosphor regular icon + the non-regular weights the app source uses, emits per-file d.ts via `ts.transpileDeclaration`, and writes `dist/styles.css` = daisyui.css + app.css (font urls rewritten to `./fonts/`) + Tailwind utilities compiled from src/web, the wrappers and the previews.
- The bundle sets `data-theme="myest8"` on `<html>`, injects the `text/tailwindcss` theme and imports `@tailwindcss/browser` (the same runtime the app serves), so designs can use any Tailwind utility. Verified in headless Chromium: `bg-hivis`, `text-urgent`, `p-[13px]` resolve.
- Adding a ui.ts component: add `src/<group>/<Name>.tsx` (JSDoc first line = the agent's summary; group = folder), export it from `src/index.ts`, author `.design-sync/previews/<Name>.tsx`.
- AppShell/PublicShell parse `page()`/`publicPage()` output with DOMParser and keep `<body>`'s markup; they paint `var(--page)` themselves because the preview harness (and possibly design hosts) force a white body.
- `app.js` behaviours are not in the bundle: flash close button, `data-confirm` prompts, user menu outside-click, drawer toggle, share menu.
- Grading used a local helper (`.ds-sync/montage.mjs`, scratch) that crops review sheets to content; it's not part of the converter.

## Known render warns
- `[TOKENS_MISSING]` --default-transition-timing-function, --default-transition-duration, --color-black, --tw-duration, --i: Tailwind/daisyUI internals that the Tailwind runtime defines on demand. Benign.
- `[RENDER_THIN]` "rendered height 0px" on a floor card only: the wrapper root is a `display:contents` span. Authored previews wrap components in a div, so this only appears for an unauthored component.

## Findings for the app (not fixed here)
- Links inside an agency (`chat-end`, Deep Ocean) ChatBubble are invisible: `app.css` `:where(a:not(.btn)) { color: var(--action) }` matches the bubble colour. Outbound messages with links on the Ticket page are affected. The ChatBubble preview avoids links in end bubbles.

## Re-sync risks
- `TAILWIND_THEME` is read from ui.ts by regex; renaming the constant or changing its `html\`<style type="text/tailwindcss">` shape breaks the build loudly.
- The icons shim depends on icons.ts calling `readFileSync(require.resolve('@phosphor-icons/core/assets/<weight>/<file>'))`. A non-regular icon added to the app is picked up only if its call is `icon('name', { ... weight: 'x' })` with literal strings.
- Wrapper prop types duplicate ui.ts option shapes; parity.ts checks only the shared unions. A new ui.ts option won't appear in the wrapper until it's added.
- daisyui.css (1.1 MB) ships whole, as the app loads it; Tailwind runtime adds ~276 KB and the icon map ~700 KB to `_ds_bundle.js`.
- Previews and shells use realistic fixture data written by hand (Coogee addresses, names); they don't come from the app's demo data.
