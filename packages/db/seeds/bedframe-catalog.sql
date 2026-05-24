-- packages/db/seeds/bedframe-catalog.sql
-- ============================================================================
-- Bedframe catalogue · 18 base models (pricing_kind='bedframe_build')
-- Source: mfg_products (BEDFRAME), variant suffixes collapsed to base model.
-- Placeholder retail per size (RM2990) — Loo edits real prices in Backend SKU
-- Master. Colour/options come from bedframe_colours + bedframe_options (the
-- configurator); this seed cross-joins all colours active onto every model so
-- the "required colour" rule never blocks.
-- APPLY ORDER: bedframe-colours.sql must run BEFORE this (colour cross-join).
-- Idempotent: stable UUIDs ffffffff-…-00NN + ON CONFLICT. Does NOT touch
-- mock (eeee…), sofa (cccc…), or mattress (dddd…) rows. Hero reuses the bed
-- line-art (it is a bed frame); Loo swaps real photos later.
-- ============================================================================
DO $$
DECLARE
  v_img text := 'https://2990s-pos.pages.dev/catalog/mattress-bed.png';
BEGIN
  INSERT INTO products
    (id, sku, category_id, pricing_kind, name, img_key, thumb_key, visible, stock)
  VALUES
    ('ffffffff-ffff-ffff-ffff-ffffffff0001','BED-HILTON','bedframe','bedframe_build','Hilton',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0002','BED-FENRIR','bedframe','bedframe_build','Fenrir',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0003','BED-CODY','bedframe','bedframe_build','Cody',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0004','BED-RICARDO','bedframe','bedframe_build','Ricardo',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0005','BED-VALKRIE','bedframe','bedframe_build','Valkrie',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0006','BED-JAGER','bedframe','bedframe_build','Jager',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0007','BED-ARIZONA','bedframe','bedframe_build','Arizona',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0008','BED-COTY','bedframe','bedframe_build','Coty',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0009','BED-TIFANNY','bedframe','bedframe_build','Tifanny',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0010','BED-VICTORIA','bedframe','bedframe_build','Victoria',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0011','BED-ELEPHANE','bedframe','bedframe_build','Elephane',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0012','BED-REGAL','bedframe','bedframe_build','Regal',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0013','BED-TRION','bedframe','bedframe_build','Trion',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0014','BED-NINA','bedframe','bedframe_build','Nina',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0015','BED-JACOB','bedframe','bedframe_build','Jacob',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0016','BED-CELENE','bedframe','bedframe_build','Celene',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0017','BED-ELEGANT','bedframe','bedframe_build','Elegant',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0018','BED-DIVAN','bedframe','bedframe_build','Divan',v_img,v_img,true,99)
  ON CONFLICT (id) DO UPDATE SET
    sku=EXCLUDED.sku, category_id=EXCLUDED.category_id, pricing_kind=EXCLUDED.pricing_kind,
    name=EXCLUDED.name, img_key=EXCLUDED.img_key, thumb_key=EXCLUDED.thumb_key,
    visible=EXCLUDED.visible, stock=EXCLUDED.stock, updated_at=now();

  -- Standard 4 sizes @ placeholder retail (Loo prices + deactivates in SKU Master).
  INSERT INTO product_size_variants (product_id, size_id, active, price)
  SELECT p.id, s.size_id, true, 2990
  FROM products p
  CROSS JOIN (VALUES ('single'),('super-single'),('queen'),('king')) AS s(size_id)
  WHERE p.id BETWEEN 'ffffffff-ffff-ffff-ffff-ffffffff0001'
                 AND 'ffffffff-ffff-ffff-ffff-ffffffff0018'
  ON CONFLICT (product_id, size_id) DO UPDATE SET active=EXCLUDED.active, price=EXCLUDED.price;

  -- All colours active on every bedframe (per-Model tick; default all-on).
  INSERT INTO product_bedframe_colours (product_id, colour_id, active)
  SELECT p.id, c.id, true
  FROM products p
  CROSS JOIN bedframe_colours c
  WHERE p.id BETWEEN 'ffffffff-ffff-ffff-ffff-ffffffff0001'
                 AND 'ffffffff-ffff-ffff-ffff-ffffffff0018'
  ON CONFLICT (product_id, colour_id) DO UPDATE SET active=EXCLUDED.active;
END $$;
