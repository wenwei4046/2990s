-- 2990's Portal · seed data for libraries + initial staff
-- Run AFTER `drizzle-kit push` / migrations. Idempotent (uses ON CONFLICT).
-- ============================================================================

-- ─── Order ID sequence (SO-XXXX) ────────────────────────────────────────────
-- Drizzle can't model sequences with custom prefixes, so we set this in raw SQL.
CREATE SEQUENCE IF NOT EXISTS order_seq START WITH 2050;

CREATE OR REPLACE FUNCTION next_order_id() RETURNS TEXT
  LANGUAGE sql VOLATILE AS
  $$ SELECT 'SO-' || nextval('order_seq')::text $$;

ALTER TABLE orders ALTER COLUMN id SET DEFAULT next_order_id();

-- ─── Categories ─────────────────────────────────────────────────────────────
INSERT INTO categories (id, label, icon, tbc, sort_order) VALUES
  ('mattress',  'Mattresses',  'bed-double',  FALSE, 1),
  ('sofa',      'Sofas',       'sofa',        FALSE, 2),
  ('bedframe',  'Bed frames',  'bed',         FALSE, 3),
  ('dining',    'Dining',      'utensils',    TRUE,  4),
  ('bathroom',  'Bathroom',    'bath',        TRUE,  5),
  ('kids',      'Kids zone',   'baby',        TRUE,  6),
  ('accessory', 'Accessories', 'lamp',        TRUE,  7)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label, icon = EXCLUDED.icon, tbc = EXCLUDED.tbc, sort_order = EXCLUDED.sort_order;

-- ─── Series ─────────────────────────────────────────────────────────────────
INSERT INTO series (id, label, active) VALUES
  ('white-series', 'White Series', TRUE),
  ('earth-warm',   'Earth Warm',   TRUE),
  ('trend-26',     'Trend 26',     TRUE),
  ('kids-zone',    'Kids Zone',    TRUE)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, active = EXCLUDED.active;

-- ─── Compartment library (15 modules — supplier convention: LHF/RHF) ───────
-- Carries the structural definition (group, dimensions, art, default price).
-- Per-product pricing lives in product_compartments — DON'T edit here for a
-- specific Sofa Model.
-- LHF/RHF = left/right hand facing (Hookka / industry naming).
-- CNR = single corner SKU; canvas rotation orients NW/NE/SE/SW.
-- 1B/2B = wide-arm variants (10–12 cm wider than 1A/2A).
-- STOOL = ottoman accessory; not yet wired into frontend palette.
INSERT INTO compartment_library (id, comp_group, label, width_cm, depth_cm, cushions, default_price, art_filename, is_accessory, sort_order) VALUES
  ('1A-LHF', '1-seater',  '1A · Left hand facing',           95,  95, 1, 1490, '1A-LHF.png', FALSE,  1),
  ('1A-RHF', '1-seater',  '1A · Right hand facing',          95,  95, 1, 1490, '1A-RHF.png', FALSE,  2),
  ('1B-LHF', '1-seater',  '1B · Left hand facing (wide arm)',105,  95, 1, 1490, '1B-LHF.png', FALSE,  3),
  ('1B-RHF', '1-seater',  '1B · Right hand facing (wide arm)',105, 95, 1, 1490, '1B-RHF.png', FALSE,  4),
  ('1NA',    '1-seater',  '1NA · No arms',                   75,  95, 1,  990, '1NA.png',    FALSE,  5),
  ('2A-LHF', '2-seater',  '2A · Left hand facing',          158,  95, 2, 1990, '2A-LHF.png', FALSE,  6),
  ('2A-RHF', '2-seater',  '2A · Right hand facing',         158,  95, 2, 1990, '2A-RHF.png', FALSE,  7),
  ('2B-LHF', '2-seater',  '2B · Left hand facing (wide arm)',170, 95, 2, 1990, '2B-LHF.png', FALSE,  8),
  ('2B-RHF', '2-seater',  '2B · Right hand facing (wide arm)',170, 95, 2, 1990, '2B-RHF.png', FALSE,  9),
  ('2NA',    '2-seater',  '2NA · No arms',                  142,  95, 2, 1490, '2NA.png',    FALSE, 10),
  ('CNR',    'Corner',    'Corner piece',                    95,  95, 1, 1490, 'CNR.png',    FALSE, 11),
  ('L-LHF',  'L-Shape',   'L · Left hand facing chaise',     95, 165, 1, 1490, 'L-LHF.png',  FALSE, 12),
  ('L-RHF',  'L-Shape',   'L · Right hand facing chaise',    95, 165, 1, 1490, 'L-RHF.png',  FALSE, 13),
  ('WC-45',  'Accessory', 'Wood console · 45cm',             45,  95, 0,  590, 'WC-45.png',  TRUE,  14),
  ('STOOL',  'Accessory', 'Ottoman / stool',                 75,  75, 0,  490, 'STOOL.png',  TRUE,  15)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label, width_cm = EXCLUDED.width_cm, depth_cm = EXCLUDED.depth_cm,
  default_price = EXCLUDED.default_price, art_filename = EXCLUDED.art_filename,
  is_accessory = EXCLUDED.is_accessory, sort_order = EXCLUDED.sort_order;

-- ─── Bundle library (5 quick-pick presets) ──────────────────────────────────
INSERT INTO bundle_library (id, label, sub, signature, base_width_cm, base_depth_cm, cushions, default_price, art_left, art_right, art_base, sort_order) VALUES
  ('1S',  '1-Seater', 'Single seat',           '1A',         190,  95, 2, 1490, NULL, NULL, '1S.png', 1),
  ('2S',  '2-Seater', 'Two seats',             '2A',         316,  95, 4, 1990, NULL, NULL, '2S.png', 2),
  ('3S',  '3-Seater', 'Three seats',           '1A+2A',      265,  95, 3, 2490, NULL, NULL, '3S.png', 3),
  ('2+L', '2 + L',    '2-seater with chaise',  '2A+L',       253, 165, 3, 2990, '2+L-L.png', '2+L-R.png', NULL, 4),
  ('3+L', '3 + L',    '3-seater with chaise',  '1A+2NA+L',   360, 165, 4, 3990, '3+L-L.png', '3+L-R.png', NULL, 5)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label, sub = EXCLUDED.sub, signature = EXCLUDED.signature,
  default_price = EXCLUDED.default_price, sort_order = EXCLUDED.sort_order;

-- ─── Size library (4 mattress/bedframe sizes) ───────────────────────────────
INSERT INTO size_library (id, label, width_cm, length_cm, sort_order) VALUES
  ('single',        'Single',        92, 190, 1),
  ('super-single',  'Super single', 107, 190, 2),
  ('queen',         'Queen',        152, 190, 3),
  ('king',          'King',         183, 190, 4)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label, width_cm = EXCLUDED.width_cm, length_cm = EXCLUDED.length_cm;

-- ─── Add-ons (mirrors prototype seed) ───────────────────────────────────────
INSERT INTO addons (id, label, description, icon, kind, price, per_floor_item, unit, default_qty, stock, enabled, sort_order) VALUES
  ('dispose-mattress', 'Dispose old mattress', 'We collect & dispose responsibly',     'recycle',           'qty',          120, NULL, 'piece',      1, NULL, TRUE,  1),
  ('dispose-bedframe', 'Dispose old bedframe', 'We collect & dispose responsibly',     'recycle',           'qty',          120, NULL, 'piece',      1, NULL, TRUE,  2),
  ('lift',             'Lift access — 3rd floor & above', 'For buildings without service lift', 'arrow-up-from-line', 'floors_items',  0,  50, 'floor·item', 1, NULL, TRUE,  3),
  ('assemble',         'Bed frame assembly',  'On-site assembly by delivery team',     'wrench',            'qty',           80, NULL, 'piece',      1, NULL, TRUE,  4),
  ('wrap',             'Mattress protector wrap', 'Vacuum-sealed protective wrap',     'package',           'qty',           35, NULL, 'piece',      1, 240,  TRUE,  5),
  ('pillow-set',       'Linen pillow pair',   'Set of 2 linen pillows',                'sparkles',          'qty',          180, NULL, 'set',        1, 18,   FALSE, 6)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, price = EXCLUDED.price,
  per_floor_item = EXCLUDED.per_floor_item, enabled = EXCLUDED.enabled,
  updated_at = now();

-- ─── Initial showrooms ──────────────────────────────────────────────────────
-- Single showroom at MVP. New rows added when 2990's expands.
INSERT INTO showrooms (id, showroom_code, name, address, phone, active, sort_order) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'KL', 'Showroom KL', 'Lot 1, Jalan Showroom, KL', '+60 3 1234 5678', TRUE, 1)
ON CONFLICT (id) DO NOTHING;

-- ─── Initial staff (PLACEHOLDER — replace before production deploy) ─────────
-- These rows exist so the dev environment has working staff to test against.
-- Before production deploy:
--   1. Create real staff via Supabase Auth admin API
--   2. INSERT new rows into this table using the auth.users.id as `id`
--   3. DELETE these placeholder rows (or update them in place)
-- The UUIDs below (11111..., 22222..., etc) are intentionally fake and
-- recognisable so they're easy to spot and remove.
INSERT INTO staff (id, staff_code, name, role, showroom_id, email, initials, color, active) VALUES
  ('11111111-1111-1111-1111-111111111111'::uuid, 'S01', 'Sales 01',         'sales',         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'sales01@example.com',       'S1', '#E86B3A', TRUE),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'L01', 'Showroom Lead 01', 'showroom_lead', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'lead01@example.com',        'L1', '#A6471E', TRUE),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'S02', 'Sales 02',         'sales',         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'sales02@example.com',       'S2', '#2F5D4F', TRUE),
  ('44444444-4444-4444-4444-444444444444'::uuid, 'S03', 'Sales 03',         'sales',         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'sales03@example.com',       'S3', '#1F3A8A', TRUE),
  ('55555555-5555-5555-5555-555555555555'::uuid, 'C01', 'Coordinator 01',   'coordinator',   NULL,                                          'coordinator01@example.com', 'C1', '#A6471E', TRUE)
ON CONFLICT (id) DO NOTHING;

-- ─── Initial drivers (PLACEHOLDER — replace before production deploy) ───────
INSERT INTO drivers (driver_code, name, phone, ic_number, vehicle, active) VALUES
  ('DRV-01', 'Driver 01', '+60 00 000 0001', NULL, 'Lorry · placeholder', TRUE),
  ('DRV-02', 'Driver 02', '+60 00 000 0002', NULL, 'Van · placeholder',   TRUE),
  ('DRV-03', 'Driver 03', '+60 00 000 0003', NULL, 'Lorry · placeholder', TRUE)
ON CONFLICT (driver_code) DO NOTHING;

-- ============================================================================
-- After this seed runs, the catalog is empty. Use the Backend SKU Master to
-- create the first products, OR run the demo-products.sql seed (separate file)
-- to populate Cloud / Oak / Linen / Dusk mattresses, Noor / Tanah / Rumah /
-- Petang sofas, and Kayu / Tenun / Oasis bed frames per the prototype data.
-- ============================================================================
