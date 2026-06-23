-- 0184 — Per-warehouse MRP lead times (Commander 2026-06-22).
-- Extend mrp_category_lead_times from (category) to (warehouse_id, category).
-- warehouse_id NULL = the GLOBAL DEFAULT (existing category-only rows become
-- globals). Lookup cascade: (warehouse, category) → (NULL, category) → 0.
-- A PK can't hold a nullable column, so drop the old PK + use a NULLS NOT
-- DISTINCT unique index. Additive + idempotent.
ALTER TABLE mrp_category_lead_times ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id) ON DELETE CASCADE;
ALTER TABLE mrp_category_lead_times DROP CONSTRAINT IF EXISTS mrp_category_lead_times_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS mrp_category_lead_times_wh_cat_uniq ON mrp_category_lead_times (warehouse_id, category) NULLS NOT DISTINCT;
