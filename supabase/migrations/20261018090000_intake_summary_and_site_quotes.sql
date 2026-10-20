-- The AI Summary of a Maintenance Request, photos that came with the first message,
-- Site Quote visits on the shared calendar, and a Quote's initial price kept once a
-- Tradie revises it after their visit (docs/adr/0007, docs/adr/0008).
ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS summary_by text,                            -- 'ai' | 'property_manager'
  ADD COLUMN IF NOT EXISTS photos_on_arrival integer NOT NULL DEFAULT 0;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'repair',       -- 'repair' | 'site_quote'
  ADD COLUMN IF NOT EXISTS quote_request_id bigint REFERENCES quote_requests(id);

CREATE INDEX IF NOT EXISTS work_orders_job_kind ON work_orders (job_id, kind);

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS initial_price_cents integer,
  ADD COLUMN IF NOT EXISTS initial_proposed_time text,
  ADD COLUMN IF NOT EXISTS revised_at text;
