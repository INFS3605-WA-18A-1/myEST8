# Image matcher adapter

Status: needs-info

## Goal

A real `ImageMatcher` (`src/ports.ts`): given an issue's photos and description, return matches, doesn't match or unclear with a one-line reason shown to the Property Manager.

## What exists

- `src/intake.ts` runs the matcher once per upload batch on all the issue's photos (task `intake.match_photos`) and stores the result on the issue; the dashboard shows it.
- Tests use `FakeImageMatcher`.

## Open question

- Which vision-capable LLM to use (spec Out of Scope: not chosen yet), and its cost per issue.

## Acceptance criteria

- [ ] Adapter sends the photos and description and parses one of the three results plus a short reason.
- [ ] Any reply it can't parse becomes `unclear`.
- [ ] Errors are thrown so the worker retries.
- [ ] The reason is shown as data only; it is never sent to a Tenant.

## Testing

- Adapter tests with recorded responses and a stubbed `fetch`; manual demo checklist with real photos.
