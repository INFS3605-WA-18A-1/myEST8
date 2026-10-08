# Spec: Maintenance workflow MVP

Status: ready-for-agent

## Problem Statement

Property Managers in small Agencies (3–4 Property Managers, around 100 Properties between them) spend most of their day passing maintenance messages along. Tenants report issues by text, email and WhatsApp. The Property Manager then has to:

- work out who sent each message and which Property it's about
- ask for photos and judge whether the issue is real
- decide how urgent it is
- find a Tradie and chase Quotes
- ask the Property Owner for approval
- book a visit without double-booking a Tradie a colleague has already booked.

Each step happens on a different channel and is tracked only in someone's inbox or memory. This admin leaves Property Managers little time to sign new Property Owners. Slow, unclear repairs also frustrate Tenants and Property Owners.

## Solution

myEST8 is one web app that also works in mobile browsers. Only Property Managers log in. Tenants, Tradies, Property Owners and Building Managers keep using email, SMS and WhatsApp.

**Intake.** An intake agent reads every incoming message, works out who sent it and what it's about, and replies using fixed message templates. For a new issue, the agent:

1. asks a few guided questions
2. sends a link to upload photos without logging in
3. checks the photos automatically
4. ranks the Urgency
5. shows the issue to a Property Manager as a Maintenance Request, with the check results.

**Urgent issues** never become Tickets. The Tenant is reminded that they arrange Urgent Repairs themselves, using the Property's Nominated Tradies where possible, and can claim up to $1,000 back from the Property Owner. When the Tenant sends the receipt, myEST8 forwards it to the Property Owner and copies in the Property Manager.

**Tickets and Jobs.** A Maintenance Request becomes a Ticket when a Property Manager confirms it. The dashboard ranks Tickets by Urgency. For each Job, myEST8:

- proposes the Trade
- recommends Tradies
- sends Quote Requests and reads the Quotes that come back
- requires at least two Quotes before a Work Order.

**Approval and scheduling.** If a Quote would take the Repair Cost over the Property's Max Repair Cost, the Property Owner approves it by replying YES or NO. A shared calendar shows every Tradie booking across the Agency and suggests new times when a visit has to move.

**After the Job.** Status updates go to everyone on their own channel. Tenants and Property Managers follow each Ticket on a progress tracker. Ratings after each Job improve future recommendations.

## User Stories

### Setup

1. As a Property Manager, I want to sign in with my own account, so that only Agency staff can see Tenant, Property and Tradie details.
2. As a Property Manager, I want an onboarding guide that connects our SMS number, WhatsApp and email inbox step by step, so that I can set up myEST8 without technical help.
3. As a Property Manager, I want the guide to show me how to create a channel the Agency doesn't have yet, so that Tenants can reach us on all three.
4. As a Property Manager, I want each channel tested with a test message during onboarding, so that I know it works before Tenants rely on it.
5. As a Property Manager, I want to add a Property with its address, Property Owner, Tenants, tenancy start date, Max Repair Cost and Nominated Tradies, so that the agent can act for it.
6. As a Property Manager, I want to record a Building Manager's contact details on a strata Property, so that Common Area issues can be passed on.
7. As a Property Manager, I want to add the Tradies we already use, with their Trades, contact details and a starting rating, so that recommendations work from day one.
8. As a Property Manager, I want to link a Tradie to their Google listing when I add them, or mark them as not on Google, so that the right Google rating appears next to ours.
9. As a Property Manager, I want each Property assigned to one Property Manager, so that my dashboard shows my own Properties first.
10. As a Property Manager, I want to see my colleagues' Properties and Tickets when I need to, so that I can cover for them.

### Intake

11. As a Tenant, I want to report an issue by messaging on SMS, WhatsApp or email, so that I don't need an app or an account.
12. As a Tenant, I want a reply soon after I message, so that I know my report has arrived.
13. As a Property Manager, I want every incoming message matched to the Tenant, Tradie or Property Owner who sent it, so that I don't have to work out who's who.
14. As a Property Manager, I want messages from unknown numbers or addresses to land in the Agency inbox, so that nothing is lost.
15. As a Property Manager, I want to link an unknown sender to a person, so that their next message is recognised automatically.
16. As a Property Manager, I want messages that aren't about maintenance left in the inbox without a reply, so that the agent never answers things it shouldn't.
17. As a Property Manager, I want messages the agent isn't sure about sent to the inbox with its best guess, so that I can route them in one click.
18. As a Tenant, I want a follow-up about an issue I already reported added to that issue, so that I don't open a new one by accident.
19. As a Property Manager, I want a housemate's report of the same issue attached to the existing Maintenance Request or Ticket, so that I don't get duplicates.
20. As a Tenant in a strata building, I want a Common Area issue passed to the Building Manager, and to be told it was, so that I know who is handling it.
21. As a Property Manager, I want Common Area issues sent to the Building Manager without my involvement, so that they stay off my list.
22. As a Property Manager, I want a Common Area issue on a Property with no Building Manager contact to come to my inbox, so that it isn't dropped.
23. As a Property Manager, I want every message in and out logged against the issue or Ticket it belongs to, so that I can read the full history in one place.

### Guided questions and photos

24. As a Tenant, I want a few short questions about the issue, so that I can explain it without writing a long message.
25. As a Tenant, I want to give my usual availability by choosing an option, so that visits are booked when I'm home.
26. As a Tenant, I want a link to upload photos from my phone's browser, so that the photos stay clear and I don't need to log in.
27. As a Tenant, I want to upload several photos for one issue, so that I can show it from different angles.
28. As a Tenant, I want to add more photos until the Property Manager confirms the issue, so that I can send a better one if I need to.
29. As a Property Manager, I want an issue with no photos after 48 hours to reach me anyway, marked "no photos", so that nothing stalls.
30. As a Property Manager, I want each photo's metadata checked against the report, so that old or unrelated photos are flagged.
31. As a Tenant, I want photos without metadata accepted without counting against me, so that I'm not penalised for my phone's settings.
32. As a Property Manager, I want the photos checked against the description, so that I can see at a glance whether they show the reported issue.

### Confirming Maintenance Requests

33. As a Property Manager, I want a list of Maintenance Requests waiting for me, each with its description, answers, photos and check results, so that I can confirm or reject each one quickly.
34. As a Property Manager, I want to confirm a Maintenance Request in one action, which creates the Ticket, so that genuine issues move on straight away.
35. As a Property Manager, I want to reject a Maintenance Request with a reason, so that the Tenant knows why.
36. As a Tenant, I want to be told when my issue is confirmed or rejected, and why if it's rejected, so that I'm not left guessing.

### Urgency and Urgent Repairs

37. As a Property Manager, I want every reported issue ranked Urgent, High or Routine, so that the most severe repairs are handled first.
38. As a Tenant with an Urgent issue, I want an immediate reminder that I can arrange the repair myself and claim up to $1,000 back from the Property Owner, so that I'm not waiting on the Agency in an emergency.
39. As a Tenant with an Urgent issue, I want the reminder to list the Property's Nominated Tradies and their phone numbers, so that I know who to call.
40. As a Tenant, I want to send my Urgent Repair receipt to the Agency through a link or as an attachment, so that it reaches the Property Owner.
41. As a Property Owner, I want the receipt forwarded to me with the Property Manager copied in, so that I can reimburse the Tenant and the Agency has a record.
42. As a Property Manager, I want to see the Urgent Repairs reported on my Properties, even though they aren't Tickets, so that I know what happened.
43. As a Property Manager, I want to change the Urgency the agent gave, so that I can correct a wrong ranking.
44. As a Property Manager, I want issues whose Urgency the agent wasn't sure of flagged, so that I check those first.
45. As a Property Manager, I want Tickets sorted by Urgency and then by when they were reported, so that the oldest severe issue is at the top.

### Tickets and Jobs

46. As a Property Manager, I want the Trade for a Ticket's first Job proposed automatically, so that I only need to check it.
47. As a Property Manager, I want to change a Job's Trade, so that I can fix a wrong guess.
48. As a Property Manager, I want to add more Jobs to a Ticket, so that an issue needing several Trades is handled together.
49. As a Property Manager, I want to cancel a Job that's no longer needed, so that it doesn't hold the Ticket open.
50. As a Property Manager, I want to close a Ticket once all its Jobs are done or cancelled, so that my list shows only open work.
51. As a Property Manager, I want each Property's frequent issues to build up from its Ticket history, so that I can spot recurring problems.

### Recommendations and Quotes

52. As a Property Manager, I want a ranked list of recommended Tradies with the Job's Trade, so that I don't have to search my contacts.
53. As a Property Manager, I want each Tradie's myEST8 rating and Google rating shown side by side, so that I can weigh them myself.
54. As a Property Manager, I want to see a Tradie's previous Quotes for the Trade, so that I know whether they're usually good value.
55. As a Property Manager, I want to see which recommended Tradies are already booked by colleagues, so that I pick someone who's free.
56. As a Property Manager, I want to send Quote Requests to 3–4 Tradies in one action, so that quoting starts straight away.
57. As a Tradie, I want Quote Requests on SMS, WhatsApp or email describing the issue and suburb, with photos when it comes by email, so that I can quote without an account.
58. As a Tradie, I want to reply with a price and time as a message or a PDF quote, so that I can quote the way I already do.
59. As a Tradie, I want to decline a Quote Request by replying, so that I'm not chased for it.
60. As a Property Manager, I want the price and proposed time read from each reply, so that I only need to confirm them.
61. As a Property Manager, I want to correct a price or time that was read wrongly, so that the comparison is accurate.
62. As a Tradie, I want a reminder if I haven't answered a Quote Request after 48 hours, so that I don't miss it.
63. As a Property Manager, I want a prompt to invite more Tradies when a Job has fewer than two Quotes after 72 hours, so that it doesn't stall.
64. As a Property Manager, I want a Job's confirmed Quotes side by side, so that I can choose in one place.
65. As a Property Manager, I want myEST8 to stop me choosing a Quote until there are at least two, so that we keep costs down.
66. As a Property Manager, I want to go ahead with a single Quote if I record a reason, so that specialist or time-critical Jobs aren't blocked.
67. As a Tradie who wasn't chosen, I want to be told, so that I stop holding time for the Job.

### Property Owner approval

68. As a Property Owner, I want to be asked to approve only when the Repair Cost would go over the Max Repair Cost, so that I'm not asked about small Jobs.
69. As a Property Owner, I want the request to show the full Repair Cost for the Ticket, so that I know the total I'm agreeing to.
70. As a Property Owner, I want to approve by replying YES or NO, so that I don't need to log in.
71. As a Property Owner, I want a reminder after 24 hours, so that I don't hold up the repair by accident.
72. As a Property Manager, I want an alert if the Property Owner hasn't replied after 48 hours, so that I can call them.
73. As a Property Manager, I want Quotes already approved to stay approved when a later Quote needs the Property Owner, so that work under way isn't undone.
74. As a Property Manager, I want to choose another Quote when the Property Owner says NO, so that the Job can still go ahead.

### Scheduling

75. As a Property Manager, I want a shared calendar of every scheduled Job across the Agency, so that we never double-book a Tradie.
76. As a Property Manager, I want to send a Work Order with a time slot when the Tradie is free, so that the booking is made in one step.
77. As a Property Manager, I want the slot to start at the Quote's proposed time when the Tradie is free then, so that I usually don't have to pick one.
78. As a Property Manager, I want slots to be 2 hours by default and adjustable, so that bigger Jobs get enough time.
79. As a Tradie, I want the Work Order with the address, issue and visit time on my usual channel, so that I know where to be and when.
80. As a Tenant, I want the visit time and the Tradie's business name sent to me, so that I can be home and know who's coming.
81. As a Tenant, I want to confirm the visit time or ask for another, so that the visit suits me.
82. As a Tradie, I want to ask for a different time by replying, so that I can fit the Job around my other work.
83. As a Property Manager, I want suggested new times that suit the Tradie's calendar and the Tenant's availability, so that rescheduling takes one click.
84. As a Property Manager, I want to pick any other free slot myself, so that I'm not limited to the suggestions.
85. As a Tenant and as a Tradie, I want to be told when a visit moves, so that we both turn up at the new time.

### Completion and ratings

86. As a Tradie, I want to reply "done" when I finish, so that the Agency knows without a phone call.
87. As a Property Manager, I want a prompt to rate the Tradie 1–5 when a Job is done, so that recommendations improve.
88. As a Tenant, I want to answer "Was it fixed properly?" with a number from 1 to 5, so that my experience counts.
89. As a Property Manager, I want both ratings shown on the Tradie's profile and fed into their myEST8 rating, so that good Tradies rise to the top.

### Updates and the progress tracker

90. As a Tenant, Tradie or Property Owner, I want messages on the channel I last used if I messaged in the past 24 hours, and by SMS or email otherwise, so that they reach me where I am.
91. As a Property Owner, I want updates when work is booked and when the Ticket is closed, so that I know my Property is looked after.
92. As a Tenant, I want a link to a progress tracker for my Ticket, so that I can check where it's up to without messaging.
93. As a Property Manager, I want a timeline for each Ticket, so that I can answer questions about it quickly.
94. As a Property Manager, I want status updates sent automatically at each step, so that I don't have to pass messages on myself.

## Implementation Decisions

### Architecture

- **One app.** The app is deployed as a single unit with internal modules. The intake agent runs as a background worker inside the same app (ADR-0001).
- **Stack not chosen yet.** The web framework, database and hosting are still open, so this spec doesn't depend on any of them. Whatever is chosen must support:
  - a background worker
  - work scheduled for a later time
  - file storage for photos and PDFs
  - pages that work at phone width.
- **Accounts.** Only Property Managers have accounts (ADR-0002). Two pages need no login, each reached by an unguessable link for one item:
  - the upload page, used for issue photos and Urgent Repair receipts
  - the Tenant's progress tracker.
- **Agencies.** Every record belongs to one Agency. Each Property has one assigned Property Manager. The demo runs a single Agency, but nothing should assume there is only one.
- **Fast webhooks.** Inbound webhooks store the message and return straight away; the background worker processes it. Processing is idempotent on the provider's message ID, because Twilio and SendGrid retry webhooks.
- **Templates only.** Every message myEST8 sends uses a fixed template with placeholders. The agent never writes free text. The only text a person writes is the rejection reason a Property Manager types, which is inserted into the rejection template.

### Modules

ADR-0001 names five modules: intake agent, Tickets, Quotes, scheduling and notifications. Two supporting modules sit beside them: profiles and onboarding. Each module owns its data, and other modules use it only through its interface.

- **Profiles:** the Agency, its Property Managers, Properties, Tenants, Property Owners, Tradies and Building Managers.
  - **Interface:**
    - Find a person by phone number or email; this returns their role, Agency and Property.
    - Link a new address to a person.
    - List an Agency's Tradies with a given Trade.
    - Record a rating.
    - Get a Tradie's myEST8 rating.
    - Refresh a Tradie's Google rating.
    - Get a Property's frequent issues, worked out from the Trades of its past Tickets.
  - **Stored per person:**
    - Each Tenant's tenancy start date and availability.
    - Each Property's location (latitude and longitude, looked up from its address when it's saved).
- **Intake agent:** interprets each inbound message and runs the conversation with a Tenant until the issue becomes a Maintenance Request or an Urgent Repair.
  - Replies from Tradies and Property Owners are passed to the quotes and scheduling modules.
  - **Interface:** handle an inbound message; handle an upload (photos or a receipt) made through a link.
- **Tickets:** owns issues in intake, Maintenance Requests, Tickets, Jobs, Urgent Repairs, the message log and the Ticket timeline.
  - **Interface:**
    - Confirm or reject a Maintenance Request.
    - Change Urgency.
    - Set a Job's Trade.
    - Add or cancel a Job.
    - Close a Ticket.
    - The dashboard queries.
    - The timeline query, for both the Property Manager's view and the Tenant's view.
- **Quotes:** Tradie recommendation, Quote Requests, Quotes, choosing a Quote, Property Owner approval and Repair Cost.
  - **Interface:**
    - Recommend Tradies for a Job.
    - Send Quote Requests.
    - Record a Tradie's reply.
    - Confirm or edit a Quote.
    - Choose a Quote, with an optional reason when there's only one.
    - Record a Property Owner's answer.
- **Scheduling:** the shared calendar, Work Orders, reschedule suggestions and Job completion.
  - **Interface:**
    - List a Tradie's free slots.
    - Send a Work Order.
    - Record a reschedule request.
    - Suggest new times.
    - Accept a time.
    - Record a visit confirmation.
    - Mark a Job done.
    - The calendar query.
- **Notifications:** the only module that sends messages.
  - **Interface:** send a template to a person, with its data and optional attachments.
  - It chooses the channel, sends the message and logs it against the issue or Ticket.
- **Onboarding:** the channel connection guide, test messages, and the forms for Properties, people and Tradies.

### External services, each behind a port

Each external service sits behind a port (an interface owned by the app), so the provider can be swapped and tests can use fakes.

- **Inbound messages.** Twilio's messaging webhook (SMS and WhatsApp) and SendGrid Inbound Parse (email) are converted into one inbound message shape:
  - the Agency channel it arrived on
  - the channel type
  - the sender's address
  - the text
  - any attachments
  - the time it was received.

  Webhooks check the provider's request signature.
- **Messenger.** Sends text on SMS, WhatsApp or email, with attachments where the channel allows. It uses Twilio Programmable Messaging and SendGrid. Outbound email sets its reply-to address to the Inbound Parse address, so replies come back in.
- **Classifier (Jev).**
  - **Input:** a JSON state and a list of typed questions, each with a fixed set of answers.
  - **Output:** one answer per question, each with a confidence score.
  - Nothing outside the classifier port depends on Jev's details, so another classifier can replace it if early access ends.
- **Image matcher (vision-capable LLM, not chosen yet).**
  - **Input:** an issue's photos and its description.
  - **Output:** matches, doesn't match or unclear, with a one-line reason shown to the Property Manager.
- **Quote reader (model not chosen yet).**
  - **Input:** a reply's text and any PDF.
  - **Output:** a price and a proposed time, either of which may be missing.
- **Places lookup (Google Places API).** Finds candidate listings for a business, returns a listing's rating and number of reviews, and looks up the location of an address.
- **Clock.** Provides the current time. Every reminder and deadline is scheduled against it.
- **Photo metadata** is read in-process by an EXIF library, not through a port.

### How the intake agent reads a message

The agent asks the classifier once for each inbound message. The state includes:

- the sender's role
- the message text
- whether it has attachments
- the answer the agent is waiting for from this person, if any
- the open items on the sender's Property, as a short list of IDs and summaries: issues in intake, Maintenance Requests, open Tickets with their Jobs, and Urgent Repairs waiting for a receipt
- for a Tradie or a Property Owner, the items waiting on them: open Quote Requests, Work Orders and approval requests.

Open items cover the whole Property, not just the sender's own items, so a housemate's report is matched to the existing issue.

| Sender | Typed questions |
|---|---|
| Tenant | Message class (new issue, update on an existing item, Common Area issue, other); related item (one of the open items, or none); Urgency (Urgent, High, Routine); Trade (the 8 Trades); update type (general update, reschedule request, visit confirmed, receipt); the answer the agent is waiting for, if any |
| Tradie | Reply type (Quote, decline, reschedule request, Job done, other); related item (one of the items waiting on them) |
| Property Owner | Reply type (approval answer, other); answer (YES, NO); related item (one of the approval requests waiting on them) |

The answer the agent is waiting for is typed to fit the question asked: yes or no, an availability option, 1–5, or confirm/reschedule.

**What happens next:**

- **Tenant, new issue, not Urgent:** the agent asks the guided questions one at a time:
  1. Where in the Property is the issue?
  2. When did it start?
  3. Is it getting worse?
  4. When are you usually home: weekday mornings, weekday afternoons, Saturdays, or any time?

  Then it sends the upload link. Urgency and Trade are classified again once the answers are in.
- **Tenant, new issue, Urgent** (from the first message or after the answers): an Urgent Repair is recorded and no Ticket is created. The reminder template includes:
  - the $1,000 limit
  - the Property's Nominated Tradies with their phone numbers
  - a link to upload the receipt.

  Receipts sent as email or WhatsApp attachments are accepted too. The receipt is forwarded to the Property Owner, by email when they have one, with the Property Manager copied in.
- **Tenant, update:** the message is attached to the related item and handled by its update type:
  - a reschedule request goes to scheduling
  - a visit confirmation is recorded
  - a receipt goes to its Urgent Repair
  - a general update is logged and marked unread for the Property Manager.
- **Tenant, Common Area issue:** the message is forwarded to the Property's Building Manager and the Tenant is told. If the Property has no Building Manager, the message goes to the inbox.
- **Other, or unknown sender:** the message goes to the Agency inbox and gets no reply.
- **Tradie or Property Owner reply:** goes to the quotes or scheduling module, matched to the related item.
- **Low confidence.** The threshold is 0.7 by default and adjustable.
  - Below it on message class, reply type or related item: the message goes to the inbox with the agent's best guesses, and the Property Manager routes it in one click.
  - Below it on Urgency: the issue is treated as High and flagged "check urgency".
  - Below it on Trade: the Trade is still proposed, with a flag.

### Lifecycles

- **From issue to Ticket:**
  1. Gathering details
  2. Waiting for photos
  3. Checking
  4. Maintenance Request, waiting for a Property Manager
  5. Confirmed, which creates a Ticket with its first Job, or Rejected

  If no photos arrive within 48 hours, the issue moves on marked "no photos". A Property Manager who changes the Urgency to Urgent closes the issue the same way as the Urgent path.
- **Urgent Repair:**
  1. Reminder sent
  2. Receipt received
  3. Receipt forwarded
- **Ticket:** Open, then Closed. A Property Manager closes a Ticket once every Job is done or cancelled.
- **Job:**
  1. Quoting
  2. Quote chosen
  3. Waiting for the Property Owner (only when needed)
  4. Approved
  5. Scheduled
  6. Done

  A Job can be cancelled from any of these steps before Done.
- **Quote Request:**
  1. Sent
  2. Reminded, at 48 hours
  3. Quoted or Declined

  If a Job has fewer than two confirmed Quotes 72 hours after the first Quote Requests, the Property Manager is prompted to invite more Tradies.
- **Property Owner approval:**
  1. Requested
  2. Reminded, at 24 hours
  3. Property Manager alerted, at 48 hours
  4. Approved or Declined

### Photo checks

- **Metadata check.** Each photo gets one of three results: OK, Flagged with a reason, or No metadata. A photo is flagged only when its metadata contradicts the report:
  - it was taken before the tenancy began
  - it was taken more than 14 days before the report (adjustable)
  - its GPS position is more than 1 km from the Property (adjustable).

  No metadata never counts against the photo.
- **Image match.** The image matcher runs once per issue, on all its photos, after the Tenant finishes uploading. It runs again if more photos are added before the Property Manager confirms.

### Recommendations, Quotes and approval

- **Recommendations.** Only the Agency's Tradies with the Job's Trade are recommended, ranked by:
  1. myEST8 rating, highest first
  2. Google rating, highest first
  3. median of their previous confirmed Quotes for that Trade, lowest first, with Tradies who haven't quoted for it last.

  The two ratings are always shown separately, never combined. Each recommended Tradie's existing bookings are shown from the calendar.
- **myEST8 rating.** The average of the starting rating, every Property Manager rating and every Tenant answer to "Was it fixed properly?", shown with the number of ratings.
- **Quote Requests.** The first round goes to 3–4 Tradies; more can be invited later. Each Quote Request includes the Trade, Urgency, issue description and suburb, with photos attached when it's sent by email. The full address is given only in the Work Order. A Tenant's contact details are never sent to a Tradie.
- **Reading Quotes.** The quote reader turns each Tradie reply into an unconfirmed Quote. It counts toward the minimum of two only after a Property Manager confirms or edits it. PDFs are stored with the Quote.
- **Choosing a Quote.** A Property Manager can choose a Quote once a Job has at least two confirmed Quotes. With only one, they must record a reason.
- **Approval check.** The Repair Cost is the total of a Ticket's approved Quotes. When a Quote is chosen, myEST8 checks whether the current Repair Cost plus this Quote would exceed the Max Repair Cost:
  - **If it would:** the Property Owner gets an approval request showing the Property, the Job, this Quote's price, the full Repair Cost including it, and the Max Repair Cost.
  - **If it wouldn't:** the Quote is approved straight away.
- **After an answer.** NO declines that Quote, and the Property Manager can choose another. Quotes already approved are never reopened. Once a Quote is approved, the Tradies who weren't chosen are told.

### Scheduling

- **Free slots.** A Tradie is free for a slot when none of their Work Orders in the Agency overlap it. The calendar only knows about bookings made in myEST8.
- **Work Orders.** A Work Order slot is 2 hours long by default. It starts at the Quote's proposed time if the Tradie is free then; otherwise the Property Manager picks a start time.
  - **To the Tradie:** the address, the issue and the visit time.
  - **To the Tenant:** the visit time, the Trade and the Tradie's business name.
- **Availability windows:**
  - weekday mornings: 8:00–12:00
  - weekday afternoons: 12:00–17:00
  - Saturdays: 8:00–17:00
  - any time: all three.
- **Reschedule suggestions.** Up to three slots within the next 14 days that:
  - are as long as the Work Order's slot
  - start on the hour
  - are free for the Tradie
  - fall inside the Tenant's availability.

  The Property Manager accepts a suggestion or picks another free slot. The Tradie and the Tenant are both told about the new time.
- **Job done.** A Tradie's "done" reply marks the Job done. The Property Manager is then prompted to rate the Tradie, and the Tenant is asked "Was it fixed properly?" (reply 1–5).

### Notifications

- **Choosing the channel:** if the person has messaged in the past 24 hours, use the channel they last used. Otherwise use SMS, or email if they have no mobile number. So WhatsApp is only used inside its 24-hour reply window, and the sandbox's 3 preset templates are never needed.
- **Templates:**
  - **Tenant:**
    - acknowledgement
    - guided questions
    - upload link
    - Urgent Repair reminder
    - Common Area passed on
    - confirmed with a tracker link
    - rejected with a reason
    - visit time
    - visit moved
    - "Was it fixed properly?"
    - Ticket closed
  - **Tradie:**
    - Quote Request
    - Quote reminder
    - not chosen
    - Work Order
    - visit moved
  - **Property Owner:**
    - approval request
    - approval reminder
    - work booked
    - Ticket closed
    - Urgent Repair receipt
  - **Building Manager:** Common Area issue
  - **Onboarding:** test message
- **Alerts on the dashboard** (not messages): Quote prompts at 72 hours, Property Owner no reply at 48 hours, and ratings due.

### Dashboard and progress tracker

- **Property Manager dashboard:**
  - Maintenance Requests waiting for confirmation
  - Tickets sorted by Urgency (High before Routine), then by when they were reported, filtered to "mine" or "all"
  - Urgent Repairs
  - the Agency inbox: unknown senders, Other, messages the agent wasn't sure about, and Common Area issues without a Building Manager
  - alerts
  - the shared calendar.
- **Ticket view:**
  - Jobs
  - recommended Tradies
  - the side-by-side Quote comparison
  - approval status
  - the Work Order
  - the timeline
  - the message log.
- **Tenant's progress tracker:** shows the stages Reported, Confirmed, Getting quotes, Approved, Booked (with the date), Done and Closed. It never shows prices, Quotes or Tradie ratings.

## Testing Decisions

### Which seam (to confirm)

Tests use one seam: the app's own boundary. Tests drive the app through four inputs:

- an inbound message, in the common inbound message shape
- an upload through a link
- a Property Manager action
- moving the clock forward.

Tests check two outputs:

- the messages sent, as recorded by a fake messenger (recipient, channel, template and data)
- what the Property Manager's dashboard and the Tenant's progress tracker show.

The messenger, classifier, image matcher, quote reader, Places lookup and clock are replaced by fakes:

- The fake classifier returns scripted answers and confidence scores for each message.
- The clock fake can be moved forward so the reminder and deadline tests run instantly.
- The real EXIF library runs against fixture photos: one with current metadata, one with none, one taken before the tenancy, and one geotagged far from the Property.

### What a good test looks like

A good test describes a scenario the way a person would see it: "a Tenant texts about a leaking tap, answers the questions, uploads two photos, and the Property Manager sees a Maintenance Request with clean checks." It asserts only on messages sent and on what the screens show. It never checks database rows, calls between modules, or the shape of the requests sent to Jev, so the modules can be restructured without rewriting tests.

### Modules covered

Every module is tested through scenarios at that seam rather than one module at a time. Scenarios to cover:

- **Intake:**
  - a Routine issue from first message to Ticket
  - an Urgent issue, including forwarding the receipt
  - a Common Area issue, with and without a Building Manager
  - an unknown sender, and linking them to a person
  - a housemate's duplicate report
  - a low-confidence message
  - the 48-hour "no photos" timeout
- **Photo checks:** each metadata flag, and no metadata.
- **Quotes:**
  - the recommendation order
  - the 48-hour reminder and 72-hour prompt
  - the two-Quote minimum, and going ahead with one Quote and a reason
  - a Tradie declining
- **Property Owner approval:**
  - under the limit
  - over the limit, answered YES and answered NO
  - the 24-hour reminder and 48-hour alert
  - earlier approved Quotes staying approved
- **Scheduling:**
  - a double-booking blocked across two Property Managers
  - a reschedule request from the Tradie and from the Tenant
  - suggestions that respect the Tenant's availability
- **Completion:** "done", both ratings, and the effect on the next recommendation.
- **Notifications:** the 24-hour channel rule for WhatsApp, SMS and email, and a person with no mobile number.
- **Closing:** closing a Ticket when its Jobs are done or cancelled.

### Adapters

Each inbound adapter gets a small set of tests that turn recorded Twilio and SendGrid webhook payloads into the common inbound message shape. These are the only tests below the main seam. Real providers are never called in automated tests; a manual demo checklist covers the Twilio sandbox and Jev.

### Prior art

There's no code in the repo yet. The first scenario, a Routine issue from first message to Ticket, sets up the test harness and fakes that every later test reuses.

## Out of Scope

- **Secondary features 13–21 from the design doc:**
  - FAQ page and FAQ chatbot
  - Tradie sign-up and Tradie calendar
  - direct Tenant–Tradie connection
  - Tenant check-ins and regular checks
  - weekly quests and Tenant Score
  - voice.
- Accounts for anyone other than Property Managers.
- Following up Common Area repairs after they've been passed to the Building Manager.
- Arranging Urgent Repairs for the Tenant, or paying or tracking reimbursements. myEST8 only forwards the receipt.
- A production WhatsApp sender and templates. The MVP uses the Twilio sandbox.
- Security review of the no-login links, and privacy of stored photos and location metadata. The user deferred both until after the MVP.
- iMessage and Apple Messages for Business.
- Native mobile apps.
- Bulk import of Properties, Tenants or Tradies.
- Messages written freely by the agent. Every message uses a template.
- Choosing the framework, database, hosting, vision-capable LLM or quote-reading model. This spec is written against ports so those choices can be made separately.

## Further Notes

- **Seams not yet confirmed with the user.** The single-seam testing approach above was not checked with the user before publishing. Confirm it before implementation starts.
- **Defaults chosen in this spec, not in the design discussion.** Change any that are wrong before building:
  - confidence threshold of 0.7
  - metadata flags at 14 days and 1 km
  - the 48-hour "no photos" timeout
  - the four availability windows
  - three suggestions within 14 days
  - recommendation order: myEST8 rating, then Google rating, then median Quote
  - myEST8 rating as a simple average that includes the starting rating
  - Job cancellation
  - the "not chosen" message to Tradies
  - the receipt upload link
  - giving Tradies the suburb in Quote Requests and the full address only in Work Orders
  - never sending Tenant contact details to Tradies.
- **NSW law.** The Urgent Repair flow follows the user's decision. NSW rules let Tenants arrange urgent repairs themselves only when they can't reach the landlord or agent, or the repair isn't done in reasonable time. This is listed in the design doc's next steps.
- **Jev access.** Jev has been in limited early access since 15 September 2026. The classifier port lets another model take over if access or usage limits change during the build.
- **Photo metadata.** Phone browsers may strip metadata from uploads. Test this early. The metadata check only advises the Property Manager, so missing metadata never blocks an issue.
- **ADR-0002.** It names only the upload link as a no-login exception. The Tenant's progress tracker link is the same kind of exception and should be added to the ADR.
- **Related documents:** the design document, the implementation document, the domain glossary (CONTEXT), and ADRs 0001–0003.
