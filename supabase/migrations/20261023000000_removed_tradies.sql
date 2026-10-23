-- When a Tradie was removed from the Agency (ISO time), null while they are still
-- one. A removed Tradie keeps their row: past Quotes, visits and ratings point at
-- it and still show their name. Expand-only: nothing existing is rewritten.
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS removed_at text;
