-- packages/db/seeds/test-orders.sql
-- Test orders for dev environment. Idempotent via ON CONFLICT.
-- IDs SO-9001…SO-9005 deliberately above the next_order_id() sequence
-- (starts at 2050) so they don't collide with real orders.

DO $$
DECLARE
  v_staff_s01 uuid;
  v_showroom uuid;
BEGIN
  SELECT id INTO v_staff_s01 FROM staff WHERE staff_code = 'S01' LIMIT 1;
  SELECT id INTO v_showroom FROM showrooms ORDER BY id LIMIT 1;

  IF v_staff_s01 IS NULL OR v_showroom IS NULL THEN
    RAISE NOTICE 'Skip test seed: missing staff S01 or showroom';
    RETURN;
  END IF;

  -- Order 1: received lane, no slip (card payment)
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state)
  VALUES ('SO-9001', v_staff_s01, v_showroom, 'received', 'Test Customer 1', '+60123456001',
    2990, 0, 2990, 2990, '0', 'credit', 'none')
  ON CONFLICT (id) DO NOTHING;

  -- Order 2: pending slip verify (no real R2 file — slip-url will fail; UI shows error gracefully)
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state, slip_key)
  VALUES ('SO-9002', v_staff_s01, v_showroom, 'received', 'Test Customer 2 (pending)', '+60123456002',
    3990, 0, 3990, 1000, '0', 'transfer', 'pending', 'slips/2026/05/test-pending.jpg')
  ON CONFLICT (id) DO NOTHING;

  -- Order 3: verified slip
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state, slip_key,
    slip_verified_by, slip_verified_at)
  VALUES ('SO-9003', v_staff_s01, v_showroom, 'proceed', 'Test Customer 3 (verified)', '+60123456003',
    4990, 0, 4990, 4990, '0', 'transfer', 'verified', 'slips/2026/05/test-verified.jpg',
    v_staff_s01, now())
  ON CONFLICT (id) DO NOTHING;

  -- Order 4: flagged slip
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state, slip_key,
    slip_flag_reason)
  VALUES ('SO-9004', v_staff_s01, v_showroom, 'received', 'Test Customer 4 (flagged)', '+60123456004',
    1990, 0, 1990, 1990, '0', 'transfer', 'flagged', 'slips/2026/05/test-flagged.jpg',
    'Amount mismatch - slip shows RM 1500, order total RM 1990')
  ON CONFLICT (id) DO NOTHING;

  -- Order 5: at logistics lane, verified
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state, slip_key,
    slip_verified_by, slip_verified_at)
  VALUES ('SO-9005', v_staff_s01, v_showroom, 'logistics', 'Test Customer 5 (logistics)', '+60123456005',
    5990, 0, 5990, 5990, '0', 'transfer', 'verified', 'slips/2026/05/test-logistics.jpg',
    v_staff_s01, now())
  ON CONFLICT (id) DO NOTHING;

  -- Order 6: dispatched, driver assigned, no DO yet (test the gate to delivered)
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state,
    driver_id, confirmed_delivery_date, confirmed_with, dispatched_at)
  VALUES ('SO-9006', v_staff_s01, v_showroom, 'dispatched', 'Test Customer 6 (dispatched)', '+60123456006',
    7990, 0, 7990, 7990, '0', 'transfer', 'verified',
    (SELECT id FROM drivers WHERE driver_code = 'DRV-01'),
    CURRENT_DATE + INTERVAL '1 day', 'Phoned 2pm window', now() - INTERVAL '2 hours')
  ON CONFLICT (id) DO NOTHING;

  -- Order 7: delivered with DO
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state,
    driver_id, confirmed_delivery_date, confirmed_with,
    dispatched_at, delivered_at, do_signed, do_key)
  VALUES ('SO-9007', v_staff_s01, v_showroom, 'delivered', 'Test Customer 7 (delivered)', '+60123456007',
    8990, 0, 8990, 8990, '0', 'transfer', 'verified',
    (SELECT id FROM drivers WHERE driver_code = 'DRV-02'),
    CURRENT_DATE - INTERVAL '1 day', 'WhatsApp confirmed',
    now() - INTERVAL '1 day', now() - INTERVAL '12 hours', true,
    'dos/2026/05/test-delivered.jpg')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sub-project D · Suppliers + PO test data
-- 2 supplier-tagged products + SO-9008 (cross-supplier) + SO-9009 (single supplier)
-- Both orders sit in the `logistics` lane to exercise the PO scanning workflow.
-- Self-contained DO block: re-derives staff/showroom/supplier IDs locally so
-- it can run even if the block above was skipped.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_staff_s01  uuid;
  v_showroom   uuid;
  v_sup_slp    uuid;
  v_sup_kfa    uuid;
  -- Stable UUIDs for the test products so the seed is idempotent and the
  -- order_items inserts can reference them by literal.
  v_prod_mat   uuid := 'dddddddd-dddd-dddd-dddd-dddddddd0001';
  v_prod_sof   uuid := 'dddddddd-dddd-dddd-dddd-dddddddd0002';
BEGIN
  SELECT id INTO v_staff_s01 FROM staff       WHERE staff_code = 'S01' LIMIT 1;
  SELECT id INTO v_showroom  FROM showrooms   ORDER BY id LIMIT 1;
  SELECT id INTO v_sup_slp   FROM suppliers   WHERE code = 'SLP'       LIMIT 1;
  SELECT id INTO v_sup_kfa   FROM suppliers   WHERE code = 'KFA'       LIMIT 1;

  IF v_staff_s01 IS NULL OR v_showroom IS NULL OR v_sup_slp IS NULL OR v_sup_kfa IS NULL THEN
    RAISE NOTICE 'Skip Sub-project D seed: missing staff S01, showroom, or suppliers SLP/KFA';
    RETURN;
  END IF;

  -- Test product 1: SLP-supplied mattress (flat-priced for simplicity)
  INSERT INTO products (id, sku, category_id, pricing_kind, name, detail,
    visible, flat_price, supplier_id)
  VALUES (v_prod_mat, 'MAT-CLOUD', 'mattress', 'flat', 'Cloud mattress (test)',
    'Test SKU for Sub-project D PO scanning', true, 2990, v_sup_slp)
  ON CONFLICT (id) DO UPDATE SET supplier_id = EXCLUDED.supplier_id;

  -- Test product 2: KFA-supplied sofa (flat-priced for simplicity — real sofas
  -- use sofa_build, but for exercising the PO rollup a flat product suffices)
  INSERT INTO products (id, sku, category_id, pricing_kind, name, detail,
    visible, flat_price, recliner_upgrade_price, supplier_id)
  VALUES (v_prod_sof, 'SOF-NOOR', 'sofa', 'flat', 'Noor sofa (test)',
    'Test SKU for Sub-project D PO scanning', true, 2990, 0, v_sup_kfa)
  ON CONFLICT (id) DO UPDATE SET supplier_id = EXCLUDED.supplier_id;

  -- Order 8: in logistics, cart spans BOTH suppliers (SLP mattress + KFA sofa)
  -- Total: 2990 + 2990 = 5980
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state)
  VALUES ('SO-9008', v_staff_s01, v_showroom, 'logistics',
    'Test Customer 8 (cross-supplier)', '+60123456008',
    5980, 0, 5980, 5980, '0', 'transfer', 'verified')
  ON CONFLICT (id) DO NOTHING;

  -- Order 9: in logistics, cart = single supplier (SLP mattress only)
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state)
  VALUES ('SO-9009', v_staff_s01, v_showroom, 'logistics',
    'Test Customer 9 (single-supplier)', '+60123456009',
    2990, 0, 2990, 2990, '0', 'transfer', 'verified')
  ON CONFLICT (id) DO NOTHING;

  -- Cart line items (order_items table is the source of truth — schema.ts §407)
  -- SO-9008: SLP mattress + KFA sofa (cross-supplier rollup test)
  INSERT INTO order_items (order_id, kind, product_id, qty, unit_price, line_total)
  VALUES
    ('SO-9008', 'product', v_prod_mat, 1, 2990, 2990),
    ('SO-9008', 'product', v_prod_sof, 1, 2990, 2990)
  ON CONFLICT DO NOTHING;

  -- SO-9009: SLP mattress only
  INSERT INTO order_items (order_id, kind, product_id, qty, unit_price, line_total)
  VALUES ('SO-9009', 'product', v_prod_mat, 1, 2990, 2990)
  ON CONFLICT DO NOTHING;
END $$;
