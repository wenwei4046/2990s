-- ----------------------------------------------------------------------------
-- 0155 — SO-SKU spec P2: SERVICE revenue bucket + SVC-* SKU seeds + deposit
--        ledger marker (+ optional deposit backfill)
--
-- Spec: docs/specs/2026-06-04-so-sku-lines-and-sync-spec.md
-- Decisions (Loo 2026-06-05, §8): D1 service_centi bucket · D5 deposit →
-- payments ledger at SO create · D9 SVC-* SKU codes.
--
-- 1) D1 — service_centi / service_cost_centi on SO + DO + SI headers.
--    delivery_returns is excluded on purpose: DRs can never carry SERVICE
--    lines (P1 guard 409s them), so the bucket would be dead weight.
--    NOTE: delivery_orders / sales_invoices bucket columns historically live
--    in migrations only (not schema.ts) — this follows that precedent;
--    schema.ts declares the pair on mfg_sales_orders.
--
-- 2) D5 — is_deposit marker on mfg_sales_order_payments. The SO POST now
--    auto-writes the POS deposit as a ledger row; the marker lets the list
--    paid-rollup avoid double-counting header deposit_centi + ledger row,
--    and lets Finance tell auto-deposits from manual balance payments.
--
-- 3) D9 — seed the 6 SERVICE SKUs. sell_price_sen is DISPLAY/reference only:
--    delivery amounts are server-computed per order (computeSoDeliveryFee),
--    dispose/lift re-priced from the addons table at SO create. pos_active
--    = false keeps them out of the POS catalog grid (they are not products
--    a customer browses); Backend SKU pickers don't filter on it.
--
-- 4) Rebuild mfg_sales_orders_with_payment_totals — the recurring `so.*`
--    footgun (0080/0127/0147): the view's column list binds at creation, so
--    adding service_centi requires DROP+CREATE. Definition otherwise
--    identical to 0147.
--
-- 5) D5 BACKFILL — existing SOs with a header deposit get their ledger row
--    (is_deposit = true) so Paid / Balance / Account Sheet light up for
--    history too, not just new orders. Idempotent (NOT EXISTS guard).
-- ----------------------------------------------------------------------------

BEGIN;

-- 1) D1 — SERVICE revenue bucket -------------------------------------------
ALTER TABLE mfg_sales_orders ADD COLUMN IF NOT EXISTS service_centi      integer NOT NULL DEFAULT 0;
ALTER TABLE mfg_sales_orders ADD COLUMN IF NOT EXISTS service_cost_centi integer NOT NULL DEFAULT 0;
ALTER TABLE delivery_orders  ADD COLUMN IF NOT EXISTS service_centi      integer NOT NULL DEFAULT 0;
ALTER TABLE delivery_orders  ADD COLUMN IF NOT EXISTS service_cost_centi integer NOT NULL DEFAULT 0;
ALTER TABLE sales_invoices   ADD COLUMN IF NOT EXISTS service_centi      integer NOT NULL DEFAULT 0;
ALTER TABLE sales_invoices   ADD COLUMN IF NOT EXISTS service_cost_centi integer NOT NULL DEFAULT 0;

-- 2) D5 — deposit marker -----------------------------------------------------
ALTER TABLE mfg_sales_order_payments ADD COLUMN IF NOT EXISTS is_deposit boolean NOT NULL DEFAULT false;

-- 3) D9 — SERVICE SKU seeds (idempotent by code) ------------------------------
INSERT INTO mfg_products (id, code, name, category, status, cost_price_sen, sell_price_sen, pos_active)
SELECT v.id, v.code, v.name, 'SERVICE'::mfg_product_category, 'ACTIVE'::mfg_product_status, 0, v.sell_price_sen, false
FROM (VALUES
  ('mfg-svc-delivery',         'SVC-DELIVERY',         'Delivery fee',               0),
  ('mfg-svc-delivery-cross',   'SVC-DELIVERY-CROSS',   'Cross-category delivery',    0),
  ('mfg-svc-delivery-add',     'SVC-DELIVERY-ADD',     'Additional delivery fee',    0),
  ('mfg-svc-dispose-mattress', 'SVC-DISPOSE-MATTRESS', 'Dispose old mattress',       8000),
  ('mfg-svc-dispose-bedframe', 'SVC-DISPOSE-BEDFRAME', 'Dispose old bedframe',       8000),
  ('mfg-svc-lift-carry',       'SVC-LIFT-CARRY',       'Lift access / stair carry',  10000)
) AS v(id, code, name, sell_price_sen)
WHERE NOT EXISTS (SELECT 1 FROM mfg_products p WHERE p.code = v.code);

-- 4) Rebuild the payment-totals view (so.* re-expands to include service_centi)
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

-- 5) D5 backfill — existing header deposits → ledger rows ---------------------
-- Effect on reports: these SOs' Paid jumps from 0 to the deposit and
-- balance_centi_live drops accordingly (it was overstated before — the view
-- only ever summed the ledger). CANCELLED SOs excluded (their deposit went to
-- customer credit via creditFromCancelledSo).
INSERT INTO mfg_sales_order_payments
  (so_doc_no, paid_at, method, merchant_provider, installment_months,
   approval_code, amount_centi, collected_by, created_by, is_deposit, note)
SELECT
  so.doc_no,
  COALESCE(so.payment_date, so.so_date),
  so.payment_method,
  CASE WHEN so.payment_method = 'merchant' THEN so.merchant_provider END,
  CASE WHEN so.payment_method = 'merchant' THEN so.installment_months END,
  so.approval_code,
  so.deposit_centi,
  so.salesperson_id,
  so.created_by,
  true,
  'Backfill 0155: POS deposit recorded from SO header'
FROM mfg_sales_orders so
WHERE so.deposit_centi > 0
  AND so.payment_method IS NOT NULL
  AND so.status <> 'CANCELLED'
  AND NOT EXISTS (
    SELECT 1 FROM mfg_sales_order_payments pp
    WHERE pp.so_doc_no = so.doc_no AND pp.is_deposit
  );

COMMIT;
