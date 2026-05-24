-- packages/db/seeds/mattress-catalog.sql
-- ============================================================================
-- Real MATTRESS catalogue · 3 brands (pure-data seed)
-- Source: 2990s / Carres / HappiSleep price-list PDFs — imported 2026-05-24.
--
-- 18 SKUs across 3 brands. Each PDF card = one product ("Soft and Firm are
-- different models" — Loo, 2026-05-24), so same-named models are disambiguated
-- by a firmness suffix in `name` (e.g. "Ketta Soft" / "Ketta Firm"). HappiSleep
-- already names each firmness uniquely (GridCool / DewCool / …) so no suffix.
--
-- PRICING (placeholder — Loo edits real prices in Backend SKU Master later):
--   • 2990s    → all 4 sizes active @ RM 2990
--   • HappiSleep → all 4 sizes active @ RM 2990
--   • Carres   → queen + king only @ RM 0  (no single / super-single)
--                visible=true → shows "By size" on POS grid, RM 0 in configurator
--
-- BRAND = series (the POS catalog renders series.label as the card badge and a
--   "series" filter dropdown). 3 brand series rows seeded below; the four decor
--   series in seed-libraries.sql are untouched (and stay hidden — the dropdown
--   only lists series that have ≥1 product).
--
-- PHOTO: hosted as POS static assets → absolute pages.dev URLs so both POS and
--   Backend resolve them (img_key is used directly as an <img>/CSS url):
--     • mattress-bed.png        — shared line-art hero (the 12 models with no
--                                 real photography; PDFs carry only the same
--                                 illustration). Variable v_img.
--     • mattress-2990s-soft.jpg — real room photo for the 2990's Soft trio
--                                 (Ketta/Akka/Arrus Soft → 0001/0003/0005).
--                                 Variable v_soft.
--     • mattress-2990s-firm.jpg — real room photo for the 2990's Firm trio
--                                 (Ketta/Akka/Arrus Firm → 0002/0004/0006).
--                                 Variable v_firm.
--   Swap remaining per-model photos in Backend SKU Master as real shots arrive.
--
-- Idempotent: stable UUIDs dddddddd-…-00NN + ON CONFLICT. Safe to re-run; a
-- re-run RESETS prices/visibility to these seed values (overwrites Backend edits).
-- Does NOT touch existing mock (eeee…) or sofa (cccc…) rows.
-- supplier_id intentionally left NULL — set per model in Backend SKU Master.
-- ============================================================================

-- ── 1) Brand series (badge + filter). Idempotent. ──────────────────────────
INSERT INTO series (id, label, active) VALUES
  ('brand-2990s',      '2990''s',     true),
  ('brand-carres',     'Carres',      true),
  ('brand-happisleep', 'HappiSleep',  true)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, active = EXCLUDED.active;

DO $$
DECLARE
  v_img  text := 'https://2990s-pos.pages.dev/catalog/mattress-bed.png';
  v_soft text := 'https://2990s-pos.pages.dev/catalog/mattress-2990s-soft.jpg';  -- 2990's Soft real photo
  v_firm text := 'https://2990s-pos.pages.dev/catalog/mattress-2990s-firm.jpg';  -- 2990's Firm real photo
BEGIN
  -- ── 2) Products (18 size_variants mattresses) ────────────────────────────
  INSERT INTO products
    (id, sku, category_id, series_id, pricing_kind, name, detail, size_display, img_key, thumb_key, visible, stock)
  VALUES
    -- 2990s — Ketta (8"), Akka (12"), Arrus (12"); Soft + Firm each
    ('dddddddd-dddd-dddd-dddd-dddddddd0001','MAT-2990-KETTA-S','mattress','brand-2990s','size_variants','Ketta Soft','Crafted with natural latex resilience, this mattress gently follows the body with clean, responsive support for calm, comfortable nights.','8" Soft',v_soft,v_soft,true,99),
    ('dddddddd-dddd-dddd-dddd-dddddddd0002','MAT-2990-KETTA-F','mattress','brand-2990s','size_variants','Ketta Firm','Crafted with natural latex resilience, this mattress gently follows the body with clean, responsive support for calm, comfortable nights.','8" Firm',v_firm,v_firm,true,99),
    ('dddddddd-dddd-dddd-dddd-dddddddd0003','MAT-2990-AKKA-S','mattress','brand-2990s','size_variants','Akka Soft','Built with spring support and latex comfort, this mattress brings grounded stability, gentle cushioning and lasting comfort through the night.','12" Soft',v_soft,v_soft,true,99),
    ('dddddddd-dddd-dddd-dddd-dddddddd0004','MAT-2990-AKKA-F','mattress','brand-2990s','size_variants','Akka Firm','Built with spring support and latex comfort, this mattress brings grounded stability, gentle cushioning and lasting comfort through the night.','12" Firm',v_firm,v_firm,true,99),
    ('dddddddd-dddd-dddd-dddd-dddddddd0005','MAT-2990-ARRUS-S','mattress','brand-2990s','size_variants','Arrus Soft','Designed for smooth everyday rest, this mattress blends spring support with foam cushioning for a balanced, effortless sleep feel.','12" Soft',v_soft,v_soft,true,99),
    ('dddddddd-dddd-dddd-dddd-dddddddd0006','MAT-2990-ARRUS-F','mattress','brand-2990s','size_variants','Arrus Firm','Designed for smooth everyday rest, this mattress blends spring support with foam cushioning for a balanced, effortless sleep feel.','12" Firm',v_firm,v_firm,true,99),

    -- Carres — Balance (12"), Whisper (12" S/F), Embrace (14" S/F), Cloudrest (14" tbc)
    ('dddddddd-dddd-dddd-dddd-dddddddd0007','MAT-CAR-BALANCE','mattress','brand-carres','size_variants','Balance','Designed for balanced support and cooling comfort, this mattress combines spring, foam, latex and cooling fabric for a stable yet comfortable sleep feel.','12"',v_img,v_img,true,99),
    ('dddddddd-dddd-dddd-dddd-dddddddd0008','MAT-CAR-WHISPER-S','mattress','brand-carres','size_variants','Whisper Soft','Made for quiet, gentle rest, this mattress blends reloop fiber and latex for a light, breathable sleep feel with soft and steady support.','12" Soft',v_img,v_img,true,99),
    ('dddddddd-dddd-dddd-dddd-dddddddd0009','MAT-CAR-WHISPER-F','mattress','brand-carres','size_variants','Whisper Firm','Made for quiet, gentle rest, this mattress blends reloop fiber and latex for a light, breathable sleep feel with soft and steady support.','12" Firm',v_img,v_img,true,99),
    ('dddddddd-dddd-dddd-dddd-dddddddd0010','MAT-CAR-EMBRACE-S','mattress','brand-carres','size_variants','Embrace Soft','Created for a more embracing sleep experience, this mattress combines spring, foam, memory foam and cooling fabric for plush comfort and lasting support.','14" Soft',v_img,v_img,true,99),
    ('dddddddd-dddd-dddd-dddd-dddddddd0011','MAT-CAR-EMBRACE-F','mattress','brand-carres','size_variants','Embrace Firm','Created for a more embracing sleep experience, this mattress combines spring, foam, memory foam and cooling fabric for plush comfort and lasting support.','14" Firm',v_img,v_img,true,99),
    ('dddddddd-dddd-dddd-dddd-dddddddd0012','MAT-CAR-CLOUDREST','mattress','brand-carres','size_variants','Cloudrest',NULL,'14"',v_img,v_img,true,99),

    -- HappiSleep — 6 uniquely-named cooling models (descriptions TBC)
    ('dddddddd-dddd-dddd-dddd-dddddddd0013','MAT-HS-GRIDCOOL','mattress','brand-happisleep','size_variants','GridCool',NULL,'10" Soft',v_img,v_img,true,99),
    ('dddddddd-dddd-dddd-dddd-dddddddd0014','MAT-HS-DEWCOOL','mattress','brand-happisleep','size_variants','DewCool',NULL,'10" Firm',v_img,v_img,true,99),
    ('dddddddd-dddd-dddd-dddd-dddddddd0015','MAT-HS-PURECOOL','mattress','brand-happisleep','size_variants','PureCool',NULL,'12" Soft',v_img,v_img,true,99),
    ('dddddddd-dddd-dddd-dddd-dddddddd0016','MAT-HS-ACECOOL','mattress','brand-happisleep','size_variants','AceCool',NULL,'12" Firm',v_img,v_img,true,99),
    ('dddddddd-dddd-dddd-dddd-dddddddd0017','MAT-HS-MISTCOOL','mattress','brand-happisleep','size_variants','MistCool',NULL,'14" Soft',v_img,v_img,true,99),
    ('dddddddd-dddd-dddd-dddd-dddddddd0018','MAT-HS-FROSTCOOL','mattress','brand-happisleep','size_variants','FrostCool',NULL,'14" Firm',v_img,v_img,true,99)
  ON CONFLICT (id) DO UPDATE SET
    sku = EXCLUDED.sku, category_id = EXCLUDED.category_id, series_id = EXCLUDED.series_id,
    pricing_kind = EXCLUDED.pricing_kind, name = EXCLUDED.name, detail = EXCLUDED.detail,
    size_display = EXCLUDED.size_display, img_key = EXCLUDED.img_key, thumb_key = EXCLUDED.thumb_key,
    visible = EXCLUDED.visible, stock = EXCLUDED.stock, updated_at = now();

  -- ── 3a) 2990s + HappiSleep — all 4 sizes active @ RM 2990 ─────────────────
  INSERT INTO product_size_variants (product_id, size_id, active, price)
  SELECT p.id, s.size_id, true, 2990
  FROM products p
  CROSS JOIN (VALUES ('single'),('super-single'),('queen'),('king')) AS s(size_id)
  WHERE p.id IN (
    'dddddddd-dddd-dddd-dddd-dddddddd0001','dddddddd-dddd-dddd-dddd-dddddddd0002',
    'dddddddd-dddd-dddd-dddd-dddddddd0003','dddddddd-dddd-dddd-dddd-dddddddd0004',
    'dddddddd-dddd-dddd-dddd-dddddddd0005','dddddddd-dddd-dddd-dddd-dddddddd0006',
    'dddddddd-dddd-dddd-dddd-dddddddd0013','dddddddd-dddd-dddd-dddd-dddddddd0014',
    'dddddddd-dddd-dddd-dddd-dddddddd0015','dddddddd-dddd-dddd-dddd-dddddddd0016',
    'dddddddd-dddd-dddd-dddd-dddddddd0017','dddddddd-dddd-dddd-dddd-dddddddd0018'
  )
  ON CONFLICT (product_id, size_id) DO UPDATE SET active = EXCLUDED.active, price = EXCLUDED.price;

  -- ── 3b) Carres — queen + king only @ RM 0 (no single / super-single) ──────
  INSERT INTO product_size_variants (product_id, size_id, active, price)
  SELECT p.id, s.size_id, true, 0
  FROM products p
  CROSS JOIN (VALUES ('queen'),('king')) AS s(size_id)
  WHERE p.id IN (
    'dddddddd-dddd-dddd-dddd-dddddddd0007','dddddddd-dddd-dddd-dddd-dddddddd0008',
    'dddddddd-dddd-dddd-dddd-dddddddd0009','dddddddd-dddd-dddd-dddd-dddddddd0010',
    'dddddddd-dddd-dddd-dddd-dddddddd0011','dddddddd-dddd-dddd-dddd-dddddddd0012'
  )
  ON CONFLICT (product_id, size_id) DO UPDATE SET active = EXCLUDED.active, price = EXCLUDED.price;
END $$;
