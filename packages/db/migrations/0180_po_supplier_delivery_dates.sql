-- ----------------------------------------------------------------------------
-- 0180 — PO Supplier Delivery Date 2/3/4 (header + line level).
--
-- Commander 2026-06-19: the supplier revises the delivery date (pushes it
-- back). We capture up to three successive revisions per PO header AND per PO
-- line: supplier_delivery_date_2 (1st revision), _3 (2nd), _4 (3rd).
--
-- Semantics:
--   * expected_at (header) KEEPS meaning "original earliest line delivery date"
--     — it is still recomputed as the earliest line delivery_date and is NOT
--     flipped to MAX.
--   * delivery_date (line) KEEPS meaning the line's original delivery date.
--   * The EFFECTIVE (latest revised) delivery date every reader uses =
--     GREATEST over non-null of [base date, date2, date3, date4]. PostgreSQL's
--     GREATEST ignores NULLs, returning NULL only when ALL args are NULL.
--   * On-time rate is measured against the EFFECTIVE (latest revised) date.
--   * All new columns are nullable; default NULL.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS); does NOT backfill.
-- ----------------------------------------------------------------------------

BEGIN;

-- Header-level revised dates.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_delivery_date_2 date;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_delivery_date_3 date;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_delivery_date_4 date;

-- Line-level revised dates.
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS supplier_delivery_date_2 date;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS supplier_delivery_date_3 date;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS supplier_delivery_date_4 date;

-- Expose the effective (latest revised) header delivery date on the outstanding
-- view so the Outstanding page sorts/filters by the date the supplier is
-- actually committing to now. effective_expected_at = GREATEST over non-null of
-- the base + the three revisions; falls back to NULL only when all are NULL.
-- The raw expected_at column is kept alongside it (callers may still want the
-- original earliest date).
CREATE OR REPLACE VIEW v_po_outstanding AS
SELECT
  po.id, po.po_number, po.supplier_id, po.po_date, po.expected_at,
  GREATEST(
    po.expected_at,
    po.supplier_delivery_date_2,
    po.supplier_delivery_date_3,
    po.supplier_delivery_date_4
  )                                     AS effective_expected_at,
  po.supplier_delivery_date_2, po.supplier_delivery_date_3, po.supplier_delivery_date_4,
  po.currency, po.subtotal_centi, po.total_centi, po.status,
  COALESCE(SUM(poi.qty), 0)            AS qty_ordered,
  COALESCE(SUM(poi.received_qty), 0)   AS qty_received,
  COALESCE(SUM(poi.qty), 0) - COALESCE(SUM(poi.received_qty), 0) AS qty_outstanding,
  CASE
    WHEN po.status IN ('RECEIVED', 'CANCELLED') THEN FALSE
    WHEN COALESCE(SUM(poi.qty), 0) > COALESCE(SUM(poi.received_qty), 0) THEN TRUE
    ELSE FALSE
  END AS is_outstanding
FROM purchase_orders po
LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
GROUP BY po.id;

COMMIT;
