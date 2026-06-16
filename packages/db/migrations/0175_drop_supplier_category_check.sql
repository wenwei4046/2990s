-- 0175 — Drop the legacy single-value CHECK on suppliers.category.
--
-- Owner spec 2026-06-12: a supplier can supply MULTIPLE categories; the value is
-- now a comma-joined text ("Sofa, Bedframe") set via SupplyCategoryPicker. But
-- migration 0087 added `suppliers_category_check` which only allowed ONE
-- canonical value (category IN ('SOFA','BEDFRAME','MATTRESS','ACCESSORY',
-- 'SERVICE','MIXED')). So saving 2+ categories — or any title-case value like
-- "Sofa" — violated the constraint, the PATCH /suppliers/:id 500'd, and the
-- Supplier Info Save failed SILENTLY ("Save 没有反应"). The multi-select feature
-- was shipped without ever dropping this constraint.
--
-- Casing/format is now validated at the app layer (parseSupplierCategories /
-- the maintained Supply Category pool), so no DB CHECK is needed.
BEGIN;
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_category_check;
COMMIT;
