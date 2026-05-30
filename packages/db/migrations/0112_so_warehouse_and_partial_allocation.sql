-- ----------------------------------------------------------------------------
-- 0112 — Per-warehouse SO allocation + partial-line readiness
-- (Commander 2026-05-30, #3 + #4).
--
-- #3 Per-warehouse scope:
--   B2C operator's PJ customer shouldn't be served from Belakong stock —
--   logistics + transit time make cross-warehouse pulls undesirable in real
--   ops. Add allocation_warehouse_id on mfg_sales_orders:
--     NULL  — keep the current cross-warehouse behaviour (backward-compat)
--     set   — allocate ONLY from that warehouse's inventory_balances
--
-- #4 Partial line readiness:
--   Today a line of qty 3 with only 2 in stock flips to PENDING (all-or-
--   nothing). Wei Siang wants the 2 to count as "ready". Add stock_qty_ready
--   integer, allow stock_status='PARTIAL', let summariseReadiness see it.
-- ----------------------------------------------------------------------------

BEGIN;

-- #3 — per-SO allocation warehouse.
ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS allocation_warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_mfg_so_allocation_wh
  ON mfg_sales_orders (allocation_warehouse_id)
  WHERE allocation_warehouse_id IS NOT NULL;

-- #4 — partial-line readiness.
ALTER TABLE mfg_sales_order_items
  ADD COLUMN IF NOT EXISTS stock_qty_ready INTEGER NOT NULL DEFAULT 0;
-- stock_status remains a text column (no enum constraint to alter); helper
-- code now treats 'PARTIAL' as a valid value alongside 'PENDING' / 'READY'.

COMMIT;
