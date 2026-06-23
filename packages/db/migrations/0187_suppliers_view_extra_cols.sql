-- ----------------------------------------------------------------------------
-- 0187 — flow the 0186 supplier columns through the suppliers list view.
--
-- The Suppliers LIST endpoint (apps/api/src/routes/suppliers.ts) selects
-- SUPPLIER_LIST_COLS — which now includes registration_no / nature_of_business
-- / exemption_no / phone2 — FROM suppliers_with_derived_category. That view
-- (migration 0088) was created with `SELECT s.*`, which Postgres binds to the
-- column list that existed AT CREATION TIME — so the 4 new columns are NOT
-- visible through it and the list 500s: "column
-- suppliers_with_derived_category.registration_no does not exist".
--
-- DROP + recreate the view (same pattern the 0088 header documents: "if
-- columns get added to suppliers in the future this view must be DROPped +
-- recreated to pick them up"). Re-emit the 0088 definition verbatim; `s.*`
-- re-expands to include the 4 new columns, no existing column dropped.
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

COMMIT;
