-- 0184_compartment_fabric_tier_overrides.sql
-- Per-compartment sofa fabric-tier Δ overrides. Sibling of model_fabric_tier_overrides (0172).
-- Effective whole-sofa Δ = MAX over the SET special values (model override + matching compartments),
-- resolved server-side; NULL tier = inherit global, 0 = free.
--
-- RLS: SELECT for all authenticated staff (the SO POST recomputes from it);
-- write for the same editor set as fabric_tier_addon_config (0124 + 0166) /
-- model_fabric_tier_overrides (0172), with master_account retired to
-- sales_director (0173): admin / super_admin / coordinator / sales_director.
CREATE TABLE IF NOT EXISTS compartment_fabric_tier_overrides (
  compartment_id  text PRIMARY KEY REFERENCES compartment_library(id) ON DELETE CASCADE,
  tier2_delta     integer,
  tier3_delta     integer,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid
);

COMMENT ON TABLE compartment_fabric_tier_overrides IS
  'Per-compartment selling fabric-tier Δ override (whole MYR). NULL tier = inherit fabric_tier_addon_config. Read by all staff; written by admin/super_admin/coordinator/sales_director.';

ALTER TABLE compartment_fabric_tier_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY cfto_select_all
  ON compartment_fabric_tier_overrides FOR SELECT TO authenticated USING (true);

CREATE POLICY cfto_write_editors
  ON compartment_fabric_tier_overrides FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','sales_director')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','sales_director')));
