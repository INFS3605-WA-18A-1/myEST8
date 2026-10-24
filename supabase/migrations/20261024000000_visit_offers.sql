-- A Tradie's offer of 2 or 3 visit times, for the Tenant to pick one. Added beside
-- Work Orders: offering times does not book anything, and picking one does.
--
-- status: 'offered' | 'picked' | 'none_fit' | 'superseded'
-- starts: 2 or 3 ISO instants. picked_start is one of them, once the Tenant chooses.
CREATE TABLE visit_offers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id bigint NOT NULL,
  job_id bigint NOT NULL,
  ticket_id bigint NOT NULL,
  tradie_id bigint NOT NULL,
  round bigint NOT NULL,
  starts jsonb NOT NULL,
  duration_minutes bigint NOT NULL,
  status text NOT NULL,
  picked_start text,
  tenant_note text,
  token text NOT NULL UNIQUE,
  created_at text NOT NULL,
  answered_at text
);

CREATE INDEX visit_offers_by_job ON visit_offers (job_id, round);

-- As every table (20261010000200_row_level_security.sql): shut out of Supabase's REST API.
ALTER TABLE visit_offers ENABLE ROW LEVEL SECURITY;
