-- 0177_product_cost_anchor.sql
-- Product cost ⇄ supplier anchor (SKU-level generalization of the sofa_combo
-- anchor, R8). A supplier_material_bindings row can be flagged as the cost
-- anchor for its material_code. While anchored, editing either side's cost
-- (the binding's unit_price_centi / price_matrix, or the mfg_products
-- base_price_sen / price1_sen) mirrors onto the other so Product-Maintenance
-- cost stays equal to the supplier's cost.
--
-- At most ONE anchor per material_code is enforced at the APP layer (the
-- set-anchor route clears is_cost_anchor on every other binding for the same
-- material_code), NOT by a DB constraint — mirrors the existing is_main_supplier
-- pattern on this same table.
--
-- Owner applies via Supabase MCP. DO NOT auto-apply.

ALTER TABLE supplier_material_bindings
  ADD COLUMN IF NOT EXISTS is_cost_anchor boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN supplier_material_bindings.is_cost_anchor IS
  'When true, this binding is the cost anchor for its material_code: edits to '
  'this binding''s cost (unit_price_centi / price_matrix) mirror to the linked '
  'mfg_products row (base_price_sen / price1_sen) and vice-versa. At most one '
  'anchor per material_code, enforced app-side (see suppliers.ts cost-anchor '
  'route). SOFA bindings are accepted as anchors but cost sync is skipped '
  '(per-height matrix vs single SKU cost is ambiguous — phase-2).';
