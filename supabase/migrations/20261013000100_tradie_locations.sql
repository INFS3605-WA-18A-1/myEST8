-- Where a Tradie works from, for the Dispatch map and "nearest Tradies": a
-- business address and the point it geocodes to (null until it is found).
ALTER TABLE people
  ADD COLUMN business_address text,
  ADD COLUMN lat double precision,
  ADD COLUMN lng double precision;
