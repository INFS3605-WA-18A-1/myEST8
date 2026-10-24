# Tradies offer visit times, Tenants pick

Amends the scheduling part of [ADR 0009](0009-estimates-inspections-and-firm-quotes.md). After a Quote was approved, the Property Manager picked the visit time and sent the Work Order. The Tenant heard the time only once it was fixed, and could reply YES or ask for another time in their own words. That request was recorded and then waited for someone to notice it.

The chosen Tradie now offers a preferred time and up to two more on their quote page (`/q/:token`), seeing when the Tenant is usually home. The preferred time is the first of the times stored on the offer. The Tenant picks one from the message or on `/v/:token`. Opening a link never books a visit; pressing Book does. The Work Order goes out at that time, already confirmed, and the Tradie, the Property Owner and the Tenant are told. If none of the times work, the Tenant says when they are usually home, with an optional note, and the Tradie is asked to offer again.

A booked repair stays booked until a new time is picked. "Need another time?" on the booked message and on the tracker starts that round, and so does a Tradie asking for another time. Picking a new time moves the existing visit. The Property Manager can still book from the Ticket or from Dispatch at any point, and that booking supersedes an open offer. The Ticket can also ask the Tradie to offer times by hand, which is how a visit already waiting on a new time continues.

If the Tradie has not offered within 24 hours they are reminded, and at 48 hours the Property Manager sees an alert. The same two steps apply when the Tenant has not picked.

When the Property Manager books or moves a visit, the Tenant's message names the time and has two links: confirm it, or ask for another. Confirming is a page of its own (`/v/confirm/:token`); opening it changes nothing, and pressing Confirm records the confirmation. Replying YES still confirms. "Need another time?" starts a new offer round for a repair, and the existing reschedule for a Site Inspection. The Ticket can resend the current visit email to the Tenant or the Tradie; the worker sends it again and logs it, and does nothing once the visit is cancelled or done.

Site Inspections stay booked by the Property Manager. There is no calendar sync and no Tradie app.
