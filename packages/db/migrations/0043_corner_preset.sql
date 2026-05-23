-- 0042_corner_preset.sql
-- F4 (Track 2 · Loo 2026-05-24): corner package preset for the 5539 Model.
-- 1B-LHF + CNR + 2A-RHF sold as a fixed Quick-Pick @2990 — 5539 previously had
-- NO quick-pick (custom à-la-carte summed to 4970, not 2990). Rendered as a
-- COMPOSED preview from module art (no composite PNG; art_base NULL). Price is a
-- plain product_bundles lookup, so the server recompute is unaffected.

INSERT INTO bundle_library (id, label, sub, signature, base_width_cm, base_depth_cm, cushions, default_price, art_left, art_right, art_base, sort_order) VALUES
  ('CORNER', 'Corner', '1B + corner + 2A', 'CORNER-PRESET', 200, 253, 3, 2990, NULL, NULL, NULL, 9)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label, sub = EXCLUDED.sub, signature = EXCLUDED.signature,
  base_width_cm = EXCLUDED.base_width_cm, base_depth_cm = EXCLUDED.base_depth_cm,
  cushions = EXCLUDED.cushions, default_price = EXCLUDED.default_price, sort_order = EXCLUDED.sort_order;

INSERT INTO product_bundles (product_id, bundle_id, active, price) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccc0015', 'CORNER', true, 2990)  -- 5539
ON CONFLICT (product_id, bundle_id) DO UPDATE SET
  active = EXCLUDED.active, price = EXCLUDED.price;
