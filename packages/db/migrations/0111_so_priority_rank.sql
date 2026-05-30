-- ----------------------------------------------------------------------------
-- 0111 — Sales Order manual priority override (Commander 2026-05-30, #38).
--
-- Default allocation FIFO ranks by customer_delivery_date ASC (earlier delivery
-- wins). But B2C reality: a walk-in customer in the showroom RIGHT NOW needs
-- the stock even when an older queued order has earlier delivery. Salesperson
-- clicks "Mark urgent" → priority_rank gets a small positive integer; non-null
-- priority_rank sorts BEFORE any date-based FIFO. Lower number = higher
-- priority (1 = highest). NULL = normal FIFO order.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS priority_rank INTEGER,
  ADD COLUMN IF NOT EXISTS priority_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS priority_set_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_mfg_so_priority_rank
  ON mfg_sales_orders (priority_rank)
  WHERE priority_rank IS NOT NULL;

COMMIT;
