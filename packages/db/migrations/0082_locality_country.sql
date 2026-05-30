-- ----------------------------------------------------------------------------
-- 0082 — Country auto-derive on locality rows (Task #121).
--
-- Commander 2026-05-27: country should not be a manual dropdown on the SO
-- form; it's auto-derived from the picked state. Adding a country column
-- to my_localities lets future Singapore / Thailand states declare their
-- own country so the SO snapshot is correct.
--
-- Snapshot country on the SO header so historic SOs survive a locality
-- country change (defense-in-depth — country on a Malaysian state isn't
-- expected to change but having the snapshot is cheap).
--
-- View refresh: mfg_sales_orders_with_payment_totals is `SELECT so.*`, so
-- it has to be DROP + CREATE'd (mirrors 0080) to pick up the new column.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE my_localities
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'Malaysia';

ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS customer_country text;

CREATE INDEX IF NOT EXISTS idx_my_localities_country ON my_localities(country);

-- Refresh the payment-totals view so customer_country is exposed via
-- GET /mfg-sales-orders (which reads mfg_sales_orders_with_payment_totals).
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
