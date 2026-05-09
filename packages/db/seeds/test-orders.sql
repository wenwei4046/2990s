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
