-- ----------------------------------------------------------------------------
-- 0122 — Expose batch_no on v_inventory_lots_open (Stage 3 fix, 2026-06-01)
--
-- WHY: so-stock-allocation's sofa readiness check reads
--   v_inventory_lots_open.batch_no to match a sofa set's on-hand against its
--   FIXED procurement batch (po_number). But the view (last defined in 0095,
--   before batch_no existed) never carried the column, so the SELECT errored,
--   lotRows came back empty, and EVERY sofa set was forced PENDING even when its
--   batch had stock on hand. Root cause of "SKU shows stock yet SO never READY"
--   (BUG-2026-06-01).
--
-- WHAT: recreate the view byte-for-byte from 0095, adding ONE column: l.batch_no.
--   No other column / filter / ordering change. Additive + idempotent.
--
-- DEPENDS ON: 0120 (adds inventory_lots.batch_no). Apply 0120/0121 first.
-- ⚠️ APPLIED MANUALLY BY IT. Test on a staging / branch DB first.
-- ----------------------------------------------------------------------------

BEGIN;

DROP VIEW IF EXISTS v_inventory_lots_open;
CREATE VIEW v_inventory_lots_open AS
SELECT
  l.id, l.warehouse_id, w.code AS warehouse_code,
  l.product_code, l.variant_key, l.product_name,
  l.qty_received, l.qty_remaining,
  l.unit_cost_sen,
  (l.qty_remaining * l.unit_cost_sen) AS remaining_value_sen,
  l.received_at, l.source_doc_type, l.source_doc_no,
  l.batch_no
FROM inventory_lots l
LEFT JOIN warehouses w ON w.id = l.warehouse_id
WHERE l.qty_remaining > 0
ORDER BY l.received_at;

COMMIT;
