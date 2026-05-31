-- ============================================================================
-- reset-test-transactions-keep-so.sql
--   WIPE every downstream transaction document but KEEP the Sales Orders
--   (mfg_sales_orders + items + payments) AND the legacy POS sales orders.
--
-- Commander 2026-06-01: clear purchasing + delivery/invoice/return + inventory
-- + accounting so the SO → DO/PO → … convert flows can be re-tested from the
-- existing Sales Orders, without re-keying them. Master/config preserved.
--
-- WHAT IS KEPT
--   • mfg_sales_orders, mfg_sales_order_items, mfg_sales_order_payments
--   • mfg_so_audit_log, mfg_so_status_changes, mfg_so_price_overrides (SO history)
--   • Legacy POS: orders, order_items, payments, quotes, slip/lane tables
--   • All master/config (suppliers, warehouses, products, staff, customers, COA)
--
-- WHAT IS WIPED
--   • Purchasing: PR, PI, GRN, PO (+ legacy purchase consignment)
--   • Sales DOWNSTREAM only: delivery orders, sales invoices, delivery returns
--   • Inventory: movements, lots, transfers, takes, rack items
--   • Accounting: journal entries
--   • customer_credits (issued by returns/refunds)
--   • po_sequences (PO number counter → restarts at this year's 0001)
--
-- SELF-HEAL NOTE  (audited 2026-06-01 across DO/DR/PO/GRN/PI/SI reverse paths)
--   • LIVE/computed fields auto-restore once downstream rows are gone: the SO
--     lifecycle badge (computeSoLifecycle), per-line delivered qty, the
--     "Current …" doc-no pointers, and the invoiced status. No reset needed.
--   • STORED fields the API recounts via helpers (recomputeSoPicked,
--     recomputeSoStockAllocation, syncSoDeliveredFromDo) DO NOT self-heal under
--     a raw SQL bulk delete — the helpers never run. We reset them by hand at
--     the bottom of this script: mfg_sales_orders.status / proceeded_at /
--     linked_do_doc_no, and mfg_sales_order_items.po_qty_picked / stock_status
--     / stock_qty_ready / allocated_batch_no.
--   • paid_centi / deposit_centi / transfer_to are the SO's OWN data — KEPT.
--
-- SAFETY
--   • One transaction — all-or-nothing.
--   • Ordered DELETEs (children → parents), NO truncate-cascade, so nothing that
--     is kept can be cascade-wiped by accident.
--   • Delete-if-exists guard: skips tables that don't exist.
--
-- RUN: Supabase → SQL Editor → Run (service role / owner) on the 2990s PROD
--      project dolvxrchzbnqvahocwsu (Singapore). DESTRUCTIVE + irreversible.
--      TAKE A DB SNAPSHOT/BACKUP FIRST.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  t TEXT;
  -- ORDERED children → parents. No CASCADE, so order matters.
  wipe TEXT[] := ARRAY[
    -- ── Purchasing ──────────────────────────────────────────────
    'purchase_return_items', 'purchase_returns',
    'purchase_invoice_items', 'purchase_invoices',
    'grn_items', 'grns',
    'purchase_order_lines', 'purchase_order_items', 'purchase_orders',
    'purchase_consignment_note_items', 'purchase_consignment_notes',
    'purchase_consignment_order_items', 'purchase_consignment_orders',

    -- ── Sales DOWNSTREAM only (SO header/items/payments are KEPT) ─
    'delivery_return_items', 'delivery_returns',
    'sales_invoice_payments', 'sales_invoice_items', 'sales_invoices',
    'delivery_order_payments', 'delivery_order_items', 'delivery_orders',

    -- ── Inventory ───────────────────────────────────────────────
    'inventory_lot_consumptions', 'inventory_lots', 'inventory_movements',
    'stock_transfer_lines', 'stock_transfers',
    'stock_take_lines', 'stock_takes',
    'warehouse_rack_movements', 'warehouse_rack_items',

    -- ── Accounting (generated from the above) ───────────────────
    'journal_entry_lines', 'journal_entries',

    -- ── Customer credits issued by returns/refunds ──────────────
    'customer_credits',

    -- ── PO number counter (restart this year's PO numbering) ────
    'po_sequences'
  ];
BEGIN
  FOREACH t IN ARRAY wipe LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM public.%I', t);
      RAISE NOTICE 'wiped %', t;
    ELSE
      RAISE NOTICE 'skip (no table) %', t;
    END IF;
  END LOOP;
END $$;

-- ── Reset the STORED fields on the KEPT Sales Orders so they look "fresh" ───
-- A raw SQL bulk delete bypasses EVERY recount/sync helper in the API
-- (recomputeSoPicked, recomputeSoStockAllocation, syncSoDeliveredFromDo), so
-- we manually set each stored field to what those helpers would produce with
-- ZERO live downstream rows. Computed/live fields (lifecycle badge, delivered
-- qty, "Current …" doc-no pointers, invoiced status) auto-heal → no reset.
--
-- DELIBERATELY LEFT UNTOUCHED (they are the Sales Order's OWN data, not
-- downstream-driven): paid_centi, deposit_centi (customer deposit/payment on
-- the SO itself) and transfer_to (operator transfer note). Wiping these would
-- destroy data we are trying to KEEP.

-- Header: un-latch ONLY the downstream-driven statuses.
-- Preserve operator states CONFIRMED / ON_HOLD / CANCELLED as-is.
UPDATE mfg_sales_orders
   SET status = 'CONFIRMED'
 WHERE status IN ('IN_PRODUCTION','READY_TO_SHIP','SHIPPED','DELIVERED','INVOICED','CLOSED');

-- Header: clear the one-time "went to production" stamp + any manual DO link.
UPDATE mfg_sales_orders SET proceeded_at     = NULL WHERE proceeded_at     IS NOT NULL;
UPDATE mfg_sales_orders SET linked_do_doc_no = NULL WHERE linked_do_doc_no IS NOT NULL;

-- Lines: release the PO pick-lock + the stock allocation. All four are driven
-- by the now-deleted PO / DO / inventory rows; with zero live downstream the
-- recount helpers would land exactly here.
UPDATE mfg_sales_order_items
   SET po_qty_picked      = 0,
       stock_status       = 'PENDING',
       stock_qty_ready    = 0,
       allocated_batch_no = NULL
 WHERE po_qty_picked      <> 0
    OR stock_status       IS DISTINCT FROM 'PENDING'
    OR stock_qty_ready    <> 0
    OR allocated_batch_no IS NOT NULL;

COMMIT;

-- ── Quick verify (run after COMMIT) ────────────────────────────────────────
-- SELECT 'mfg_sales_orders' tbl, count(*) FROM mfg_sales_orders
-- UNION ALL SELECT 'mfg_sales_order_items', count(*) FROM mfg_sales_order_items
-- UNION ALL SELECT 'purchase_orders', count(*) FROM purchase_orders
-- UNION ALL SELECT 'grns', count(*) FROM grns
-- UNION ALL SELECT 'delivery_orders', count(*) FROM delivery_orders
-- UNION ALL SELECT 'sales_invoices', count(*) FROM sales_invoices
-- UNION ALL SELECT 'delivery_returns', count(*) FROM delivery_returns
-- UNION ALL SELECT 'inventory_movements', count(*) FROM inventory_movements
-- UNION ALL SELECT 'po_qty_picked>0', count(*) FROM mfg_sales_order_items WHERE po_qty_picked <> 0;
