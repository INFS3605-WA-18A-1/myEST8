# myEST8

Maintenance coordination for small property management agencies. Tenants raise issues through the channels they already use, and the Agency turns them into Tickets, Jobs and approved Quotes.

## Language

### People and organisations

**Agency**:
A small property management business made up of 3–4 Property Managers.
_Avoid_: company, firm

**Property Manager**:
A staff member of an Agency who manages a set of Properties.
_Avoid_: agent, manager (on its own)

**Tenant**:
A person living in a Property under its lease. Removing a Tenant ends their tenancy: they leave the Property, and their mobile and email no longer reach the Agency as them, but their profile and the Tickets they raised stay on record.
_Avoid_: resident, renter

**Property Owner**:
The owner of a Property. Must approve Quotes when a Ticket's Repair Cost would go over the Property's Max Repair Cost. Removing a Property Owner takes them out of every list and picker, and their mobile and email no longer reach the Agency as them, but their past approvals stay on record. An Owner of a Property can't be removed until that Property has another Owner.
_Avoid_: landlord, land owner

**Tradie**:
A tradesperson the Agency engages to do Jobs. Tradies are shared across the Agency's Property Managers. Removing a Tradie takes them out of every list and picker and every Property's Nominated Tradies, and their mobile and email no longer reach the Agency as them, but their past Quotes, visits and ratings stay on record. A Tradie with work in progress can't be removed: an open Quote Request, a Quote waiting on a decision, or a visit booked today or later.
_Avoid_: contractor, tradesperson

**Nominated Tradie**:
A Tradie named for a Property to carry out Urgent Repairs.
_Avoid_: emergency tradie, preferred tradie

**Building Manager**:
The person who organises repairs to Common Areas together with the strata. Not part of the Agency. Removing a Building Manager takes them out of every list and picker, and their mobile and email no longer reach the Agency as them. One who looks after a Property can't be removed until that Property names another Building Manager, or none.

### Places

**Property**:
One rentable dwelling with its own lease and owner.
_Avoid_: unit, building

**Common Area**:
A part of a strata building shared by all residents, such as a lift or foyer. Its repairs are organised by the Building Manager and strata, not the Agency.

### Work

**Maintenance Request**:
An issue a Tenant has reported that has passed the automatic checks and is waiting for a Property Manager to confirm it.
_Avoid_: draft ticket, pending ticket

**Ticket**:
A single issue raised by one Tenant, created when a Property Manager confirms its Maintenance Request. Holds one or more Jobs.
_Avoid_: case

**Urgency**:
How soon a reported issue must be dealt with: Urgent, High or Routine. Urgent issues are Urgent Repairs and never become Tickets.
_Avoid_: priority, severity

**Urgent Repair**:
A repair needed because something threatens safety, the structure, security or an essential service. The Tenant arranges it, with a Nominated Tradie where possible, and claims up to $1,000 back from the Property Owner.
_Avoid_: emergency repair

**Reimbursement Request**:
A Tenant's claim to be paid back for an Urgent Repair they arranged. It needs the job's receipt (a PDF, photo or other file). The Property Manager checks it and forwards it to the Property Owner, who reimburses the Tenant.
_Avoid_: urgent repair waiting on a receipt, receipt claim

**Job**:
The work one Tradie does under a Ticket.
_Avoid_: task

**Trade**:
The kind of work a Job needs, from a fixed list: plumbing, electrical, carpentry, roofing, appliances, locksmith, pest control, general handyman.
_Avoid_: job type, category

**Job fit**:
How closely a Tradie's past work and Google listing match a Job's repair, judged by AI on four levels: no related work, Trade only, related work, done this kind of job. One part of how recommended Tradies are ranked, shown beside the ratings and never combined into them.
_Avoid_: match score, relevance

**Summary**:
One plain-English line describing a Maintenance Request's issue, written by AI from the Tenant's words and answers and editable by the Property Manager. Never adds facts the Tenant didn't give.
_Avoid_: title, headline, AI description

**Quote Request**:
An invitation sent to a Tradie to quote for a Job. Each Tradie's Quote Request moves on its own: one Tradie may give a Firm Quote remotely while another needs a Site Inspection.

**Quote**:
A Tradie's price for a Job: an Estimate or a Firm Quote. The two are never compared as if equal.

**Estimate**:
A Tradie's ballpark price from the Tenant's description and photos. Non-binding: the final bill can legally differ. The Tradie says with it whether they need a Site Inspection before they can give a Firm Quote.
_Avoid_: initial quote, rough quote

**Site Inspection**:
A Tradie's visit to a Property to see the issue before giving a Firm Quote, sometimes for a Call-out Fee. Optional and per Tradie: routine jobs skip it.
_Avoid_: site quote, site visit (on its own), onsite quote

**Call-out Fee**:
What a Tradie charges for a Site Inspection, owed whether or not they get the Job.

**Firm Quote**:
A Tradie's fixed price for a defined scope of work, with a projected timeline and the dates and times they can start. Binding once accepted. It supersedes the same Tradie's Estimate, which stays on record. Always required before a Job can move forward; a Site Inspection may or may not be needed before one (see ADR 0016).
_Avoid_: final quote, formal quote

**Work Order**:
The confirmation sent to the chosen Tradie that authorises them to do a Job. For a repair, the Tradie offers a preferred time and up to two more, and the Tenant picks one; the Property Manager can still book or move a time, which supersedes an open offer. Every Tenant visit message has a link to confirm the time and a link to ask for another. A Site Inspection stays booked by the Property Manager.
_Avoid_: notice of work confirmation, job confirmation


**Repair Cost**:
The total of the approved Firm Quotes across a Ticket's Jobs.
_Avoid_: repair amount, total cost
**Max Repair Cost**:
The most a Ticket's Repair Cost can reach on a Property before the Property Owner must approve.
_Avoid_: spending limit, approval limit

### Tenants

**Tenant Score**:
An Agency-internal measure of a Tenant built only from verified events: Tenant-caused damage confirmed by a Tradie or Property Manager, and lease breaches a Property Manager records.
_Avoid_: tenant rating

### Channels

**Channel**:
A way people reach the Agency, and the Agency reaches them: an SMS number, an email address or WhatsApp. An Agency connects its Channels in the welcome wizard and in Settings.
_Avoid_: integration, inbox (on its own)

**Contact address**:
A mobile number or email on a person's profile. Several people in an Agency may share one. A message from it is read as the person the Agency asked most recently (a reply it is waiting on, such as an Owner's approval or a Tenant's missing details), or as the Tenant when exactly one of them has a Property and nobody was asked. Otherwise it waits in the Inbox for the Property Manager to say who sent it. A removed person's address, and a Tenant who has left, no longer match.
_Avoid_: unique email, one inbox per person

**Agency SMS number**:
The Agency's SMS Channel when its number is managed through Twilio. Tenants, Tradies and Property Owners text it, and myEST8 replies from it. It is either created by myEST8 or registered by the Agency, and an Agency has one at a time. It differs from a Channel the Agency types in, which is any address plus a verification code.
_Avoid_: Twilio number (to the Agency), virtual number, shared number

**Server SMS phone**:
The one SMS number for the server, an Android phone running textbee. Tenants text it, and myEST8 replies from it. An Agency connects it with Connect SMS. There is no verification code, because the server holds the phone. One Agency has it at a time.
_Avoid_: textbee number (to the Agency), shared number

**Created number**:
An Agency SMS number myEST8 bought on its own Twilio account. The platform pays its monthly fee, and disconnecting it releases it back to Twilio.

**Registered number**:
An Agency SMS number on the Agency's own Twilio account. myEST8 points its incoming texts at itself and stores the Agency's Account SID and Auth Token, encrypted. Disconnecting it only unlinks it: the number stays on the Agency's Twilio account.
