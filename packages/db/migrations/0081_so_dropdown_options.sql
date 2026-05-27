-- ----------------------------------------------------------------------------
-- 0081 — Generic dropdown option table for SO-related selects.
--
-- Commander 2026-05-27: "customer type, building type, relationship 和
-- payment dropdown where can do maintenance?" These four dropdowns were
-- hardcoded in TS — coordinator had no way to edit them at runtime. One
-- table indexed by category so the SO Maintenance page can render N
-- mini-tables (one per category) without N separate tables.
-- ----------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS so_dropdown_options (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category    text NOT NULL CHECK (category IN ('customer_type', 'building_type', 'relationship', 'payment_method')),
  value       text NOT NULL,
  label       text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, value)
);

CREATE INDEX IF NOT EXISTS idx_sdo_category ON so_dropdown_options(category, sort_order);

ALTER TABLE so_dropdown_options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sdo_select ON so_dropdown_options;
DROP POLICY IF EXISTS sdo_insert ON so_dropdown_options;
DROP POLICY IF EXISTS sdo_update ON so_dropdown_options;
DROP POLICY IF EXISTS sdo_delete ON so_dropdown_options;
CREATE POLICY sdo_select ON so_dropdown_options FOR SELECT TO authenticated USING (true);
CREATE POLICY sdo_insert ON so_dropdown_options FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY sdo_update ON so_dropdown_options FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY sdo_delete ON so_dropdown_options FOR DELETE TO authenticated USING (true);

-- Seed with the current hardcoded values so existing SOs that reference
-- these literals continue to display + new SOs can pick them by default.
INSERT INTO so_dropdown_options (category, value, label, sort_order) VALUES
  ('customer_type', 'NEW', 'New customer', 1),
  ('customer_type', 'EXISTING', 'Existing customer', 2),
  ('building_type', 'Condo', 'Condo', 1),
  ('building_type', 'Landed', 'Landed', 2),
  ('building_type', 'Apartment', 'Apartment', 3),
  ('building_type', 'Office', 'Office', 4),
  ('building_type', 'Shop', 'Shop', 5),
  ('building_type', 'Other', 'Other', 6),
  ('relationship', 'Spouse', 'Spouse', 1),
  ('relationship', 'Parent', 'Parent', 2),
  ('relationship', 'Child', 'Child', 3),
  ('relationship', 'Sibling', 'Sibling', 4),
  ('relationship', 'Relative', 'Relative', 5),
  ('relationship', 'Friend', 'Friend', 6),
  ('relationship', 'Colleague', 'Colleague', 7),
  ('relationship', 'Other', 'Other', 8),
  ('payment_method', 'CASH', 'Cash', 1),
  ('payment_method', 'MBB', 'Maybank (MBB)', 2),
  ('payment_method', 'VISA', 'Visa', 3),
  ('payment_method', 'MASTER', 'Mastercard', 4),
  ('payment_method', 'CREDIT CARD', 'Credit Card', 5),
  ('payment_method', 'EPP', 'EPP installment', 6),
  ('payment_method', 'ONLINE', 'Online transfer', 7),
  ('payment_method', 'TNG', 'TouchNGo', 8),
  ('payment_method', 'DUITNOW', 'DuitNow', 9),
  ('payment_method', 'OTHER', 'Other', 10)
ON CONFLICT (category, value) DO NOTHING;

COMMIT;
