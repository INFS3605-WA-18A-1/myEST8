# Site Quotes for High Jobs

Status: ready-for-agent
Owner: backend-engineer
Spec: ../spec.md, Part 2 "Site Quotes", "Templates"

## Acceptance criteria

- [x] `bookSiteQuotes`, `siteQuoteSlots`, `skipSiteQuotes`, `markSiteQuoteDone`, `markQuotesFinal` exist and are exposed on `asPropertyManager`.
- [x] Site Quote visits are `work_orders` with `kind = 'site_quote'`; they appear on the calendar and in `isFree`, never as the Job's repair visit.
- [x] Tradie DONE on a Site Quote visit marks the visit done, not the Job.
- [x] Choosing a Quote cancels the other Tradies' Site Quote visits.
- [x] Templates `tenant.site_quotes`, `tradie.site_quote`, `tradie.site_quote_reminder` exist; the tracker shows `site_visit`.
