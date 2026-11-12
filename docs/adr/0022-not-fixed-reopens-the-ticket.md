# A "not fixed" report reopens the Ticket with a Redo Job

When a Tradie marks a Job done, the Tenant is asked to rate the fix. Before this, a Tenant who wrote back that it wasn't fixed was handled as any message. A low rating was stored as a score and nothing else. "Still dripping" while the Ticket was open was logged unread, or got the "we've got your message" reply meant for new reports. And once the Ticket was closed, it was no longer offered to the classifier, so the same problem came in as a new Maintenance Request: a second Ticket for one issue.

We decided that a report that finished work isn't fixed belongs to the Ticket it is about. It waits in the Inbox with the reason **Not fixed**, with the message logged unread on that Ticket and a reply to the Tenant that their Property Manager will arrange for it to be looked at again. One press in the Inbox, or **Not fixed? Redo the work** on the Ticket page, adds a **Redo Job**: the done Job's Trade, on the same Ticket, starting at quoting, with `jobs.rework_of` naming the Job it redoes. A closed Ticket is reopened first (a `reopened` event, `closed_at` cleared). Closing it again later tells the Tenant and the Owner about every done Job, the redo included.

How a report is recognised:

- A fix rating of 1 or 2.
- A message the classifier reads as the new `not_fixed` kind, about a done Job or a Ticket with one.
- A repeat report (`new_issue` about an open item) of a Ticket whose Jobs are all done or cancelled, or a Ticket closed less than 60 days ago (`REWORK_WINDOW_DAYS`). Closed Tickets in that window and done Jobs are now offered to the classifier as items.

Edge cases:

- **A Job on the Ticket is still under way** (a redo already added, or other work): the message is logged unread on the Ticket and nothing waits in the Inbox. Redo is refused while a Job is under way.
- **A Not fixed for the same Job already waits**: the new message is logged unread on the Ticket, with no second Inbox item and no second reply.
- **"Not fixed" before any Job is done**: an ordinary update on the Ticket.
- **Urgent or a safety risk** ("the pipe burst"): the Urgent Repair path, as for a new report. The law lets the Tenant arrange an Urgent Repair, and Urgent Repairs never become Tickets.
- **A Ticket closed more than 60 days ago**: not offered, so the problem is a new issue. The Ticket page's redo has no time limit, as the Property Manager decides there.
- **Any other message about a closed Ticket** ("thanks!"): it waits in the Inbox as "About a closed Ticket" rather than unread on a Ticket nobody works.

We did not send the redo to the original Tradie automatically. Whether it is their callback at no charge or a job for someone else is the Property Manager's call, made through the usual Quote Requests on the redo Job.
