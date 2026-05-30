-- ----------------------------------------------------------------------------
-- 0101 — GRN ↔ PO money/date parity (GRN PO-clone rebuild).
--
-- Gives the Goods Received Note module the same money + date shape as the
-- Purchase Order module so the rebuilt GRN detail page (View→Edit gate, single
-- Save, inline line editing, live totals) can mirror PurchaseOrderDetail 1:1.
-- This migration is ADDITIVE and non-destructive — every new column is
-- nullable / defaulted so existing grns + grn_items rows survive untouched.
--
-- Two parts:
--   1. grns header gets currency + per-document money rollups (subtotal / tax /
--      total) so the GRN list + detail can render a Totals card like the PO.
--      The currency enum reuses the SAME `currency_code` type that
--      purchase_orders.currency uses (created in migration 0041).
--   2. grn_items gets line_total_centi (so the recompute helper can Σ it like
--      recomputePoTotals), a per-line delivery_date, a unit_cost_centi snapshot,
--      and a supplier_sku snapshot — matching the PO line shape.
--
-- No RLS changes: grns + grn_items already carry policies (migration 0042).
-- No new grn_status value (GRN cancel is out of scope for this task).
-- ----------------------------------------------------------------------------

BEGIN;

-- ── 1. grns header money columns ────────────────────────────────────────────
-- Mirror purchase_orders.{currency, subtotal_centi, tax_centi, total_centi}.
-- recomputeGrnTotals (apps/api/src/routes/grns.ts) writes subtotal_centi +
-- total_centi as Σ grn_items.line_total_centi (no tax for GRN).
ALTER TABLE grns
  ADD COLUMN IF NOT EXISTS currency       currency_code NOT NULL DEFAULT 'MYR',
  ADD COLUMN IF NOT EXISTS subtotal_centi INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_centi      INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_centi    INTEGER       NOT NULL DEFAULT 0;

-- ── 2. grn_items line money + date columns ──────────────────────────────────
-- line_total_centi = qty_received * unit_price_centi - discount_centi
--   (discount_centi already exists on grn_items from migration 0057).
-- delivery_date   — per-line expected/received date (parity with PO line).
-- unit_cost_centi — cost snapshot (parity with purchase_order_items).
-- supplier_sku    — supplier SKU snapshot (parity with purchase_order_items).
ALTER TABLE grn_items
  ADD COLUMN IF NOT EXISTS line_total_centi INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_date    DATE,
  ADD COLUMN IF NOT EXISTS unit_cost_centi  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier_sku     TEXT;

COMMIT;
