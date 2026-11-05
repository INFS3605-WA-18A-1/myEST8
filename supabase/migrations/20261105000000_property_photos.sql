-- A Property's photo, stored with the other files. photo_source says who chose it:
-- 'fetched' is the online photo, 'manager' is one a Property Manager uploaded.
-- Both columns stay null until there is a photo. Existing rows gain two nulls,
-- so the running app (which does not read them yet) is unchanged.
ALTER TABLE properties ADD COLUMN photo_file_id bigint REFERENCES files (id) ON DELETE SET NULL;
ALTER TABLE properties ADD COLUMN photo_source text;

ALTER TABLE properties ADD CONSTRAINT properties_photo_source CHECK (photo_source IS NULL OR photo_source IN ('fetched', 'manager'));
ALTER TABLE properties ADD CONSTRAINT properties_photo_pair CHECK (
  (photo_file_id IS NULL AND photo_source IS NULL) OR (photo_file_id IS NOT NULL AND photo_source IS NOT NULL)
);
