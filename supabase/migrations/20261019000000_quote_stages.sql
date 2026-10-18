-- Estimates, Site Inspections and Firm Quotes (docs/adr/0009, superseding 0007).
-- Each Quote Request moves on its own: sent -> estimated -> inspection_booked ->
-- inspected -> firm_quoted (or declined, closed). An Estimate and a Firm Quote are
-- separate rows in quotes, so a Firm Quote supersedes an Estimate without deleting
-- it. The Job-level site_quoting status goes, and Site Quote visits are Site
-- Inspections. Expand only: initial_price_cents, initial_proposed_time and
-- revised_at stay (no longer read), to be dropped later.

-- The Tradie's no-login quote page, /q/:token. The default fills existing rows,
-- and any insert that leaves it out.
ALTER TABLE quote_requests
  ADD COLUMN IF NOT EXISTS token text NOT NULL
    DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  -- The Property Manager's say on whether a Site Inspection is needed; null follows the Tradie's Estimate.
  ADD COLUMN IF NOT EXISTS inspection_override boolean;

CREATE UNIQUE INDEX IF NOT EXISTS quote_requests_token ON quote_requests (token);

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'estimate',          -- 'estimate' | 'firm'
  ADD COLUMN IF NOT EXISTS supersedes_quote_id bigint REFERENCES quotes (id), -- a Firm Quote's Estimate
  -- Estimate: whether the Tradie needs a Site Inspection first, and its Call-out Fee.
  ADD COLUMN IF NOT EXISTS needs_inspection boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS callout_fee_cents bigint,
  -- Firm Quote: the scope of work, the projected timeline in days, and the dates the Tradie can start (ISO dates).
  ADD COLUMN IF NOT EXISTS scope_of_work text,
  ADD COLUMN IF NOT EXISTS duration_days integer,
  ADD COLUMN IF NOT EXISTS available_dates jsonb,
  -- Set when the Property Manager proceeds on this Estimate: the most the Tradie may charge.
  ADD COLUMN IF NOT EXISTS not_to_exceed_cents bigint;

-- One Quote per Quote Request becomes one per stage.
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_quote_request_id_key;

-- A Quote revised after a Site Quote visit was the Tradie's firm price: it becomes the
-- Firm Quote, and its initial price becomes the Estimate it supersedes.
UPDATE quotes SET stage = 'firm' WHERE revised_at IS NOT NULL AND stage = 'estimate';

WITH estimates AS (
  INSERT INTO quotes (agency_id, job_id, ticket_id, quote_request_id, tradie_id, trade, price_cents, proposed_time,
                      confirmed, status, pdf_file_id, received_at, stage, needs_inspection)
  SELECT f.agency_id, f.job_id, f.ticket_id, f.quote_request_id, f.tradie_id, f.trade,
         coalesce(f.initial_price_cents, f.price_cents), f.initial_proposed_time,
         1, 'superseded', NULL, f.received_at, 'estimate', true
  FROM quotes f
  WHERE f.stage = 'firm'
    AND NOT EXISTS (SELECT 1 FROM quotes e WHERE e.quote_request_id = f.quote_request_id AND e.stage = 'estimate')
  RETURNING id, quote_request_id
)
UPDATE quotes f SET supersedes_quote_id = estimates.id, received_at = coalesce(f.revised_at, f.received_at)
FROM estimates
WHERE f.quote_request_id = estimates.quote_request_id AND f.stage = 'firm';

CREATE UNIQUE INDEX IF NOT EXISTS quotes_request_stage ON quotes (quote_request_id, stage);

-- Site Quote visits are Site Inspections; the Tradies who had one needed it.
UPDATE work_orders SET kind = 'inspection' WHERE kind = 'site_quote';  -- kind: 'repair' | 'inspection'

UPDATE quotes q SET needs_inspection = true
WHERE q.stage = 'estimate' AND NOT q.needs_inspection
  AND EXISTS (SELECT 1 FROM work_orders w WHERE w.quote_request_id = q.quote_request_id AND w.kind = 'inspection');

-- Where each quoted request now stands.
UPDATE quote_requests r SET status = 'firm_quoted'
WHERE r.status = 'quoted' AND EXISTS (SELECT 1 FROM quotes q WHERE q.quote_request_id = r.id AND q.stage = 'firm');

UPDATE quote_requests r SET status = 'inspection_booked'
WHERE r.status = 'quoted'
  AND EXISTS (SELECT 1 FROM work_orders w WHERE w.quote_request_id = r.id AND w.kind = 'inspection' AND w.status = 'active');

UPDATE quote_requests r SET status = 'inspected'
WHERE r.status = 'quoted'
  AND EXISTS (SELECT 1 FROM work_orders w WHERE w.quote_request_id = r.id AND w.kind = 'inspection' AND w.status = 'done');

UPDATE quote_requests SET status = 'estimated' WHERE status = 'quoted';

-- No Job-level site quoting any more: the Job stays quoting throughout.
UPDATE jobs SET status = 'quoting' WHERE status = 'site_quoting';
