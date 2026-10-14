# Landing page says only what the app does

Status: needs-triage
Priority: P3
DesignDoc: —

## What's wrong now

The landing page claims owners approve 'with a reply or a link' (`src/web/pages/landing.ts:386`), but no owner page exists. The hero conversation doesn't match the real follow-up questions or the upload link. The workflow animation's Pause button needs JS (`:338`).

## Acceptance criteria

- [ ] Remove the link claim.
- [ ] Use the real questions and the upload link in the demo thread.
- [ ] The animation is paused by default without JS, or has a CSS-only pause.
