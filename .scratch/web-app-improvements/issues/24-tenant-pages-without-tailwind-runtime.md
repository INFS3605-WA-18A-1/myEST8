# Tenant pages without the Tailwind runtime

Status: needs-triage
Priority: P3
DesignDoc: —

## What's wrong now

Every page loads the 276 KB `tailwind.js` browser runtime as a blocking script (`src/web/ui.ts` `head()`). Tenant pages lose their tracker circles and lines without it.

## Acceptance criteria

- [ ] The utilities tenant pages use live in `app.css`, and `publicPage` stops loading `tailwind.js` for tenant pages.
