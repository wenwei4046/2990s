-- ----------------------------------------------------------------------------
-- 0103 — Sales Invoice full module (DO/SO-clone rebuild).
--
-- Rebuilds the Sales Invoice module as a faithful clone of the Delivery Order
-- module (which is itself a Sales Order clone): an editable SO-style header +
-- a payments ledger. This migration is ADDITIVE and non-destructive — every
-- new column is nullable / defaulted so existing sales_invoices rows survive
-- untouched.
--
-- Two parts:
--   1. sales_invoices gets the editable SO-style header columns it lacks
--      (salesperson / agent / email / customer_type / building_type /
--      branding / venue / ref / customer_so_no / sales_location /
--      customer_state + customer_country / address fields / emergency contact /
--      per-category revenue + cost rollups + totals/margin/line_count).
--   2. sales_invoice_payments — mirror of mfg_sales_order_payments /
--      delivery_order_payments so the SI Create + Detail screens render the
--      same Houzs PaymentsTable ledger.
--
-- sales_invoices already has (from 0042): invoice_number, so_doc_no,
-- delivery_order_id, debtor_code, debtor_name, invoice_date, due_date,
-- currency, subtotal_centi, discount_centi, tax_centi, total_centi,
-- paid_centi, status, notes, sent_at, paid_at.
-- sales_invoice_items already carry variant + pricing columns (0058):
-- item_group, description2, uom, variants, discount_centi, line_total_centi,
-- unit_price_centi, gap/divan/leg/special, …
-- ----------------------------------------------------------------------------

BEGIN;

-- ── 1. sales_invoices header columns ────────────────────────────────────────
-- Mirror the fields an editable SO/DO header carries so the SI Detail / Create
-- screens are a true clone.
ALTER TABLE sales_invoices
  -- Sales agent / salesperson (FK to staff, mirrors mfg_sales_orders.salesperson_id)
  ADD COLUMN IF NOT EXISTS salesperson_id      UUID REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent               TEXT,
  -- Customer / order metadata
  ADD COLUMN IF NOT EXISTS email               TEXT,
  ADD COLUMN IF NOT EXISTS customer_type       TEXT,
  ADD COLUMN IF NOT EXISTS building_type       TEXT,
  ADD COLUMN IF NOT EXISTS branding            TEXT,
  ADD COLUMN IF NOT EXISTS venue               TEXT,
  ADD COLUMN IF NOT EXISTS venue_id            UUID REFERENCES venues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ref                 TEXT,
  ADD COLUMN IF NOT EXISTS customer_so_no      TEXT,
  ADD COLUMN IF NOT EXISTS po_doc_no           TEXT,
  ADD COLUMN IF NOT EXISTS sales_location      TEXT,
  ADD COLUMN IF NOT EXISTS customer_state      TEXT,
  ADD COLUMN IF NOT EXISTS customer_country    TEXT,
  ADD COLUMN IF NOT EXISTS customer_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS note                TEXT,
  -- Delivery / billing address (mirrors delivery_orders / mfg_sales_orders)
  ADD COLUMN IF NOT EXISTS address1            TEXT,
  ADD COLUMN IF NOT EXISTS address2            TEXT,
  ADD COLUMN IF NOT EXISTS city                TEXT,
  ADD COLUMN IF NOT EXISTS state               TEXT,
  ADD COLUMN IF NOT EXISTS postcode            TEXT,
  ADD COLUMN IF NOT EXISTS phone               TEXT,
  -- Emergency contact (mirrors mfg_sales_orders)
  ADD COLUMN IF NOT EXISTS emergency_contact_name         TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone        TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship TEXT,
  -- Per-category revenue + cost rollups (mirror the DO recomputeTotals output)
  ADD COLUMN IF NOT EXISTS mattress_sofa_centi       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bedframe_centi            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accessories_centi         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS others_centi              INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mattress_sofa_cost_centi  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bedframe_cost_centi       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accessories_cost_centi    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS others_cost_centi         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS local_total_centi         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost_centi          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_margin_centi        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS margin_pct_basis          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_count                INTEGER NOT NULL DEFAULT 0,
  -- Audit trail (mirrors the SO/DO header; created_by already exists)
  ADD COLUMN IF NOT EXISTS confirmed_at        TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_si_salesperson ON sales_invoices(salesperson_id);

-- sales_invoice_items already carry variant + pricing columns from 0058.
-- Add the per-line cost/margin columns so the SI recompute can roll a cost
-- total like the DO/SO does (mirrors delivery_order_items in 0100).
ALTER TABLE sales_invoice_items
  ADD COLUMN IF NOT EXISTS do_item_id        UUID REFERENCES delivery_order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_cost_centi   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_cost_centi   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_margin_centi INTEGER NOT NULL DEFAULT 0;

-- ── 2. sales_invoice_payments (mirror of mfg_sales_order_payments) ──────────
CREATE TABLE IF NOT EXISTS sales_invoice_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_invoice_id    uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  paid_at             date NOT NULL DEFAULT CURRENT_DATE,
  method              text NOT NULL,                -- 'merchant' | 'transfer' | 'cash'
  merchant_provider   text,                          -- bank (only when method='merchant')
  installment_months  integer,                       -- N months — null = no installment
  online_type         text,                          -- Online sub-type (only when method='transfer')
  approval_code       text,
  amount_centi        integer NOT NULL CHECK (amount_centi >= 0),
  account_sheet       text,
  collected_by        uuid REFERENCES staff(id) ON DELETE SET NULL,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES staff(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sip_si      ON sales_invoice_payments(sales_invoice_id);
CREATE INDEX IF NOT EXISTS idx_sip_paid_at ON sales_invoice_payments(paid_at);

ALTER TABLE sales_invoice_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sip_select ON sales_invoice_payments;
DROP POLICY IF EXISTS sip_insert ON sales_invoice_payments;
DROP POLICY IF EXISTS sip_update ON sales_invoice_payments;
DROP POLICY IF EXISTS sip_delete ON sales_invoice_payments;

CREATE POLICY sip_select ON sales_invoice_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY sip_insert ON sales_invoice_payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY sip_update ON sales_invoice_payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY sip_delete ON sales_invoice_payments FOR DELETE TO authenticated USING (true);

COMMIT;
