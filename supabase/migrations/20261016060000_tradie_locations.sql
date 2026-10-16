-- Where a Tradie works from, for the Dispatch map and "nearest Tradies": a
-- business address and the point it geocodes to (null until it is found).
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS business_address text,
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;
