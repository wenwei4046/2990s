-- 0041_console_and_powerslide_presets.sql
-- F6 (console) + F7 (power-slide combo) — Track 2 · Loo 2026-05-24.
-- Two new Quick-Pick preset bundles. Both are plain priced presets — the price is
-- a product_bundles lookup, so the server-side recompute is UNAFFECTED (no engine
-- override; F7 chosen as a preset, not a per-seat price override).
--   2WC = 2-Seater + Console (1A-LHF + WC-45 + 1A-RHF) — SF 9050, SF 5119 @2990
--   2PS = 2-Seater + 2 Power slide combo — DSL 8027 @2990 (per-seat power slide
--         stays available in Custom Build via products.seat_upgrade_label)
-- Engine: BUNDLES gained 2WC/2PS in packages/shared/src/sofa-build.ts. POS art
-- reuses 2S.png (2WC auto-uses /sofa-modules/2WC.png once Loo adds that plan-view).

INSERT INTO bundle_library (id, label, sub, signature, base_width_cm, base_depth_cm, cushions, default_price, art_left, art_right, art_base, sort_order) VALUES
  ('2WC', '2-Seater + Console',       '2-seater with wood console', '2WC-PRESET', 235, 95, 2, 2990, NULL, NULL, '2WC.png', 7),
  ('2PS', '2-Seater + 2 Power slide', '2-seater · 2 power slide',   '2PS-PRESET', 265, 95, 3, 2990, NULL, NULL, '2S.png',  8)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label, sub = EXCLUDED.sub, signature = EXCLUDED.signature,
  base_width_cm = EXCLUDED.base_width_cm, base_depth_cm = EXCLUDED.base_depth_cm,
  cushions = EXCLUDED.cushions, default_price = EXCLUDED.default_price,
  art_base = EXCLUDED.art_base, sort_order = EXCLUDED.sort_order;

-- SF 9050: its ONLY config is the console — deactivate the plain 2S, add 2WC.
UPDATE product_bundles SET active = false
  WHERE product_id = 'cccccccc-cccc-cccc-cccc-cccccccc0003' AND bundle_id = '2S';

INSERT INTO product_bundles (product_id, bundle_id, active, price) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccc0003', '2WC', true, 2990),  -- SF 9050
  ('cccccccc-cccc-cccc-cccc-cccccccc0007', '2WC', true, 2990),  -- SF 5119
  ('cccccccc-cccc-cccc-cccc-cccccccc0012', '2PS', true, 2990)   -- DSL 8027
ON CONFLICT (product_id, bundle_id) DO UPDATE SET
  active = EXCLUDED.active, price = EXCLUDED.price;
