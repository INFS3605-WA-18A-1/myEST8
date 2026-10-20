# Migration and type unions for Summary and Site Quotes

Status: ready-for-agent
Owner: database-engineer
Spec: ../spec.md, Part 2 "Data model"

## Acceptance criteria

- [ ] `supabase/migrations/20261018090000_intake_summary_and_site_quotes.sql` adds the columns listed in the spec.
- [ ] `JobStatus` includes `site_quoting`; `STAGES` and the stage labels include Site quotes.
- [ ] `Issue` carries `summary`, `summaryBy`, `photosOnArrival`; Work Order views carry `kind`.
- [ ] Repair-only Work Order queries filter `kind = 'repair'`.
