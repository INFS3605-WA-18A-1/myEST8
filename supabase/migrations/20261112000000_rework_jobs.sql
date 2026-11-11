-- A Job that redoes a done Job the Tenant says isn't fixed. rework_of is the done
-- Job it redoes, on the same Ticket. Existing rows gain a null, so the running app
-- (which does not read it yet) is unchanged.
ALTER TABLE jobs ADD COLUMN rework_of bigint REFERENCES jobs (id);
