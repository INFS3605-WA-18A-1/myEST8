# Site Quotes for High Jobs

A Quote given from a description and a photo is a guess. For a Routine repair the guess is good enough and the Property Manager chooses from the Initial Quotes. For a High Job the Agency gets the Tradies on site before committing: once two Initial Quotes are confirmed, the Property Manager is prompted to book Site Quotes with those Tradies, each Tradie revises their Quote after the visit, and the Property Manager chooses from the revised prices with the initial ones still showing.

The gate is the Ticket's Urgency being High. Urgent issues never reach Quotes (they are Urgent Repairs the Tenant arranges), and Routine Jobs are not worth two extra visits. The Property Manager can skip the Site Quotes on a High Job, book them on a Routine one, or mark the Quotes final before every visit is done.

Site Quote visits are Work Orders with `kind = 'site_quote'`, so they sit on the shared calendar, block the Tradie's slot, and take the same confirm and reschedule replies as a repair visit. Queries that mean "the Job's repair visit" filter `kind = 'repair'`. A Job getting Site Quotes has the status `site_quoting`; the dashboard shows it as its own lane. We considered a separate table and rejected it: the calendar and free-slot logic would have had to read two tables for the same question.
