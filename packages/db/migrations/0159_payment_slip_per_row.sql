-- 0159_payment_slip_per_row.sql
-- Loo 2026-06-06 (spec D4) — EVERY payment carries its own slip. Legacy rows
-- stay NULL and the UIs fall back to the order-level slip (mfg_sales_orders.
-- slip_key) for display.

BEGIN;

ALTER TABLE mfg_sales_order_payments ADD COLUMN IF NOT EXISTS slip_key text;

COMMIT;
