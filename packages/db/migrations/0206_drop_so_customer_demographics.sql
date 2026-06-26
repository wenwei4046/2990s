-- 0206 — drop the now-dead SO demographic snapshot columns (Part A, mig 0185).
-- Demographics moved to the customers table in 0205; nothing reads/writes these
-- on the SO anymore. The capture path never deployed → no real data lost. The
-- current payment-totals view (0200) enumerates columns explicitly and does NOT
-- reference these two, so no view rebuild is needed.
--
-- PRE-CHECK (run manually before applying; expect ZERO rows). If any object
-- depends on these columns, drop/recreate it first:
--   SELECT dependent.relname, a.attname
--   FROM pg_depend d
--   JOIN pg_rewrite r ON r.oid = d.objid
--   JOIN pg_class dependent ON dependent.oid = r.ev_class
--   JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
--   WHERE d.refobjid = 'public.mfg_sales_orders'::regclass
--     AND a.attname IN ('customer_race','customer_age_frame');
--
-- IF EXISTS guards make it re-runnable. Transactional.

BEGIN;
ALTER TABLE mfg_sales_orders DROP COLUMN IF EXISTS customer_race;
ALTER TABLE mfg_sales_orders DROP COLUMN IF EXISTS customer_age_frame;
COMMIT;
