-- 0132_pwp_sofa_combo_refs.sql
-- PWP Code Voucher — Phase 2 (sofa by Combo), Chairman 2026-06-02.
-- A sofa is identified by COMBO (modular — no fixed Model). A SOFA pwp_rule names
-- the eligible TRIGGER and REWARD combos; a code snapshots its reward combos so a
-- later rule edit/delete never breaks an outstanding voucher. Mattress/bedframe
-- rules keep using the *_model_ids columns; sofa rules use the *_combo_ids
-- columns. [] = no sofa combos named (a non-sofa rule). Default [] → no behaviour
-- change for existing rows.
--
-- No RLS change (pwp_rules + pwp_codes already have their policies); additive
-- columns only.

-- 1. Sofa rule combo references. sofa_combo_pricing.id[] (uuid-as-text in jsonb,
--    same convention as the *_model_ids arrays).
ALTER TABLE pwp_rules
  ADD COLUMN IF NOT EXISTS trigger_combo_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reward_combo_ids  jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN pwp_rules.trigger_combo_ids IS
  'SOFA trigger: sofa_combo_pricing.id[] whose build qualifies as a trigger. [] = not a sofa-trigger rule. Mattress/bedframe rules use trigger_eligible_model_ids instead.';
COMMENT ON COLUMN pwp_rules.reward_combo_ids IS
  'SOFA reward: sofa_combo_pricing.id[] redeemable at the combo PWP price. [] = not a sofa-reward rule.';

-- 2. The code snapshots its reward combos (mirrors eligible_reward_model_ids for
--    the model path) so a rule edit/delete never breaks an outstanding voucher.
ALTER TABLE pwp_codes
  ADD COLUMN IF NOT EXISTS reward_combo_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN pwp_codes.reward_combo_ids IS
  'Snapshot of the rule''s reward_combo_ids at reserve time (SOFA rewards). [] = a model-based (mattress/bedframe) reward code.';
