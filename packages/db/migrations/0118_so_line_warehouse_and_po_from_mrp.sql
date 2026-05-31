-- ----------------------------------------------------------------------------
-- 0118 — Per-LINE warehouse binding on SO + MRP-origin tag on PO lines
-- (Commander 2026-05-31, MRP/Supply-Chain rebuild).
--
-- Decision (supersedes the 2026-05-30 header-level allocation_warehouse_id in
-- 0112, which was never populated): the warehouse binds at the SO LINE, not the
-- SO header. Each SO line carries its own warehouse_id so MRP + auto-allocation
-- run strictly PER-WAREHOUSE (2990 can't pull stock across warehouses — that
-- needs a stock transfer). A single SO can therefore split lines across
-- warehouses. The "overall" MRP view is the UNION of per-warehouse results,
-- never a cross-warehouse pooled recompute.
--
-- #1 mfg_sales_order_items.warehouse_id
--    Per-line ship-from warehouse. Backfilled from each SO's customer_state via
--    state_warehouse_mappings (best-effort; unmapped states stay NULL and the
--    engines treat NULL as its own bucket). The create/edit code stamps it going
--    forward (state default, editable per line).
--
-- #2 purchase_order_items.from_mrp
--    Tags a PO line raised through the MRP "convert to PO" path. MRP-origin lines
--    are REFERENCE-ONLY: they do NOT lock the source SO line (excluded from the
--    po_qty_picked recount + the qty_exceeds_remaining cap), so the same SO line
--    can be converted to PO an unlimited number of times from MRP. The ordinary
--    SO→PO "From SO" picker keeps its cap (from_mrp stays false there).
-- ----------------------------------------------------------------------------

BEGIN;

-- #1 — per-line ship-from warehouse.
ALTER TABLE mfg_sales_order_items
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_mso_items_warehouse
  ON mfg_sales_order_items (warehouse_id)
  WHERE warehouse_id IS NOT NULL;

-- Backfill from the parent SO's customer_state. state_warehouse_mappings keys on
-- the canonical state name; map the common WP-KL alias the same way the API's
-- deriveSalesLocationFromState helper does.
UPDATE mfg_sales_order_items it
SET warehouse_id = swm.warehouse_id
FROM mfg_sales_orders so
JOIN state_warehouse_mappings swm
  ON swm.state = CASE
       WHEN so.customer_state = 'Wilayah Persekutuan Kuala Lumpur' THEN 'Kuala Lumpur'
       ELSE so.customer_state
     END
WHERE it.doc_no = so.doc_no
  AND it.warehouse_id IS NULL
  AND swm.warehouse_id IS NOT NULL;

-- #2 — MRP-origin tag on PO lines.
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS from_mrp BOOLEAN NOT NULL DEFAULT false;

COMMIT;
