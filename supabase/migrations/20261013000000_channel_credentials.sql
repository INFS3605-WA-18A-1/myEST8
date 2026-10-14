-- Per-Agency credentials for a channel connected through the provider's own
-- sign-in (Gmail by OAuth), kept apart from agency_channels so reconnecting an
-- address never drops them and the page-facing channel list never holds a secret.
-- `secret` is the refresh token encrypted with CHANNEL_SECRET_KEY (src/channel-secrets.ts),
-- `data` is non-secret JSON (the connected address), `cursor` is where polling is up to
-- (Gmail's historyId), `status` is 'ok' or 'needs_reconnect'.
-- Rollback: DROP TABLE channel_credentials. Nothing else reads it.
CREATE TABLE channel_credentials (
  agency_id bigint NOT NULL REFERENCES agencies (id),
  channel_type text NOT NULL,
  provider text NOT NULL,
  secret bytea,
  data text NOT NULL DEFAULT '{}',
  cursor text,
  status text NOT NULL DEFAULT 'ok',
  updated_at text NOT NULL,
  PRIMARY KEY (agency_id, channel_type)
);

ALTER TABLE channel_credentials ENABLE ROW LEVEL SECURITY;
