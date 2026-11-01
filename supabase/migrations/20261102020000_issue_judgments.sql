-- Jev's judgment of a Maintenance Request (ADR 0018), kept so a Tenant's profile
-- asks once. minor is 0 to 1 (higher is more minor). tenant_caused is 0 to 1, the
-- probability the damage came from the Tenant's misuse or negligence. Code decides
-- what those numbers mean, and the wording never treats them as a finding.
CREATE TABLE issue_judgments (
  issue_id bigint PRIMARY KEY REFERENCES issues (id) ON DELETE CASCADE,
  minor real NOT NULL CHECK (minor >= 0 AND minor <= 1),
  tenant_caused real NOT NULL CHECK (tenant_caused >= 0 AND tenant_caused <= 1),
  model text NOT NULL,
  judged_at timestamptz NOT NULL DEFAULT now()
);

-- As every table (20261010000200_row_level_security.sql): shut out of Supabase's REST API.
ALTER TABLE issue_judgments ENABLE ROW LEVEL SECURITY;
