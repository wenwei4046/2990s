-- 0130_pwp_codes.sql
-- PWP Code Voucher System (v2) — Chairman 2026-06-02.
-- Upgrades the PWP (换购) redemption from the in-cart-only toggle to a voucher
-- CODE that unifies same-cart + cross-order. Buying a TRIGGER reserves N codes
-- (N = rule.qty_per_trigger × trigger qty), each redeemable once for one REWARD
-- at its mfg_products.pwp_price_sen. POS-SELLING-ONLY; cost / procurement
-- untouched. Default data (no rules / no pwp prices) → ZERO price change.
--
-- Lifecycle: RESERVED (trigger in an open cart/quote, occupies the number) →
-- USED (applied to a reward + that order confirmed) | AVAILABLE (trigger bought
-- but code not applied → printed on the SO, redeemable next order). A RESERVED
-- code is DELETED (number freed) when its trigger leaves the cart.
--
-- ⚠️ RLS: this migration creates NEW-table RLS (pwp_codes). SELECT for all
-- authenticated staff (cross-order redemption reads any staff's code); INSERT /
-- UPDATE / DELETE for any ACTIVE staff (a salesperson owns their cart's reserved
-- codes, and a cross-order redemption marks another staff's AVAILABLE code USED).
-- The /pwp-codes API route + atomic conditional UPDATEs enforce the state
-- machine; RLS is defence-in-depth. It does NOT alter any existing policy. Apply
-- to prod only after Chairman's explicit OK (per red line #4).

-- 1. The voucher codes. `code` is the PRIMARY KEY = the occupy-the-number
--    guarantee (a globally unique string; two carts can never reserve the same
--    one). The rule reference snapshots reward_category + eligible_reward_model_ids
--    so a later rule edit/delete never breaks an outstanding code.
CREATE TABLE pwp_codes (
  code                       text PRIMARY KEY,                       -- 'PWP-1234ABCD'
  rule_id                    uuid REFERENCES pwp_rules(id) ON DELETE SET NULL,
  reward_category            mfg_product_category NOT NULL,          -- snapshot from the rule
  eligible_reward_model_ids  jsonb NOT NULL DEFAULT '[]'::jsonb,     -- snapshot; [] = whole reward category
  status                     text NOT NULL DEFAULT 'RESERVED'
                               CHECK (status IN ('RESERVED','USED','AVAILABLE')),
  owner_staff_id             uuid REFERENCES staff(id) ON DELETE SET NULL,      -- who generated it (whose cart)
  cart_line_key              text,                                   -- the trigger cart line that owns it (delete-on-remove)
  trigger_item_code          text,                                   -- the trigger SKU code (audit)
  source_doc_no              text,                                   -- trigger SO (set at Confirm)
  redeemed_doc_no            text,                                   -- reward SO that consumed it (set when USED)
  redeemed_item_code         text,                                   -- the reward SKU it paid for (audit)
  customer_id                uuid REFERENCES customers(id) ON DELETE SET NULL,  -- bound when the code turns AVAILABLE at the trigger SO
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pwp_codes_owner_status ON pwp_codes (owner_staff_id, status);
CREATE INDEX idx_pwp_codes_cart_line    ON pwp_codes (cart_line_key);
CREATE INDEX idx_pwp_codes_source_doc   ON pwp_codes (source_doc_no);

COMMENT ON TABLE pwp_codes IS
  'PWP (换购) voucher codes. RESERVED when a trigger enters a cart (N = rule.qty_per_trigger × qty), DELETED if the trigger leaves; at order Confirm an applied code → USED, an un-applied reserved code → AVAILABLE (printed on the SO, redeemable next order). Each code = one reward redemption at mfg_products.pwp_price_sen. POS-selling only.';

-- 2. RLS — SELECT for all staff (cross-order validate reads any code); writes
--    for any ACTIVE staff (own-cart reserve + cross-order mark-used). The API
--    route is the real gate; RLS is defence-in-depth.
ALTER TABLE pwp_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY pwp_codes_select_all
  ON pwp_codes FOR SELECT TO authenticated USING (true);

CREATE POLICY pwp_codes_insert_staff
  ON pwp_codes FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE));

CREATE POLICY pwp_codes_update_staff
  ON pwp_codes FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE));

CREATE POLICY pwp_codes_delete_staff
  ON pwp_codes FOR DELETE TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE));
