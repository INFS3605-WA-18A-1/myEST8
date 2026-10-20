# Estimates, Site Inspections and Firm Quotes

Supersedes 0007.

Quoting in Australia has up to three steps, and the price means something different at each: an Estimate from the description and photos (non-binding), an optional Site Inspection (sometimes for a Call-out Fee), then a Firm Quote (a fixed price for a defined scope, binding once accepted). One "Quote" step could not show a Tradie who needs to inspect, treated a guess like a fixed price, and could not track the fee or the visit. 0007 gated visits on the Ticket being High and booked them for every Tradie at once; real Tradies decide for themselves whether they can price a job without seeing it.

So each Quote Request moves on its own: `sent → estimated → inspection_booked → inspected → firm_quoted` (or `declined`, `closed`). The Tradie's Estimate says whether they need a Site Inspection; the Property Manager can override it. The Job stays `quoting` throughout: there is no Job-level `site_quoting` status any more.

An Estimate and a Firm Quote are separate rows in `quotes` (`stage`), so a Firm Quote supersedes an Estimate without deleting it (`supersedes_quote_id`). Choosing compares Firm Quotes only. For a cheap routine Job the Property Manager may proceed on an Estimate with a Not-to-exceed Cap instead, as long as the Tradie did not ask to inspect; the cap then counts towards the Repair Cost.

Tradies give Estimates and Firm Quotes on a no-login page at `/q/:token` linked from the Quote Request message, like the Tenant's upload page; ADR 0002 still holds (only Property Managers have accounts). A plain SMS or email reply with a price still records an Estimate (unconfirmed until the Property Manager checks it). A message can't carry a Firm Quote's scope and dates, so a price sent after the Estimate records nothing: once a Firm Quote is allowed the Tradie is sent their quote page link (before their Site Inspection, nothing is sent), and the message is left unread for the Property Manager.

Site Inspections stay Work Orders (`kind = 'inspection'`), for the reasons 0007 gave: they sit on the shared calendar, block the Tradie's slot, and take the same confirm and reschedule replies.
