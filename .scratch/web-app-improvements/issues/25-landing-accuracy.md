# Landing page says only what the app does

Status: done
Priority: P3
DesignDoc: —

## What's wrong now

The landing page claims owners approve 'with a reply or a link' (`src/web/pages/landing.ts:386`), but no owner page exists. The hero conversation doesn't match the real follow-up questions or the upload link. The workflow animation's Pause button needs JS (`:338`).

## Acceptance criteria

- [x] Remove the link claim. Property Owners approve by replying YES or NO.
- [x] Use the real questions and the upload link in the demo thread (the words `templates.ts` sends).
- [x] Nothing loops any more: the workflow animation and its Pause button are gone, replaced by entrances that run once.
