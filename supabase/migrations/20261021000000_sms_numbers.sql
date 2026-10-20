-- An Agency's own SMS number on Twilio (ADR 0005). Either myEST8 bought it on the
-- server's Twilio account ('created'), or the Agency registered a number from its own
-- Twilio account ('registered'). A text to the number is checked with the auth token of
-- the account that owns it, so a registered number keeps its Account SID and Auth Token
-- here. The token is encrypted by the app (AES-256-GCM with TOKEN_ENCRYPTION_KEY) before
-- it is stored, like a Gmail refresh token. Expand-only: nothing existing is rewritten.
CREATE TABLE sms_numbers (
  agency_id bigint PRIMARY KEY REFERENCES agencies (id),
  kind text NOT NULL,
  -- E.164. Empty while a registered account's number is still being chosen.
  phone_number text UNIQUE,
  -- Twilio's id for the number (PN...), to change its webhook and to release it.
  number_sid text,
  -- Registered numbers only: the Agency's Twilio account and its encrypted auth token.
  account_sid text,
  auth_token text,
  created_at text NOT NULL
);

ALTER TABLE sms_numbers ENABLE ROW LEVEL SECURITY;
