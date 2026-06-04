-- packages/db/seeds/hookka-sofa-catalog.sql
-- Real Hookka Industries 3 sofa models (5531 / 5535 / 5539) — full sofa_build
-- structure (compartments, bundles, size variants), prices left as 0 placeholders
-- for Loo to fill via the Backend SKU Master UI after deploy.
--
-- Source: Hookka Industries Sdn Bhd quotation, customer 300-C "Carress" (PDF).
-- Supplier:
--   HOOKKA INDUSTRIES SDN BHD
--   2775F, Jalan Industri 12, Kampung Baru Sungai Buloh, 47000 Sungai Buloh, Selangor
--   +6011-6133 3173 · hookka.industries@gmail.com
--   SSM 202501060540 (1661946-X) · TIN C60515534080
--
-- Why prices = 0:
--   - product_compartments.price / product_bundles.price / product_size_variants.price
--     are NOT NULL in schema. 0 is the placeholder until the SKU Master sets real values.
--   - products.recliner_upgrade_price is required (NOT NULL) when pricing_kind='sofa_build'
--     by the pricing_consistency CHECK; we set it to 0.
--   - flat_price stays NULL (correct for sofa_build).
--
-- Naming convention — Hookka quotation codes mapped 1:1 into compartment_library:
--   1A(LHF) / 1A(RHF) — 1-seat with arm, left/right hand facing
--   1B(LHF) / 1B(RHF) — 1-seat with larger arm, L/R (5539 only)
--   2A(LHF) / 2A(RHF) — 2-seat with arm, L/R
--   2B(LHF) / 2B(RHF) — 2-seat with larger arm, L/R (5539 only)
--   1NA / 2NA       — no-arm pieces (codes match prototype's existing entries; reused)
--   L(LHF) / L(RHF)   — chaise/L-shape, L/R
--   CNR             — generic corner
--   STOOL           — ottoman/stool (accessory)
--
-- Bundle library: Hookka uses 1S / 2S / 3S — these already exist (prototype seed); reused.
-- Size library: 24" / 28" / 30" depths — added as s-24 / s-28 / s-30 (cm rounded: 61/71/76).
--
-- Stable UUIDs ffffffff-ffff-ffff-ffff-ffffffff5531/5535/5539 (5,3,9 are valid hex).
-- ON CONFLICT clauses make this idempotent — safe to re-run.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Update KFA supplier → real Hookka details (keep code='KFA' as stable identifier)
-- ────────────────────────────────────────────────────────────────────────────
UPDATE suppliers
SET
  name            = 'Hookka Industries Sdn Bhd',
  whatsapp_number = '+60116133 3173',
  email           = 'hookka.industries@gmail.com',
  updated_at      = now()
WHERE code = 'KFA';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Compartment library — add Hookka-specific codes (reuse 1NA / 2NA which match)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO compartment_library
  (id, comp_group, label, width_cm, depth_cm, cushions, default_price, art_filename, is_accessory, sort_order)
VALUES
  -- 1-seater with arm (A = standard arm)
  ('1A(LHF)', '1-seater', '1A · Left hand facing',  95, 95, 1, 0, NULL, false, 101),
  ('1A(RHF)', '1-seater', '1A · Right hand facing', 95, 95, 1, 0, NULL, false, 102),
  -- 1-seater with larger arm (B = wider arm; 5539 only)
  ('1B(LHF)', '1-seater', '1B · Left hand facing (wide arm)',  105, 95, 1, 0, NULL, false, 103),
  ('1B(RHF)', '1-seater', '1B · Right hand facing (wide arm)', 105, 95, 1, 0, NULL, false, 104),
  -- 2-seater with arm
  ('2A(LHF)', '2-seater', '2A · Left hand facing',  158, 95, 2, 0, NULL, false, 105),
  ('2A(RHF)', '2-seater', '2A · Right hand facing', 158, 95, 2, 0, NULL, false, 106),
  -- 2-seater with larger arm (5539 only)
  ('2B(LHF)', '2-seater', '2B · Left hand facing (wide arm)',  170, 95, 2, 0, NULL, false, 107),
  ('2B(RHF)', '2-seater', '2B · Right hand facing (wide arm)', 170, 95, 2, 0, NULL, false, 108),
  -- L-shape chaise (LHF/RHF naming)
  ('L(LHF)',  'L-Shape',  'L · Left hand facing chaise',  95, 165, 1, 0, NULL, false, 109),
  ('L(RHF)',  'L-Shape',  'L · Right hand facing chaise', 95, 165, 1, 0, NULL, false, 110),
  -- Generic corner (Hookka doesn't distinguish NW/NE/SE/SW)
  ('CNR',    'Corner',   'Corner piece', 95, 95, 1, 0, NULL, false, 111),
  -- Ottoman / stool
  ('STOOL',  'Accessory','Ottoman / stool', 75, 75, 0, 0, NULL, true, 112)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Size library — add sofa-depth sizes (24" / 28" / 30")
-- ────────────────────────────────────────────────────────────────────────────
-- size_library is shaped for bed sizes (width × length cm) but the schema doesn't
-- restrict semantics — we use width_cm = depth in cm, length_cm = depth in cm
-- (square-ish placeholder). Labels carry the human-readable depth in inches.
INSERT INTO size_library (id, label, width_cm, length_cm, sort_order)
VALUES
  ('s-24', '24-inch depth', 61, 61, 101),
  ('s-28', '28-inch depth', 71, 71, 102),
  ('s-30', '30-inch depth', 76, 76, 103)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Insert 3 sofa products (5531 / 5535 / 5539)
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_sup_kfa uuid;
BEGIN
  SELECT id INTO v_sup_kfa FROM suppliers WHERE code = 'KFA' LIMIT 1;

  IF v_sup_kfa IS NULL THEN
    RAISE EXCEPTION 'Hookka seed: KFA supplier not found — aborting';
  END IF;

  INSERT INTO products
    (id, sku, category_id, pricing_kind, name, detail, visible, stock,
     flat_price, recliner_upgrade_price, supplier_id)
  VALUES
    ('ffffffff-ffff-ffff-ffff-ffffffff5531', 'SOF-5531', 'sofa', 'sofa_build',
      'Sofa 5531', 'Hookka modular · 10 compartments · 3 bundles · 3 depths',
      true, 0, NULL, 0, v_sup_kfa),
    ('ffffffff-ffff-ffff-ffff-ffffffff5535', 'SOF-5535', 'sofa', 'sofa_build',
      'Sofa 5535', 'Hookka modular · 10 compartments · 3 bundles · 3 depths',
      true, 0, NULL, 0, v_sup_kfa),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539', 'SOF-5539', 'sofa', 'sofa_build',
      'Sofa 5539', 'Hookka modular · 14 compartments (incl. 1B/2B wide arm) · 3 bundles · 3 depths',
      true, 0, NULL, 0, v_sup_kfa)
  ON CONFLICT (id) DO UPDATE SET
    sku                    = EXCLUDED.sku,
    name                   = EXCLUDED.name,
    detail                 = EXCLUDED.detail,
    pricing_kind           = EXCLUDED.pricing_kind,
    flat_price             = EXCLUDED.flat_price,
    recliner_upgrade_price = EXCLUDED.recliner_upgrade_price,
    supplier_id            = EXCLUDED.supplier_id,
    visible                = EXCLUDED.visible,
    updated_at             = now();
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Compartments per model — price = 0 (NOT NULL placeholder)
-- ────────────────────────────────────────────────────────────────────────────
-- 5531 + 5535: 10 compartments each (1A LHF/RHF, 2A LHF/RHF, 1NA, 2NA, L LHF/RHF, CNR, STOOL)
INSERT INTO product_compartments (product_id, compartment_id, price, active)
SELECT product_id, comp_id, 0, true
FROM (
  VALUES
    ('ffffffff-ffff-ffff-ffff-ffffffff5531'::uuid, '1A(LHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5531'::uuid, '1A(RHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5531'::uuid, '2A(LHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5531'::uuid, '2A(RHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5531'::uuid, '1NA'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5531'::uuid, '2NA'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5531'::uuid, 'L(LHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5531'::uuid, 'L(RHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5531'::uuid, 'CNR'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5531'::uuid, 'STOOL'),

    ('ffffffff-ffff-ffff-ffff-ffffffff5535'::uuid, '1A(LHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5535'::uuid, '1A(RHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5535'::uuid, '2A(LHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5535'::uuid, '2A(RHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5535'::uuid, '1NA'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5535'::uuid, '2NA'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5535'::uuid, 'L(LHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5535'::uuid, 'L(RHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5535'::uuid, 'CNR'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5535'::uuid, 'STOOL'),

    -- 5539: 10 base + 4 wide-arm variants (1B / 2B LHF/RHF) = 14 compartments
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, '1A(LHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, '1A(RHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, '1B(LHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, '1B(RHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, '2A(LHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, '2A(RHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, '2B(LHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, '2B(RHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, '1NA'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, '2NA'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, 'L(LHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, 'L(RHF)'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, 'CNR'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, 'STOOL')
) AS t(product_id, comp_id)
ON CONFLICT (product_id, compartment_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Bundles per model — 1S / 2S / 3S, price = 0 placeholder
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO product_bundles (product_id, bundle_id, price, active)
SELECT product_id, bundle_id, 0, true
FROM (
  VALUES
    ('ffffffff-ffff-ffff-ffff-ffffffff5531'::uuid, '1S'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5531'::uuid, '2S'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5531'::uuid, '3S'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5535'::uuid, '1S'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5535'::uuid, '2S'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5535'::uuid, '3S'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, '1S'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, '2S'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, '3S')
) AS t(product_id, bundle_id)
ON CONFLICT (product_id, bundle_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Size variants per model — 24" / 28" / 30" depth, price = 0 placeholder
-- ────────────────────────────────────────────────────────────────────────────
-- Note: pricing_consistency CHECK doesn't restrict size_variants to specific
-- pricing_kind. Sofa_build with size variants is structurally allowed; depth
-- becomes a per-build modifier alongside compartments.
INSERT INTO product_size_variants (product_id, size_id, price, active)
SELECT product_id, size_id, 0, true
FROM (
  VALUES
    ('ffffffff-ffff-ffff-ffff-ffffffff5531'::uuid, 's-24'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5531'::uuid, 's-28'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5531'::uuid, 's-30'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5535'::uuid, 's-24'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5535'::uuid, 's-28'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5535'::uuid, 's-30'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, 's-24'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, 's-28'),
    ('ffffffff-ffff-ffff-ffff-ffffffff5539'::uuid, 's-30')
) AS t(product_id, size_id)
ON CONFLICT (product_id, size_id) DO NOTHING;
