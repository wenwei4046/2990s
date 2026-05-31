-- ============================================================================
-- reset-test-transactions.sql  —  WIPE all transactional documents, keep master
--
-- Commander 2026-05-31: clear every transaction document so the team can re-test
-- the purchasing + sales + inventory flows from a clean slate. MASTER / config
-- data is preserved (suppliers, warehouses, racks, products + pricing, all
-- libraries, staff, drivers, customers, chart of accounts, dropdown configs).
--
-- HOW NUMBERS RESET
--   • Every document number (GRN/PI/PR/SO/DO/SI/DR/transfer/take) is COUNT-BASED
--     in the API (count of this-month's rows + 1), so deleting the rows already
--     restarts them — nothing extra to do.
--   • Only TWO persistent counters survive a row delete, reset explicitly below:
--       - order_seq      (Postgres sequence, legacy POS "orders" → SO-XXXX)
--       - po_sequences   (table, PO numbers per year)
--
-- SAFETY
--   • One transaction — all-or-nothing. If anything errors, nothing is wiped.
--   • Truncate-if-exists: skips tables that don't exist (e.g. consignment tables
--     that were already dropped), so it can't half-fail on a missing table.
--   • RESTART IDENTITY + CASCADE: resets serial PKs and follows FK chains.
--
-- RUN: paste into Supabase → SQL Editor → Run (as the service role / owner).
-- This is DESTRUCTIVE and irreversible. Take a snapshot first if unsure.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  t TEXT;
  wipe TEXT[] := ARRAY[
    -- ── Purchasing ──────────────────────────────────────────────
    'purchase_return_items', 'purchase_returns',
    'purchase_invoice_items', 'purchase_invoices',
    'grn_items', 'grns',
    'purchase_order_lines', 'purchase_order_items', 'purchase_orders',
    -- legacy purchase-consignment (only if still present)
    'purchase_consignment_note_items', 'purchase_consignment_notes',
    'purchase_consignment_order_items', 'purchase_consignment_orders',

    -- ── Sales (ERP / mfg) ───────────────────────────────────────
    'mfg_so_audit_log', 'mfg_so_status_changes', 'mfg_so_price_overrides',
    'mfg_sales_order_payments', 'mfg_sales_order_items', 'mfg_sales_orders',
    'delivery_order_payments', 'delivery_order_items', 'delivery_orders',
    'sales_invoice_payments', 'sales_invoice_items', 'sales_invoices',
    'delivery_return_items', 'delivery_returns',

    -- ── Sales (legacy POS) ──────────────────────────────────────
    'order_slip_events', 'order_lane_history', 'pending_slip_uploads',
    'payments', 'quotes', 'order_items', 'orders',
    -- legacy consignment (only if still present)
    'consignment_note_items', 'consignment_notes',
    'consignment_order_items', 'consignment_orders',

    -- ── Inventory ───────────────────────────────────────────────
    'inventory_lot_consumptions', 'inventory_lots', 'inventory_movements',
    'stock_transfer_lines', 'stock_transfers',
    'stock_take_lines', 'stock_takes',
    'warehouse_rack_movements', 'warehouse_rack_items',

    -- ── Accounting (generated from the above) ───────────────────
    'journal_entry_lines', 'journal_entries',

    -- ── Customer credits issued by returns/refunds ──────────────
    'customer_credits'
  ];
BEGIN
  FOREACH t IN ARRAY wipe LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', t);
      RAISE NOTICE 'wiped %', t;
    ELSE
      RAISE NOTICE 'skip (no table) %', t;
    END IF;
  END LOOP;
END $$;

-- ── Reset the two persistent counters ──────────────────────────────────────
-- Legacy POS sales-order id sequence → next is SO-2990 (brand alignment).
ALTER SEQUENCE IF EXISTS order_seq RESTART WITH 2990;

-- PO number counter table → next PO restarts at this year's 0001.
TRUNCATE TABLE po_sequences;

COMMIT;

-- ── Quick verify (run after COMMIT) ────────────────────────────────────────
-- SELECT 'orders' tbl, count(*) FROM orders
-- UNION ALL SELECT 'mfg_sales_orders', count(*) FROM mfg_sales_orders
-- UNION ALL SELECT 'purchase_orders', count(*) FROM purchase_orders
-- UNION ALL SELECT 'grns', count(*) FROM grns
-- UNION ALL SELECT 'inventory_movements', count(*) FROM inventory_movements;
