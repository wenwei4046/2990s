-- ----------------------------------------------------------------------------
-- 0069 — SO line: track qty already converted to PO (PR — Commander
-- 2026-05-26).
--
-- Commander asked for "multi-select + partial proceed" on SO → PO
-- conversion: pick N SOs, pick partial qty per line, the rest stays on
-- the SO for a later PO. Need a counter so the picker can show what's
-- still outstanding + the API can reject a double-spend.
--
--   po_qty_picked = how much of this line has already been emitted to
--                   one or more POs (cumulative across all conversions).
--                   The "still convertible" qty = qty - po_qty_picked.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE mfg_sales_order_items
  ADD COLUMN IF NOT EXISTS po_qty_picked INTEGER NOT NULL DEFAULT 0;

-- Partial index speeds up the "still has outstanding qty" picker query.
CREATE INDEX IF NOT EXISTS idx_mso_items_outstanding
  ON mfg_sales_order_items (doc_no)
  WHERE po_qty_picked < qty;

COMMIT;
