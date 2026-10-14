# Fill the tenant tracker's gaps

Status: needs-triage
Priority: P1
DesignDoc: Tenant flow 5–7, Story 14

## What's wrong now

The tracker shows 'Visit {time}' with no Tradie and no way to change it (`src/web/tenant-pages.ts:187`). 'Was it fixed properly?' is asked only by message. Stage names are unclear: 'Approved' reads as owner approval, and 'Done' then 'Closed' is redundant (`tenant-pages.ts:27-30`). Screen readers hear 'Done (Done)'.

## Acceptance criteria

- [ ] The visit shows the Tradie's business name and an 'Ask for another time' action.
- [ ] At Done, the page asks 'Was it fixed properly?' with labelled 1–5 choices.
- [ ] An Urgent Repair repeats the $1,000 limit and the Nominated Tradies.
- [ ] Stage names are in plain words, and the current status is the most prominent text.
