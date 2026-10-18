# Quote Requests to two or more Tradies, revised Quotes

Status: ready-for-agent
Owner: backend-engineer
Spec: ../spec.md, Part 2 "Quote Requests"

## Acceptance criteria

- [x] `recommend` returns at most four, Nominated first, with `nominated` and `preselected` flags.
- [x] `sendQuoteRequests` refuses one Tradie when two are available.
- [x] A Tradie's price during `site_quoting` revises their Quote, keeping the initial price and time.
- [x] `quotingDecision` yields `book_site_quotes` for High Jobs with two confirmed Quotes.
