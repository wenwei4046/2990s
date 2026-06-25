-- ----------------------------------------------------------------------------
-- 0199 — Delivery-date INTEGRITY: never overwrite the customer's ORIGINAL date.
--
-- Owner rule (his HC Delivery sheet has THREE separate date columns and they
-- must never collapse into one): the customer's ORIGINAL delivery date
-- (mfg_sales_orders.customer_delivery_date — the date the customer first picked
-- at order time) must NEVER be overwritten by a later amendment. Amendments go
-- into SEPARATE columns so the original always survives as an audit anchor.
--
-- Until now the Delivery Planning "schedule" action wrote the firm/new trip date
-- straight into customer_delivery_date — silently clobbering the customer's
-- original pick. This migration adds the dedicated amendment columns so the
-- route can write the new date WITHOUT touching the original:
--
--   mfg_sales_orders.amend_date_from_customer  — HC "Amend Delivery Date from
--     Customer": the date the CUSTOMER requests to change TO (their ask).
--   mfg_sales_orders.amended_delivery_date     — HC "Amended Delivery Date": the
--     new date WE propose / confirm (the firm trip date). The Delivery Planning
--     schedule action writes HERE now, never customer_delivery_date.
--
--   delivery_orders.arrives_em_warehouse_date  — HC EM-region "Arrives EM
--     Warehouse Date": the date the goods arrive at the East-Malaysia transit
--     warehouse on a cross-border leg.
--
-- The "effective" delivery date that drives Days Left / OVERDUE in the route is
-- amended_delivery_date ?? customer_delivery_date — the amendment wins for the
-- countdown, while the Original column still shows customer_delivery_date.
--
-- ALL columns are nullable with NO default — purely additive raw-data capture.
-- DATE (not enums, not timestamptz). Additive + idempotent — safe to re-run
-- (ADD COLUMN IF NOT EXISTS). No data backfill, no trigger. Whole file is
-- transactional.
--
-- Apply BEFORE deploying the delivery-planning / SO / DO route changes that
-- SELECT / PATCH these columns (migrate-before-deploy).
-- ----------------------------------------------------------------------------

BEGIN;

-- ── 1. Amendment dates on mfg_sales_orders ───────────────────────────────────
-- The ORIGINAL customer_delivery_date stays untouched; amendments live here.
ALTER TABLE mfg_sales_orders ADD COLUMN IF NOT EXISTS amend_date_from_customer DATE;
ALTER TABLE mfg_sales_orders ADD COLUMN IF NOT EXISTS amended_delivery_date    DATE;

COMMENT ON COLUMN mfg_sales_orders.amend_date_from_customer IS
  'HC "Amend Delivery Date from Customer": the date the CUSTOMER requests to change TO. The original customer_delivery_date is never overwritten — this records the customer''s requested new date. Nullable.';
COMMENT ON COLUMN mfg_sales_orders.amended_delivery_date IS
  'HC "Amended Delivery Date": the new delivery date WE propose / confirm (the firm trip date). The Delivery Planning schedule action writes HERE — NOT customer_delivery_date (which stays the customer''s ORIGINAL pick). Drives Days Left / OVERDUE (effective = amended_delivery_date ?? customer_delivery_date). Nullable.';

-- ── 2. EM-warehouse arrival date on delivery_orders ──────────────────────────
-- The cross-border (East Malaysia) transit-warehouse arrival date.
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS arrives_em_warehouse_date DATE;

COMMENT ON COLUMN delivery_orders.arrives_em_warehouse_date IS
  'HC EM-region "Arrives EM Warehouse Date": the date the goods arrive at the East-Malaysia transit warehouse on a cross-border delivery leg. Nullable.';

COMMIT;
