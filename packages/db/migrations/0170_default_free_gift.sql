-- 0170_default_free_gift.sql
-- Default Free Gift (accessory). A qualifying trigger auto-grants accessory
-- gifts at RM 0 in the POS cart. Two homes for the gift config, matching where
-- a trigger's identity lives:
--   • mfg_products.default_free_gifts      — non-sofa triggers (mattress / bedframe / accessory), matched by product/model.
--   • sofa_combo_pricing.default_free_gifts — sofa triggers, matched BY COMBO (D9), never by compartment.
-- Entry shape: [{ "giftProductId": "<mfg_products.id of an ACCESSORY>", "qty": <int >= 1>, "campaignName": "<text|null>" }]
-- The GIFT is always an accessory; only the TRIGGER may be a sofa combo.
-- Additive; IF NOT EXISTS guards a re-run / parallel-branch collision.
ALTER TABLE mfg_products       ADD COLUMN IF NOT EXISTS default_free_gifts jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sofa_combo_pricing ADD COLUMN IF NOT EXISTS default_free_gifts jsonb NOT NULL DEFAULT '[]'::jsonb;
