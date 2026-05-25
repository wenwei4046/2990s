-- ----------------------------------------------------------------------------
-- 0052 — Simple Accounting layer
--   Journal Entries (header + lines, double-entry) + Chart of Accounts +
--   GL view + AR / AP aging views.
--
-- Commander 2026-05-25 "OK A": port HOOKKA SO + add a simple Accounting
-- (Journal Entries + GL + AR/AP aging) instead of forking Odoo (AGPL).
-- ERPNext is referenced as the conceptual blueprint (its journal_entry +
-- gl_entry pattern), but we keep it minimal — 5 tables + 3 views.
--
-- Posting model:
--   - SI confirm  → JE: Dr Accounts Receivable, Cr Sales Revenue
--   - SI payment  → JE: Dr Cash/Bank, Cr Accounts Receivable
--   - PI confirm  → JE: Dr Inventory/Expense, Cr Accounts Payable
--   - PI payment  → JE: Dr Accounts Payable, Cr Cash/Bank
--
-- All currency stored as INTEGER `_sen` (×100 from RM) to match the rest of
-- the schema. Lines validate Σdebit_sen = Σcredit_sen via a trigger.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── Chart of Accounts ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code    TEXT NOT NULL UNIQUE,             -- '1000', '4000', etc
  account_name    TEXT NOT NULL,
  account_type    TEXT NOT NULL,                    -- 'ASSET'|'LIABILITY'|'EQUITY'|'INCOME'|'EXPENSE'
  parent_code     TEXT REFERENCES accounts(account_code) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_account_type CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE'))
);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(account_type);

-- ── Seed minimal Malaysian SME chart ───────────────────────────────────
INSERT INTO accounts (account_code, account_name, account_type) VALUES
  ('1000', 'Cash on Hand',           'ASSET'),
  ('1010', 'Bank — Maybank Current', 'ASSET'),
  ('1100', 'Accounts Receivable',    'ASSET'),
  ('1200', 'Inventory',              'ASSET'),
  ('2000', 'Accounts Payable',       'LIABILITY'),
  ('2100', 'SST Payable',            'LIABILITY'),
  ('3000', 'Owner''s Equity',        'EQUITY'),
  ('4000', 'Sales Revenue',          'INCOME'),
  ('4100', 'Other Income',           'INCOME'),
  ('5000', 'Cost of Goods Sold',     'EXPENSE'),
  ('5100', 'Operating Expense',      'EXPENSE'),
  ('5200', 'Discount Given',         'EXPENSE')
ON CONFLICT (account_code) DO NOTHING;

-- ── Journal Entry header ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  je_no           TEXT NOT NULL UNIQUE,             -- 'JE-2605-0001'
  entry_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  source_type     TEXT NOT NULL,                    -- 'SI'|'PI'|'SI_PAYMENT'|'PI_PAYMENT'|'MANUAL'
  source_doc_no   TEXT,                             -- 'SI-2605-001' / 'PI-...' / etc
  narration       TEXT,
  total_debit_sen  INTEGER NOT NULL DEFAULT 0,
  total_credit_sen INTEGER NOT NULL DEFAULT 0,
  posted          BOOLEAN NOT NULL DEFAULT FALSE,
  posted_at       TIMESTAMPTZ,
  posted_by       UUID REFERENCES staff(id) ON DELETE SET NULL,
  reversed        BOOLEAN NOT NULL DEFAULT FALSE,
  reversed_by_je  UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES staff(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_je_date          ON journal_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_je_source        ON journal_entries(source_type, source_doc_no);
CREATE INDEX IF NOT EXISTS idx_je_posted        ON journal_entries(posted);

-- ── Journal Entry line (one row per Dr or Cr posting) ──────────────────
CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_no         INTEGER NOT NULL,
  account_code    TEXT NOT NULL REFERENCES accounts(account_code) ON DELETE RESTRICT,
  debit_sen       INTEGER NOT NULL DEFAULT 0,
  credit_sen      INTEGER NOT NULL DEFAULT 0,
  party_type      TEXT,                             -- 'CUSTOMER'|'SUPPLIER'|null
  party_code      TEXT,
  party_name      TEXT,
  notes           TEXT,
  CONSTRAINT chk_je_line_sides CHECK (
    (debit_sen >= 0 AND credit_sen >= 0)
    AND NOT (debit_sen > 0 AND credit_sen > 0)
    AND (debit_sen > 0 OR credit_sen > 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_jel_je      ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_jel_account ON journal_entry_lines(account_code);
CREATE INDEX IF NOT EXISTS idx_jel_party   ON journal_entry_lines(party_type, party_code);

-- ── Trigger: enforce balanced JE on post ───────────────────────────────
CREATE OR REPLACE FUNCTION fn_check_je_balanced()
RETURNS TRIGGER AS $$
DECLARE
  debit_sum INTEGER;
  credit_sum INTEGER;
BEGIN
  IF NEW.posted = TRUE AND (OLD.posted IS DISTINCT FROM TRUE) THEN
    SELECT COALESCE(SUM(debit_sen), 0), COALESCE(SUM(credit_sen), 0)
      INTO debit_sum, credit_sum
      FROM journal_entry_lines WHERE journal_entry_id = NEW.id;

    IF debit_sum <> credit_sum THEN
      RAISE EXCEPTION 'Journal entry % is not balanced: debit=% credit=%',
        NEW.je_no, debit_sum, credit_sum;
    END IF;

    IF debit_sum = 0 THEN
      RAISE EXCEPTION 'Journal entry % has no lines', NEW.je_no;
    END IF;

    NEW.total_debit_sen  := debit_sum;
    NEW.total_credit_sen := credit_sum;
    NEW.posted_at        := COALESCE(NEW.posted_at, now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_je_balanced ON journal_entries;
CREATE TRIGGER trg_je_balanced
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION fn_check_je_balanced();

-- ── GL view: flat list of every posted line w/ account + date ──────────
CREATE OR REPLACE VIEW v_gl_entries AS
SELECT
  l.id              AS line_id,
  j.je_no,
  j.entry_date,
  j.source_type,
  j.source_doc_no,
  l.line_no,
  l.account_code,
  a.account_name,
  a.account_type,
  l.debit_sen,
  l.credit_sen,
  l.party_type,
  l.party_code,
  l.party_name,
  l.notes,
  j.posted,
  j.posted_at
FROM journal_entry_lines l
JOIN journal_entries j ON j.id = l.journal_entry_id
JOIN accounts a ON a.account_code = l.account_code
WHERE j.posted = TRUE AND j.reversed = FALSE
ORDER BY j.entry_date DESC, j.je_no DESC, l.line_no ASC;

-- ── Account balances view (running sum by account) ─────────────────────
CREATE OR REPLACE VIEW v_account_balances AS
SELECT
  a.account_code,
  a.account_name,
  a.account_type,
  COALESCE(SUM(l.debit_sen), 0)  AS total_debit_sen,
  COALESCE(SUM(l.credit_sen), 0) AS total_credit_sen,
  -- Sign convention: Asset/Expense are Dr-normal; Liability/Equity/Income are Cr-normal
  CASE
    WHEN a.account_type IN ('ASSET', 'EXPENSE')
      THEN COALESCE(SUM(l.debit_sen), 0)  - COALESCE(SUM(l.credit_sen), 0)
    ELSE
      COALESCE(SUM(l.credit_sen), 0) - COALESCE(SUM(l.debit_sen), 0)
  END AS balance_sen
FROM accounts a
LEFT JOIN journal_entry_lines l ON l.account_code = a.account_code
LEFT JOIN journal_entries j ON j.id = l.journal_entry_id AND j.posted = TRUE AND j.reversed = FALSE
GROUP BY a.account_code, a.account_name, a.account_type
ORDER BY a.account_code;

-- ── AR Aging view: outstanding sales invoices bucketed by overdue days ─
CREATE OR REPLACE VIEW v_ar_aging AS
SELECT
  s.id              AS invoice_id,
  s.invoice_number,
  s.debtor_code,
  s.debtor_name,
  s.invoice_date,
  s.due_date,
  s.total_centi,
  s.paid_centi,
  (s.total_centi - s.paid_centi) AS outstanding_centi,
  CASE
    WHEN s.due_date IS NULL OR s.due_date >= CURRENT_DATE THEN 0
    ELSE CURRENT_DATE - s.due_date
  END AS days_overdue,
  CASE
    WHEN s.due_date IS NULL OR s.due_date >= CURRENT_DATE THEN 'CURRENT'
    WHEN CURRENT_DATE - s.due_date BETWEEN 1 AND 30  THEN '1-30'
    WHEN CURRENT_DATE - s.due_date BETWEEN 31 AND 60 THEN '31-60'
    WHEN CURRENT_DATE - s.due_date BETWEEN 61 AND 90 THEN '61-90'
    ELSE '90+'
  END AS aging_bucket,
  s.status
FROM sales_invoices s
WHERE s.total_centi > s.paid_centi
  AND s.status NOT IN ('CANCELLED', 'VOID');

-- ── AP Aging view: outstanding purchase invoices bucketed ──────────────
CREATE OR REPLACE VIEW v_ap_aging AS
SELECT
  p.id              AS invoice_id,
  p.invoice_number,
  p.supplier_invoice_ref,
  p.supplier_id,
  sup.code          AS supplier_code,
  sup.name          AS supplier_name,
  p.invoice_date,
  p.due_date,
  p.total_centi,
  p.paid_centi,
  (p.total_centi - p.paid_centi) AS outstanding_centi,
  CASE
    WHEN p.due_date IS NULL OR p.due_date >= CURRENT_DATE THEN 0
    ELSE CURRENT_DATE - p.due_date
  END AS days_overdue,
  CASE
    WHEN p.due_date IS NULL OR p.due_date >= CURRENT_DATE THEN 'CURRENT'
    WHEN CURRENT_DATE - p.due_date BETWEEN 1 AND 30  THEN '1-30'
    WHEN CURRENT_DATE - p.due_date BETWEEN 31 AND 60 THEN '31-60'
    WHEN CURRENT_DATE - p.due_date BETWEEN 61 AND 90 THEN '61-90'
    ELSE '90+'
  END AS aging_bucket,
  p.status
FROM purchase_invoices p
LEFT JOIN suppliers sup ON sup.id = p.supplier_id
WHERE p.total_centi > p.paid_centi
  AND p.status NOT IN ('CANCELLED', 'VOID');

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE accounts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines  ENABLE ROW LEVEL SECURITY;

CREATE POLICY acct_staff_read  ON accounts            FOR SELECT TO authenticated USING (true);
CREATE POLICY acct_staff_write ON accounts            FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY je_staff_read    ON journal_entries     FOR SELECT TO authenticated USING (true);
CREATE POLICY je_staff_write   ON journal_entries     FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY jel_staff_read   ON journal_entry_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY jel_staff_write  ON journal_entry_lines FOR ALL    TO authenticated USING (true) WITH CHECK (true);

COMMIT;
