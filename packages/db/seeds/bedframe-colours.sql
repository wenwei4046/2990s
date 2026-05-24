-- packages/db/seeds/bedframe-colours.sql
-- Starter bedframe colour palette (Loo: "all colour same / free for now, refine
-- soon"). All surcharge 0. Real list is a 1-line update later. Idempotent.
-- APPLY BEFORE bedframe-catalog.sql (its colour cross-join references these).
INSERT INTO bedframe_colours (id, label, swatch_hex, surcharge, active, sort_order) VALUES
  ('sand',     'Sand',     '#D8C7A8', 0, true, 10),
  ('stone',    'Stone',    '#9A958C', 0, true, 20),
  ('charcoal', 'Charcoal', '#3A3A3A', 0, true, 30),
  ('forest',   'Forest',   '#3E5641', 0, true, 40),
  ('rust',     'Rust',     '#A6492E', 0, true, 50)
ON CONFLICT (id) DO UPDATE SET
  label=EXCLUDED.label, swatch_hex=EXCLUDED.swatch_hex, surcharge=EXCLUDED.surcharge,
  active=EXCLUDED.active, sort_order=EXCLUDED.sort_order;
