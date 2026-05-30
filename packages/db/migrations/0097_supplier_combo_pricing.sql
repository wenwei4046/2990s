-- ----------------------------------------------------------------------------
-- 0097 — sofa_combo_pricing.supplier_id (supplier-scopeable combos)
--
-- Commander 2026-05-29 (feat/supplier-combo-po-autoprice): make Sofa Combo
-- Pricing scopeable to a SUPPLIER, so a Purchase Order to that supplier can
-- later auto-price using the supplier's own combo deals + surcharges. PO
-- auto-pricing itself is a later phase — this migration only adds the scope
-- column + lookup indexes.
--
-- Scope ladder is unchanged for the sales side: a NULL supplier_id row is a
-- sales-side / master combo (what the Products page reads + writes today). A
-- non-NULL supplier_id row belongs to that one supplier's purchasing scope.
-- The two never collide because every lookup filters supplier_id explicitly
-- (sales side = IS NULL, supplier side = = :supplier_id).
--
-- ON DELETE CASCADE: dropping a supplier removes its combo rows — they have no
-- meaning without the supplier, mirroring the supplier_id FK on
-- supplier_material_bindings (0089) and the rack tables (0094).
--
-- Additive + non-destructive: existing rows default to supplier_id = NULL and
-- keep behaving exactly as before (sales-side combos).
--
-- RLS: sofa_combo_pricing has no row-level-security policies (0090 created it
-- without ENABLE ROW LEVEL SECURITY); the API reaches it through the
-- authenticated role directly. Adding a nullable column does not change that —
-- no policy edits are needed and security is not weakened.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── Column ──────────────────────────────────────────────────────────────
-- Supplier scope. NULL = sales-side / master combo (the default, unchanged).
-- Non-NULL = this supplier's purchasing-scope combo.
ALTER TABLE sofa_combo_pricing
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE;

COMMENT ON COLUMN sofa_combo_pricing.supplier_id IS
  'NULL = sales-side / master combo (default, read+written by the Products '
  'page). Non-NULL = combo scoped to that supplier''s purchasing side, used '
  'by the Supplier detail Combo Pricing tab + (later) PO auto-pricing.';

-- ── Lookup indexes now carry supplier_id ───────────────────────────────────
-- Mirror the existing non-unique lookup + history indexes from 0090 and add
-- supplier_id so the supplier-scoped reads stay a single indexed scan. There
-- is no UNIQUE index on this table (the append-only history model keeps many
-- rows per scope tuple — the latest effective_from wins at read time), so we
-- recreate the same non-unique shapes 0090 used.
DROP INDEX IF EXISTS idx_sofa_combo_pricing_lookup;
CREATE INDEX IF NOT EXISTS idx_sofa_combo_pricing_lookup
  ON sofa_combo_pricing (base_model, tier, customer_id, supplier_id, effective_from DESC)
  WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS idx_sofa_combo_pricing_history;
CREATE INDEX IF NOT EXISTS idx_sofa_combo_pricing_history
  ON sofa_combo_pricing (base_model, tier, customer_id, supplier_id, effective_from DESC, created_at DESC);

-- ── Index on supplier_id ───────────────────────────────────────────────────
-- Cheap "all combos for this supplier" filter (Supplier detail Combo Pricing
-- tab + future PO auto-pricing read every active row for one supplier).
CREATE INDEX IF NOT EXISTS idx_sofa_combo_pricing_supplier
  ON sofa_combo_pricing (supplier_id)
  WHERE supplier_id IS NOT NULL;

COMMIT;
