-- 0044_sofa_fabric_colour.sql
-- Sofa fabric & colour selection (spec 2026-05-24). 3 tables mirror the
-- compartment pattern. Fabric tiers add a transparent surcharge (G1); colour
-- is free. Seeds 3 trial fabrics + 5 colours each and cross-joins them onto
-- every seeded sofa so the "required fabric" rule (enforced in server
-- recompute) never makes an existing Model un-orderable.

CREATE TABLE IF NOT EXISTS fabric_library (
  id                text PRIMARY KEY,
  label             text NOT NULL,
  tier              text NOT NULL DEFAULT 'standard',
  default_surcharge integer NOT NULL DEFAULT 0,
  swatch_key        text,
  active            boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fabric_colours (
  fabric_id  text NOT NULL REFERENCES fabric_library(id) ON DELETE CASCADE,
  colour_id  text NOT NULL,
  label      text NOT NULL,
  swatch_hex text,
  swatch_key text,
  active     boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (fabric_id, colour_id)
);

CREATE TABLE IF NOT EXISTS product_fabrics (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  fabric_id  text NOT NULL REFERENCES fabric_library(id),
  active     boolean NOT NULL DEFAULT true,
  surcharge  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, fabric_id)
);

-- RLS: read any authenticated staff, write admin only (same as libraries/pricing).
ALTER TABLE fabric_library  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fabric_colours  ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_fabrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY fabric_library_select ON fabric_library
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY fabric_library_admin_write ON fabric_library
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY fabric_colours_select ON fabric_colours
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY fabric_colours_admin_write ON fabric_colours
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY product_fabrics_select ON product_fabrics
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY product_fabrics_admin_write ON product_fabrics
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Realtime so POS sees Backend surcharge edits in ~300ms (mirrors product_bundles).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='product_fabrics') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.product_fabrics';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='fabric_library') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.fabric_library';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='fabric_colours') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.fabric_colours';
  END IF;
END $$;

-- ── Trial seed (Loo 2026-05-24): 3 fabrics + 5 colours each ──
INSERT INTO fabric_library (id, label, tier, default_surcharge, active, sort_order) VALUES
  ('linen',      'Linen',        'standard', 0,   true, 10),
  ('velvet',     'Velvet',       'premium',  300, true, 20),
  ('leather-pu', 'Leather (PU)', 'premium',  600, true, 30)
ON CONFLICT (id) DO NOTHING;

INSERT INTO fabric_colours (fabric_id, colour_id, label, swatch_hex, active, sort_order)
SELECT f.id, c.colour_id, c.label, c.swatch_hex, true, c.sort_order
FROM fabric_library f
CROSS JOIN (VALUES
  ('sand',     'Sand',     '#D8C7A8', 10),
  ('stone',    'Stone',    '#9A958C', 20),
  ('charcoal', 'Charcoal', '#3A3A3A', 30),
  ('forest',   'Forest',   '#3E5641', 40),
  ('rust',     'Rust',     '#A6492E', 50)
) AS c(colour_id, label, swatch_hex, sort_order)
WHERE f.id IN ('linen','velvet','leather-pu')
ON CONFLICT (fabric_id, colour_id) DO NOTHING;

-- Activate all 3 trial fabrics on every existing sofa (surcharge = default) so
-- "required fabric" keeps them orderable + the surcharge is testable in POS.
INSERT INTO product_fabrics (product_id, fabric_id, active, surcharge)
SELECT p.id, f.id, true, f.default_surcharge
FROM products p
CROSS JOIN fabric_library f
WHERE p.pricing_kind = 'sofa_build'
ON CONFLICT (product_id, fabric_id) DO NOTHING;

-- ── Extend create_product_with_pricing to upsert product_fabrics for sofas ──
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

    -- Fabric availability + per-Model surcharge (spec 2026-05-24).
    INSERT INTO product_fabrics (product_id, fabric_id, active, surcharge)
    SELECT v_product_id, (r->>'fabricId')::text, (r->>'active')::boolean, (r->>'surcharge')::int
    FROM jsonb_array_elements(COALESCE(p->'fabrics', '[]'::jsonb)) r;
  ELSIF v_kind = 'size_variants' THEN
    INSERT INTO product_size_variants (product_id, size_id, active, price)
    SELECT v_product_id, (r->>'sizeId')::text, (r->>'active')::boolean, (r->>'price')::int
    FROM jsonb_array_elements(p->'sizes') r;
  END IF;

  RETURN v_product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_product_with_pricing(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_product_with_pricing(jsonb) FROM anon;
