-- ----------------------------------------------------------------------------
-- 0068 — Sales Order: payment fields (PR #143).
--
-- Commander 2026-05-26: "你把 POS system 的 payment 那个地方也放进来 Sales
-- Order 里面". The POS handover already collects payment_method, optional
-- installment_months / merchant_provider, plus tracks deposit + paid totals.
-- Mirror the same shape on mfg_sales_orders so the backend SO detail page
-- can render the same Payment card and persist the choices.
--
-- Fields:
--   payment_method      — 'cash' | 'transfer' | 'merchant' | 'installment'
--                          (free text on the SO row; the strict enum exists
--                          on POS orders.payment_method and is mirrored here
--                          for cross-system parity.)
--   installment_months  — 6 or 12, NULL unless payment_method = 'installment'
--   merchant_provider   — 'GHL'/'HLB'/'MBB'/'PBB' unless merchant
--   deposit_centi       — agreed deposit (typically 50% of total)
--   paid_centi          — running total of payments received so far
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS payment_method     TEXT,
  ADD COLUMN IF NOT EXISTS installment_months INTEGER,
  ADD COLUMN IF NOT EXISTS merchant_provider  TEXT,
  ADD COLUMN IF NOT EXISTS deposit_centi      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_centi         INTEGER NOT NULL DEFAULT 0;

COMMIT;
