-- ----------------------------------------------------------------------------
-- 0106 — GRN line consumption tracking (GRN → {PI, PR} parity).
--
-- Extends the PO→GRN consumption pattern (purchase_order_items.received_qty,
-- migration 0098/0101) down the chain to GRN→PI and GRN→PR. A GRN line can now
-- be invoiced and returned MULTIPLE times by remaining quantity, capped at
-- qty_accepted:
--   invoiced_qty — Σ of PI line qty drawn from this grn_item (remaining =
--                  qty_accepted - invoiced_qty).
--   returned_qty — Σ of PR line qty drawn from this grn_item (remaining =
--                  qty_accepted - returned_qty).
-- These also drive the GRN edit-lock: a GRN with ANY line invoiced_qty>0 or
-- returned_qty>0 has a downstream child and becomes read-only.
--
-- ADDITIVE + non-destructive — both columns are NOT NULL DEFAULT 0 so existing
-- grn_items rows survive untouched (house style of 0101).
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE grn_items
  ADD COLUMN IF NOT EXISTS invoiced_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returned_qty integer NOT NULL DEFAULT 0;

COMMIT;
