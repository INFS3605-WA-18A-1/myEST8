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
A person living in a Property under its lease.
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
An invitation sent to a Tradie to quote for a Job.

**Quote**:
A Tradie's price and proposed time for a Job. The first one a Tradie gives, from the description and photos, is their Initial Quote; after a Site Quote the same Quote is revised and the initial price stays on record.

**Site Quote**:
A Tradie's visit to a Property to inspect the issue before giving a final Quote. Booked by the Property Manager on a High Job once Initial Quotes are in. A Job with Site Quotes booked is getting site quotes.
_Avoid_: inspection, site visit (on its own), onsite quote

**Work Order**:
The confirmation sent to the chosen Tradie that authorises them to do a Job.
_Avoid_: notice of work confirmation, job confirmation

**Repair Cost**:
The total of the approved Quotes across a Ticket's Jobs.
_Avoid_: repair amount, total cost

**Max Repair Cost**:
The most a Ticket's Repair Cost can reach on a Property before the Property Owner must approve.
_Avoid_: spending limit, approval limit

### Tenants

**Tenant Score**:
An Agency-internal measure of a Tenant built only from verified events: Tenant-caused damage confirmed by a Tradie or Property Manager, and lease breaches a Property Manager records.
_Avoid_: tenant rating
