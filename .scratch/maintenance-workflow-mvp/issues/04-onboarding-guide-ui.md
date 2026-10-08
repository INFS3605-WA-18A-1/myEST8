# Onboarding guide UI

Status: ready-for-agent
Blocked by: 01

## Goal

Stories 2–8. A step-by-step guide that connects the Agency's SMS number, WhatsApp and email inbox, shows how to create a channel the Agency doesn't have, tests each channel, and collects Properties, people and Tradies.

## What exists

- `src/onboarding.ts` (via `app.asPropertyManager`): `connectChannel`, `sendTestMessage` (template `onboarding.test_message`, marks the channel tested), `addOwner`, `addBuildingManager`, `addTenant`, `addTradie` (Google listing or "not on Google", starting rating 1–5, Trades from the fixed list), `addProperty` (Property Owner, assigned Property Manager, Max Repair Cost, Nominated Tradies, optional Building Manager; location geocoded on save), `findGoogleListings`.
- Validation lives in `src/onboarding.ts` and `src/profiles.ts` and raises `ActionError`.

## Acceptance criteria

- [ ] Guide pages for each channel: Twilio SMS number, Twilio WhatsApp sandbox (production sender noted as later), SendGrid Inbound Parse with the Agency inbox forwarding to it.
- [ ] For a missing channel, the guide explains how to create it before connecting.
- [ ] Each connected channel can send a test message; the guide shows which channels are tested.
- [ ] Forms for Property Owners, Building Managers, Tenants (tenancy start date), Tradies (with Google listing search or "not on Google") and Properties.
- [ ] Forms show `ActionError` messages next to the fields and work at phone width.

## Testing

- Scenario tests already seed through these actions (`test/support/world.ts`). Add HTTP form tests; the real channels are covered by the manual demo checklist.
