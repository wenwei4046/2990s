-- 0183_special_delivery_fee_rules.sql
-- Generalises model_special_delivery_fees (0140) onto the #691 RuleTarget
-- abstraction. A rule's `target` jsonb is RuleTarget[] (scopes
-- model | variant | compartment | combo). standalone_fee OVERRIDES the base
-- delivery fee (delivery_fee_config.base_fee) when the rule matches an SO;
-- cross_cat_followup_fee applies when the matched SO is a cross-category
-- follow-up linked to an earlier SO. Fees are whole MYR (the server scales
-- ×100 to sen at order time), mirroring 0140.

CREATE TABLE IF NOT EXISTS special_delivery_fee_rules (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target                  jsonb NOT NULL DEFAULT '[]'::jsonb,
                          -- RuleTarget[]: [{ scope, modelId?, variantKey?, compartmentCode?, comboId? }]
  standalone_fee          integer NOT NULL DEFAULT 0 CHECK (standalone_fee         >= 0),
  cross_cat_followup_fee  integer NOT NULL DEFAULT 0 CHECK (cross_cat_followup_fee >= 0),
  label                   text,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid
);

COMMENT ON TABLE special_delivery_fee_rules IS
  'Special transport-fee rules keyed on the #691 RuleTarget abstraction (target jsonb = RuleTarget[]). standalone_fee overrides the base delivery fee; cross_cat_followup_fee applies on a cross-category follow-up SO. Fees are whole MYR (server scales ×100 to sen). Generalises model_special_delivery_fees (0140). Migration 0183.';

-- Data move: each existing per-Model tag → one rule targeting that Model (scope='model').
-- Guarded so a re-run (this repo has duplicate-numbered migrations) seeds only once.
INSERT INTO special_delivery_fee_rules (target, standalone_fee, cross_cat_followup_fee, updated_at, updated_by)
SELECT jsonb_build_array(jsonb_build_object('modelId', model_id::text, 'scope', 'model')),
       standalone_fee, cross_cat_followup_fee, updated_at, updated_by
FROM model_special_delivery_fees
WHERE NOT EXISTS (SELECT 1 FROM special_delivery_fee_rules);

-- RLS — read for any authenticated staff (the order POST reads it to recompute
-- the fee); write for the same fee-editor roles as 0140 (master_account retired
-- → sales_director).
ALTER TABLE special_delivery_fee_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY sdfr_select_all
  ON special_delivery_fee_rules FOR SELECT TO authenticated
  USING (true);

CREATE POLICY sdfr_write_fee_editors
  ON special_delivery_fee_rules FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff
       WHERE id = auth.uid()
         AND active = TRUE
         AND role IN ('admin', 'coordinator', 'sales_director', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff
       WHERE id = auth.uid()
         AND active = TRUE
         AND role IN ('admin', 'coordinator', 'sales_director', 'super_admin')
    )
  );
