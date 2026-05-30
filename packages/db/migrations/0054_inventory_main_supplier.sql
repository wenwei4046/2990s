-- ----------------------------------------------------------------------------
-- 0054 — Extend v_inventory_all_skus with main_supplier_code + name (PR #38).
--
-- Commander 2026-05-26: "我们的还需要看到是什么supplier的货"
-- AutoCount's SKU master shows a "Main Supplier" column; this puts the
-- supplier code + name directly on the inventory view so the API doesn't
-- need a separate join + zip.
-- ----------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE VIEW v_inventory_all_skus AS
SELECT
  p.code              AS product_code,
  p.name              AS product_name,
  p.category          AS category,
  p.size_label        AS size_label,
  w.id                AS warehouse_id,
  w.code              AS warehouse_code,
  w.name              AS warehouse_name,
  COALESCE(b.qty, 0)              AS qty,
  b.last_movement_at,
  COALESCE(v.value_sen, 0)        AS value_sen,
  ms.supplier_code    AS main_supplier_code,
  ms.supplier_name    AS main_supplier_name,
  ms.unit_price_centi AS main_supplier_price_centi
FROM mfg_products p
CROSS JOIN warehouses w
LEFT JOIN inventory_balances b ON b.warehouse_id = w.id AND b.product_code = p.code
LEFT JOIN (
  SELECT warehouse_id, product_code, SUM(qty_remaining * unit_cost_sen) AS value_sen
    FROM inventory_lots
   WHERE qty_remaining > 0
   GROUP BY warehouse_id, product_code
) v ON v.warehouse_id = w.id AND v.product_code = p.code
LEFT JOIN LATERAL (
  SELECT sup.code AS supplier_code, sup.name AS supplier_name, smb.unit_price_centi
    FROM supplier_material_bindings smb
    JOIN suppliers sup ON sup.id = smb.supplier_id
   WHERE smb.material_code = p.code
   ORDER BY smb.is_main_supplier DESC, smb.unit_price_centi ASC
   LIMIT 1
) ms ON TRUE
WHERE w.is_active = TRUE
  AND p.status = 'ACTIVE';

-- ── New view: per-product summary (sum qty across all warehouses) ──────
-- This is what the AutoCount-style "list view" hits. One row per SKU
-- with Total Bal Qty + Main Supplier columns.
CREATE OR REPLACE VIEW v_inventory_product_totals AS
SELECT
  p.code              AS product_code,
  p.name              AS product_name,
  p.category          AS category,
  p.size_label        AS size_label,
  p.base_price_sen,
  p.price1_sen,
  p.branding,
  COALESCE(SUM(b.qty), 0)                       AS total_qty,
  COALESCE(SUM(v.value_sen), 0)                 AS total_value_sen,
  MAX(b.last_movement_at)                       AS last_movement_at,
  ms.supplier_code    AS main_supplier_code,
  ms.supplier_name    AS main_supplier_name,
  ms.unit_price_centi AS main_supplier_price_centi
FROM mfg_products p
LEFT JOIN inventory_balances b ON b.product_code = p.code
LEFT JOIN (
  SELECT warehouse_id, product_code, SUM(qty_remaining * unit_cost_sen) AS value_sen
    FROM inventory_lots
   WHERE qty_remaining > 0
   GROUP BY warehouse_id, product_code
) v ON v.product_code = p.code AND v.warehouse_id = b.warehouse_id
LEFT JOIN LATERAL (
  SELECT sup.code AS supplier_code, sup.name AS supplier_name, smb.unit_price_centi
    FROM supplier_material_bindings smb
    JOIN suppliers sup ON sup.id = smb.supplier_id
   WHERE smb.material_code = p.code
   ORDER BY smb.is_main_supplier DESC, smb.unit_price_centi ASC
   LIMIT 1
) ms ON TRUE
WHERE p.status = 'ACTIVE'
GROUP BY p.code, p.name, p.category, p.size_label, p.base_price_sen, p.price1_sen, p.branding,
         ms.supplier_code, ms.supplier_name, ms.unit_price_centi;

COMMIT;
