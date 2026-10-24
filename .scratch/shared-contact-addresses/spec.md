# Let one email or mobile belong to several people

Status: ready-for-agent

## What's wrong

The Property Manager can't give a Property Owner the email they choose. Adding or editing a person refuses any email or mobile that someone else in the Agency already has: `addAddress` in `src/profiles.ts` says "… already belongs to someone else", because `contact_addresses` allows each address only once per Agency (its primary key is `(agency_id, address)`).

That blocks demos and real life alike. One person often plays several parts with a single inbox: a landlord who is also a Tenant elsewhere, or a demo presenter who is Tenant, Owner and Tradie with one or two inboxes. In production, Owner "Kevin He" was stuck on a placeholder email he doesn't read, because his real inbox already belonged to his Tenant record.

## What to build

1. **Accept an address someone else has.** Adding and editing a Tenant, Property Owner, Building Manager or Tradie accepts any valid mobile or email, even if another person in the Agency already uses it. The person's own `email` and `mobile` are always what was entered. Other checks stay: format, at least one of the two, a removed person's address no longer matching. The Property Manager account rule (`emailTaken`, for sign-in accounts) is unchanged.
   - On the profile, a quiet note under a shared address says who else uses it, for example "Also Kevin He (Tenant)", linked. That's so the Property Manager knows replies are shared.
2. **Who sent a message from a shared address.** `findByAddress` (`src/profiles.ts`) becomes a lookup that returns **every active (not removed) person** an address belongs to. It looks at each person's own `email`/`mobile` and at `contact_addresses`, which keeps the addresses linked from the inbox; no migration, `contact_addresses` keeps its key. With one match, nothing changes. With several, intake (`src/intake.ts`, where it calls `findByAddress`) picks the sender in this order:
   1. **Someone is waiting for this person's reply** (`pending_answers` for one of them, such as an Owner's approval or a Tenant's missing details): that person. If several are waiting, the one asked most recently.
   2. **Otherwise one of them is a Tenant with a Property** (Tenants are the ones who start conversations, by reporting a repair): that Tenant.
   3. **Otherwise** the message goes to the Inbox with a new reason, `shared_address`, listing the people it could be, so the Property Manager uses **Pick a contact**. Read how `toInbox` and the reasons work, and add the wording for the Inbox card.
3. **Replies to approvals work from a shared inbox.** A Property Owner who shares an inbox with a Tenant replies "YES" to an over-cap approval request, and the approval is recorded as approved by the Owner.

## Test seams

- **Action tests:**
  - adding an Owner with a Tenant's email succeeds and both keep it
  - editing a Tradie to an Owner's mobile succeeds
  - a removed person's address doesn't match
  - the Property Manager account check still refuses a taken sign-in email
- **Intake scenarios** (`test/support/harness.ts`):
  - an Owner and a Tenant share an inbox, and the Owner replies YES to their approval request: approval recorded
  - from the same shared inbox with nothing pending, a new repair report starts a Maintenance Request for the Tenant
  - two non-Tenants share an address with nothing pending: the message goes to the Inbox with `shared_address` and both candidates
  - a single-owner address behaves exactly as before
- **Page tests:**
  - Add a Property Owner with an email the Tenant has: saved, no refusal
  - the "Also …" note on both profiles
  - the Inbox card for `shared_address`

Existing tests that asserted "already belongs to someone else" for people change to assert the new behaviour. Say which in the report: the rule itself has changed, so this isn't weakening a test. Everything else must pass unchanged. Test-first, one slice at a time, with expected values from worked examples. Update `CONTEXT.md` if it defines how a sender is identified, and `docs/design-system.md` for the note and the Inbox card.
