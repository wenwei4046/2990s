-- ----------------------------------------------------------------------------
-- 0080 — Refresh mfg_sales_orders_with_payment_totals view.
--
-- Commander 2026-05-27 found a 500 on /mfg-sales-orders:
--   column mfg_sales_orders_with_payment_totals.mattress_sofa_cost_centi does not exist
--
-- Root cause: migration 0076 created the view as `SELECT so.*`. Postgres binds
-- the column list at view-creation time, so the 4 category cost columns added
-- in 0079 (mattress_sofa_cost_centi / bedframe_cost_centi / accessories_cost_centi
-- / others_cost_centi) are NOT picked up by the view automatically. The API's
-- GET /mfg-sales-orders selects from the view → SQL error.
--
-- Fix: DROP + CREATE the view. The new SELECT so.* expands to include all
-- columns currently on mfg_sales_orders, including the 4 cost columns and
-- any future additions until the next manual refresh.
-- ----------------------------------------------------------------------------

BEGIN;

DROP VIEW IF EXISTS mfg_sales_orders_with_payment_totals;

CREATE VIEW mfg_sales_orders_with_payment_totals AS
SELECT
  so.*,
  coalesce(p.paid_total, 0)                                                AS paid_total_centi,
  GREATEST(so.local_total_centi - coalesce(p.paid_total, 0), 0)            AS balance_centi_live
FROM mfg_sales_orders so
LEFT JOIN (
  SELECT so_doc_no, sum(amount_centi)::bigint AS paid_total
  FROM mfg_sales_order_payments
  GROUP BY so_doc_no
) p ON p.so_doc_no = so.doc_no;

COMMIT;
