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
The owner of a Property. Must approve Quotes when a Ticket's Repair Cost would go over the Property's Max Repair Cost.
_Avoid_: landlord, land owner

**Tradie**:
A tradesperson the Agency engages to do Jobs. Tradies are shared across the Agency's Property Managers.
_Avoid_: contractor, tradesperson

**Nominated Tradie**:
A Tradie named for a Property to carry out Urgent Repairs.
_Avoid_: emergency tradie, preferred tradie

**Building Manager**:
The person who organises repairs to Common Areas together with the strata. Not part of the Agency.

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
A Tradie's fixed price for a defined scope of work, with a projected timeline and the dates they can start. Binding once accepted. It supersedes the same Tradie's Estimate, which stays on record.
_Avoid_: final quote, formal quote

**Not-to-exceed Cap**:
The most a Tradie may charge when the Property Manager proceeds on an Estimate for a cheap routine Job instead of waiting for a Firm Quote.
_Avoid_: limit, ceiling

**Work Order**:
The confirmation sent to the chosen Tradie that authorises them to do a Job.
_Avoid_: notice of work confirmation, job confirmation

**Repair Cost**:
The total of the approved Quotes across a Ticket's Jobs: each Firm Quote's price, or the Not-to-exceed Cap where the Property Manager proceeded on an Estimate.
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
