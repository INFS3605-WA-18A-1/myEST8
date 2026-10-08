# Property Manager sign-in and sessions

Status: ready-for-agent

## Goal

Stories 1, 9, 10. Only Property Managers have accounts (ADR-0002). A Property Manager signs in with their own account, sees their own Properties first, and can see colleagues' Properties and Tickets when covering.

## What exists

- `src/app.ts` `asPropertyManager(propertyManagerId)` returns every Property Manager action, already scoped to the Property Manager's Agency (records from another Agency are not found).
- `src/views.ts` `dashboard(..., filter: 'mine' | 'all')` already filters by the Properties assigned to the Property Manager.
- `src/profiles.ts` stores Property Managers (`property_managers`: name, email, agency). No credentials or sessions yet.
- No HTTP routes expose Property Manager actions. They must not exist until this issue is done.

## Acceptance criteria

- [ ] A Property Manager signs in with their own account (email plus a credential or magic link) and signs out.
- [ ] Sessions are server-side or signed, expire, and are invalidated on sign-out.
- [ ] Every Property Manager HTTP route resolves the signed-in Property Manager and calls `app.asPropertyManager(id)`; unauthenticated requests get 401 and never reach a module.
- [ ] Credentials are stored hashed with a standard algorithm; sign-in is rate limited.
- [ ] Adding a Property Manager to an Agency stays an admin/setup step (`app.setup.addPropertyManager`).

## Testing

- Scenario tests at the app boundary are unchanged; auth is tested at the HTTP layer: signed-in requests reach the dashboard, signed-out requests get 401, a Property Manager can't act on another Agency's records.
