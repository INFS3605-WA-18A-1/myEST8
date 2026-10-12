# Security review of no-login links and privacy of photos

Status: needs-triage

## Goal

Review the two no-login pages and the data they collect. The user deferred this until after the MVP (spec Out of Scope).

## What exists

- Upload and tracker links carry a 24-byte random token (`newToken` in `src/shared.ts`); there is no expiry beyond the issue's status, and no rate limit.
- Uploads are validated for count (10), size (10 MB each) and type in `src/intake.ts`.
- Photos, receipts and PDFs are stored as blobs in SQLite (`src/files.ts`); photo GPS metadata stays in the stored file.
- Attachments sent by SMS or WhatsApp go to Twilio as `GET /media/:id?expires=&signature=` links (`src/file-links.ts`): HMAC-SHA256 with `FILE_LINK_SECRET` over the file id and expiry, valid for one hour, served with `no-store`, `nosniff` and a sandboxing CSP. Anyone holding a live link can fetch the file, GPS metadata included.

## To review

- [ ] Token expiry and revocation for upload and tracker links.
- [ ] Rate limiting and abuse protection on `POST /u/:token` and `GET /t/:token`.
- [ ] Content checks on uploads (real image/PDF, not just the declared type).
- [ ] Retention and access to stored photos and their location metadata; whether to strip GPS after the metadata check.
- [ ] Twilio and SendGrid webhook signature checks in production configuration.

## Testing

- Depends on the decisions; HTTP tests for each control added.
