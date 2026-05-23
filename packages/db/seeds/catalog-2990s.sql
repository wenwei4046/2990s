-- packages/db/seeds/catalog-2990s.sql
-- ============================================================================
-- Real SOFA catalogue · Track 1 (pure-data seed)
-- Source: 未命名电子表格.pdf (sofa price list, 15 models) — imported 2026-05-23.
--
-- WHY "pure-data": the sofa configurator's modules + bundles are HARD-CODED in
-- packages/shared/src/sofa-build.ts (13 modules, 5 bundles: 1S/2S/3S/2+L/3+L,
-- per-seat recliner upgrade). The DB libraries only price/toggle/art those
-- fixed items — adding new ids here does NOT make them appear in the
-- configurator. So this seed maps every PDF row that the EXISTING engine can
-- express, exactly, and flags the rest for Track 2 (sofa-build.ts extension).
--
-- MAPPING RULES
--   • 1/2/3 SEATER, 2+L            → product_bundles 1S/2S/3S/2+L at PDF price
--   • POWER INCLINER/LEG/SLIDE     → products.recliner_upgrade_price (one slot;
--                                     each model has at most one power upgrade)
--   • HEADREST                     → included in bundle price; noted in detail
--   • WOOD CONSOLE                 → existing WC-45 accessory compartment
--   • depth (24/26/28/30/32")      → same price across depths; noted in
--                                     size_display (not a pricing dimension)
--   • all 15 library compartments  → seeded active at library default price so
--                                     Custom Build prices à-la-carte correctly
--
-- TRACK 2 (needs sofa-build.ts change — NOT done here, flagged inline):
--   • 2.5-SEATER bundle            → AM 9070, AM 9071, SF 5080
--   • POWER-LEG/SLIDE/INCLINER as distinct order-line items ("2S + 2 power
--     slide"), HEADREST descriptor ("2S + 2 headrest")
--   • STOOL as a placeable module  → SF 5080  (in library, absent from
--     SOFA_MODULES → currently dead)
--   • Corner package 1B+CORNER+2A @2990 → 5539 (custom build sums à-la-carte
--     ≠ 2990 until a corner bundle exists)
--
-- Idempotent: stable UUIDs cccccccc-…-00NN + ON CONFLICT. Safe to re-run; a
-- re-run RESETS prices to these seed values (overwrites later Backend edits).
-- Does NOT wipe existing data — the one-time test-data wipe is run separately.
-- supplier_id intentionally left NULL — set per model in Backend SKU Master.
-- visible = true (catalogue goes live on POS immediately).
-- ============================================================================

DO $$
BEGIN
  -- ── 1) Products (15 sofa_build) ──────────────────────────────────────────
  INSERT INTO products
    (id, sku, category_id, pricing_kind, name, detail, size_display, visible, stock, recliner_upgrade_price)
  VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccc0001','SOF-AM9036', 'sofa','sofa_build','AM 9036',  NULL,                                              'Depths: 24"/30"',          true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0002','SOF-AM9038', 'sofa','sofa_build','AM 9038',  NULL,                                              'Depths: 24"/30"',          true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0003','SOF-SF9050', 'sofa','sofa_build','SF 9050',  '2-seater with wood console',                      'Depths: 24"/26"/28"/30"',  true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0004','SOF-AM9053', 'sofa','sofa_build','AM 9053',  'Power incliner upgrade (+RM990/seat)',            'Depths: 24"/30"',          true, 99, 990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0005','SOF-AM9070', 'sofa','sofa_build','AM 9070',  'Includes headrest',                               NULL,                       true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0006','SOF-AM9071', 'sofa','sofa_build','AM 9071',  NULL,                                              NULL,                       true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0007','SOF-SF5119', 'sofa','sofa_build','SF 5119',  'Power leg upgrade (+RM490/seat); wood console option', 'Depth: 30"',          true, 99, 490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0008','SOF-SF5080', 'sofa','sofa_build','SF 5080',  'Stool option (Track 2)',                          NULL,                       true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0009','SOF-SF5130', 'sofa','sofa_build','SF 5130',  NULL,                                              NULL,                       true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0010','SOF-DSL8019','sofa','sofa_build','DSL 8019', 'Power incliner upgrade (+RM990/seat)',            'Depth: 30"',               true, 99, 990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0011','SOF-DSL8020','sofa','sofa_build','DSL 8020', NULL,                                              'Depths: 24"/30"',          true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0012','SOF-DSL8027','sofa','sofa_build','DSL 8027', 'Power slide upgrade (+RM990/seat)',               'Depth: 32"',               true, 99, 990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0013','SOF-5531',   'sofa','sofa_build','5531',     NULL,                                              'Depths: 24"/28"',          true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0014','SOF-5535',   'sofa','sofa_build','5535',     NULL,                                              'Depths: 24"/28"/30"',      true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0015','SOF-5539',   'sofa','sofa_build','5539',     'Corner: 1B + Corner + 2A',                        NULL,                       true, 99,   0)
  ON CONFLICT (id) DO UPDATE SET
    sku = EXCLUDED.sku, name = EXCLUDED.name, detail = EXCLUDED.detail,
    size_display = EXCLUDED.size_display, pricing_kind = EXCLUDED.pricing_kind,
    recliner_upgrade_price = EXCLUDED.recliner_upgrade_price,
    visible = EXCLUDED.visible, stock = EXCLUDED.stock, updated_at = now();

  -- ── 2) Compartments: every library module active at default price, for each
  --        sofa product, so Custom Build prices à-la-carte correctly. ────────
  INSERT INTO product_compartments (product_id, compartment_id, active, price)
  SELECT p.id, cl.id, true, cl.default_price
  FROM products p
  CROSS JOIN compartment_library cl
  WHERE p.id BETWEEN 'cccccccc-cccc-cccc-cccc-cccccccc0001'
                 AND 'cccccccc-cccc-cccc-cccc-cccccccc0015'
  ON CONFLICT (product_id, compartment_id) DO UPDATE SET
    active = EXCLUDED.active, price = EXCLUDED.price;

  -- ── 3) Bundles: only the seater configs each model actually offers, at PDF
  --        prices. Models with no expressible quick-pick (SF 5080 / 5539) get
  --        no bundle row — sellable via Custom Build only until Track 2. ─────
  INSERT INTO product_bundles (product_id, bundle_id, active, price) VALUES
    -- AM 9036 — standard
    ('cccccccc-cccc-cccc-cccc-cccccccc0001','1S', true,1490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0001','2S', true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0001','3S', true,2490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0001','2+L',true,2990),
    -- AM 9038 — standard
    ('cccccccc-cccc-cccc-cccc-cccccccc0002','1S', true,1490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0002','2S', true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0002','3S', true,2490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0002','2+L',true,2990),
    -- SF 9050 — only "2-seater + wood console" 2990 (console included in price)
    ('cccccccc-cccc-cccc-cccc-cccccccc0003','2S', true,2990),
    -- AM 9053 — standard + power incliner (recliner_upgrade_price)
    ('cccccccc-cccc-cccc-cccc-cccccccc0004','1S', true,1490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0004','2S', true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0004','3S', true,2490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0004','2+L',true,2990),
    -- AM 9070 — headrest included in price; 2.5-seater → Track 2
    ('cccccccc-cccc-cccc-cccc-cccccccc0005','1S', true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0005','2S', true,2490),
    -- AM 9071 — 3S=2990; 2.5-seater 2990 → Track 2
    ('cccccccc-cccc-cccc-cccc-cccccccc0006','1S', true,1490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0006','2S', true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0006','3S', true,2990),
    -- SF 5119 — 1S/2S higher; power leg (recliner_upgrade_price)
    ('cccccccc-cccc-cccc-cccc-cccccccc0007','1S', true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0007','2S', true,2490),
    -- SF 5080 — only 2.5-seater + stool → Track 2 (no expressible bundle)
    -- 5080 intentionally has NO product_bundles row.
    -- SF 5130 — only 2+L
    ('cccccccc-cccc-cccc-cccc-cccccccc0009','2+L',true,2990),
    -- DSL 8019 — 3S=2990; power incliner
    ('cccccccc-cccc-cccc-cccc-cccccccc0010','1S', true,1490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0010','2S', true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0010','3S', true,2990),
    -- DSL 8020 — only 2+L
    ('cccccccc-cccc-cccc-cccc-cccccccc0011','2+L',true,2990),
    -- DSL 8027 — standard; power slide; "2S+2 power slide" combo → Track 2
    ('cccccccc-cccc-cccc-cccc-cccccccc0012','1S', true,1490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0012','2S', true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0012','3S', true,2490),
    -- 5531 — standard
    ('cccccccc-cccc-cccc-cccc-cccccccc0013','1S', true,1490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0013','2S', true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0013','3S', true,2490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0013','2+L',true,2990),
    -- 5535 — standard
    ('cccccccc-cccc-cccc-cccc-cccccccc0014','1S', true,1490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0014','2S', true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0014','3S', true,2490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0014','2+L',true,2990)
    -- 5539 — corner package 1B+CORNER+2A @2990 → Track 2 (no quick-pick bundle)
  ON CONFLICT (product_id, bundle_id) DO UPDATE SET
    active = EXCLUDED.active, price = EXCLUDED.price;
END $$;
