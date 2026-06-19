-- 0179_combo_price_tiers.sql
-- Combo Price 1/2/3 by fabric tier (Option B, owner 2026-06-19).
--
-- Today a sofa combo carries ONE selling map (selling_prices_by_height = the
-- PRICE_1 base) and the Price-1/2/3 difference is a FLAT per-item add-on
-- (fabric-tier-addon.ts sofaTier2Delta/sofaTier3Delta). Option B lets a combo
-- GENUINELY store three per-height SELLING price maps, picked by the line's
-- fabric tier:
--   · price1 = the EXISTING selling_prices_by_height (NOT renamed),
--   · price2_by_height / price3_by_height = explicit per-tier selling maps.
-- When a build's fabric resolves to PRICE_2 / PRICE_3 AND the matching map is
-- NON-EMPTY, the engine charges that explicit tier price and SUPPRESSES the flat
-- fabric-tier add-on for that combo (the tier premium is already in the map).
-- EMPTY {} (the default these columns get for every existing combo) means the
-- combo falls back to PRICE_1 selling + the flat add-on — BYTE-IDENTICAL to
-- today. This is the backward-compat guarantee.
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS, NOT NULL DEFAULT '{}'::jsonb),
-- so the deploy auto-runner (applies migrations >= 0168) can safely re-run it.
-- No existing object is altered; combo cost/selling/PWP maps are untouched.
--
-- ⚠️ DO NOT apply by hand here — the owner applies migrations on prod.

BEGIN;

ALTER TABLE sofa_combo_pricing
  ADD COLUMN IF NOT EXISTS price2_by_height jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS price3_by_height jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN sofa_combo_pricing.price2_by_height IS
  'Option B — explicit SELLING price per height for fabric tier PRICE_2. '
  '{} = inherit price1 (selling_prices_by_height) + the flat fabric-tier add-on '
  '(byte-identical to pre-Option-B behaviour).';
COMMENT ON COLUMN sofa_combo_pricing.price3_by_height IS
  'Option B — explicit SELLING price per height for fabric tier PRICE_3. '
  '{} = inherit price1 (selling_prices_by_height) + the flat fabric-tier add-on '
  '(byte-identical to pre-Option-B behaviour).';

COMMIT;
