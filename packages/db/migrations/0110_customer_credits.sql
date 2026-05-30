-- ----------------------------------------------------------------------------
-- 0110 — Customer Credit Balance ledger (Commander 2026-05-30, Edge #11).
--
-- One append-only row per credit event. Keyed by debtor_code so the same
-- customer's credits roll up across all their SIs / refunds. Positive
-- amount_centi adds to the balance (customer overpaid, or a paid SI was
-- cancelled and the payment turned into credit); negative amount_centi
-- applies the credit toward a future invoice. Sum of amount_centi per
-- debtor_code = current credit balance.
--
-- This also implicitly handles Edge #9 (partial-paid SI cancel): when an SI
-- with paid_centi > 0 is cancelled, the reverseSiRevenue path writes a
-- positive credit row for paid_centi — the cash is still booked, but the
-- customer carries the balance as a credit instead of being owed a refund.
--
-- Snapshot debtor_name so historical entries don't lose context if the
-- customer master is renamed.
-- ----------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS customer_credits (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debtor_code        text NOT NULL,
  debtor_name        text,                                -- snapshot
  entry_date         date NOT NULL DEFAULT CURRENT_DATE,
  amount_centi       integer NOT NULL,                    -- signed: + adds, − applies
  source_type        text NOT NULL,                       -- 'SI_CANCEL_REFUND' | 'OVERPAY' | 'APPLIED_TO_SI' | 'MANUAL_ADJUST'
  source_doc_no      text,                                -- e.g. SI-2605-004 (the SI that triggered this entry)
  source_doc_id      uuid,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES staff(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cust_credits_debtor   ON customer_credits(debtor_code);
CREATE INDEX IF NOT EXISTS idx_cust_credits_src      ON customer_credits(source_type, source_doc_no);
CREATE INDEX IF NOT EXISTS idx_cust_credits_created  ON customer_credits(created_at DESC);

ALTER TABLE customer_credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cust_credits_select ON customer_credits;
DROP POLICY IF EXISTS cust_credits_insert ON customer_credits;
CREATE POLICY cust_credits_select ON customer_credits FOR SELECT TO authenticated USING (true);
CREATE POLICY cust_credits_insert ON customer_credits FOR INSERT TO authenticated WITH CHECK (true);

-- ── View: current credit balance per debtor ────────────────────────────────
CREATE OR REPLACE VIEW v_customer_credit_balances AS
SELECT
  debtor_code,
  MAX(debtor_name)         AS debtor_name,
  SUM(amount_centi)        AS balance_centi,
  COUNT(*)                 AS entry_count,
  MAX(created_at)          AS last_entry_at
FROM customer_credits
GROUP BY debtor_code;

COMMIT;
