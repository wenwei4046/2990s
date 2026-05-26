-- ----------------------------------------------------------------------------
-- 0067 — Sales Order: customer_so_no column (PR — Commander 2026-05-26).
--
-- Commander rebuilt the "Order Details" section of the New SO page to
-- mirror the POS pattern. That layout has both Customer PO No (their
-- buy-side ref) AND Customer SO No (their own internal SO number from
-- their ERP — useful when AKEMI/HOUZS need to cross-reference our SOs
-- against their own). Schema didn't have a column for it; storing in
-- `ref` (free-text "Reference") would mix two different concepts.
--
-- Free-text on purpose — different customers number their SOs
-- differently; we don't want to normalize.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS customer_so_no TEXT;

COMMIT;
