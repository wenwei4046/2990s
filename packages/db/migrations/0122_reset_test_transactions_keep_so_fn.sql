-- ============================================================================
-- 0122_reset_test_transactions_keep_so_fn.sql
--
-- Commander 2026-06-01 — TEMPORARY testing helper, sibling of
-- reset_test_transactions() (migration 0116). Same wipe, but PRESERVES every
-- Sales Order (SO header + its lines, payments, audit log, status changes,
-- price overrides). Everything downstream of the SO — purchasing, GRNs,
-- invoices, returns, deliveries, inventory movements/lots, stock takes,
-- transfers, journal entries, legacy POS docs, refund credits — is cleared so
-- the team can re-drive the SAME batch of Sales Orders through the whole
-- procurement → inbound → outbound → invoice flow again from a clean slate.
--
-- After the wipe the kept SOs are reset to a fresh, re-testable state:
--   • every non-cancelled SO line  → stock_status = 'PENDING', qty_ready = 0
--     (all inventory is gone, so nothing is allocated/ready)
--   • every SO header not CANCELLED/CONFIRMED/IN_PRODUCTION → 'CONFIRMED'
--     (rolls SHIPPED / DELIVERED / INVOICED / READY_TO_SHIP / CLOSED back to
--      the base active status — "未出货,可重测")
--
-- order_seq is NOT reset (SO numbering continues from where it is — the SOs
-- still exist). po_sequences IS reset (next PO restarts at this year's 0001).
--
-- SECURITY DEFINER so it can TRUNCATE. EXECUTE granted to service_role ONLY —
-- the API calls it with the service-role key after gating the caller to
-- super_admin in application code. Drop before pilot.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reset_test_transactions_keep_so()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t TEXT;
  -- Same list as reset_test_transactions(), MINUS the six SO tables
  -- (mfg_so_audit_log, mfg_so_status_changes, mfg_so_price_overrides,
  --  mfg_sales_order_payments, mfg_sales_order_items, mfg_sales_orders).
  wipe TEXT[] := ARRAY[
    -- ── Purchasing ──────────────────────────────────────────────
    'purchase_return_items', 'purchase_returns',
    'purchase_invoice_items', 'purchase_invoices',
    'grn_items', 'grns',
    'purchase_order_lines', 'purchase_order_items', 'purchase_orders',
    'purchase_consignment_note_items', 'purchase_consignment_notes',
    'purchase_consignment_order_items', 'purchase_consignment_orders',

    -- ── Sales fulfilment (downstream of SO — wiped, SO itself kept) ──
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

  -- ── Reset the kept Sales Orders to a fresh, re-testable state ──────────
  -- All inventory is gone, so every line is PENDING with nothing ready.
  IF to_regclass('public.mfg_sales_order_items') IS NOT NULL THEN
    UPDATE public.mfg_sales_order_items
       SET stock_status = 'PENDING',
           stock_qty_ready = 0
     WHERE COALESCE(cancelled, false) = false;

    -- allocated_batch_no exists from migration 0121; clear it best-effort so
    -- an older schema (column absent) still resets the rest above.
    BEGIN
      UPDATE public.mfg_sales_order_items
         SET allocated_batch_no = NULL
       WHERE allocated_batch_no IS NOT NULL;
    EXCEPTION WHEN undefined_column THEN
      NULL;
    END;
  END IF;

  -- Roll shipped/delivered/invoiced/ready/closed headers back to CONFIRMED.
  -- CANCELLED stays cancelled; CONFIRMED / IN_PRODUCTION are already "fresh".
  IF to_regclass('public.mfg_sales_orders') IS NOT NULL THEN
    UPDATE public.mfg_sales_orders
       SET status = 'CONFIRMED'
     WHERE status NOT IN ('CANCELLED', 'CONFIRMED', 'IN_PRODUCTION');
  END IF;

  -- order_seq is intentionally NOT reset — the SOs still exist, numbering
  -- continues. Only the PO number counter is cleared.
  IF to_regclass('public.po_sequences') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE po_sequences';
  END IF;
END;
$$;

-- Lock it down: only the service role (used by the API after the super_admin
-- gate) may execute. Revoke the default PUBLIC execute grant.
REVOKE ALL ON FUNCTION public.reset_test_transactions_keep_so() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_test_transactions_keep_so() FROM anon;
REVOKE ALL ON FUNCTION public.reset_test_transactions_keep_so() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reset_test_transactions_keep_so() TO service_role;
