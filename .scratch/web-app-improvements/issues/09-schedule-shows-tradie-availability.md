# Schedule shows when Tradies are free

Status: needs-triage
Priority: P1
DesignDoc: Feature 9, Story 12, logic rule 8

## What's wrong now

`/calendar` is seven day columns of booked visits (`src/web/pages/calendar.ts:50`), about 100 px each at 1024 px, with names cut off. It can't answer 'is this Tradie free?'. Dispatch has a separate 'Tradie schedule' (`dispatch.ts:73`). Reschedule blocks link to the plain Ticket, not to the suggested times (`ticket.ts` `?suggest=`).

## Acceptance criteria

- [ ] Schedule shows Tradie rows against days (merging Dispatch's Tradie schedule), with free and booked time visible.
- [ ] 'Reschedule requested' links to the Ticket's suggested times.
- [ ] Mine/All and a Trade filter.
- [ ] Empty days fold into one line on phones.
- [ ] One name across the nav, URL and copy.
