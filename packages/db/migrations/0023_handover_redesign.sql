-- 0023_handover_redesign.sql
-- Adds: orders.{customer_type, building_type, billing_same, salesperson_id},
-- categories.hero_image_key. Rewrites create_order_with_items to read the new
-- fields and to insert kind='addon' order_items rows from a p->'addons' array.
-- All new columns are nullable / defaulted so existing rows survive.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_type   text
    CHECK (customer_type IN ('new','existing')),
  ADD COLUMN IF NOT EXISTS building_type   text
    CHECK (building_type IN ('condo','landed','apartment','office','shop','other')),
  ADD COLUMN IF NOT EXISTS billing_same    boolean NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS salesperson_id  uuid REFERENCES staff(id);

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS hero_image_key  text;

-- Replace create_order_with_items: now reads customerType, buildingType,
-- billingSame, salespersonId, specialInstructions from payload; inserts
-- addon rows from p->'addons'. Body is byte-identical to 0022 except for
-- the marked sections.
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

  -- ─── Slip session validation (unchanged from 0022) ─────────────────────────
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

  -- ─── INSERT orders (NEW: 4 extra columns) ──────────────────────────────────
  INSERT INTO orders (
    id, staff_id, showroom_id, lane,
    customer_name, customer_phone, customer_email,
    customer_address, customer_address_line2,
    customer_postcode, customer_city, customer_state,
    customer_type, building_type, billing_same, salesperson_id,         -- NEW
    subtotal, addon_total, total, paid,
    pricing_version,
    payment_method, approval_code,
    notes, delivery_notes,                                              -- delivery_notes NEW
    delivery_date, delivery_slot, delivery_tbd,                         -- delivery_tbd NEW
    slip_key, slip_state
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
    NULLIF(p->>'customerType', ''),                                     -- NEW
    NULLIF(p->>'buildingType', ''),                                     -- NEW
    COALESCE((p->>'billingSame')::boolean, TRUE),                       -- NEW
    NULLIF(p->>'salespersonId', '')::uuid,                              -- NEW
    (p->>'subtotal')::int,
    COALESCE((p->>'addonTotal')::int, 0),
    (p->>'total')::int,
    COALESCE((p->>'paid')::int, 0),
    v_pricing_version,
    (p->>'paymentMethod')::payment_method,
    NULLIF(p->>'approvalCode', ''),
    NULLIF(p->>'notes', ''),
    NULLIF(p->>'specialInstructions', ''),                              -- NEW (→ delivery_notes)
    NULLIF(p->>'deliveryDate', '')::date,
    NULLIF(p->>'deliverySlot', ''),
    COALESCE((p->>'addressLater')::boolean, FALSE),                     -- → delivery_tbd
    v_session_row.r2_key,
    CASE WHEN v_session_row.id IS NOT NULL
         THEN 'pending'::slip_state
         ELSE 'none'::slip_state END
  );

  -- ─── INSERT order_items (product lines — unchanged from 0022) ──────────────
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

  -- ─── INSERT order_items (addon lines — NEW in 0023) ────────────────────────
  -- Server reads CURRENT addon prices from the addons table — client-submitted
  -- prices in p->'addons' are IGNORED. This keeps the "honest pricing"
  -- promise even when a tampered POS submits free addons.
  INSERT INTO order_items (
    order_id, kind, addon_id, qty, unit_price, line_total,
    floors_count, items_count
  )
  SELECT
    v_order_id,
    'addon'::order_item_kind,
    a.id,
    COALESCE((ad->>'qty')::int, 1),
    a.price,                                                            -- server-side price
    CASE
      WHEN a.kind = 'floors_items' THEN
        a.price
        + a.per_floor_item
          * COALESCE((ad->>'floorsCount')::int, 0)
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

  -- ─── Promote slip session (unchanged from 0022) ────────────────────────────
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
