-- Reimbursement Requests: a Tenant's claim to be paid back for an Urgent Repair they
-- arranged. The Property Manager now reviews the receipt and forwards it to the
-- Property Owner, then marks the claim reimbursed, so an Urgent Repair keeps the
-- amount claimed and when each step happened, and a timeline of its own (Ticket
-- timelines belong to Tickets, which an Urgent Repair never becomes).
--
-- urgent_repairs.status: 'reminder_sent' | 'receipt_received' | 'receipt_forwarded' | 'reimbursed'
ALTER TABLE urgent_repairs
  ADD COLUMN IF NOT EXISTS amount_cents integer,                     -- claimed by the Tenant, confirmed by the Property Manager
  ADD COLUMN IF NOT EXISTS forwarded_at text,
  ADD COLUMN IF NOT EXISTS reimbursed_at text;

CREATE TABLE IF NOT EXISTS urgent_repair_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  urgent_repair_id bigint NOT NULL REFERENCES urgent_repairs (id),
  kind text NOT NULL,
  data text NOT NULL,
  at text NOT NULL
);

CREATE INDEX IF NOT EXISTS urgent_repair_events_by_repair ON urgent_repair_events (urgent_repair_id, at);

-- As every table (20261010000200_row_level_security.sql): shut out of Supabase's REST API.
ALTER TABLE urgent_repair_events ENABLE ROW LEVEL SECURITY;
