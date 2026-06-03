-- ----------------------------------------------------------------------------
-- 0127 — Refresh mfg_sales_orders_with_payment_totals view (delivery_fee_centi)
--
-- Wei Siang 2026-06-03 found a 500 on /mfg-sales-orders (Sales Orders list):
--   column mfg_sales_orders_with_payment_totals.delivery_fee_centi does not exist
--
-- Root cause: the view is `SELECT so.*`, whose column list Postgres binds at
-- view-creation time. delivery_fee_centi was added to mfg_sales_orders AFTER the
-- view's last rebuild (0080/0082/0086), so the view never exposed it and the
-- list query selecting it errored. Same recurring `so.*` footgun as 0080.
--
-- Fix: DROP + CREATE the view (identical definition to 0086) so `so.*` re-expands
-- to include delivery_fee_centi and any other columns added since. Read-only view
-- rebuild — no data touched. Already applied to prod via the SQL editor; this
-- migration captures it in-repo so a fresh rebuild stays in sync.
--
-- ⚠️ APPLIED MANUALLY BY IT. View-only change, idempotent.
-- ----------------------------------------------------------------------------

BEGIN;

DROP VIEW IF EXISTS mfg_sales_orders_with_payment_totals;

CREATE VIEW mfg_sales_orders_with_payment_totals AS
SELECT
  so.*,
  coalesce(p.paid_total, 0)                                     AS paid_total_centi,
  GREATEST(so.local_total_centi - coalesce(p.paid_total, 0), 0) AS balance_centi_live
FROM mfg_sales_orders so
LEFT JOIN (
  SELECT so_doc_no, sum(amount_centi)::bigint AS paid_total
  FROM mfg_sales_order_payments
  GROUP BY so_doc_no
) p ON p.so_doc_no = so.doc_no;

COMMIT;
