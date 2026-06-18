-- 0176_sofa_combo_anchor.sql
-- R8 (Commander 2026-06-16): anchor a sofa Model's combo COST to ONE supplier.
--
-- "我锚定一个 Supplier" — when a base_model is anchored, the Combo Pricing
-- editor/API MIRRORS combo CREATE + price EDIT bidirectionally between the
-- master (sales-side, supplier_id NULL) combo and that supplier's scope
-- (supplier_id = the anchored supplier). Edit either side → both get a new
-- effective-dated row; create a combo on either side → the other gets a copy.
-- The Product-Maintenance cost (SO cost reference) and the anchored supplier's
-- cost stay in lock-step. One anchor per Model (PK = base_model).
--
-- ⚠️ Applied to prod 2026-06-18 directly in the Supabase SQL Editor. Additive
-- (new table); changes no existing object. The CREATE POLICY statements below
-- are guarded with DROP POLICY IF EXISTS so the deploy auto-runner (applies
-- migrations >= 0168) can safely re-run this file without erroring on an
-- already-existing policy.

CREATE TABLE IF NOT EXISTS sofa_combo_anchor (
  base_model  TEXT PRIMARY KEY,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID
);

COMMENT ON TABLE sofa_combo_anchor IS
  'R8 — one row per sofa base_model anchored to a supplier. Combo create + '
  'price edits mirror between the master (NULL supplier) combo and this '
  'supplier scope, keeping Product-Maintenance cost = the anchored supplier cost.';

-- RLS — SELECT for all staff (combo UI + API read anchors to drive the mirror);
-- writes for the same roles that may write combos (sofa-combos.ts WRITE_ROLES:
-- admin / super_admin / coordinator / sales_director). Mirrors sofa_combo_pricing
-- gating. No existing policy altered.
ALTER TABLE sofa_combo_anchor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sofa_combo_anchor_select_all ON sofa_combo_anchor;
CREATE POLICY sofa_combo_anchor_select_all
  ON sofa_combo_anchor FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS sofa_combo_anchor_write_editors ON sofa_combo_anchor;
CREATE POLICY sofa_combo_anchor_write_editors
  ON sofa_combo_anchor FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','super_admin','coordinator','sales_director')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','super_admin','coordinator','sales_director')));
