# Tokens, type and the design system doc

Status: ready-for-agent
Owner: ui-agent
Spec: ../spec.md, Part 1 "Tokens", "Type"

## Acceptance criteria

- [x] `@fontsource-variable/bricolage-grotesque` and `@fontsource-variable/public-sans` installed; Lexend and Red Hat Text packages removed.
- [x] `src/web/assets.ts` serves the two variable woff2 files; `head()` preloads them.
- [x] `app.css` `:root` holds exactly the tokens in the spec table; the daisyUI theme maps them; no literal colour elsewhere in the CSS.
- [x] `docs/design-system.md` and `.design-sync/conventions.md` describe the new tokens, type scale and rules.
