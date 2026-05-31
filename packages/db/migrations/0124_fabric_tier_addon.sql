-- 0124_fabric_tier_addon.sql
-- POS selling fabric-tier add-on (Chairman 2026-06-01). Sofa + bedframe.
-- Mirrors delivery_fee_config (0029). POS-SELLING-ONLY; cost/procurement untouched.
--
-- RLS state verified 2026-06-01 before writing: fabric_library already has RLS ON
-- with fabric_library_select (is_staff) + fabric_library_admin_write (is_admin =
-- admin/super_admin, ALL). is_admin() EXCLUDES coordinator + master_account, so a
-- NEW UPDATE policy is added below for the Master Admin editor set. (Chairman RLS OK.)

-- 1. Front-of-house SELLING tiers + procurement link on the customer-pickable list.
--    Selling tiers are DISTINCT from fabric_trackings cost tiers. fabric_code links
--    to the procurement ledger row (populated by the Backend +New Fabric flow, later plan).
ALTER TABLE fabric_library
  ADD COLUMN IF NOT EXISTS sofa_tier     fabric_price_tier,
  ADD COLUMN IF NOT EXISTS bedframe_tier fabric_price_tier,
  ADD COLUMN IF NOT EXISTS fabric_code   text;

-- 2. Δ config singleton (whole MYR, like delivery_fee_config.base_fee).
CREATE TABLE fabric_tier_addon_config (
  id                    integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  sofa_tier2_delta      integer NOT NULL DEFAULT 0 CHECK (sofa_tier2_delta     >= 0),
  sofa_tier3_delta      integer NOT NULL DEFAULT 0 CHECK (sofa_tier3_delta     >= 0),
  bedframe_tier2_delta  integer NOT NULL DEFAULT 0 CHECK (bedframe_tier2_delta >= 0),
  bedframe_tier3_delta  integer NOT NULL DEFAULT 0 CHECK (bedframe_tier3_delta >= 0),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES staff(id) ON DELETE SET NULL
);
INSERT INTO fabric_tier_addon_config (id) VALUES (1);

COMMENT ON TABLE fabric_tier_addon_config IS
  'Singleton (id=1): flat POS selling add-on (whole MYR) per fabric tier, per category. Read by all staff; written by admin/coordinator/master_account.';

ALTER TABLE fabric_tier_addon_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY fabric_tier_addon_config_select_all
  ON fabric_tier_addon_config FOR SELECT TO authenticated USING (true);

CREATE POLICY fabric_tier_addon_config_update_editors
  ON fabric_tier_addon_config FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','coordinator','master_account')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','coordinator','master_account')));

-- 3. fabric_library WRITE RLS for the Master Admin editor set. is_admin() (existing
--    fabric_library_admin_write) covers only admin/super_admin; this adds coordinator
--    + master_account for SELLING-tier edits. (Chairman RLS OK 2026-06-01.)
CREATE POLICY fabric_library_update_editors
  ON fabric_library FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','coordinator','master_account')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','coordinator','master_account')));

-- 4. SO header snapshot of the order's total fabric add-on (reporting only; the Δ also
--    folds into each sofa/bedframe line's total_centi — that is what actually charges).
ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS fabric_tier_addon_centi integer NOT NULL DEFAULT 0
    CHECK (fabric_tier_addon_centi >= 0);
