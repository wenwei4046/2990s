-- 0133_so_delivery_fee.sql
-- Activate the delivery fee on the LIVE manufacturing-SO path.
--
-- Background (2026-06-02, Chairman): the base + cross-category delivery fee
-- (delivery_fee_config, migration 0029) was only ever wired into the dead
-- legacy retail /orders path. The live POS->SO path (POST /mfg-sales-orders)
-- charged ZERO delivery — it computed the fee for *display* in the POS handover
-- summary, then dropped it before submit. This column lets the SO snapshot the
-- server-recomputed delivery fee so it survives recomputeTotals and shows on
-- the SO detail.
--
-- The fee is folded into local_total_centi / total_revenue_centi /
-- balance_centi / total_margin_centi (same treatment as the fabric-tier add-on
-- — pure-margin revenue), while the per-category revenue buckets stay
-- goods-only. recomputeTotals reads this column back on every re-roll so the
-- fee is never erased.
--
-- Only POS handover orders set it (server gates on an explicit applyDeliveryFee
-- flag); backend-authored SOs keep delivery_fee_centi = 0 and are unaffected.

ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS delivery_fee_centi integer NOT NULL DEFAULT 0;

ALTER TABLE mfg_sales_orders
  ADD CONSTRAINT mso_delivery_fee_nonneg CHECK (delivery_fee_centi >= 0);

COMMENT ON COLUMN mfg_sales_orders.delivery_fee_centi IS
  'Server-recomputed delivery fee in sen (base + cross-category + special-model + additional). Snapshot at create; folded into local_total/total_revenue/balance/margin; read back by recomputeTotals so re-rolls preserve it. 0 for non-POS SOs. Migration 0133.';
