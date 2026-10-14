# Recommend 3–4 Tradies per Job

Status: needs-triage
Priority: P1
DesignDoc: Story 10, logic rule 5

## What's wrong now

`recommend()` returns every Tradie with the Trade (`src/quotes.ts:133-158`), and the Ticket page lists them all (`ticket.ts:571`), with only three pre-ticked (`:569`). Nominated Tradies and distance are ignored, even though Dispatch already works out the nearest Tradies (`src/web/pages/dispatch.ts:125`).

## Acceptance criteria

- [ ] At most 4 Tradies are recommended per Job, ranked by myEST8 rating, Google rating and previous Quotes.
- [ ] The property's Nominated Tradies and distance within `TRADIE_SEARCH_RADIUS_KM` feed the ranking.
- [ ] A 'Show all Tradies with this Trade' link lists the rest.
