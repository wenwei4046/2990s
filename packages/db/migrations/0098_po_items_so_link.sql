-- ----------------------------------------------------------------------------
-- 0098 — PO items: remember the source SO line (Commander 2026-05-29, BUG 1).
--
-- When a PO line is created via "Convert from Sales Order", we bump
-- mfg_sales_order_items.po_qty_picked so the converted line drops out of the
-- From-SO picker (see migration 0069). But the PO item never stored WHICH SO
-- line it came from — so deleting a PO line couldn't release that quota back.
--
-- Commander: "By right 删掉之后, available 的额度应该要释放出来" — deleting a
-- PO line should hand the qty back to the SO line so it reappears in the
-- picker. This column gives the delete handler the link it needs.
--
--   so_item_id = the mfg_sales_order_items.id this PO line was converted from
--                (NULL for manually-added lines that never came from an SO).
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS so_item_id UUID
    REFERENCES mfg_sales_order_items(id) ON DELETE SET NULL;

-- Speeds up "release quota on delete" lookups + future SO→PO traceability.
CREATE INDEX IF NOT EXISTS idx_po_items_so_item
  ON purchase_order_items (so_item_id)
  WHERE so_item_id IS NOT NULL;

COMMIT;
