# Sign-in errors and recovery

Status: needs-triage
Priority: P3
DesignDoc: —

## What's wrong now

There is no forgot-password path (`src/web/auth.ts:182-202`). A failed sign-in only sets a flash, with no `aria-invalid` and no focus move. Sign-in shows the new-user 'What happens next' panel.

## Acceptance criteria

- [ ] Add a 'Forgot password' path.
- [ ] Failed fields get `aria-invalid`, and focus moves to the error.
- [ ] The onboarding panel shows on sign-up only.
