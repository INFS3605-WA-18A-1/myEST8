# Property Owner and Building Manager profiles

Status: ready-for-agent

## What's wrong

- **Owners and Building Managers can only be added, never seen or changed.** They can be added from Setup (`POST /setup/owners`, `/setup/building-managers`), but there is no list and no profile page. The side menu's Profiles group has Properties, Tradies and Tenants only.
- **That broke a real approval test.** A repair over a Property's Max Repair Cost asks the Property Owner to approve. In production, Owner "Kevin He" had a mobile but no email, SMS isn't connected, and there was nowhere in the app to add his email. (His email was added by hand in the database for now.)

Tenants, Tradies and Properties already have profiles with a pen to edit details (`editPen`, `detailsForm` in `src/web/ui.ts`, `saveDetails` in `src/web/pages/onboarding-forms.ts`, and the `editTenant`/`editTradie`/`editProperty` actions). Tradies also have Remove, with confirmation, built on `people.removed_at` (`src/profiles.ts`). Property Owners and Building Managers get the same.

## What to build

1. **Lists.** The side menu's Profiles group gains **Property Owners** (`/owners`) and **Building Managers** (`/building-managers`), in the same style as Tradies and Tenants. Each list is a table showing:
   - name (linking to the profile), mobile and email
   - Properties: for an Owner, the ones they own; for a Building Manager, the ones they look after
   - a "No way to reach" flag when the person has neither a mobile the Agency can text (SMS connected) nor an email

   Each list page also has an Add form, the same one Setup uses. Reuse it, don't copy it.
2. **Profiles.** `/owners/:id` and `/building-managers/:id`:
   - **Details block:** name, mobile and email, with the pen that edits them, exactly as the Tenant profile does. Same checks: at least one of mobile or email, formats valid, no address held by someone else. A changed mobile or email updates `contact_addresses`.
   - **Properties:** their Properties, each linking to the Property.
   - **For an Owner,** their recent approvals: the Tickets awaiting or decided, linking to them. Read how approvals are stored.
   - **Remove:** the same confirmation pattern as Remove Tradie, with `removed_at` (no migration needed). Refused while they own (Owner) or look after (Building Manager) any Property, naming them. A removed person drops out of the lists and pickers, and their mobile and email stop matching inbound messages, as for Tradies.
3. **Links in.**
   - Wherever a Property shows its Owner or Building Manager (the Property profile, the Ticket, the approval step), the name links to their profile.
   - **When an approval can't reach the Owner** (`notifications.channelFor` throws `UndeliverableError` for them), the Ticket's approval step says so before the Property Manager presses the button, for example "Kevin He can't be reached: no SMS channel is connected and they have no email address." It links to **Add an email** (their profile with `?edit=details#details`). The flash after a failed send (from `formAction`) also links there, if the flash supports a link; otherwise the step's note is enough.
4. **Docs.** `docs/design-system.md` covers the two new Profiles pages, and `CONTEXT.md` if it lists the Profiles.

## Test seams

- **Action tests:**
  - edit an Owner and a Building Manager: saved, bad input refused naming the field, another Agency's not found, the new email matched by intake
  - remove: refused while linked to a Property, and allowed once not
- **Page tests:**
  - both lists, with the "No way to reach" flag
  - both profiles, with the pen, Save, a refused save and Cancel
  - Remove, with its confirmation and its refusal
  - the Owner and Building Manager links from a Property and a Ticket
  - the approval step's "can't be reached" note and its link
- **One browser test at 390 px:** open Property Owners, open an Owner, add an email with the pen, save. No sideways scroll.

Test-first, one slice at a time, with expected values from worked examples. Never weaken an existing test. If Tailwind classes change, run `npm run css` and commit `src/web/static/tw.css`.
