-- ----------------------------------------------------------------------------
-- 0181 — Purchase-Consignment Order supplier delivery date 2/3/4 (header + line).
--
-- Clones the PO feature (migration 0180) for the consignment purchase flow.
-- Commander 2026-06-19: a consignment supplier can revise the delivery date the
-- same way a normal PO supplier does — capture up to three successive revisions
-- per PC-Order header AND per line.
--
-- Semantics (identical to 0180):
--   * expected_at (header) / delivery_date (line) KEEP meaning the original date.
--   * The EFFECTIVE (latest revised) date every reader uses = GREATEST over
--     non-null of [base, _2, _3, _4] — computed only at READ sites via the shared
--     effectiveDelivery() helper. NOT flipped to MAX in storage.
--   * All new columns are nullable; default NULL.
--
-- Consignment has NO MRP / NO outstanding view / NO supplier on-time metric, so
-- this is display-only — the columns feed the header/line inputs + the shared
-- purchase-order PDF the PCO reuses (which already computes effectiveDelivery).
-- No view to recreate (there is no v_pc_*_outstanding).
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS). NOT applied by hand here —
-- the owner applies migrations on prod.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE purchase_consignment_orders      ADD COLUMN IF NOT EXISTS supplier_delivery_date_2 date;
ALTER TABLE purchase_consignment_orders      ADD COLUMN IF NOT EXISTS supplier_delivery_date_3 date;
ALTER TABLE purchase_consignment_orders      ADD COLUMN IF NOT EXISTS supplier_delivery_date_4 date;

ALTER TABLE purchase_consignment_order_items ADD COLUMN IF NOT EXISTS supplier_delivery_date_2 date;
ALTER TABLE purchase_consignment_order_items ADD COLUMN IF NOT EXISTS supplier_delivery_date_3 date;
ALTER TABLE purchase_consignment_order_items ADD COLUMN IF NOT EXISTS supplier_delivery_date_4 date;

COMMIT;
