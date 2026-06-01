-- 0128_pwp_rules.sql
-- Purchase-with-purchase (PWP / 换购优惠) — Chairman 2026-06-02.
-- Buying a TRIGGER (a specified Mattress model) unlocks buying a REWARD (a
-- specified Bed Frame model) at its PWP price. POS-SELLING-ONLY; cost /
-- procurement untouched. Default data → ZERO price change (no rules seeded,
-- pwp_price_sen defaults 0). The pure resolvePwp (packages/shared/src/pwp.ts)
-- is shared by POS + server; the server uses mfg_products.pwp_price_sen as a
-- valid reward line's selling base (fabric Δ still stacks) and drift-rejects a
-- forged claim.
--
-- ⚠️ RLS: this migration creates NEW-table RLS (pwp_rules) for the Master Admin
-- editor set {admin, super_admin, coordinator, master_account}, mirroring the
-- mfg-products price EDIT_ROLES. It does NOT alter any existing policy. Apply to
-- prod only after Chairman's explicit OK (per red line #4).

-- 1. PWP SELLING base price per SKU. Parallel to sell_price_sen; used INSTEAD of
--    it when the line is a valid PWP reward. 0 = no PWP price set (not eligible
--    for PWP pricing even if its Model is on a rule). Sofa rows carry it too
--    (reserved/unused). Cost path never reads it.
ALTER TABLE mfg_products
  ADD COLUMN IF NOT EXISTS pwp_price_sen integer NOT NULL DEFAULT 0
    CHECK (pwp_price_sen >= 0);

-- 2. Global PWP rules. Generic Category→Category; only MATTRESS→BEDFRAME enabled
--    at launch. Model id arrays hold product_models.id (uuid as text); [] = the
--    whole category. No effective-dating (the PWP price is snapshotted on the
--    order line); rules carry only an `active` flag.
CREATE TABLE pwp_rules (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_category           mfg_product_category NOT NULL,
  trigger_eligible_model_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  reward_category            mfg_product_category NOT NULL,
  eligible_reward_model_ids  jsonb NOT NULL DEFAULT '[]'::jsonb,
  qty_per_trigger            integer NOT NULL DEFAULT 1 CHECK (qty_per_trigger >= 1),
  active                     boolean NOT NULL DEFAULT TRUE,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid REFERENCES staff(id) ON DELETE SET NULL
);

-- At most one active rule per (trigger, reward) category pair.
CREATE UNIQUE INDEX pwp_rules_one_active_per_pair
  ON pwp_rules (trigger_category, reward_category) WHERE active;

COMMENT ON TABLE pwp_rules IS
  'Purchase-with-purchase rules. Buying a trigger-category model (eligible list) unlocks reward-category models (eligible list) at mfg_products.pwp_price_sen. allowance = qty_per_trigger × eligible trigger units in the order. Read by all staff; written by admin/super_admin/coordinator/master_account. POS-selling only.';

-- 3. RLS — SELECT for all staff, writes for the Master Admin editor set.
ALTER TABLE pwp_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY pwp_rules_select_all
  ON pwp_rules FOR SELECT TO authenticated USING (true);

CREATE POLICY pwp_rules_insert_editors
  ON pwp_rules FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','super_admin','coordinator','master_account')));

CREATE POLICY pwp_rules_update_editors
  ON pwp_rules FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','super_admin','coordinator','master_account')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','super_admin','coordinator','master_account')));

CREATE POLICY pwp_rules_delete_editors
  ON pwp_rules FOR DELETE TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','super_admin','coordinator','master_account')));

-- 4. A rule change alters what the engine prices, so bump pricing_version — a
--    saved quote with a stale PWP state then surfaces the drift modal on
--    promotion (same as delivery_fee_config, 0029).
DROP TRIGGER IF EXISTS bump_pricing_version_pwp_rules ON pwp_rules;
CREATE TRIGGER bump_pricing_version_pwp_rules
  AFTER INSERT OR UPDATE OR DELETE ON pwp_rules
  FOR EACH STATEMENT EXECUTE FUNCTION bump_pricing_version();
