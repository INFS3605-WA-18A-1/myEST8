# Show Quote Requests while quoting

Status: needs-triage
Priority: P2
DesignDoc: Logic rule 6

## What's wrong now

Quote Requests (sent time, declined or reminded) sit inside 'More about this Job', which starts collapsed (`src/web/pages/ticket.ts:523,534`).

## Acceptance criteria

- [ ] While a Job is quoting, its Quote Requests are listed open: Tradie, sent, status, and 'reminded' or 'no reply after 72 h: invite more'.
