-- ----------------------------------------------------------------------------
-- 0046 — Add supplier_code to fabric_trackings.
--
-- Commander asked for a "Supplier Code" column on Fabric Tracking. The PO
-- printed for the supplier needs to show the supplier's own SKU, not our
-- internal fabric_code. Denormalised here (single supplier per fabric) —
-- the supplier_material_bindings table still owns the multi-supplier mapping
-- when needed.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE fabric_trackings
  ADD COLUMN IF NOT EXISTS supplier_code TEXT;

COMMIT;
