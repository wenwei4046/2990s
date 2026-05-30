-- ----------------------------------------------------------------------------
-- 0070 — Sales Order: payment_date column (PR #157).
--
-- Commander 2026-05-27: "Bank Transfer、Cash 也是需要 Approval Code 的，还
-- 需要一个日期填写收钱的日期". Every payment method (merchant card, bank
-- transfer, cash) needs the actual date the funds were received, captured
-- alongside the existing approval_code.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS payment_date DATE;

COMMIT;
