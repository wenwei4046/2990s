-- packages/db/seeds/mock-catalog.sql
-- 11 mock catalog SKUs for Phase 1+ — unblocks PoScanModal + Catalog page UI work.
-- Sourced from prototype/pos-data.jsx (canonical reference).
--
-- All products use pricing_kind = 'flat' with flat_price = 2990 (the brand promise).
-- Real catalog editor (SkuMaster.tsx) supports sofa_build / size_variants — when Loo
-- seeds production via the Backend, those richer pricing kinds will replace these.
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

  -- ─── Sofas (4 KFA-supplied) ────────────────────────────────────────────────
  INSERT INTO products (id, sku, category_id, pricing_kind, name, detail,
    size_display, visible, stock, flat_price, recliner_upgrade_price, supplier_id)
  VALUES
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0001', 's-noor', 'sofa', 'flat',
      'Noor', 'Boucle Cream', '210cm · 3-seat', true, 99, 2990, 0, v_sup_kfa),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0002', 's-tanah', 'sofa', 'flat',
      'Tanah', 'Linen Sand', '260cm · L-shape', true, 99, 2990, 0, v_sup_kfa),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0003', 's-rumah', 'sofa', 'flat',
      'Rumah', 'Leather Walnut', '160cm · 2-seat', true, 99, 2990, 0, v_sup_kfa),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0004', 's-petang', 'sofa', 'flat',
      'Petang', 'Wool Cream', '78cm · armchair', true, 99, 2990, 0, v_sup_kfa)
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

  -- ─── Mattresses (4 SLP-supplied) ───────────────────────────────────────────
  INSERT INTO products (id, sku, category_id, pricing_kind, name, detail,
    size_display, visible, stock, flat_price, supplier_id)
  VALUES
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0005', 'm-cloud', 'mattress', 'flat',
      'Cloud', 'Pocket spring · gel-infused memory foam · cool knit',
      'Queen, 152x190', true, 99, 2990, v_sup_slp),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0006', 'm-oak', 'mattress', 'flat',
      'Oak', 'Hybrid latex · medium-firm · oeko-tex cover',
      'King, 183x190', true, 99, 2990, v_sup_slp),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0007', 'm-linen', 'mattress', 'flat',
      'Linen', 'Soft top · breathable linen · 5-zone support',
      'Single, 92x190', true, 99, 2990, v_sup_slp),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0008', 'm-dusk', 'mattress', 'flat',
      'Dusk', 'Memory foam · medium · cooling cover',
      'Queen, 152x190', true, 99, 2990, v_sup_slp)
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

  -- ─── Bedframes (3 KFA-supplied) ────────────────────────────────────────────
  INSERT INTO products (id, sku, category_id, pricing_kind, name, detail,
    size_display, visible, stock, flat_price, supplier_id)
  VALUES
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0009', 'b-platform', 'bedframe', 'flat',
      'Platform', 'Solid ash · slatted base · low profile',
      'Queen', true, 99, 2990, v_sup_kfa),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0010', 'b-storage', 'bedframe', 'flat',
      'Storage', 'Lift-up base · 240L storage · linen finish',
      'Queen · storage', true, 99, 2990, v_sup_kfa),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0011', 'b-wooden', 'bedframe', 'flat',
      'Wooden', 'Quilted boucle · channel headboard · oak feet',
      'King', true, 99, 2990, v_sup_kfa)
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
END $$;
