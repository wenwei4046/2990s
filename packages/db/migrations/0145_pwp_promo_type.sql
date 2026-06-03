-- 0145_pwp_promo_type.sql
-- PWP & Promo — Chairman 2026-06-03.
-- Splits the one PWP rule engine into two flavours via a `type` discriminator:
--   • 'pwp'   — existing behaviour. A reward earns its mfg_products.pwp_price_sen
--               ONLY if that price is > 0 (0 = "no PWP price set", unchanged).
--   • 'promo' — same trigger→reward mechanics, code, Auto Fill, cross-order carry
--               forward + same-customer binding — BUT the reward may redeem for
--               FREE (pwp_price_sen = 0). For a promo code 0 means "free", not
--               "unset". Lets "buy a mattress → get another mattress free" work
--               (which the >0 gate previously blocked).
-- One engine, no parallel tables. POS-SELLING-ONLY; cost / procurement untouched.
-- Default data → ZERO behaviour change (every existing rule/code defaults 'pwp').
--
-- ⚠️ Additive only: two NOT NULL DEFAULT columns. Touches no RLS policy and no
-- index (migration 0129 already removed the one-active-per-pair unique index, so
-- a PWP and a Promo rule on the same category pair coexist with no extra work).
-- Apply to prod only after Chairman's explicit OK (red line #4/#8).

-- 1. Rule flavour. Default 'pwp' keeps every existing rule identical.
ALTER TABLE pwp_rules
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'pwp'
    CHECK (type IN ('pwp','promo'));

-- 2. Each code snapshots its rule's type (like reward_category) so an outstanding
--    voucher keeps its free-vs-paid meaning even if the rule is later edited.
ALTER TABLE pwp_codes
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'pwp'
    CHECK (type IN ('pwp','promo'));

COMMENT ON COLUMN pwp_rules.type IS
  'pwp = reward needs pwp_price_sen > 0; promo = reward may redeem free (0 = free, not unset). Same engine otherwise.';
COMMENT ON COLUMN pwp_codes.type IS
  'Snapshot of the rule type at reserve time. promo codes price a 0 reward as free instead of skipping it.';
