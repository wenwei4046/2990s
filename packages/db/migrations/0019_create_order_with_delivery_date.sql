-- 0019_create_order_with_delivery_date.sql
-- Bug #7 fix: write delivery_date / delivery_slot to schema columns instead of
-- stuffing them into orders.notes. RPC accepts the new params and inserts.
--
-- Same as 0010 but with two extra columns in INSERT. SECURITY INVOKER unchanged.

CREATE OR REPLACE FUNCTION public.create_order_with_items(p jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_order_id        text;
  v_staff_id        uuid := auth.uid();
  v_showroom_id     uuid;
  v_pricing_version text;
  v_session_id      uuid;
  v_session_row     pending_slip_uploads%ROWTYPE;
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

  -- ─── Slip session validation ──────────────────────────────────────────────
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
  ELSIF (p->>'paymentMethod') = 'transfer' THEN
    RAISE EXCEPTION 'slip_required_for_transfer' USING errcode = '23514';
  END IF;

  -- ─── INSERT orders (now writes delivery_date + delivery_slot too) ─────────
  INSERT INTO orders (
    id, staff_id, showroom_id, lane,
    customer_name, customer_phone, customer_email,
    customer_address, customer_postcode, customer_city, customer_state,
    subtotal, addon_total, total, paid,
    pricing_version,
    payment_method, approval_code,
    notes,
    delivery_date, delivery_slot,
    slip_key, slip_state
  ) VALUES (
    v_order_id, v_staff_id, v_showroom_id, 'received',
    p->>'customerName',
    NULLIF(p->>'customerPhone', ''),
    NULLIF(p->>'customerEmail', ''),
    NULLIF(p->>'customerAddress', ''),
    NULLIF(p->>'customerPostcode', ''),
    NULLIF(p->>'customerCity', ''),
    NULLIF(p->>'customerState', ''),
    (p->>'subtotal')::int,
    COALESCE((p->>'addonTotal')::int, 0),
    (p->>'total')::int,
    COALESCE((p->>'paid')::int, 0),
    v_pricing_version,
    (p->>'paymentMethod')::payment_method,
    NULLIF(p->>'approvalCode', ''),
    NULLIF(p->>'notes', ''),
    NULLIF(p->>'deliveryDate', '')::date,
    NULLIF(p->>'deliverySlot', ''),
    v_session_row.r2_key,
    CASE WHEN v_session_row.id IS NOT NULL
         THEN 'pending'::slip_state
         ELSE 'none'::slip_state END
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

  -- ─── Promote slip session ─────────────────────────────────────────────────
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
$$;
