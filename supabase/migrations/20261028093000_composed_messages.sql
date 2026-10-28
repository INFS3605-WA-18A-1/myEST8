-- Whether Claude Haiku wrote an outbound message's text (ADR 0011), so a Ticket's
-- messages can mark it as written by AI. False for everything sent before, and
-- for every message that went out as its template's text. Expand-only: older
-- code inserts without naming it and gets false.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS composed boolean NOT NULL DEFAULT false;
