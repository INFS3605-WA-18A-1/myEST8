# A pen button to edit a Tenant's, Property's or Tradie's details

Status: ready-for-agent
Spec: ../spec.md

## What's wrong

The profile pages (`/tenants/:id`, `/properties/:id`, `/tradies/:id`) show a person's or Property's details, such as name, mobile, email and address, but nothing can change them after they're added. A mistyped mobile means texts go nowhere.

## What to build

- **The pen.** On each profile, the details block (the contact card for a Tenant or Tradie, the details card for a Property) gets a **pen button at its side**, the `pencil-simple` `icon-btn` the Maintenance Request's Summary uses. It is a link to `?edit=details#details` and opens the edit form in place of the displayed details, with no JavaScript. The form has **Save** and **Cancel** (Cancel links back to the plain profile). Its accessible name: "Edit details".
- **What each can edit:**
  - **Tenant:** name, mobile, email. At least one of mobile or email, as when added.
  - **Tradie:** business name, contact name, mobile, email, Trades. The Google listing and starting rating aren't edited here. The business address keeps its own existing form.
  - **Property:** address and suburb, Max Repair Cost, the Property Owner, the Property Manager, the Building Manager, and the Nominated Tradies. Use the same fields and pickers as adding a Property.
- **Rules:** the same checks as adding: `requireContact`, phone and email format, an address unique within the Agency, the Owner and Managers in this Agency.
  - Changing a mobile or email updates the contact addresses intake matches senders on (`contact_addresses`), so the next text or email from the new number reaches them. An address already held by someone else in the Agency is refused with a clear field error, as when adding.
  - **Changing a Property's address** clears its map location and geocodes the new address, the same way adding does (the `geocode` helper; a failure leaves no pin for **Look up missing addresses**).
- **Actions:** new ones in the module that owns each record (`src/profiles.ts` or `src/onboarding.ts`, matching where adding lives), exposed through `src/app.ts`, scoped to the Agency.
- **After saving:** back on the profile with "Details saved." A refused save re-renders the form with the posted values and the error under its field.

## Acceptance criteria

- [ ] Action tests for each of the three:
  - an edit is saved
  - a bad phone, a missing contact or a clashing address is refused naming the field
  - another Agency's record is not found
  - a changed mobile is what intake now matches
  - a changed Property address is geocoded again
- [ ] Page tests:
  - each profile shows the pen with "Edit details"
  - `?edit=details` shows the form filled in
  - Save shows the change with "Details saved."
  - a refused save keeps the values and shows the field error
  - Cancel returns to the plain view
- [ ] A browser test at 390 px: open a Tradie, press the pen, change the mobile, save, and see it. No sideways scroll.
- [ ] `docs/design-system.md` describes the pen-to-edit pattern on profiles.
- [ ] `npm run check` passes.
