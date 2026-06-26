-- ----------------------------------------------------------------------------
-- 0201 — Amend Client Date Reason (HC "Amend Client Date Reason").
--
-- Pairs with the delivery-date amendment columns added in 0199
-- (amend_date_from_customer / amended_delivery_date): when the delivery date is
-- amended, the HC Delivery sheet also captures WHY the client's date changed.
-- This is the free-text reason field that travels with those amend dates.
--
-- One nullable TEXT column, no default — purely additive raw-data capture.
-- Additive + idempotent — safe to re-run (ADD COLUMN IF NOT EXISTS). No
-- backfill, no trigger. Whole file is transactional.
--
-- ⚠️ amend_reason must NOT be added to the SO LIST query: the list selects the
-- shared HEADER column set FROM the view mfg_sales_orders_with_payment_totals,
-- which fixes its column list at creation time and does NOT carry amend_reason.
-- The SO DETAIL GET reads the BASE table (mfg_sales_orders) and appends
-- amend_reason there; POST/PATCH persist it. See apps/api/src/routes/
-- mfg-sales-orders.ts.
--
-- Apply BEFORE deploying the SO / Delivery-Planning route changes that SELECT /
-- PATCH this column (migrate-before-deploy).
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE mfg_sales_orders ADD COLUMN IF NOT EXISTS amend_reason TEXT;

COMMENT ON COLUMN mfg_sales_orders.amend_reason IS
  'HC "Amend Client Date Reason": free-text reason WHY the client delivery date was amended. Pairs with amend_date_from_customer / amended_delivery_date (migration 0199). Nullable. NOT in the SO list HEADER (the list reads the payment-totals view which lacks this column) — only the SO detail GET (base table), POST and PATCH carry it.';

COMMIT;
