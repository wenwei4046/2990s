-- ----------------------------------------------------------------------------
-- 0055 — Supplier full master record (PR #40)
--
-- Commander 2026-05-26 spec (HOUZS Century AutoCount parity):
--   1. Credit Account     → already covered by suppliers.code
--   2. Company Name       → already covered by suppliers.name
--   3. Address + contact  → existing address/phone/email + ADD postcode/area/mobile/fax/website/attention
--   4. Supplier type      → NEW (e.g. 'Matrix', 'Distributor', 'Maker')
--   5. Category           → NEW (free text — 'Bedframe', 'Fabric', 'Hardware'...)
--   6. TIN Number         → NEW
--   7. Business Reg No    → NEW
--   8. Payment Term       → already covered by suppliers.payment_terms
--
-- Plus AutoCount-style ergonomics:
--   - business_nature (free text)
--   - currency (defaults MYR)
--   - statement_type ('OPEN_ITEM'|'BALANCE_FORWARD'|'NO_STATEMENT')
--   - aging_basis ('INVOICE_DATE'|'DUE_DATE')
--   - credit_limit_sen (INT, 0 = unlimited)
--
-- All additive — no breaking changes. Apply via Supabase SQL Editor.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS supplier_type    TEXT,
  ADD COLUMN IF NOT EXISTS category         TEXT,
  ADD COLUMN IF NOT EXISTS tin_number       TEXT,
  ADD COLUMN IF NOT EXISTS business_reg_no  TEXT,
  ADD COLUMN IF NOT EXISTS postcode         TEXT,
  ADD COLUMN IF NOT EXISTS area             TEXT,
  ADD COLUMN IF NOT EXISTS mobile           TEXT,
  ADD COLUMN IF NOT EXISTS fax              TEXT,
  ADD COLUMN IF NOT EXISTS website          TEXT,
  ADD COLUMN IF NOT EXISTS attention        TEXT,
  ADD COLUMN IF NOT EXISTS business_nature  TEXT,
  ADD COLUMN IF NOT EXISTS currency         TEXT NOT NULL DEFAULT 'MYR',
  ADD COLUMN IF NOT EXISTS statement_type   TEXT NOT NULL DEFAULT 'OPEN_ITEM',
  ADD COLUMN IF NOT EXISTS aging_basis      TEXT NOT NULL DEFAULT 'INVOICE_DATE',
  ADD COLUMN IF NOT EXISTS credit_limit_sen INTEGER NOT NULL DEFAULT 0;

-- Indexes that help the supplier picker + Procurement filters
CREATE INDEX IF NOT EXISTS idx_suppliers_supplier_type ON suppliers(supplier_type) WHERE supplier_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_category      ON suppliers(category)      WHERE category IS NOT NULL;

COMMIT;
