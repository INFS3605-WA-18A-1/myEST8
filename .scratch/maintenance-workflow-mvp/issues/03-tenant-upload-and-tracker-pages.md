# Tenant no-login pages: upload page and progress tracker

Status: ready-for-agent

## Goal

The two pages Tenants reach by link without logging in (ADR-0002): the upload page for issue photos and Urgent Repair receipts, and the Tenant's progress tracker. Both work at phone width.

## What exists

- `app.upload(token, files)` (`src/app.ts`, `src/intake.ts`) accepts photos for an issue or a receipt for an Urgent Repair, validates count, size and type, and refuses expired links.
- `app.tracker(token)` (`src/tickets.ts` `tracker`) returns the stages Reported, Confirmed, Getting quotes, Approved, Booked (with the visit time), Done and Closed. It never includes prices, Quotes or Tradie ratings.
- Links are `${baseUrl}/u/<token>` and `${baseUrl}/t/<token>` (templates `tenant.upload_link`, `tenant.urgent_repair_reminder`, `tenant.confirmed`).
- The HTTP layer (`src/http.ts`) exposes `POST /u/:token` and `GET /t/:token` as JSON.

## Acceptance criteria

- [ ] `GET /u/:token` serves an HTML form that uploads several photos (or a receipt photo/PDF) from the phone's camera or gallery to `POST /u/:token`, and shows success, "link expired" and validation errors.
- [ ] Photos can be added again until the Property Manager confirms or rejects the issue.
- [ ] `GET /t/:token` serves an HTML tracker showing each stage, reached or not, with the Booked visit time in the Agency's time zone.
- [ ] Both pages work at 360px width, need no JavaScript framework, and are accessible.
- [ ] Early check (spec Further Notes): upload a photo from iOS Safari and Android Chrome and record whether EXIF date and GPS survive. Missing metadata is accepted either way.

## Testing

- HTTP tests: the upload form posts files that reach `app.upload`; an unknown token returns 404; the tracker page contains no price.
- Manual demo checklist for real phones.
