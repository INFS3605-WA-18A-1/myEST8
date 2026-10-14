# Web app improvements

Status: needs-triage

## Why

An audit of every page (October 2026) against the DesignDoc (`.claude/worktrees/agent-a22b57f263f6dd079/DesignDoc.md`, sections 2–5) and `docs/design-system.md`. The app has the right places and the right tokens, but several DesignDoc features are missing or buried, and some pages put the wrong thing first. The dashboard's Ticket board and the collapsible rail were fixed alongside this audit; everything below is still open.

## Principles

- **Put the decision first.** Each page leads with what the Property Manager decides next (choose a Quote, confirm a request, book a visit), and Wattle marks only that.
- **Read order follows the work.** What the issue is, then where, then its status, as the dashboard dockets now do.
- **DesignDoc rules are visible in the UI.** Urgency-then-time ranking, at least two Quotes compared side by side, 3–4 recommended Tradies, both ratings never combined, full repair cost on owner approvals.
- **Outsiders get plain words and the Agency's name.** Tenant pages are the only pages outsiders see.
- **Phones never scroll sideways.** Wide tables stack.

## Issues

| # | Priority | Issue | DesignDoc |
|---|---|---|---|
| 01 | P1 | [Compare Quotes side by side](issues/01-quote-comparison-table.md) | Story 10, logic rule 6 |
| 02 | P1 | [Recommend 3–4 Tradies per Job](issues/02-recommend-three-to-four-tradies.md) | Story 10, logic rule 5 |
| 03 | P1 | [Rank Maintenance Requests by Urgency, then submission time](issues/03-rank-requests-by-urgency.md) | Story 9, logic rule 3 |
| 04 | P1 | [Put the Ticket's progress tracker at the top](issues/04-ticket-progress-tracker-first.md) | Feature 12 |
| 05 | P1 | [Show check results where the decision is made](issues/05-check-results-on-queues.md) | Story 8, logic rule 2 |
| 06 | P1 | [Tenant pages name the Agency and Property](issues/06-tenant-pages-name-the-agency.md) | Tenant flow 3–5 |
| 07 | P1 | [Fill the tenant tracker's gaps](issues/07-tenant-tracker-gaps.md) | Tenant flow 5–7, Story 14 |
| 08 | P1 | [Owner reminder shows the full repair cost](issues/08-owner-reminder-full-cost.md) | Logic rule 7 |
| 09 | P1 | [Schedule shows when Tradies are free](issues/09-schedule-shows-tradie-availability.md) | Feature 9, Story 12, logic rule 8 |
| 10 | P1 | [Channel guide in plain words](issues/10-channel-guide-plain-words.md) | Story 6 |
| 11 | P2 | [Lead the Ticket header with the next action](issues/11-ticket-header-next-action.md) | PM flow 3–8 |
| 12 | P2 | [Show Quote Requests while quoting](issues/12-quote-requests-visible.md) | Logic rule 6 |
| 13 | P2 | [Make alerts and approvals actionable](issues/13-actionable-alerts.md) | Stories 11, 14 |
| 14 | P2 | [Remove repetition below the dashboard fold](issues/14-dashboard-no-repetition.md) | — |
| 15 | P2 | [Make Dispatch lists actionable](issues/15-dispatch-actionable.md) | Logic rule 5 |
| 16 | P2 | [Give decision rows room to read](issues/16-decision-row-density.md) | — |
| 17 | P2 | [Property profile around its Tickets and Max Repair Cost](issues/17-property-profile.md) | Feature 5 |
| 18 | P2 | [Tradie profile with history and both ratings](issues/18-tradie-profile.md) | Feature 5, 11 |
| 19 | P2 | [Settings works in place](issues/19-settings-in-place.md) | PM flow 1 |
| 20 | P3 | [One vocabulary across the app](issues/20-vocabulary-pass.md) | CONTEXT.md |
| 21 | P3 | [Stack wide tables on phones](issues/21-tables-stack-on-phones.md) | — |
| 22 | P3 | [Sign-in errors and recovery](issues/22-sign-in-polish.md) | — |
| 23 | P3 | [Upload page feedback](issues/23-upload-page-feedback.md) | Story 7 |
| 24 | P3 | [Tenant pages without the Tailwind runtime](issues/24-tenant-pages-without-tailwind-runtime.md) | — |
| 25 | P3 | [Landing page says only what the app does](issues/25-landing-accuracy.md) | — |
| 26 | P3 | [One query for the board's facts](issues/26-dashboard-board-query.md) | — |
| 27 | P3 | [Shell consistency](issues/27-shell-consistency.md) | — |
