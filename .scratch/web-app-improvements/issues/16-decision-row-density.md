# Give decision rows room to read

Status: needs-triage
Priority: P2
DesignDoc: —

## What's wrong now

Thumbnails are 48 px, against a 56 px spec. The description is one line, and badges collapse into '+N', which hides 'Check Trade' and 'No photos' (`src/web/pages/dashboard.ts` `requestRow`).

## Acceptance criteria

- [ ] 56 px thumbnails.
- [ ] Two lines of description.
- [ ] Flags wrap instead of collapsing to '+N'.
