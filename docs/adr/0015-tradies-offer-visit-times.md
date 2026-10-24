# Tradies offer visit times, Tenants pick

Amends the scheduling part of [ADR 0009](0009-estimates-inspections-and-firm-quotes.md). After a Quote was approved, the Property Manager picked the visit time and sent the Work Order. The Tenant heard the time only once it was fixed, and could reply YES or ask for another time in their own words. That request was recorded and then waited for someone to notice it.

The chosen Tradie now offers two or three times on their quote page (`/q/:token`), seeing when the Tenant is usually home. The Tenant picks one from the message or on `/v/:token`. Opening a link never books a visit; pressing Book does. The Work Order goes out at that time, already confirmed, and the Tradie, the Property Owner and the Tenant are told. If none of the times work, the Tenant says when they are usually home, with an optional note, and the Tradie is asked to offer again.

A booked repair stays booked until a new time is picked. "Need another time?" on the booked message and on the tracker starts that round, and so does a Tradie asking for another time. Picking a new time moves the existing visit. The Property Manager can still book from the Ticket or from Dispatch at any point, and that booking supersedes an open offer. The Ticket can also ask the Tradie to offer times by hand, which is how a visit already waiting on a new time continues.

If the Tradie has not offered within 24 hours they are reminded, and at 48 hours the Property Manager sees an alert. The same two steps apply when the Tenant has not picked.

Site Inspections stay booked by the Property Manager. There is no calendar sync and no Tradie app.
