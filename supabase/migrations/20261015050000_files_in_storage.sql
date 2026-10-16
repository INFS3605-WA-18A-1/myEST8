-- Files can live in Supabase Storage instead of the row (expand only: rows already
-- holding bytes keep working, and nothing is dropped). A file has its bytes here
-- or an object path in the private `files` bucket, never neither.
ALTER TABLE files ADD COLUMN storage_path text;
ALTER TABLE files ALTER COLUMN content DROP NOT NULL;
ALTER TABLE files ADD CONSTRAINT files_content_or_path CHECK (content IS NOT NULL OR storage_path IS NOT NULL);
