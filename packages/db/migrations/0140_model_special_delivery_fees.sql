-- 0140_model_special_delivery_fees.sql
-- Phase 1 — per-Model special delivery fees (Chairman 2026-06-02).
--
-- (Numbered 0140 to clear the concurrent special-addons branch, which took
--  0133 the same day. This branch's 0133_so_delivery_fee is already applied.)
--
-- Some models cost more to transport (e.g. 2 full-latex mattresses, 1 special
-- sofa at RM 500). A special model's standalone fee OVERRIDES the normal base
-- (delivery_fee_config.base_fee). When the model's SO is a cross-category
-- follow-up linked to an earlier SO, the cross_cat_followup_fee applies instead
-- (e.g. RM 300). There is no automatic "latex" signal in the schema, so a row
-- in THIS table IS the manual "this model is special" tag.
--
-- Per-MODEL (not per-SKU): a mattress model has ~5 size SKUs, but the transport
-- fee is a property of the whole model — set once here. Fees are whole MYR (like
-- delivery_fee_config); the server scales ×100 to sen at order time.

CREATE TABLE IF NOT EXISTS model_special_delivery_fees (
  model_id                uuid PRIMARY KEY REFERENCES product_models(id) ON DELETE CASCADE,
  standalone_fee          integer NOT NULL DEFAULT 0 CHECK (standalone_fee         >= 0),
  cross_cat_followup_fee  integer NOT NULL DEFAULT 0 CHECK (cross_cat_followup_fee >= 0),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES staff(id) ON DELETE SET NULL
);

COMMENT ON TABLE model_special_delivery_fees IS
  'Per-Model special transport fees (whole MYR). A row tags the model as special: standalone_fee overrides the base delivery fee; cross_cat_followup_fee applies when the model''s SO is a cross-category follow-up linked to an earlier SO. Migration 0140.';

-- RLS — read for any authenticated staff (the order POST reads it to recompute
-- the fee); write for the same fee-editor roles as delivery_fee_config.
ALTER TABLE model_special_delivery_fees ENABLE ROW LEVEL SECURITY;

CREATE POLICY msdf_select_all
  ON model_special_delivery_fees FOR SELECT TO authenticated
  USING (true);

CREATE POLICY msdf_write_fee_editors
  ON model_special_delivery_fees FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff
       WHERE id = auth.uid()
         AND active = TRUE
         AND role IN ('admin', 'coordinator', 'master_account')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff
       WHERE id = auth.uid()
         AND active = TRUE
         AND role IN ('admin', 'coordinator', 'master_account')
    )
  );
