-- A no-login link for a booked visit: the Tenant confirms the time, or asks for
-- another one. Mail scanners open the link; only the page's POST changes anything.
--
-- Nullable, with a random default, so older code can insert a Work Order without
-- naming a token (Rollback runs that code on this database). gen_random_uuid()
-- is volatile, so each existing row gets its own value rather than one shared
-- or one anyone could compute from the visit. A row that still has no token is
-- filled by the app the first time a link needs it.
--
-- The first instant in visit_offers.starts is the Tradie's preferred time. The
-- rest, if any, are the other times they can offer (up to two).

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS token text
    DEFAULT replace(gen_random_uuid()::text, '-', '');

CREATE UNIQUE INDEX IF NOT EXISTS work_orders_token ON work_orders (token);

COMMENT ON COLUMN visit_offers.starts IS 'One to three ISO instants. The first is the Tradie''s preferred time.';
