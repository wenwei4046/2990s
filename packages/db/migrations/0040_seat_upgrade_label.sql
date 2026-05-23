-- 0039_seat_upgrade_label.sql
-- F3 (Track 2 · Loo 2026-05-23): the per-seat sofa upgrade gets a per-product
-- NAME + footrest flag so order lines read "2-Seater + 2 Power slide" /
-- "+ 2 Headrest" instead of a generic "recliner". Price stays in
-- products.recliner_upgrade_price — there is exactly ONE upgrade type per Model
-- (follows the PDF; other Models offer none unless an admin sets a label).
--
--   seat_upgrade_label    NULL  → this Model offers no per-seat upgrade
--                                  (POS hides the per-seat add button).
--                         text  → e.g. 'Power incliner','Power slide','Power leg',
--                                  'Headrest'. POS shows the add button + this
--                                  label; summarizeSofaCells appends "+ N <label>".
--   seat_upgrade_footrest true  → seat opens a footrest (power recliner/incliner/
--                                  slide/leg). false → no footrest (headrest).
--
-- Display-only: the upgrade PRICE is unchanged (recliner_upgrade_price), so the
-- server-side recompute (computeOrderTotal/computeSofaPrice) needs NO change.

ALTER TABLE products ADD COLUMN IF NOT EXISTS seat_upgrade_label text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS seat_upgrade_footrest boolean NOT NULL DEFAULT true;

-- Recreate create_product_with_pricing: body unchanged from the live definition
-- (which already inserts included_addons), the products INSERT now also picks up
-- seat_upgrade_label + seat_upgrade_footrest for sofa_build SKUs.
CREATE OR REPLACE FUNCTION public.create_product_with_pricing(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id uuid;
  v_kind text := p->>'pricingKind';
BEGIN
  INSERT INTO products (
    sku, category_id, series_id, pricing_kind, name, detail, size_display,
    img_key, thumb_key, stock, low_at, visible, flat_price, recliner_upgrade_price,
    seat_upgrade_label, seat_upgrade_footrest,
    included_addons
  ) VALUES (
    p->>'sku',
    p->>'categoryId',
    NULLIF(p->>'seriesId', ''),
    v_kind::pricing_kind,
    p->>'name',
    NULLIF(p->>'detail', ''),
    NULLIF(p->>'sizeDisplay', ''),
    p->>'imgKey',
    p->>'thumbKey',
    COALESCE((p->>'stock')::int, 0),
    COALESCE((p->>'lowAt')::int, 5),
    COALESCE((p->>'visible')::boolean, true),
    CASE WHEN v_kind = 'flat'       THEN (p->>'flatPrice')::int            ELSE NULL END,
    CASE WHEN v_kind = 'sofa_build' THEN (p->>'reclinerUpgradePrice')::int ELSE NULL END,
    CASE WHEN v_kind = 'sofa_build' THEN NULLIF(p->>'seatUpgradeLabel', '') ELSE NULL END,
    COALESCE((p->>'seatUpgradeFootrest')::boolean, true),
    COALESCE(p->'includedAddons', '[]'::jsonb)
  )
  RETURNING id INTO v_product_id;

  IF v_kind = 'sofa_build' THEN
    INSERT INTO product_compartments (product_id, compartment_id, active, price)
    SELECT v_product_id, (r->>'compartmentId')::text, (r->>'active')::boolean, (r->>'price')::int
    FROM jsonb_array_elements(p->'compartments') r;

    INSERT INTO product_bundles (product_id, bundle_id, active, price)
    SELECT v_product_id, (r->>'bundleId')::text, (r->>'active')::boolean, (r->>'price')::int
    FROM jsonb_array_elements(p->'bundles') r;
  ELSIF v_kind = 'size_variants' THEN
    INSERT INTO product_size_variants (product_id, size_id, active, price)
    SELECT v_product_id, (r->>'sizeId')::text, (r->>'active')::boolean, (r->>'price')::int
    FROM jsonb_array_elements(p->'sizes') r;
  END IF;

  RETURN v_product_id;
END;
$function$;
