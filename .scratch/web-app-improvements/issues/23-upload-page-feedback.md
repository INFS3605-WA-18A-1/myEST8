# Upload page feedback

Status: needs-triage
Priority: P3
DesignDoc: Story 7

## What's wrong now

Nothing changes after photos are picked (`src/web/tenant-pages.ts:139-144`). PDFs are accepted, then refused (`src/intake.ts:554`). The 'expired' error has no next step.

## Acceptance criteria

- [ ] After a choice, the page shows '3 photos selected' with names.
- [ ] Photo links accept images only.
- [ ] The expired-link error tells the Tenant to reply to the message for a new link.
