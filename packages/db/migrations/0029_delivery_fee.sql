-- 0029_delivery_fee.sql
-- Admin-configurable delivery fee with cross-category surcharge.
-- Rules locked 2026-05-18 with Loo:
--   * Base fee (default RM 250) applies to every order.
--   * Cross-category surcharge (default RM 175) applies once, flat, when the
--     order contains products spanning ≥2 distinct categories.
--   * POS sales can key in any additional fee at handover (no cap, no approval).
--   * Backend Settings edits the two default rates; pricing_version bumps so
--     existing PricingDriftModal flow surfaces drift if rates change between
--     quote save and order placement.
--   * Fees snapshot onto orders.* and quotes.* and never mutate retroactively.

-- ─── Config singleton ───────────────────────────────────────────────────────
CREATE TABLE delivery_fee_config (
  id                  integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_fee            integer NOT NULL DEFAULT 250 CHECK (base_fee            >= 0),
  cross_category_fee  integer NOT NULL DEFAULT 175 CHECK (cross_category_fee  >= 0),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES staff(id) ON DELETE SET NULL
);

INSERT INTO delivery_fee_config (id) VALUES (1);

COMMENT ON TABLE delivery_fee_config IS
  'Singleton (id = 1) holding the two delivery-fee defaults. Read by every staff role; written by admin/coordinator only.';

-- ─── RLS — read for any authenticated staff; write for admin/coordinator ─────
ALTER TABLE delivery_fee_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY delivery_fee_config_select_all
  ON delivery_fee_config FOR SELECT TO authenticated
  USING (true);

CREATE POLICY delivery_fee_config_update_admin_coord
  ON delivery_fee_config FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff
       WHERE id = auth.uid()
         AND active = TRUE
         AND role IN ('admin', 'coordinator')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff
       WHERE id = auth.uid()
         AND active = TRUE
         AND role IN ('admin', 'coordinator')
    )
  );

-- No INSERT / DELETE policies — singleton row is seeded above and the CHECK
-- (id = 1) blocks any further INSERT even if a future policy allowed it.

-- ─── pricing_version bump trigger ───────────────────────────────────────────
-- Reuses the function created in 0001. Any UPDATE to the singleton row bumps
-- app_config.pricing_version so a saved quote with stale fees triggers the
-- PricingDriftModal flow on promotion.
DROP TRIGGER IF EXISTS bump_pricing_version_delivery_fee_config ON delivery_fee_config;
CREATE TRIGGER bump_pricing_version_delivery_fee_config
  AFTER UPDATE ON delivery_fee_config
  FOR EACH STATEMENT EXECUTE FUNCTION bump_pricing_version();

-- ─── Snapshot columns on orders ─────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_fee_base           integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee_cross_category integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee_additional     integer NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD CONSTRAINT delivery_fee_base_nonneg            CHECK (delivery_fee_base           >= 0),
  ADD CONSTRAINT delivery_fee_cross_category_nonneg  CHECK (delivery_fee_cross_category >= 0),
  ADD CONSTRAINT delivery_fee_additional_nonneg      CHECK (delivery_fee_additional     >= 0);

-- ─── Snapshot columns on quotes ─────────────────────────────────────────────
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS delivery_fee_base           integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee_cross_category integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee_additional     integer NOT NULL DEFAULT 0;

ALTER TABLE quotes
  ADD CONSTRAINT q_delivery_fee_base_nonneg           CHECK (delivery_fee_base           >= 0),
  ADD CONSTRAINT q_delivery_fee_cross_category_nonneg CHECK (delivery_fee_cross_category >= 0),
  ADD CONSTRAINT q_delivery_fee_additional_nonneg     CHECK (delivery_fee_additional     >= 0);

-- ─── RPC update — create_order_with_items now persists delivery fees ────────
-- Diff vs 0028: +3 delivery_fee_* columns in INSERT list, +3 values from payload.
CREATE OR REPLACE FUNCTION public.create_order_with_items(p jsonb)
RETURNS text
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
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
  ELSIF (p->>'paymentMethod') = 'transfer' THEN
    RAISE EXCEPTION 'slip_required_for_transfer' USING errcode = '23514';
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
    -- NEW: three delivery-fee snapshot columns
    delivery_fee_base, delivery_fee_cross_category, delivery_fee_additional,
    pricing_version,
    payment_method, approval_code,
    notes, delivery_notes,
    delivery_date, delivery_slot, delivery_tbd,
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
    -- NEW: delivery fees default to 0 if absent (legacy POS clients)
    COALESCE((p->>'deliveryFeeBase')::int, 0),
    COALESCE((p->>'deliveryFeeCrossCategory')::int, 0),
    COALESCE((p->>'deliveryFeeAdditional')::int, 0),
    v_pricing_version,
    (p->>'paymentMethod')::payment_method,
    NULLIF(p->>'approvalCode', ''),
    NULLIF(p->>'notes', ''),
    NULLIF(p->>'specialInstructions', ''),
    NULLIF(p->>'deliveryDate', '')::date,
    NULLIF(p->>'deliverySlot', ''),
    COALESCE((p->>'addressLater')::boolean, FALSE),
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
$$;
