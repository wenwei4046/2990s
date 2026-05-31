-- ============================================================================
-- 0116_reset_test_transactions_fn.sql
--
-- Commander 2026-05-31 — TEMPORARY testing helper. Wraps the
-- reset-test-transactions.sql wipe into a callable function so the Backend
-- "Clear test data" button (System Health → Danger zone) can run it via
-- supabase.rpc('reset_test_transactions'). Same semantics as the standalone
-- script: clears every transactional document, keeps all master/config data,
-- resets the two persistent counters (order_seq → 2990, po_sequences).
--
-- SECURITY DEFINER so it runs as the function owner (can TRUNCATE). EXECUTE
-- granted to service_role ONLY — the API calls it with the service-role key
-- after gating the caller to super_admin in application code. anon /
-- authenticated cannot call it.
--
-- This is a destructive, testing-only function. Drop it before the pilot
-- (a later cleanup migration) so production has no one-key wipe.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reset_test_transactions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t TEXT;
  wipe TEXT[] := ARRAY[
    -- ── Purchasing ──────────────────────────────────────────────
    'purchase_return_items', 'purchase_returns',
    'purchase_invoice_items', 'purchase_invoices',
    'grn_items', 'grns',
    'purchase_order_lines', 'purchase_order_items', 'purchase_orders',
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
    END IF;
  END LOOP;

  -- Reset the two persistent counters that survive a row delete.
  -- Legacy POS sales-order id sequence → next is SO-2990 (brand alignment).
  IF to_regclass('public.order_seq') IS NOT NULL THEN
    EXECUTE 'ALTER SEQUENCE order_seq RESTART WITH 2990';
  END IF;
  -- PO number counter table → next PO restarts at this year's 0001.
  IF to_regclass('public.po_sequences') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE po_sequences';
  END IF;
END;
$$;

-- Lock it down: only the service role (used by the API after the super_admin
-- gate) may execute. Revoke the default PUBLIC execute grant.
REVOKE ALL ON FUNCTION public.reset_test_transactions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_test_transactions() FROM anon;
REVOKE ALL ON FUNCTION public.reset_test_transactions() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reset_test_transactions() TO service_role;
