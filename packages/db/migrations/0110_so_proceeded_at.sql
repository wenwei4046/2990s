-- 0110_so_proceeded_at.sql
-- POS "Proceed" timestamp on the Sales Order.
--
-- Auto-stamped the FIRST time an SO moves to IN_PRODUCTION (the POS "Proceed"
-- action; see PATCH /mfg-sales-orders/:docNo/status). This is the "Process
-- Date" the coordinator sees on the SO detail page.
--
-- Deliberately a NEW column — NOT the existing `internal_expected_dd` (a future
-- production-ready date that drives MRP order-by math) and NOT the dead
-- `processing_date` column (whose name is already overloaded by the UI's
-- "Processing Date" = internal_expected_dd).
--
-- Additive + nullable: safe, no backfill, order-independent (depends only on
-- mfg_sales_orders from 0042). NOTE: the sibling branch feat/cost-sell-split
-- owns 0109_mfg_sell_price.sql; this migration takes 0110 to avoid a collision.

ALTER TABLE mfg_sales_orders ADD COLUMN IF NOT EXISTS proceeded_at timestamptz;
