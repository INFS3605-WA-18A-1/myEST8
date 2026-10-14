# Tenant pages name the Agency and Property

Status: needs-triage
Priority: P1
DesignDoc: Tenant flow 3–5

## What's wrong now

The upload (`/u/:token`) and tracker (`/t/:token`) pages show only the myEST8 logo (`src/web/ui.ts` `publicPage`). `tracker()` returns no Agency name or address (`src/tickets.ts:726-730`). A Tenant who messaged 'Harbour Realty' lands on a page from an unknown brand.

## Acceptance criteria

- [ ] Both pages show 'Harbour Realty' (the Agency's name) in the bar and the Property's street under the title.
- [ ] The upload page says which issue the link is for and shows photos already sent.
