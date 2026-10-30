# A Firm Quote is always required; Site Inspection is optional

Amends ADR 0009.

A Job can only move forward once a Firm Quote is chosen. The "proceed on an Estimate with a Not-to-exceed Cap" path is removed: an Estimate is non-binding, so it can never authorise work or count as a fixed price towards the Repair Cost. The Not-to-exceed Cap concept is retired.

The Site Inspection stays optional and per Tradie, as 0009 had it: after an Estimate the Tradie says whether they need one. A Tradie who does not need a Site Inspection goes straight from their Estimate to giving a Firm Quote — the `estimated → firm_quoted` transition without `inspection_booked → inspected` stays. The Property Manager's inspection override in `quote_requests.inspection_override` is unchanged.

Historic data (Estimate rows with a `not_to_exceed_cents` value) keeps rendering and counting towards the Repair Cost in the same way through `coalesce(not_to_exceed_cents, price_cents)`. No column is dropped; no existing Quote is recategorised.