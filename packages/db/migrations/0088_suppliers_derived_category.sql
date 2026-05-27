-- ----------------------------------------------------------------------------
-- 0088 — Suppliers list view with `derived_category` auto-computed from the
-- supplier's assigned SKUs (supplier_material_bindings → mfg_products).
--
-- Commander 2026-05-27 ("当 Assign SKU 之后，你就会知道它是什么 Category 了呀"):
-- Once a supplier has SKUs assigned via the Assign SKU flow (which writes
-- to supplier_material_bindings), the supplier's Category on the list page
-- should be auto-derived from the distinct mfg_products.category set of
-- those bindings — not a manually-picked field.
--
-- Derivation rules:
--   0 distinct categories → NULL (no SKUs assigned yet)
--   1 distinct category   → that single category (SOFA / BEDFRAME / ...)
--   ≥2 distinct           → 'MIXED'
--
-- We still keep the suppliers.category COLUMN intact (PR #208 / migration
-- 0087): the Pricing tab uses it to filter the maintenance sections that
-- show up under this supplier. The list page's visible Category column
-- now reads `derived_category` from this view instead.
--
-- View binds column list at creation time (`SELECT s.*`), so if columns
-- get added to suppliers in the future this view must be DROPped + recreated
-- to pick them up (same pattern as 0076 / 0080 / 0086).
-- ----------------------------------------------------------------------------

BEGIN;

DROP VIEW IF EXISTS suppliers_with_derived_category;

CREATE VIEW suppliers_with_derived_category AS
SELECT
  s.*,
  (
    SELECT
      CASE
        WHEN count(DISTINCT mp.category) = 0 THEN NULL
        WHEN count(DISTINCT mp.category) = 1 THEN max(mp.category::text)
        ELSE 'MIXED'
      END
    FROM supplier_material_bindings smb
    LEFT JOIN mfg_products mp
      ON mp.code = smb.material_code
     AND smb.material_kind = 'mfg_product'
    WHERE smb.supplier_id = s.id
  ) AS derived_category
FROM suppliers s;

-- Views inherit RLS from the underlying tables with security_invoker
-- (Postgres 15+, Supabase default). The base table `suppliers` already has
-- staff-readable RLS; nothing extra needed.

COMMIT;
