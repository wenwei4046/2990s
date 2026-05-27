-- 0078 — Per-category cost breakdown on SO header (Task #114).
-- Commander 2026-05-27: Houzs auto-summarizes category costing. We
-- already have category REVENUE columns; mirror with category COST.

BEGIN;

ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS mattress_sofa_cost_centi integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bedframe_cost_centi      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accessories_cost_centi   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS others_cost_centi        integer NOT NULL DEFAULT 0;

COMMIT;
