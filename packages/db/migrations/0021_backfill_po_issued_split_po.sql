-- 0021_backfill_po_issued_split_po.sql
-- Cross-supplier split-PO fix: until now, generating a PO for ANY supplier on
-- an order flipped orders.po_issued=true wholesale, even if some items were
-- still uncovered. The fix in apps/api/src/routes/purchase-orders.ts only
-- flips po_issued=true when every (order_id, sku) is in a purchase_order_lines
-- row. Backfill any rows that are stale under the new semantics: po_issued is
-- TRUE but the order still has at least one item without a matching PO line.
--
-- Affected at time of writing: SO-9008 (MAT-CLOUD covered by PO-2026-0001 SLP,
-- SOF-NOOR still pending KFA). Idempotent — safe to re-run.

UPDATE orders
SET po_issued = FALSE,
    po_issued_at = NULL,
    po_issued_by = NULL
WHERE po_issued = TRUE
  AND id IN (
    SELECT DISTINCT oi.order_id
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE NOT EXISTS (
      SELECT 1 FROM purchase_order_lines pol
      WHERE pol.order_id = oi.order_id AND pol.sku = p.sku
    )
  );
