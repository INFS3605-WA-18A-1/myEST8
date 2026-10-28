-- Jev's judgment of how well a Tradie fits a Job (ADR 0016), kept so a page never
-- waits on Jev. evidence_key is a hash of what Jev was shown: when the Job's or the
-- Tradie's evidence changes, the key no longer matches and the Tradie is judged again.
--
-- score: 0-3, Jev's probability-weighted position on the job-fit levels.
-- confidence: 0-1, how concentrated Jev's answer was.
CREATE TABLE job_fits (
  job_id bigint NOT NULL,
  tradie_id bigint NOT NULL,
  score double precision NOT NULL,
  confidence double precision NOT NULL,
  evidence_key text NOT NULL,
  judged_at text NOT NULL,
  PRIMARY KEY (job_id, tradie_id)
);

-- As every table (20261010000200_row_level_security.sql): shut out of Supabase's REST API.
ALTER TABLE job_fits ENABLE ROW LEVEL SECURITY;

-- What a Tradie's Google listing says they do, read when they are linked to it: its
-- place types (a JSON list, like trades) and its one-line description. Null for a
-- Tradie linked before this, or not on Google. Expand-only: nothing existing is rewritten.
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS google_types text,
  ADD COLUMN IF NOT EXISTS google_summary text;
