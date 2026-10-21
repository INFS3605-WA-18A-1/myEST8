# The follow-up panel on the Maintenance Request review page

Status: resolved
Blocked by: 01
Spec: ../spec.md

## What to build

The flow in the spec, on `/requests/:issueId` (`src/web/pages/requests.ts`), using `draftFollowUp` and `sendFollowUp` from issue 01.

- **Routes:** `POST /requests/:issueId/follow-up/draft` and `POST /requests/:issueId/follow-up/send`. Follow the page's existing pattern for posts (`formAction`, flash, redirect). The draft step needs to show the draft, so it re-renders the page with the notes and the draft rather than redirecting.
- **Where the panel goes:** with the review's other actions. Read the page's layout comment at the top of the file. It goes beside Decide from 1024px and under the Summary on a phone.
- **The AI mark:** the `sparkle` icon (`icon('sparkle')`) with "Written by AI. Check it before you send." Reuse `aiFilled` if it fits. Either way, add the `sparkle` icon to `aiFilled`'s label in `src/web/ui.ts`, so the AI Summary carries it too.
- **The fallback note** from the spec when the draft isn't by AI.
- **Docs:** follow `docs/design-system.md` and add the follow-up panel and the AI mark to it. If Tailwind classes change, run `npm run css` and commit `src/web/static/tw.css`.

## Acceptance criteria

- [x] Page tests (`test/web/`):
  - the panel shows on a request in intake, with the Tenant's first name
  - drafting shows the editable draft with the sparkle and the AI note
  - a failed draft shows the notes and the fallback note, with no AI mark
  - sending flashes "Follow-up sent to …" and the Tenant got the message
  - blank notes or text are refused with the field error
  - the AI Summary label now has the sparkle
- [x] An e2e test (`test/e2e/`) in the demo: open a Maintenance Request, write notes, draft, edit, send, and see the message in the phone simulator.
- [x] Works at 390px with no sideways scroll, and by keyboard alone.
- [x] `npm run check` passes.
