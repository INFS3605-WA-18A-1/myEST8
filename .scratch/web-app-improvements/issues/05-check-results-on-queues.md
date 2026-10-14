# Show check results where the decision is made

Status: needs-triage
Priority: P1
DesignDoc: Story 8, logic rule 2

## What's wrong now

The `/requests` rows drop the 'Flagged photos' flag that dashboard rows show (`src/web/pages/requests.ts:95-99`). Neither queue shows the image-match result. On the review page, Checks comes fourth and Decide last (`requests.ts:116-175`). Confirm is one click from both lists with no prompt, even for flagged requests.

## Acceptance criteria

- [ ] `/requests` rows show the same flags as the dashboard rows, plus the image-match result.
- [ ] The review page puts Checks and Decide beside the report, above Answers and Photos.
- [ ] Confirming a request with flagged photos asks first (`postButton`'s `confirm`).
