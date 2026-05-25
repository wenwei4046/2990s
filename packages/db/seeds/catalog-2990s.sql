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
-- 2.5-SEATER (DONE 2026-05-23): added as a Quick-Pick-only bundle `2.5S`
--   (widened 2-seater, reuses 2S.png) — see sofa-build.ts BUNDLES + seed-
--   libraries.sql bundle_library. Seeded for AM 9070 / AM 9071 / SF 5080 below.
--
-- TRACK 2 (still needs sofa-build.ts change — NOT done here, flagged inline):
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
  -- ── 0) Brand series guard — every current sofa is the 2990's brand (Loo,
  --        2026-05-26 → the "2990'S" badge shows on every sofa card, §6 below).
  --        Idempotent so this seed is self-contained even if it runs before
  --        mattress-catalog.sql (which also seeds this series row). ───────────
  INSERT INTO series (id, label, active) VALUES ('brand-2990s', '2990''s', true)
  ON CONFLICT (id) DO NOTHING;

  -- ── 1) Products (15 sofa_build) ──────────────────────────────────────────
  --   name      = friendly "real name" (Loo, 2026-05-26) — shown in catalogue,
  --               cart and configurator.
  --   model_code= technical code ('AM 9036') — surfaced ONLY on the Sales Order
  --               as "<model_code> · <name>".
  --   img_key   = hero photo, hosted as a POS static asset (apps/pos/public/
  --               catalog/sofa-*.jpg) → absolute pages.dev URL so POS + Backend
  --               both resolve it. thumb_key = same file. NOTE: the photo for
  --               SF 5130 (Pllao) was delivered mis-numbered "5095" — 5130 is
  --               the correct code (Loo, 2026-05-26).
  --   size_display = NULL for every sofa (Loo, 2026-05-26: depth must NOT show
  --               on the catalogue card). Depth still lives in depth_options
  --               (§5 below) which drives the configurator's depth toggle.
  INSERT INTO products
    (id, sku, category_id, pricing_kind, name, model_code, detail, size_display, img_key, thumb_key, visible, stock, recliner_upgrade_price)
  VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccc0001','SOF-AM9036', 'sofa','sofa_build','Ommbuc','AM 9036', NULL,                                              NULL, 'https://2990s-pos.pages.dev/catalog/sofa-am9036.jpg', 'https://2990s-pos.pages.dev/catalog/sofa-am9036.jpg', true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0002','SOF-AM9038', 'sofa','sofa_build','Lotti', 'AM 9038', NULL,                                              NULL, 'https://2990s-pos.pages.dev/catalog/sofa-am9038.jpg', 'https://2990s-pos.pages.dev/catalog/sofa-am9038.jpg', true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0003','SOF-SF9050', 'sofa','sofa_build','Pantti','SF 9050', '2-seater with wood console',                      NULL, 'https://2990s-pos.pages.dev/catalog/sofa-sf9050.jpg', 'https://2990s-pos.pages.dev/catalog/sofa-sf9050.jpg', true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0004','SOF-AM9053', 'sofa','sofa_build','Siyyp', 'AM 9053', 'Power incliner upgrade (+RM990/seat)',            NULL, 'https://2990s-pos.pages.dev/catalog/sofa-am9053.jpg', 'https://2990s-pos.pages.dev/catalog/sofa-am9053.jpg', true, 99, 990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0005','SOF-AM9070', 'sofa','sofa_build','Annsa', 'AM 9070', 'Includes headrest',                               NULL, 'https://2990s-pos.pages.dev/catalog/sofa-am9070.jpg', 'https://2990s-pos.pages.dev/catalog/sofa-am9070.jpg', true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0006','SOF-AM9071', 'sofa','sofa_build','Krron', 'AM 9071', NULL,                                              NULL, 'https://2990s-pos.pages.dev/catalog/sofa-am9071.jpg', 'https://2990s-pos.pages.dev/catalog/sofa-am9071.jpg', true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0007','SOF-SF5119', 'sofa','sofa_build','Lyyar', 'SF 5119', 'Power leg upgrade (+RM490/seat); wood console option', NULL, 'https://2990s-pos.pages.dev/catalog/sofa-sf5119.jpg', 'https://2990s-pos.pages.dev/catalog/sofa-sf5119.jpg', true, 99, 490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0008','SOF-SF5080', 'sofa','sofa_build','Blatt', 'SF 5080', 'Stool option (Track 2)',                          NULL, 'https://2990s-pos.pages.dev/catalog/sofa-sf5080.jpg', 'https://2990s-pos.pages.dev/catalog/sofa-sf5080.jpg', true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0009','SOF-SF5130', 'sofa','sofa_build','Pllao', 'SF 5130', NULL,                                              NULL, 'https://2990s-pos.pages.dev/catalog/sofa-sf5130.jpg', 'https://2990s-pos.pages.dev/catalog/sofa-sf5130.jpg', true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0010','SOF-DSL8019','sofa','sofa_build','Qubbu', 'DSL 8019','Power incliner upgrade (+RM990/seat)',            NULL, 'https://2990s-pos.pages.dev/catalog/sofa-dsl8019.jpg','https://2990s-pos.pages.dev/catalog/sofa-dsl8019.jpg',true, 99, 990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0011','SOF-DSL8020','sofa','sofa_build','Telluc','DSL 8020', NULL,                                             NULL, 'https://2990s-pos.pages.dev/catalog/sofa-dsl8020.jpg','https://2990s-pos.pages.dev/catalog/sofa-dsl8020.jpg',true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0012','SOF-DSL8027','sofa','sofa_build','Boaat', 'DSL 8027','Power slide upgrade (+RM990/seat)',               NULL, 'https://2990s-pos.pages.dev/catalog/sofa-dsl8027.jpg','https://2990s-pos.pages.dev/catalog/sofa-dsl8027.jpg',true, 99, 990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0013','SOF-5531',   'sofa','sofa_build','Xammar','5531',     NULL,                                              NULL, 'https://2990s-pos.pages.dev/catalog/sofa-5531.jpg',   'https://2990s-pos.pages.dev/catalog/sofa-5531.jpg',   true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0014','SOF-5535',   'sofa','sofa_build','Trrbu', '5535',     NULL,                                              NULL, 'https://2990s-pos.pages.dev/catalog/sofa-5535.jpg',   'https://2990s-pos.pages.dev/catalog/sofa-5535.jpg',   true, 99,   0),
    ('cccccccc-cccc-cccc-cccc-cccccccc0015','SOF-5539',   'sofa','sofa_build','Booqit','5539',     'Corner: 1B + Corner + 2A',                        NULL, 'https://2990s-pos.pages.dev/catalog/sofa-5539.jpg',   'https://2990s-pos.pages.dev/catalog/sofa-5539.jpg',   true, 99,   0)
  ON CONFLICT (id) DO UPDATE SET
    sku = EXCLUDED.sku, name = EXCLUDED.name, model_code = EXCLUDED.model_code,
    detail = EXCLUDED.detail, size_display = EXCLUDED.size_display,
    img_key = EXCLUDED.img_key, thumb_key = EXCLUDED.thumb_key,
    pricing_kind = EXCLUDED.pricing_kind,
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
    -- SF 9050 — only "2-seater + wood console" 2990 (2WC preset = 1A-LHF+WC-45+1A-RHF)
    ('cccccccc-cccc-cccc-cccc-cccccccc0003','2WC', true,2990),
    -- AM 9053 — standard + power incliner (recliner_upgrade_price)
    ('cccccccc-cccc-cccc-cccc-cccccccc0004','1S', true,1490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0004','2S', true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0004','3S', true,2490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0004','2+L',true,2990),
    -- AM 9070 — headrest included in price (headrest descriptor → Track 2)
    ('cccccccc-cccc-cccc-cccc-cccccccc0005','1S',  true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0005','2S',  true,2490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0005','2.5S',true,2990),
    -- AM 9071 — 3S=2990; 2.5-seater 2990
    ('cccccccc-cccc-cccc-cccc-cccccccc0006','1S',  true,1490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0006','2S',  true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0006','3S',  true,2990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0006','2.5S',true,2990),
    -- SF 5119 — 1S/2S higher; +console preset (2WC); power leg (recliner_upgrade_price)
    ('cccccccc-cccc-cccc-cccc-cccccccc0007','1S', true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0007','2S', true,2490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0007','2WC',true,2990),
    -- SF 5080 — 2.5-seater 2990 (stool placeable module → Track 2)
    ('cccccccc-cccc-cccc-cccc-cccccccc0008','2.5S',true,2990),
    -- SF 5130 — only 2+L
    ('cccccccc-cccc-cccc-cccc-cccccccc0009','2+L',true,2990),
    -- DSL 8019 — 3S=2990; power incliner
    ('cccccccc-cccc-cccc-cccc-cccccccc0010','1S', true,1490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0010','2S', true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0010','3S', true,2990),
    -- DSL 8020 — only 2+L
    ('cccccccc-cccc-cccc-cccc-cccccccc0011','2+L',true,2990),
    -- DSL 8027 — standard; +2S+2-power-slide combo preset (2PS); per-seat slide too
    ('cccccccc-cccc-cccc-cccc-cccccccc0012','1S', true,1490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0012','2S', true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0012','3S', true,2490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0012','2PS',true,2990),
    -- 5531 — standard
    ('cccccccc-cccc-cccc-cccc-cccccccc0013','1S', true,1490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0013','2S', true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0013','3S', true,2490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0013','2+L',true,2990),
    -- 5535 — standard
    ('cccccccc-cccc-cccc-cccc-cccccccc0014','1S', true,1490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0014','2S', true,1990),
    ('cccccccc-cccc-cccc-cccc-cccccccc0014','3S', true,2490),
    ('cccccccc-cccc-cccc-cccc-cccccccc0014','2+L',true,2990),
    -- 5539 — corner package preset (CORNER = 1B-LHF + CNR + 2A-RHF) @2990
    ('cccccccc-cccc-cccc-cccc-cccccccc0015','CORNER',true,2990)
  ON CONFLICT (product_id, bundle_id) DO UPDATE SET
    active = EXCLUDED.active, price = EXCLUDED.price;

  -- ── 4) Per-Model seat upgrade label + footrest (F3, 2026-05-23, migration
  --        0039). Only the Models the PDF lists with a power/headrest option;
  --        price stays recliner_upgrade_price. Others keep seat_upgrade_label
  --        NULL → POS hides the per-seat add button. ─────────────────────────
  UPDATE products SET seat_upgrade_label='Power incliner', seat_upgrade_footrest=true  WHERE sku IN ('SOF-AM9053','SOF-DSL8019');
  UPDATE products SET seat_upgrade_label='Power slide',    seat_upgrade_footrest=true  WHERE sku='SOF-DSL8027';
  UPDATE products SET seat_upgrade_label='Power leg',      seat_upgrade_footrest=true  WHERE sku='SOF-SF5119';
  UPDATE products SET seat_upgrade_label='Headrest',       seat_upgrade_footrest=false WHERE sku='SOF-AM9070';

  -- ── 5) Per-Model seat depths (F5, 2026-05-24, migration 0040). CSV of inches;
  --        the POS depth toggle reads this. Non-pricing (same price all depths). ─
  UPDATE products SET depth_options='24,30'       WHERE sku IN ('SOF-AM9036','SOF-AM9038','SOF-AM9053','SOF-DSL8020');
  UPDATE products SET depth_options='24,26,28,30' WHERE sku='SOF-SF9050';
  UPDATE products SET depth_options='28'          WHERE sku IN ('SOF-AM9070','SOF-AM9071','SOF-SF5080','SOF-SF5130','SOF-5539');
  UPDATE products SET depth_options='30'          WHERE sku IN ('SOF-SF5119','SOF-DSL8019');
  UPDATE products SET depth_options='32'          WHERE sku='SOF-DSL8027';
  UPDATE products SET depth_options='24,28'       WHERE sku='SOF-5531';
  UPDATE products SET depth_options='24,28,30'    WHERE sku='SOF-5535';

  -- ── 6) Brand series (Loo, 2026-05-26). Every current sofa is the 2990's
  --        brand → set series_id so the catalogue card shows the "2990'S" badge
  --        (mirrors the mattress brand badges; series 'brand-2990s' guaranteed
  --        by §0 above). ──────────────────────────────────────────────────────
  UPDATE products SET series_id='brand-2990s'
  WHERE id BETWEEN 'cccccccc-cccc-cccc-cccc-cccccccc0001'
              AND 'cccccccc-cccc-cccc-cccc-cccccccc0015';
END $$;
