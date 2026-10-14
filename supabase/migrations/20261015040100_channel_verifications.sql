-- A one-time code proving a Property Manager owns an SMS, WhatsApp or email
-- address before it is stored on agency_channels. The code itself is never
-- stored, only its hash. Expand-only: nothing existing is rewritten.
CREATE TABLE channel_verifications (
  agency_id bigint NOT NULL REFERENCES agencies (id),
  channel_type text NOT NULL,
  address text NOT NULL,
  code_hash text NOT NULL,
  expires_at text NOT NULL,
  attempts bigint NOT NULL DEFAULT 0,
  confirmed_at text,
  PRIMARY KEY (agency_id, channel_type)
);

ALTER TABLE channel_verifications ENABLE ROW LEVEL SECURITY;

-- A provider's later report that an outbound message was not delivered.
ALTER TABLE messages ADD COLUMN delivery_error text;
