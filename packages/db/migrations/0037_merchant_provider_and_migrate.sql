-- 0037_merchant_provider_and_migrate.sql
-- 1. orders.merchant_provider column — which acquirer/terminal (GHL/HLB/MBB/PBB)
--    a 'merchant' payment went through. NULL for every other method, and NULL
--    for legacy rows migrated below (they predate the terminal split).
-- 2. Migrate existing credit/debit orders → merchant (Loo's call 2026-05-23:
--    drop the credit/debit distinction, fold both into merchant).
-- 3. Recreate create_order_with_items to persist merchant_provider. Body is
--    unchanged from 0035 (incl. the slip_required ELSE branch) except the
--    INSERT picks up one more column + value pair.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS merchant_provider text;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_merchant_provider_check;
ALTER TABLE orders ADD CONSTRAINT orders_merchant_provider_check
  CHECK (merchant_provider IS NULL OR merchant_provider IN ('GHL', 'HLB', 'MBB', 'PBB'));

-- Legacy credit/debit → merchant. provider stays NULL (unknown for old rows).
UPDATE orders SET payment_method = 'merchant'
 WHERE payment_method IN ('credit', 'debit');

CREATE OR REPLACE FUNCTION public.create_order_with_items(p jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id        text;
  v_staff_id        uuid := auth.uid();
  v_showroom_id     uuid;
  v_pricing_version text;
  v_session_id      uuid;
  v_session_row     pending_slip_uploads%ROWTYPE;
  v_billing_same    boolean;
BEGIN
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT showroom_id INTO v_showroom_id
  FROM staff WHERE id = v_staff_id AND active = TRUE;
  IF v_showroom_id IS NULL THEN
    v_showroom_id := (p->>'showroomId')::uuid;
    IF v_showroom_id IS NULL THEN
      SELECT id INTO v_showroom_id FROM showrooms ORDER BY id LIMIT 1;
    END IF;
  END IF;

  v_pricing_version := COALESCE(app_config_get('pricing_version'), '0');
  v_order_id := next_order_id();

  v_session_id := NULLIF(p->>'uploadSessionId', '')::uuid;
  IF v_session_id IS NOT NULL THEN
    SELECT * INTO v_session_row FROM pending_slip_uploads
    WHERE id = v_session_id FOR UPDATE;

    IF v_session_row.id IS NULL THEN
      RAISE EXCEPTION 'slip_session_not_found' USING errcode = 'P0002';
    END IF;
    IF v_session_row.staff_id <> v_staff_id THEN
      RAISE EXCEPTION 'not_session_owner' USING errcode = '42501';
    END IF;
    IF v_session_row.status <> 'uploaded' THEN
      RAISE EXCEPTION 'slip_not_ready' USING errcode = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'slip_required' USING errcode = '23514';
  END IF;

  v_billing_same := COALESCE((p->>'billingSame')::boolean, TRUE);

  INSERT INTO orders (
    id, staff_id, showroom_id, lane,
    customer_name, customer_phone, customer_email,
    customer_address, customer_address_line2,
    customer_postcode, customer_city, customer_state,
    customer_type, building_type, billing_same, salesperson_id,
    customer_billing_address, customer_billing_address_line2,
    customer_billing_postcode, customer_billing_city, customer_billing_state,
    subtotal, addon_total, total, paid,
    delivery_fee_base, delivery_fee_cross_category, delivery_fee_additional,
    pricing_version,
    payment_method, approval_code, installment_months, merchant_provider,
    notes, delivery_notes,
    delivery_date, delivery_slot, delivery_tbd,
    slip_key, slip_state,
    signature_data
  ) VALUES (
    v_order_id, v_staff_id, v_showroom_id, 'received',
    p->>'customerName',
    NULLIF(p->>'customerPhone', ''),
    NULLIF(p->>'customerEmail', ''),
    NULLIF(p->>'customerAddress', ''),
    NULLIF(p->>'customerAddressLine2', ''),
    NULLIF(p->>'customerPostcode', ''),
    NULLIF(p->>'customerCity', ''),
    NULLIF(p->>'customerState', ''),
    NULLIF(p->>'customerType', ''),
    NULLIF(p->>'buildingType', ''),
    v_billing_same,
    NULLIF(p->>'salespersonId', '')::uuid,
    CASE WHEN v_billing_same THEN NULL ELSE NULLIF(p->>'billingAddress', '') END,
    CASE WHEN v_billing_same THEN NULL ELSE NULLIF(p->>'billingAddressLine2', '') END,
    CASE WHEN v_billing_same THEN NULL ELSE NULLIF(p->>'billingPostcode', '') END,
    CASE WHEN v_billing_same THEN NULL ELSE NULLIF(p->>'billingCity', '') END,
    CASE WHEN v_billing_same THEN NULL ELSE NULLIF(p->>'billingState', '') END,
    (p->>'subtotal')::int,
    COALESCE((p->>'addonTotal')::int, 0),
    (p->>'total')::int,
    COALESCE((p->>'paid')::int, 0),
    COALESCE((p->>'deliveryFeeBase')::int, 0),
    COALESCE((p->>'deliveryFeeCrossCategory')::int, 0),
    COALESCE((p->>'deliveryFeeAdditional')::int, 0),
    v_pricing_version,
    (p->>'paymentMethod')::payment_method,
    NULLIF(p->>'approvalCode', ''),
    NULLIF(p->>'installmentMonths', '')::int,
    NULLIF(p->>'merchantProvider', ''),
    NULLIF(p->>'notes', ''),
    NULLIF(p->>'specialInstructions', ''),
    NULLIF(p->>'deliveryDate', '')::date,
    NULLIF(p->>'deliverySlot', ''),
    COALESCE((p->>'addressLater')::boolean, FALSE),
    v_session_row.r2_key,
    CASE WHEN v_session_row.id IS NOT NULL
         THEN 'pending'::slip_state
         ELSE 'none'::slip_state END,
    NULLIF(p->>'signatureData', '')
  );

  INSERT INTO order_items (order_id, kind, product_id, qty, unit_price, line_total, config)
  SELECT
    v_order_id,
    'product'::order_item_kind,
    (li->>'productId')::uuid,
    (li->>'qty')::int,
    (li->>'unitPrice')::int,
    (li->>'lineTotal')::int,
    li->'config'
  FROM jsonb_array_elements(p->'lines') li;

  INSERT INTO order_items (
    order_id, kind, addon_id, qty, unit_price, line_total,
    floors_count, items_count
  )
  SELECT
    v_order_id,
    'addon'::order_item_kind,
    a.id,
    COALESCE((ad->>'qty')::int, 1),
    a.price,
    CASE
      WHEN a.kind = 'floors_items' THEN
        COALESCE(a.per_floor_item, 0)
          * GREATEST(0, COALESCE((ad->>'floorsCount')::int, 0) - 2)
          * COALESCE((ad->>'itemsCount')::int, 0)
      ELSE a.price * COALESCE((ad->>'qty')::int, 1)
    END,
    CASE WHEN a.kind = 'floors_items'
         THEN (ad->>'floorsCount')::int ELSE NULL END,
    CASE WHEN a.kind = 'floors_items'
         THEN (ad->>'itemsCount')::int ELSE NULL END
  FROM jsonb_array_elements(COALESCE(p->'addons', '[]'::jsonb)) ad
  JOIN addons a ON a.id = ad->>'addonId'
  WHERE a.enabled = TRUE;

  IF v_session_id IS NOT NULL THEN
    UPDATE pending_slip_uploads
       SET status = 'promoted',
           promoted_at = now(),
           promoted_to_order_id = v_order_id
     WHERE id = v_session_id;

    INSERT INTO order_slip_events (order_id, event, actor_id, meta)
    VALUES (v_order_id, 'uploaded', v_staff_id,
            jsonb_build_object('session_id', v_session_id));
  END IF;

  RETURN v_order_id;
END;
$function$;
