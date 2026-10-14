# Shell consistency

Status: needs-triage
Priority: P3
DesignDoc: —

## What's wrong now

Mine/All is missing on Schedule, Properties and Tradies. Its aria-label is 'Views' (`src/web/ui.ts` `segmented`). Long titles (Property addresses) are cut off on phones. Setup has no way back to Settings.

## Acceptance criteria

- [ ] Mine/All on every list page.
- [ ] The control is labelled 'Show Tickets for'.
- [ ] The top bar title wraps to two lines on phones.
- [ ] Setup gets a back link to Settings.
