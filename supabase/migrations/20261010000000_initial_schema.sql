-- myEST8's schema, ported from the CREATE TABLE IF NOT EXISTS statements each
-- module used to run on SQLite (issue 14). The same shapes, in Postgres types:
--
--   INTEGER PRIMARY KEY  -> bigint generated always as identity
--   INTEGER              -> bigint (read back as JS numbers; 0/1 flags stay 0/1)
--   REAL                 -> double precision
--   BLOB                 -> bytea (photos, receipts and PDF Quotes stay in the database)
--   TEXT                 -> text. Times stay ISO 8601 UTC text ("2026-10-08T09:00:00.000Z"),
--                           written by the app, compared and sorted as text as before.
--                           JSON values (trades, attachments, payloads) stay JSON text.
--
-- Unqualified names, so the same file builds the public schema in production
-- and a schema per test locally. Apply with the Supabase CLI to hosted
-- databases (`supabase db push --db-url "$SUPABASE_DB_URL"`); locally, tests,
-- `npm run dev` and CI apply it with src/migrate.ts.

-- Profiles: the Agency, its channels, Property Managers, people and Properties.
CREATE TABLE agencies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  time_zone text NOT NULL
);

CREATE TABLE agency_channels (
  agency_id bigint NOT NULL REFERENCES agencies (id),
  channel_type text NOT NULL,
  address text NOT NULL,
  tested_at text,
  PRIMARY KEY (channel_type, address)
);

CREATE TABLE property_managers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id bigint NOT NULL REFERENCES agencies (id),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text
);

CREATE TABLE people (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id bigint NOT NULL REFERENCES agencies (id),
  role text NOT NULL,
  name text NOT NULL,
  business_name text,
  mobile text,
  email text,
  property_id bigint,
  tenancy_start text,
  availability text,
  trades text NOT NULL DEFAULT '[]',
  starting_rating double precision,
  google_place_id text,
  google_rating double precision,
  google_review_count bigint,
  last_inbound_channel text,
  last_inbound_address text,
  last_inbound_at text
);

CREATE TABLE contact_addresses (
  agency_id bigint NOT NULL,
  address text NOT NULL,
  person_id bigint NOT NULL REFERENCES people (id),
  PRIMARY KEY (agency_id, address)
);

CREATE TABLE properties (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id bigint NOT NULL REFERENCES agencies (id),
  property_manager_id bigint NOT NULL REFERENCES property_managers (id),
  address text NOT NULL,
  suburb text NOT NULL,
  lat double precision,
  lng double precision,
  owner_id bigint NOT NULL REFERENCES people (id),
  max_repair_cost_cents bigint NOT NULL,
  building_manager_id bigint REFERENCES people (id)
);

CREATE TABLE nominated_tradies (
  property_id bigint NOT NULL REFERENCES properties (id),
  tradie_id bigint NOT NULL REFERENCES people (id),
  PRIMARY KEY (property_id, tradie_id)
);

CREATE TABLE ratings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tradie_id bigint NOT NULL REFERENCES people (id),
  source text NOT NULL,
  score bigint NOT NULL,
  job_id bigint NOT NULL,
  at text NOT NULL,
  UNIQUE (job_id, source)
);

-- Files: photos, receipts, PDF Quotes and message attachments.
CREATE TABLE files (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id bigint NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  content bytea NOT NULL,
  created_at text NOT NULL
);

-- Tickets: issues in intake, Tickets, Jobs, Urgent Repairs, the timeline and the message log.
CREATE TABLE issues (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id bigint NOT NULL,
  property_id bigint NOT NULL,
  tenant_id bigint NOT NULL,
  status text NOT NULL,
  description text NOT NULL,
  location text,
  started text,
  worsening text,
  availability text,
  urgency text NOT NULL,
  check_urgency bigint NOT NULL DEFAULT 0,
  trade text NOT NULL,
  check_trade bigint NOT NULL DEFAULT 0,
  no_photos bigint NOT NULL DEFAULT 0,
  image_match text,
  image_match_reason text,
  photos_token text NOT NULL UNIQUE,
  reported_at text NOT NULL,
  rejected_reason text
);

CREATE TABLE photos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  issue_id bigint NOT NULL REFERENCES issues (id),
  file_id bigint NOT NULL,
  metadata text NOT NULL,
  reasons text NOT NULL,
  uploaded_at text NOT NULL
);

CREATE TABLE tickets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id bigint NOT NULL,
  issue_id bigint NOT NULL UNIQUE REFERENCES issues (id),
  property_id bigint NOT NULL,
  tenant_id bigint NOT NULL,
  status text NOT NULL,
  urgency text NOT NULL,
  check_urgency bigint NOT NULL,
  reported_at text NOT NULL,
  tracker_token text NOT NULL UNIQUE,
  closed_at text
);

CREATE TABLE jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id bigint NOT NULL,
  ticket_id bigint NOT NULL REFERENCES tickets (id),
  trade text NOT NULL,
  check_trade bigint NOT NULL DEFAULT 0,
  status text NOT NULL
);

CREATE TABLE urgent_repairs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id bigint NOT NULL,
  issue_id bigint NOT NULL UNIQUE REFERENCES issues (id),
  property_id bigint NOT NULL,
  tenant_id bigint NOT NULL,
  status text NOT NULL,
  receipt_token text NOT NULL UNIQUE,
  created_at text NOT NULL
);

CREATE TABLE urgent_repair_receipts (
  urgent_repair_id bigint NOT NULL REFERENCES urgent_repairs (id),
  file_id bigint NOT NULL
);

CREATE TABLE timeline (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id bigint NOT NULL REFERENCES tickets (id),
  kind text NOT NULL,
  data text NOT NULL,
  at text NOT NULL
);

CREATE TABLE messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id bigint NOT NULL,
  direction text NOT NULL,
  person_id bigint,
  channel_type text NOT NULL,
  address text NOT NULL,
  template text,
  text text NOT NULL,
  issue_id bigint,
  files text NOT NULL,
  unread bigint NOT NULL DEFAULT 0,
  at text NOT NULL
);

-- Intake: inbound messages, questions waiting for an answer, and the inbox.
CREATE TABLE inbound_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_message_id text NOT NULL UNIQUE,
  agency_id bigint NOT NULL,
  channel_type text NOT NULL,
  sender text NOT NULL,
  text text NOT NULL,
  attachments text NOT NULL,
  received_at text NOT NULL,
  processed bigint NOT NULL DEFAULT 0
);

CREATE TABLE pending_answers (
  person_id bigint NOT NULL,
  kind text NOT NULL,
  awaiting text NOT NULL,
  asked_at text NOT NULL,
  -- Insertion order, kept when a question is asked again (SQLite's rowid): the tie-break for asked_at.
  seq bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY (person_id, kind)
);

CREATE TABLE inbox_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id bigint NOT NULL,
  inbound_id bigint NOT NULL REFERENCES inbound_messages (id),
  message_id bigint NOT NULL,
  person_id bigint,
  reason text NOT NULL,
  best_guess text,
  status text NOT NULL DEFAULT 'open',
  at text NOT NULL
);

-- Quotes: Quote Requests, Quotes and Property Owner approvals.
CREATE TABLE quote_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id bigint NOT NULL,
  job_id bigint NOT NULL,
  ticket_id bigint NOT NULL,
  tradie_id bigint NOT NULL,
  status text NOT NULL,
  sent_at text NOT NULL,
  UNIQUE (job_id, tradie_id)
);

CREATE TABLE quotes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id bigint NOT NULL,
  job_id bigint NOT NULL,
  ticket_id bigint NOT NULL,
  quote_request_id bigint NOT NULL UNIQUE REFERENCES quote_requests (id),
  tradie_id bigint NOT NULL,
  trade text NOT NULL,
  price_cents bigint,
  proposed_time text,
  confirmed bigint NOT NULL DEFAULT 0,
  status text NOT NULL,
  pdf_file_id bigint,
  single_quote_reason text,
  received_at text NOT NULL
);

CREATE TABLE approvals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id bigint NOT NULL,
  quote_id bigint NOT NULL REFERENCES quotes (id),
  job_id bigint NOT NULL,
  ticket_id bigint NOT NULL,
  owner_id bigint NOT NULL,
  status text NOT NULL,
  requested_at text NOT NULL,
  answered_at text
);

-- Scheduling: Work Orders on the shared calendar. "end" is quoted: it's a keyword in Postgres.
CREATE TABLE work_orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id bigint NOT NULL,
  job_id bigint NOT NULL,
  ticket_id bigint NOT NULL,
  tradie_id bigint NOT NULL,
  start text NOT NULL,
  "end" text NOT NULL,
  status text NOT NULL,
  visit_confirmed bigint NOT NULL DEFAULT 0,
  reschedule_requested_by text
);

CREATE INDEX work_orders_by_tradie ON work_orders (agency_id, tradie_id, start);

-- Spreadsheet imports waiting for review.
CREATE TABLE imports (
  token text PRIMARY KEY,
  agency_id bigint NOT NULL REFERENCES agencies (id),
  property_manager_id bigint NOT NULL REFERENCES property_managers (id),
  state text NOT NULL,
  expires_at text NOT NULL
);

-- Property Manager sign-in sessions (only the token's hash is stored).
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  property_manager_id bigint NOT NULL REFERENCES property_managers (id),
  created_at text NOT NULL,
  expires_at text NOT NULL
);

-- The background worker's tasks.
CREATE TABLE tasks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL,
  payload text NOT NULL,
  run_at text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts bigint NOT NULL DEFAULT 0,
  last_error text
);

CREATE INDEX tasks_due ON tasks (status, run_at, id);
