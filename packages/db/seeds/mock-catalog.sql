-- packages/db/seeds/mock-catalog.sql
-- 11 mock catalog SKUs for Phase 1+ — unblocks PoScanModal + Catalog page UI work.
-- Sourced from prototype/pos-data.jsx (canonical reference).
--
-- - Sofas (4): seeded as flat for early testing, now HIDDEN (visible=false).
--   Real sofas live in hookka-sofa-catalog.sql with proper sofa_build structure.
--   Kept as soft-deleted rows so future PoScan / inventory tests still resolve
--   the SKU codes (s-noor / s-tanah / s-rumah / s-petang) without orphan FKs.
-- - Mattresses (4): pricing_kind = 'size_variants' with all 4 sizes active.
--   Demonstrates the size + addon picker flow in Configurator.tsx for staff.
-- - Bedframes (3): pricing_kind = 'size_variants' with queen + king active.
--
-- Stable UUIDs (eeeeeeee-eeee-eeee-eeee-eeeeeeee0001..0011) so future seeds don't
-- collide. ON CONFLICT (id) DO UPDATE makes this idempotent.

DO $$
DECLARE
  v_sup_slp uuid;
  v_sup_kfa uuid;
BEGIN
  SELECT id INTO v_sup_slp FROM suppliers WHERE code = 'SLP' LIMIT 1;
  SELECT id INTO v_sup_kfa FROM suppliers WHERE code = 'KFA' LIMIT 1;

  IF v_sup_slp IS NULL OR v_sup_kfa IS NULL THEN
    RAISE NOTICE 'Skip mock-catalog seed: missing suppliers SLP or KFA';
    RETURN;
  END IF;

  -- ─── Sofas (4 KFA-supplied, HIDDEN — superseded by hookka-sofa-catalog.sql) ─
  INSERT INTO products (id, sku, category_id, pricing_kind, name, detail,
    size_display, visible, stock, flat_price, recliner_upgrade_price, supplier_id)
  VALUES
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0001', 's-noor', 'sofa', 'flat',
      'Noor', 'Boucle Cream', '210cm · 3-seat', false, 99, 2990, 0, v_sup_kfa),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0002', 's-tanah', 'sofa', 'flat',
      'Tanah', 'Linen Sand', '260cm · L-shape', false, 99, 2990, 0, v_sup_kfa),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0003', 's-rumah', 'sofa', 'flat',
      'Rumah', 'Leather Walnut', '160cm · 2-seat', false, 99, 2990, 0, v_sup_kfa),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0004', 's-petang', 'sofa', 'flat',
      'Petang', 'Wool Cream', '78cm · armchair', false, 99, 2990, 0, v_sup_kfa)
  ON CONFLICT (id) DO UPDATE SET
    sku = EXCLUDED.sku,
    name = EXCLUDED.name,
    detail = EXCLUDED.detail,
    size_display = EXCLUDED.size_display,
    pricing_kind = EXCLUDED.pricing_kind,
    flat_price = EXCLUDED.flat_price,
    recliner_upgrade_price = EXCLUDED.recliner_upgrade_price,
    supplier_id = EXCLUDED.supplier_id,
    visible = EXCLUDED.visible,
    stock = EXCLUDED.stock,
    updated_at = now();

  -- ─── Mattresses (4 SLP-supplied, size_variants — all 4 sizes active) ──────
  INSERT INTO products (id, sku, category_id, pricing_kind, name, detail,
    size_display, visible, stock, flat_price, supplier_id)
  VALUES
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0005', 'm-cloud', 'mattress', 'size_variants',
      'Cloud', 'Pocket spring · gel-infused memory foam · cool knit',
      NULL, true, 99, NULL, v_sup_slp),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0006', 'm-oak', 'mattress', 'size_variants',
      'Oak', 'Hybrid latex · medium-firm · oeko-tex cover',
      NULL, true, 99, NULL, v_sup_slp),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0007', 'm-linen', 'mattress', 'size_variants',
      'Linen', 'Soft top · breathable linen · 5-zone support',
      NULL, true, 99, NULL, v_sup_slp),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0008', 'm-dusk', 'mattress', 'size_variants',
      'Dusk', 'Memory foam · medium · cooling cover',
      NULL, true, 99, NULL, v_sup_slp)
  ON CONFLICT (id) DO UPDATE SET
    sku = EXCLUDED.sku,
    name = EXCLUDED.name,
    detail = EXCLUDED.detail,
    size_display = EXCLUDED.size_display,
    pricing_kind = EXCLUDED.pricing_kind,
    flat_price = EXCLUDED.flat_price,
    supplier_id = EXCLUDED.supplier_id,
    visible = EXCLUDED.visible,
    stock = EXCLUDED.stock,
    updated_at = now();

  INSERT INTO product_size_variants (product_id, size_id, active, price) VALUES
    -- Cloud — entry tier
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0005', 'single',       true, 1990),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0005', 'super-single', true, 2490),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0005', 'queen',        true, 2990),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0005', 'king',         true, 3490),
    -- Oak — premium tier
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0006', 'single',       true, 2190),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0006', 'super-single', true, 2690),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0006', 'queen',        true, 3190),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0006', 'king',         true, 3690),
    -- Linen — value tier
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0007', 'single',       true, 1790),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0007', 'super-single', true, 2290),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0007', 'queen',        true, 2790),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0007', 'king',         true, 3290),
    -- Dusk — entry tier
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0008', 'single',       true, 1990),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0008', 'super-single', true, 2490),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0008', 'queen',        true, 2990),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0008', 'king',         true, 3490)
  ON CONFLICT (product_id, size_id) DO UPDATE SET
    active = EXCLUDED.active,
    price = EXCLUDED.price;

  -- ─── Bedframes (3 KFA-supplied, size_variants — queen + king only) ────────
  INSERT INTO products (id, sku, category_id, pricing_kind, name, detail,
    size_display, visible, stock, flat_price, supplier_id)
  VALUES
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0009', 'b-platform', 'bedframe', 'size_variants',
      'Platform', 'Solid ash · slatted base · low profile',
      NULL, true, 99, NULL, v_sup_kfa),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0010', 'b-storage', 'bedframe', 'size_variants',
      'Storage', 'Lift-up base · 240L storage · linen finish',
      NULL, true, 99, NULL, v_sup_kfa),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0011', 'b-wooden', 'bedframe', 'size_variants',
      'Wooden', 'Quilted boucle · channel headboard · oak feet',
      NULL, true, 99, NULL, v_sup_kfa)
  ON CONFLICT (id) DO UPDATE SET
    sku = EXCLUDED.sku,
    name = EXCLUDED.name,
    detail = EXCLUDED.detail,
    size_display = EXCLUDED.size_display,
    pricing_kind = EXCLUDED.pricing_kind,
    flat_price = EXCLUDED.flat_price,
    supplier_id = EXCLUDED.supplier_id,
    visible = EXCLUDED.visible,
    stock = EXCLUDED.stock,
    updated_at = now();

  INSERT INTO product_size_variants (product_id, size_id, active, price) VALUES
    -- Platform — minimal slatted base
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0009', 'queen', true, 1990),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0009', 'king',  true, 2190),
    -- Storage — lift-up storage frame
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0010', 'queen', true, 2290),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0010', 'king',  true, 2490),
    -- Wooden — quilted boucle headboard
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0011', 'queen', true, 2390),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0011', 'king',  true, 2590)
  ON CONFLICT (product_id, size_id) DO UPDATE SET
    active = EXCLUDED.active,
    price = EXCLUDED.price;
END $$;
