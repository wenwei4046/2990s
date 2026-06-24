-- ----------------------------------------------------------------------------
-- 0189 — Payment Vouchers (PV): a standalone, "very plain" cash-out voucher.
--
-- The owner needs to pay a vendor that is NOT a goods invoice — e.g. a freight
-- forwarder, a one-off service. A PV is a simple document: a payee, a credit
-- account (the bank / cash / AP the money is paid FROM), a few expense lines
-- (description + debit account + amount), and a total that posts to the GL.
--
-- This is STANDALONE for v1. A later step may LINK a PV charge into a PO's
-- landed-goods cost (allocation) — that is NOT built here.
--
-- GL post (source_type 'PV', mirrors postPiAccounting + the 0188 FX shape):
--   Dr each line.debit_account_code  round(amount_centi  * exchange_rate)  (MYR)
--   Cr header.credit_account_code     round(total_centi   * exchange_rate)  (MYR)
-- balanced because Σ round(line) is reconciled against round(total) at post time.
--
-- currency / exchange_rate mirror purchase_invoices (0188): the voucher keeps
-- showing its OWN currency + *_centi totals; exchange_rate (MYR per 1 unit, 1
-- for MYR) converts the journal entry to MYR at GL-post time only.
--
-- RLS mirrors purchase_returns (0048) / purchase_invoices: authenticated staff
-- read + write (the API runs as the user-scoped Supabase client, so RLS fires).
--
-- Additive + idempotent — safe to re-run.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── enum ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE payment_voucher_status AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── payment_vouchers (header) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_vouchers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pv_number            TEXT NOT NULL UNIQUE,                 -- 'PV-2606-001' (ours)
  voucher_date         DATE NOT NULL DEFAULT current_date,
  payee_name           TEXT NOT NULL,                        -- who we're paying (free text)
  supplier_id          UUID REFERENCES suppliers(id) ON DELETE SET NULL,  -- optional link
  credit_account_code  TEXT NOT NULL REFERENCES accounts(account_code) ON DELETE RESTRICT,  -- paid FROM (bank/cash/AP)
  currency             currency_code NOT NULL DEFAULT 'MYR',
  -- MYR per 1 unit of `currency` (1 for MYR). Converts the GL post to MYR at
  -- post time only — subtotal/total stay in the voucher's own currency (0188).
  exchange_rate        NUMERIC(14,6) NOT NULL DEFAULT 1,
  notes                TEXT,
  total_centi          INTEGER NOT NULL DEFAULT 0,           -- Σ lines.amount_centi (voucher currency)
  status               payment_voucher_status NOT NULL DEFAULT 'DRAFT',
  posted_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID REFERENCES staff(id) ON DELETE SET NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pv_date     ON payment_vouchers(voucher_date);
CREATE INDEX IF NOT EXISTS idx_pv_supplier ON payment_vouchers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_pv_status   ON payment_vouchers(status);

COMMENT ON COLUMN payment_vouchers.credit_account_code IS
  'The bank/cash/AP account the money is paid FROM (GL credit leg).';
COMMENT ON COLUMN payment_vouchers.exchange_rate IS
  'MYR per 1 unit of the PV currency (1 for MYR); converts the GL post to MYR at post time.';

-- ── payment_voucher_lines ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_voucher_lines (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pv_id                UUID NOT NULL REFERENCES payment_vouchers(id) ON DELETE CASCADE,
  line_no              INTEGER NOT NULL,
  description          TEXT,
  debit_account_code   TEXT NOT NULL REFERENCES accounts(account_code) ON DELETE RESTRICT,  -- expense/charge account (GL debit leg)
  amount_centi         INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pv_lines_pv ON payment_voucher_lines(pv_id);

-- ── RLS — authenticated staff read + write (matches purchase_returns 0048) ──
ALTER TABLE payment_vouchers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_voucher_lines ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY pv_staff_read   ON payment_vouchers      FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pv_staff_write  ON payment_vouchers      FOR ALL    TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pvl_staff_read  ON payment_voucher_lines FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pvl_staff_write ON payment_voucher_lines FOR ALL    TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
