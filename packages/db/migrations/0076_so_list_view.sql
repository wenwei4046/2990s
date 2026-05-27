-- ----------------------------------------------------------------------------
-- 0076 — SO list view with live payment totals (Follow-up #83).
--
-- Commander 2026-05-27: The SO list page's Balance column reads
-- mfg_sales_orders.balance_centi, but after PR-C (PR #163) the source of
-- truth for actual paid amount is the mfg_sales_order_payments ledger.
-- The header.balance_centi column is set on insert/recompute to local_total
-- (not net of payments), so the list grid shows a stale Balance.
--
-- Fix: a view that joins each SO header to its sum of payments and
-- exposes a live balance_centi_live = max(local_total - paid_total, 0).
-- The GET /mfg-sales-orders list endpoint reads from this view; the SO
-- detail page continues to read from the base table (it computes its own
-- live total from the payments query already).
-- ----------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE VIEW mfg_sales_orders_with_payment_totals AS
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

-- Views inherit RLS from the underlying tables when run with
-- security_invoker (Postgres 15+, Supabase default). The base table
-- mfg_sales_orders already has staff-readable RLS; nothing extra needed.

COMMIT;
