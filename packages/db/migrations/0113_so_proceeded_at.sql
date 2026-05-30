-- 0113_so_proceeded_at.sql
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
-- mfg_sales_orders from 0042). Renumbered 0110 -> 0113 when merging into main
-- (main had already reached 0112). Already applied to the production Supabase
-- on 2026-05-30 (idempotent ADD COLUMN IF NOT EXISTS — a fresh-DB re-run is a
-- safe no-op).

ALTER TABLE mfg_sales_orders ADD COLUMN IF NOT EXISTS proceeded_at timestamptz;
