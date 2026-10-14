# Settings works in place

Status: needs-triage
Priority: P2
DesignDoc: PM flow 1

## What's wrong now

Every Settings tab sends you to `/setup#…` or the full-page wizard (`src/web/pages/settings.ts:27-30,81,95`). The Agency tab is read-only. Gmail's `needs_reconnect` state isn't shown.

## Acceptance criteria

- [ ] Editable Agency tab (name, time zone).
- [ ] Channels shows each channel's state, with Reconnect for Gmail.
- [ ] Setup's sections move into Settings tabs, and `/setup` redirects (the design system's phase 2).
