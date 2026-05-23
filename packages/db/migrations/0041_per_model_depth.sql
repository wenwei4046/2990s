-- 0040_per_model_depth.sql
-- F5 (Track 2 · Loo 2026-05-24): per-Model seat depth options. Each sofa Model
-- offers its own set of depths (e.g. 24/30, 28, 32) — see the design doc §8.2.
-- Stored as a CSV of inch integers in products.depth_options (e.g. '24,30'). The
-- POS configurator reads it to render the depth toggle; the chosen depth is
-- recorded on the order and shown on the invoice.
--
-- NON-PRICING: same price across depths, so the server-side recompute
-- (computeOrderTotal / computeSofaPrice) is UNAFFECTED. The shared engine widens
-- its Depth type from '24'|'28' to any inch string and scales the plan-view by
-- 2.5cm per inch per cushion (24→0, 28→+10, 30→+15, 32→+20).

ALTER TABLE products ADD COLUMN IF NOT EXISTS depth_options text;

-- Seed the 15 Track-1 sofas (Loo-confirmed 2026-05-24). Idempotent — keyed by sku.
UPDATE products SET depth_options = '24,30'       WHERE sku IN ('SOF-AM9036','SOF-AM9038','SOF-AM9053','SOF-DSL8020');
UPDATE products SET depth_options = '24,26,28,30' WHERE sku = 'SOF-SF9050';
UPDATE products SET depth_options = '28'          WHERE sku IN ('SOF-AM9070','SOF-AM9071','SOF-SF5080','SOF-SF5130','SOF-5539');
UPDATE products SET depth_options = '30'          WHERE sku IN ('SOF-SF5119','SOF-DSL8019');
UPDATE products SET depth_options = '32'          WHERE sku = 'SOF-DSL8027';
UPDATE products SET depth_options = '24,28'       WHERE sku = 'SOF-5531';
UPDATE products SET depth_options = '24,28,30'    WHERE sku = 'SOF-5535';

-- Recreate create_product_with_pricing: same body as 0039, the products INSERT
-- now also persists depth_options (NULLIF empty → NULL, sofa_build only).
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
    seat_upgrade_label, seat_upgrade_footrest, depth_options,
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
    CASE WHEN v_kind = 'sofa_build' THEN NULLIF(p->>'depthOptions', '')    ELSE NULL END,
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
