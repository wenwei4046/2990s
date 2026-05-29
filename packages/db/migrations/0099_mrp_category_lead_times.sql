-- ----------------------------------------------------------------------------
-- 0099 — Per-category MRP lead time (Commander 2026-05-29).
--
-- "有没有一个 maintenance 可以按 category 调整 lead time（比如早几天）" — the
-- buyer needs to know how many days BEFORE a Sales Order's delivery date a PO
-- must be placed, per product category. The MRP then computes an order-by date
-- = delivery date − lead_days, shows it on each line, and sorts by it (the
-- soonest order-by floats to the top).
--
--   category   : 'sofa' | 'bedframe' | 'mattress' | 'accessory' | 'service'
--                (lowercase, matches mfg_sales_order_items.item_group; the MRP
--                 server uppercase-normalises product category on lookup)
--   lead_days  : how many days early to place the PO (0 = order on the due date)
-- ----------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS mrp_category_lead_times (
  category    text PRIMARY KEY CHECK (category IN ('sofa', 'bedframe', 'mattress', 'accessory', 'service')),
  lead_days   integer NOT NULL DEFAULT 0 CHECK (lead_days >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mrp_category_lead_times ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mclt_select ON mrp_category_lead_times;
DROP POLICY IF EXISTS mclt_insert ON mrp_category_lead_times;
DROP POLICY IF EXISTS mclt_update ON mrp_category_lead_times;
CREATE POLICY mclt_select ON mrp_category_lead_times FOR SELECT TO authenticated USING (true);
CREATE POLICY mclt_insert ON mrp_category_lead_times FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY mclt_update ON mrp_category_lead_times FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Seed the five categories at 0 days (order on the due date) so the maintenance
-- page shows every category as an editable row out of the box.
INSERT INTO mrp_category_lead_times (category, lead_days) VALUES
  ('sofa', 0),
  ('bedframe', 0),
  ('mattress', 0),
  ('accessory', 0),
  ('service', 0)
ON CONFLICT (category) DO NOTHING;

COMMIT;
