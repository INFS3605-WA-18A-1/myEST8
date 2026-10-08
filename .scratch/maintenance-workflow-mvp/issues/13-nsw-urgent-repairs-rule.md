# Check the Urgent Repair flow against NSW rules

Status: ready-for-human

## Goal

Confirm the Urgent Repair flow is right for NSW before the demo (spec Further Notes; design doc next steps).

## Background

- myEST8 reminds a Tenant with an Urgent issue that they can arrange the repair themselves, using the Property's Nominated Tradies where possible, and claim up to $1,000 back from the Property Owner (`tenant.urgent_repair_reminder` in `src/templates.ts`, limit in `src/intake.ts`).
- NSW rules let Tenants arrange urgent repairs themselves only when they can't reach the landlord or agent, or the repair isn't done in reasonable time.

## Acceptance criteria

- [ ] A human checks the current NSW rules and the $1,000 limit.
- [ ] Decide whether the reminder wording or the flow changes (for example, telling the Tenant to call the Agency first during business hours).
- [ ] Any change is captured as a new issue or an ADR.
