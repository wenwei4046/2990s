-- 0006_create_order_with_items.sql
-- Phase 2 step E: atomic order creation. The Hono /orders endpoint already
-- does server-side recompute via @2990s/shared.computeOrderTotal — by the
-- time this RPC runs the totals + per-line unitPrice/lineTotal are
-- authoritative. The RPC just persists them in one transaction:
--
--   1. Resolve staff_id + showroom_id from auth.uid().
--   2. Stamp current pricing_version snapshot from app_config.
--   3. Generate order id via the existing next_order_id() sequence.
--   4. INSERT orders.
--   5. INSERT order_items (one per line).
--
-- SECURITY INVOKER — orders_sales_insert / order_items_scope RLS still gate
-- each row. A non-staff caller fails on the orders INSERT.
--
-- Returns the order id (text, 'SO-XXXX').

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
BEGIN
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT showroom_id INTO v_showroom_id
  FROM staff WHERE id = v_staff_id AND active = TRUE;
  IF v_showroom_id IS NULL THEN
    -- Coordinators have NULL showroom_id (oversee all). Pick the first
    -- showroom in that case — staff with NULL showroom MUST pass an
    -- explicit showroomId in the payload.
    v_showroom_id := (p->>'showroomId')::uuid;
    IF v_showroom_id IS NULL THEN
      SELECT id INTO v_showroom_id FROM showrooms ORDER BY id LIMIT 1;
    END IF;
  END IF;

  v_pricing_version := COALESCE(app_config_get('pricing_version'), '0');
  v_order_id := next_order_id();

  INSERT INTO orders (
    id, staff_id, showroom_id, lane,
    customer_name, customer_phone, customer_email,
    customer_address, customer_postcode, customer_city, customer_state,
    subtotal, addon_total, total, paid,
    pricing_version,
    payment_method, approval_code,
    notes
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
    NULLIF(p->>'notes', '')
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

  RETURN v_order_id;
END;
$$;
