# One vocabulary across the app

Status: needs-triage
Priority: P3
DesignDoc: CONTEXT.md

## What's wrong now

Capitalisation is mixed: 'Check urgency' and 'Check Urgency'; 'Check trade' and 'Check Trade'. 'Over the limit' (`approvals.ts:62`) should name the Max Repair Cost. 'Agent unsure' uses a word on the avoid list. The review page's 'The report' is 'What the Tenant reported' on the Ticket page.

## Acceptance criteria

- [ ] One spelling for each term, matching CONTEXT.md.
- [ ] Tenant- and prospect-facing pages use plain sentence-case words, not glossary capitals (a rule added to `docs/design-system.md`).
