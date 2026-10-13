-- An Agency's connected mailbox (Gmail for now, ADR 0004): myEST8 reads new mail
-- from it and sends as it. The refresh token is encrypted by the app
-- (AES-256-GCM with TOKEN_ENCRYPTION_KEY) before it is stored.
CREATE TABLE mailbox_connections (
  agency_id bigint PRIMARY KEY REFERENCES agencies (id),
  provider text NOT NULL,
  address text NOT NULL,
  refresh_token text NOT NULL,
  -- Gmail's history id: new mail is read from here on.
  history_id text,
  -- 'connected', or 'reconnect' when the provider refused the token.
  status text NOT NULL DEFAULT 'connected',
  connected_at text NOT NULL,
  checked_at text
);

ALTER TABLE mailbox_connections ENABLE ROW LEVEL SECURITY;
