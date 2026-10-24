-- A no-login link for a booked visit: the Tenant confirms the time, or asks for
-- another one. Mail scanners open the link; only the page's POST changes anything.
--
-- The first instant in visit_offers.starts is the Tradie's preferred time. The
-- rest, if any, are the other times they can offer (up to two).

ALTER TABLE work_orders ADD COLUMN token text;

UPDATE work_orders SET token = md5(id::text || ':' || start) WHERE token IS NULL;

ALTER TABLE work_orders ALTER COLUMN token SET NOT NULL;

CREATE UNIQUE INDEX work_orders_token ON work_orders (token);

COMMENT ON COLUMN visit_offers.starts IS 'One to three ISO instants. The first is the Tradie''s preferred time.';
