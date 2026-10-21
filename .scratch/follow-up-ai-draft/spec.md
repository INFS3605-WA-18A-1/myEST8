# Follow up with a Tenant, drafted by AI

A new Maintenance Request often needs a word back to the Tenant before the Property Manager can decide, for example "Is the leak still dripping? Can you turn the water off at the meter?". Today the review page (`/requests/:issueId`, `src/web/pages/requests.ts`) has no way to reply. The Property Manager now writes the gist, Claude Haiku turns it into a full message, and the Property Manager checks it, edits it if needed, and sends it.

## The flow

1. **Notes.** The review page gets a **Follow up with <Tenant first name>** panel with one field: what you want to say, in your own words, up to 1000 characters. The button is **Draft with AI**, with the `sparkle` icon.
2. **Draft.** Posting the notes asks Haiku for the message. The page shows it in an editable field, marked as AI-written: the `sparkle` icon and "Written by AI. Check it before you send." The notes stay in their field, so the Property Manager can redraft.
3. **Send.** **Send to <Tenant first name>** sends the text as it is in the field, edited or not, to the Tenant on their usual channel (the one intake would reply on). Template `tenant.follow_up`, subject "About your maintenance request". It is logged against the Maintenance Request like every other message the Tenant gets.
4. The page comes back with "Follow-up sent to <Tenant>". A Tenant's reply comes in through intake as usual.

Nothing reaches the Tenant until the Property Manager presses Send: the AI never sends on its own.

## Composing

The `Composer` port and `src/adapters/claude-composer.ts` (Claude Haiku, `claude-haiku-5-5`) are already on this branch from the `haiku-composer` branch. Call it with:
- `template: 'tenant.follow_up'`
- `purpose`: "A Property Manager following up with the Tenant about their Maintenance Request"
- `recipientRole: 'tenant'`, `channel`: the Tenant's channel, `agencyName`
- `facts`: `{ tenantName, propertyAddress, request, propertyManagerName, notes }`, where `request` is the Summary, or the Tenant's description when there is none
- `untrustedFields: ['request']`, because it holds the Tenant's words
- `draft`: the notes
- `mustInclude: []`

The adapter already tells Haiku to keep the draft's meaning and add no facts.

**When Haiku isn't there or fails:** with no `ANTHROPIC_API_KEY`, or if the call throws, the draft field is filled with the notes as written, with no AI mark. The note says "AI drafting isn't available right now. Your notes are below: edit them and send, or try again." Sending never depends on the model.

## The AI mark

`aiFilled` in `src/web/ui.ts` (used for the AI Summary) gets the same `sparkle` icon before its label. Every AI-written thing then carries one mark. The icon is decorative (`aria-hidden`), and the label text carries the meaning.

## Non-goals

- Haiku composing every outbound message (the `haiku-composer` branch's second commit). Only this follow-up is composed.
- Follow-ups from the Ticket page, or to Tradies or Property Owners.
- Saving drafts.
