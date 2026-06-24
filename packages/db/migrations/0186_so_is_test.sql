-- 0186_so_is_test.sql
-- Sales Analysis (2026-06-25): a flag to exclude smoke-test SOs from analytics.
-- The current live set is mostly staff tests (junk names, shared phones), so
-- every analytics rate is noise until they are excluded. Default false; the
-- analysis endpoint excludes is_test=true unless ?includeTest=true. Flagging
-- the actual test rows is a SEPARATE owner-confirmed backfill (do not guess
-- which orders are real).

ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
