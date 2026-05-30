-- ----------------------------------------------------------------------------
-- 0069 — Sales Order: approval_code column (PR #150).
--
-- Commander 2026-05-26: "不是有一个 approval code 之类的吗". Merchant card
-- transactions return an approval / authorisation code from the acquirer
-- (GHL/HLB/MBB/PBB terminals). The card receipt stamps it on the slip, and
-- we want a place to log it against the SO for cross-reference.
--
-- Also re-models installment as a SUB-TYPE of merchant rather than its own
-- top-level payment_method. The DB doesn't enforce this — both columns are
-- nullable text/int — but the UI flow does: payment_method = 'merchant',
-- installment_months optional (NULL = normal swipe, 6/12 = installment).
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS approval_code TEXT;

COMMIT;
