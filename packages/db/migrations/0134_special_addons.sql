-- 0134_special_addons.sql
-- (Applied to prod 2026-06-02 via Supabase MCP under ledger name
--  `0133_special_addons`; file renumbered 0133->0134 because a concurrent
--  delivery-fee branch also took 0133. Already applied — this file is for
--  fresh-DB replay / record. The file/ledger name mismatch is cosmetic.)
-- Special Add-ons (Chairman 2026-06-02). The grown-up version of the flat
-- maintenance_config `specials` / `sofaSpecials` pools: a per-Model, optionally
-- multi-choice product add-on (e.g. "Right Drawer" → Thickness 10"/8") that
-- shows as a DESCRIPTION on the SO product line + a selling surcharge. NOT a SKU.
-- POS-SELLING-ONLY; cost/procurement untouched.
--
-- Takeover (NOT migration of Models/orders): the `code` column reuses the SAME
-- string already stored in product_models.allowed_options.specials and the SO
-- line's variants.specials (e.g. 'Right Drawer'). So the 11 Models' on/off and
-- every historical order keep working unchanged — only the price/description
-- LOOKUP source moves from maintenance_config → this table (by code), later PRs.
--
-- ⚠️ RLS: this migration creates NEW-table RLS (special_addons) for the Master
-- Admin editor set {admin, super_admin, coordinator, master_account}, mirroring
-- pwp_rules (0128) + mfg-products price EDIT_ROLES. It does NOT alter any
-- existing policy. Apply to prod only after Chairman's explicit OK (red line #4).

-- 1. The add-on definition. One row = one special add-on.
--    selling_price_sen / cost_price_sen may be NEGATIVE (a deduction, e.g. the
--    existing "No Side Panel" = −RM40 = −4000). No >= 0 CHECK by design
--    (Chairman 2026-06-02 decision C: a line total may go < 0).
CREATE TABLE special_addons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable business key. = old special `value` + allowed_options.specials entry
  -- + variants.specials entry. Unique so the per-Model gate stays code-keyed.
  code               text NOT NULL UNIQUE,
  label              text NOT NULL,
  so_description     text NOT NULL DEFAULT '',
  -- Which product categories may offer it (multi). [] = none. e.g. {BEDFRAME},
  -- {BEDFRAME,MATTRESS}. Modular filters the picker by the Model's category.
  categories         text[] NOT NULL DEFAULT '{}',
  -- POS SELLING surcharge added when picked. cost_price_sen is the procurement
  -- benchmark (carried over from the old priceSen), never summed into selling.
  selling_price_sen  integer NOT NULL DEFAULT 0,
  cost_price_sen     integer NOT NULL DEFAULT 0,
  -- 0..N follow-up questions. Each: { label, required, choices:[{label, extraSen}] }.
  -- [] = no follow-up (tick → flat add). extraSen may be negative too.
  option_groups      jsonb NOT NULL DEFAULT '[]'::jsonb,
  active             boolean NOT NULL DEFAULT TRUE,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES staff(id) ON DELETE SET NULL
);

COMMENT ON TABLE special_addons IS
  'Special add-ons (Chairman 2026-06-02). Per-Model product add-ons priced on top of the product (selling surcharge + optional sub-choices), shown as an SO line description — not a SKU. code = the string in allowed_options.specials / variants.specials (zero Model/order migration). Read by all staff; written by admin/super_admin/coordinator/master_account. POS-selling only.';

-- 2. Seed (TAKEOVER) from the current master maintenance_config specials pools so
--    Right Drawer / drawers / covers / No Side Panel etc. carry over with their
--    cost ref + (currently 0) selling. categories: specials→BEDFRAME, sofaSpecials
--    →SOFA. No follow-up groups initially (Chairman adds Thickness etc. later).
--    ON CONFLICT DO NOTHING: a code present in both pools keeps the first (no
--    overlap in live data 2026-06-02). selling_price_sen defaults from the old
--    sellingPriceSen (unset → 0) ⇒ ZERO customer-price change on apply.
WITH latest AS (
  SELECT config
  FROM maintenance_config_history
  WHERE scope = 'master'
  ORDER BY effective_from DESC
  LIMIT 1
)
INSERT INTO special_addons
  (code, label, so_description, categories, selling_price_sen, cost_price_sen, option_groups, active, sort_order)
SELECT
  elem->>'value',
  elem->>'value',
  '',
  ARRAY['BEDFRAME']::text[],
  COALESCE(NULLIF(elem->>'sellingPriceSen','')::int, 0),
  COALESCE(NULLIF(elem->>'priceSen','')::int, 0),
  '[]'::jsonb,
  TRUE,
  ord::int
FROM latest, jsonb_array_elements(COALESCE(latest.config->'specials', '[]'::jsonb))
  WITH ORDINALITY AS t(elem, ord)
WHERE COALESCE(elem->>'value','') <> ''
ON CONFLICT (code) DO NOTHING;

WITH latest AS (
  SELECT config
  FROM maintenance_config_history
  WHERE scope = 'master'
  ORDER BY effective_from DESC
  LIMIT 1
)
INSERT INTO special_addons
  (code, label, so_description, categories, selling_price_sen, cost_price_sen, option_groups, active, sort_order)
SELECT
  elem->>'value',
  elem->>'value',
  '',
  ARRAY['SOFA']::text[],
  COALESCE(NULLIF(elem->>'sellingPriceSen','')::int, 0),
  COALESCE(NULLIF(elem->>'priceSen','')::int, 0),
  '[]'::jsonb,
  TRUE,
  1000 + ord::int
FROM latest, jsonb_array_elements(COALESCE(latest.config->'sofaSpecials', '[]'::jsonb))
  WITH ORDINALITY AS t(elem, ord)
WHERE COALESCE(elem->>'value','') <> ''
ON CONFLICT (code) DO NOTHING;

-- 3. RLS — SELECT for all staff (POS configurator + Modular need it); writes for
--    the Master Admin editor set. Mirrors pwp_rules (0128). No existing policy altered.
ALTER TABLE special_addons ENABLE ROW LEVEL SECURITY;

CREATE POLICY special_addons_select_all
  ON special_addons FOR SELECT TO authenticated USING (true);

CREATE POLICY special_addons_insert_editors
  ON special_addons FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','super_admin','coordinator','master_account')));

CREATE POLICY special_addons_update_editors
  ON special_addons FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','super_admin','coordinator','master_account')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','super_admin','coordinator','master_account')));

CREATE POLICY special_addons_delete_editors
  ON special_addons FOR DELETE TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','super_admin','coordinator','master_account')));

-- 4. A price/active change alters what the engine prices, so bump pricing_version —
--    a saved quote with stale add-on state then surfaces the drift modal on
--    promotion (same as pwp_rules 0128 / delivery_fee_config 0029).
DROP TRIGGER IF EXISTS bump_pricing_version_special_addons ON special_addons;
CREATE TRIGGER bump_pricing_version_special_addons
  AFTER INSERT OR UPDATE OR DELETE ON special_addons
  FOR EACH STATEMENT EXECUTE FUNCTION bump_pricing_version();
