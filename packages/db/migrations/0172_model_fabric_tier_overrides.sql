-- 0172_model_fabric_tier_overrides.sql
-- Per-Model override of the POS selling fabric-tier add-on Δ (Loo 2026-06-14).
-- Mirrors model_special_delivery_fees (0140). A row gives a Model its own P2/P3
-- Δ that REPLACES the global fabric_tier_addon_config (0124) for that Model;
-- NULL on a tier = inherit the global. POS-SELLING-ONLY; cost/procurement
-- (fabric_trackings, computeMfgLineCost) untouched. Sofa + bedframe Models.
--
-- RLS: SELECT for all authenticated staff (the SO POST recomputes from it);
-- write for the same editor set as fabric_tier_addon_config (0124 + 0166):
-- admin / super_admin / coordinator / master_account. super_admin included
-- from the start (0124 had to retro-add it in 0166 — don't repeat that gap).

CREATE TABLE model_fabric_tier_overrides (
  model_id     uuid PRIMARY KEY REFERENCES product_models(id) ON DELETE CASCADE,
  tier2_delta  integer CHECK (tier2_delta IS NULL OR tier2_delta >= 0),  -- NULL = inherit global P2
  tier3_delta  integer CHECK (tier3_delta IS NULL OR tier3_delta >= 0),  -- NULL = inherit global P3
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES staff(id) ON DELETE SET NULL
);

COMMENT ON TABLE model_fabric_tier_overrides IS
  'Per-Model selling fabric-tier Δ override (whole MYR). NULL tier = inherit fabric_tier_addon_config. Read by all staff; written by admin/super_admin/coordinator/master_account.';

ALTER TABLE model_fabric_tier_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY mfto_select_all
  ON model_fabric_tier_overrides FOR SELECT TO authenticated USING (true);

CREATE POLICY mfto_write_editors
  ON model_fabric_tier_overrides FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','master_account')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','master_account')));
