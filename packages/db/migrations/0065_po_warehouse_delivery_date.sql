-- ----------------------------------------------------------------------------
-- 0065 — PO warehouse + per-line delivery date (PR #76).
--
-- Commander 2026-05-26 (AutoCount parity): "我的 Purchase Location 正常是
-- 一张 PO 一个的，然后它下面会自动叫我选择这些东西是送什么地方". Adds:
--
--   purchase_orders.purchase_location_id  — default ship-to warehouse for
--                                           every line on this PO (header
--                                           setting, mirrors AutoCount's
--                                           "Purchase Location" dropdown).
--   purchase_order_items.delivery_date    — per-line delivery date; lets
--                                           commander stagger receipts on
--                                           a single PO without splitting.
--   purchase_order_items.warehouse_id     — per-line ship-to override;
--                                           defaults to the header value
--                                           on the API side when blank.
--
-- All three columns are nullable so existing PO rows stay valid. The UI
-- (PurchaseOrderDetail.tsx) plus the API patch endpoints come in the same
-- PR — no follow-up migration needed once we wire those.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS purchase_location_id UUID
    REFERENCES warehouses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_po_purchase_location
  ON purchase_orders (purchase_location_id);

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS delivery_date DATE,
  ADD COLUMN IF NOT EXISTS warehouse_id  UUID
    REFERENCES warehouses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_po_items_warehouse
  ON purchase_order_items (warehouse_id);

COMMIT;
