-- 0174_model_default_free_gifts.sql
-- Per-Model default free gifts (Loo 2026-06-15). Re-keys the per-SKU
-- mfg_products.default_free_gifts (0170) to the Model, and is the storage for
-- the relocated editor in the POS PWP & Promo tab. Same jsonb entry shape:
-- [{ "giftProductId": "<accessory mfg_products.id>", "qty": <int>=1>, "campaignName": "<text|null>" }].
-- Sofa included: a complete sofa of a Model grants its gift once. Mirrors
-- model_fabric_tier_overrides (0172). Write role set per mig 0173.
--
-- PROD RED-LINE: verify the table/policy don't already exist and confirm the
-- active staff role set (if mig 0173 not yet applied and active master_account
-- staff remain, apply 0173 first or add master_account to the policy).

CREATE TABLE IF NOT EXISTS model_default_free_gifts (
  model_id   uuid PRIMARY KEY REFERENCES product_models(id) ON DELETE CASCADE,
  gifts      jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES staff(id) ON DELETE SET NULL
);

COMMENT ON TABLE model_default_free_gifts IS
  'Per-Model default free gifts (accessory SKUs auto-added at RM0). Same jsonb shape as mfg_products.default_free_gifts. Read by all staff; written by admin/super_admin/coordinator/sales_director.';

ALTER TABLE model_default_free_gifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY mdfg_select_all ON model_default_free_gifts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY mdfg_write_editors ON model_default_free_gifts
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','sales_director')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','sales_director')));

-- Backfill: fold each Model's existing per-SKU gift up to the Model (first
-- non-empty per model_id). Only AKKA-FIRM has data in prod today.
INSERT INTO model_default_free_gifts (model_id, gifts)
SELECT DISTINCT ON (mp.model_id) mp.model_id, mp.default_free_gifts
FROM mfg_products mp
WHERE mp.model_id IS NOT NULL
  AND jsonb_array_length(mp.default_free_gifts) > 0
ORDER BY mp.model_id, mp.code
ON CONFLICT (model_id) DO NOTHING;
