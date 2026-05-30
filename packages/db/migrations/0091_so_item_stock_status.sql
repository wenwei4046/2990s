-- ----------------------------------------------------------------------------
-- 0091 — mfg_sales_order_items.stock_status
--
-- Commander 2026-05-28 ("所有的 SO Item 都要多一个 column，去做后面的
-- checking 动作"):
--
-- Each SO line item now carries an explicit fulfillment flag. As stock
-- arrives (eventually from inventory allocation; manual flip for MVP),
-- ops marks the line as READY. The Detail Listing API aggregates by
-- item_group (mattress/bedframe/accessory/sofa) and surfaces:
--   · category chips (e.g. "MATTRESS · BEDFRAME") when SOME categories
--     are fully ready
--   · auto-advance to STOCK_READY when ALL non-cancelled lines are READY
--
-- The chip column on the SO list reads:
--   · empty  — no category fully ready
--   · "MATTRESS"   — all mattress lines READY, but bedframe still PENDING
--   · "READY"      — every line READY (status itself advances)
--
-- Append-only history continues via mfg_so_audit_log; the API records a
-- status transition entry whenever the auto-advance fires.
--
-- (No enum changes in this migration. Commander's 6-stage rename
-- — Confirm/Proceed/StockReady/Arrange/Delivered/Invoice — comes in a
-- follow-up migration so this PR stays focused on the per-item flag.)
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE mfg_sales_order_items
  ADD COLUMN IF NOT EXISTS stock_status TEXT NOT NULL DEFAULT 'PENDING';

-- Enforce the value set at the DB layer. CHECK constraints are cheap and
-- prevent stray writes from a misbehaving client.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mfg_sales_order_items_stock_status_check'
  ) THEN
    ALTER TABLE mfg_sales_order_items
      ADD CONSTRAINT mfg_sales_order_items_stock_status_check
      CHECK (stock_status IN ('PENDING','READY'));
  END IF;
END $$;

-- Index for the per-SO aggregation query (Detail Listing groups by doc_no
-- and counts READY vs PENDING across item_group).
CREATE INDEX IF NOT EXISTS idx_mfg_so_items_doc_no_stock
  ON mfg_sales_order_items (doc_no, stock_status)
  WHERE cancelled = false;

COMMENT ON COLUMN mfg_sales_order_items.stock_status IS
  'Per-line fulfillment flag (PR — Commander 2026-05-28). Default PENDING; '
  'flipped to READY when stock for this line arrives. The Detail Listing API '
  'aggregates by item_group and auto-advances mfg_sales_orders.status to '
  'READY_TO_SHIP when every non-cancelled line is READY.';

COMMIT;
