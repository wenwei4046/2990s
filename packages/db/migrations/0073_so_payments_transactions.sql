-- ----------------------------------------------------------------------------
-- 0073 — Payments as transactions (PR #163).
--
-- Commander 2026-05-27: "我save了之后不会变成一个transaction出来的吗 然后
-- 没有看到total amount在order那边". The Payment card on the SO detail page
-- was a single-row block (method + approval_code + payment_date + paid_centi
-- + deposit_centi) that got overwritten on every save. Commander wants
-- HOOKKA-style behaviour: each Save → one transaction row in a payments
-- ledger, so we have a full receipt history per SO and the order page can
-- compute `total paid = sum(payments.amount)` instead of carrying a single
-- mutable scalar.
--
-- Schema mirrors HOOKKA's payments grid: Date · Method · Amount · Account
-- Sheet · Approval Code · Collected By.
--
-- The legacy header fields (payment_method, merchant_provider, installment_
-- months, approval_code, payment_date, paid_centi) are LEFT IN PLACE for
-- now — the UI refactor in PR #163 will start writing to mfg_sales_order_
-- payments and stop writing to those columns, then a follow-up migration
-- can drop them once the live data is migrated. deposit_centi stays as the
-- "expected deposit" target (50% rule etc.) — it is a requirement, not an
-- amount-paid figure.
-- ----------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS mfg_sales_order_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  so_doc_no           text NOT NULL REFERENCES mfg_sales_orders(doc_no) ON DELETE CASCADE,
  paid_at             date NOT NULL DEFAULT CURRENT_DATE,
  method              text NOT NULL,                -- 'merchant' | 'transfer' | 'cash'
  merchant_provider   text,                          -- 'GHL' | 'HLB' | 'MBB' | 'PBB' (only when method='merchant')
  installment_months  integer,                       -- 6 | 12 — null = normal swipe (only when method='merchant')
  approval_code       text,                          -- auth code (merchant) / slip ref (transfer) / receipt no (cash)
  amount_centi        integer NOT NULL CHECK (amount_centi >= 0),
  account_sheet       text,                          -- bank account / cashbook the funds landed in (free text for now)
  collected_by        uuid REFERENCES staff(id) ON DELETE SET NULL,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES staff(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_msop_doc      ON mfg_sales_order_payments(so_doc_no);
CREATE INDEX IF NOT EXISTS idx_msop_paid_at  ON mfg_sales_order_payments(paid_at);

-- RLS: same pattern as 0072 — every authenticated staff can read+write
-- their orders' payments. Granular per-role gating later.
ALTER TABLE mfg_sales_order_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS msop_select ON mfg_sales_order_payments;
DROP POLICY IF EXISTS msop_insert ON mfg_sales_order_payments;
DROP POLICY IF EXISTS msop_update ON mfg_sales_order_payments;
DROP POLICY IF EXISTS msop_delete ON mfg_sales_order_payments;

CREATE POLICY msop_select ON mfg_sales_order_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY msop_insert ON mfg_sales_order_payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY msop_update ON mfg_sales_order_payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY msop_delete ON mfg_sales_order_payments FOR DELETE TO authenticated USING (true);

COMMIT;
