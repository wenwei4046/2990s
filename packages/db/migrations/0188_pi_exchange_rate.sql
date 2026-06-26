-- ----------------------------------------------------------------------------
-- 0188 — multi-currency AP (v1): an exchange rate on the Purchase Invoice so a
-- foreign-currency PI (RMB / USD / SGD) converts to MYR at GL-POST time only.
--
-- The PI itself keeps showing its ORIGINAL currency + original *_centi totals;
-- this rate is applied ONLY when postPiAccounting writes the journal entry
-- (Dr 1200 Inventory / Cr 2000 AP), so the GL records MYR while the invoice
-- stays in its currency. Without it a RMB invoice posted RMB numbers into the
-- GL as if they were MYR (mixed / wrong books).
--
-- DEFINITION: exchange_rate = MYR per 1 unit of the PI's currency (e.g. RMB→MYR
-- ≈ 0.62). MYR invoices keep rate = 1, so their GL behaviour is unchanged.
--   amount_myr_centi = round(amount_foreign_centi * exchange_rate)
--
-- Additive + idempotent — safe to re-run.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(14,6) NOT NULL DEFAULT 1;

COMMENT ON COLUMN purchase_invoices.exchange_rate IS
  'MYR per 1 unit of the PI currency (1 for MYR); used to convert AP to MYR at GL-post time.';

COMMIT;
