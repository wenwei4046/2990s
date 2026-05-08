-- 0004_create_product_with_pricing.sql
-- Phase 1 step 3: atomic product creation. Replaces the frontend's two-step
-- direct-supabase write (products INSERT, then pricing rows) with a single
-- RPC that wraps everything in a transaction. RLS still gates each INSERT —
-- the function is SECURITY INVOKER so auth.uid() resolves to the caller and
-- existing is_admin() policies on products/product_compartments/etc apply.
--
-- Why an RPC: Supabase JS doesn't expose multi-statement transactions via the
-- REST endpoint. Without this, a successful products INSERT followed by a
-- failing product_compartments INSERT leaves an orphan products row.

CREATE OR REPLACE FUNCTION public.create_product_with_pricing(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_product_id uuid;
  v_kind text := p->>'pricingKind';
BEGIN
  -- Insert the product row. RLS policy `products_admin_write` on this table
  -- enforces is_admin(); a non-admin caller fails here with insufficient_privilege.
  INSERT INTO products (
    sku, category_id, series_id, pricing_kind, name, detail, size_display,
    img_key, thumb_key, stock, low_at, visible, flat_price, recliner_upgrade_price
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
    CASE WHEN v_kind = 'sofa_build' THEN (p->>'reclinerUpgradePrice')::int ELSE NULL END
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
$$;

-- Authenticated callers may invoke this RPC; the body's RLS-gated INSERTs
-- still reject non-admins. anon stays out.
GRANT EXECUTE ON FUNCTION public.create_product_with_pricing(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_product_with_pricing(jsonb) FROM anon;
