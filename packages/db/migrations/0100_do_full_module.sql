-- ----------------------------------------------------------------------------
-- 0100 — Delivery Order full module (SO-clone rebuild).
--
-- Rebuilds the Delivery Order module as a faithful clone of the Sales Order
-- module: an editable SO-style header + a payments ledger + robust idempotent
-- inventory deduction. This migration is ADDITIVE and non-destructive — every
-- new column is nullable / defaulted so existing delivery_orders rows survive
-- untouched.
--
-- Three parts:
--   1. delivery_orders gets the header columns an editable SO-style screen
--      needs (salesperson / payment / sales_location / customer_type /
--      building_type / email / emergency contact / branding / venue / ref /
--      customer_state + customer_country / per-category totals + costs).
--   2. delivery_order_payments — mirror of mfg_sales_order_payments so the DO
--      Create + Detail screens render the same Houzs PaymentsTable ledger.
--   3. inventory_movements gets a partial UNIQUE index on
--      (source_doc_type, source_doc_id, product_code, variant_key) so a DO can
--      only ever deduct stock ONCE no matter how its status is advanced
--      (DISPATCHED → IN_TRANSIT → … or a jump straight to SIGNED/DELIVERED).
-- ----------------------------------------------------------------------------

BEGIN;

-- ── 1. delivery_orders header columns ──────────────────────────────────────
-- Mirror the fields an editable SO header carries (mfg_sales_orders) so the
-- DO Detail / Create screens are a true clone. delivery_orders already has:
--   so_doc_no, debtor_code, debtor_name, do_date, expected_delivery_at,
--   driver_*, vehicle, address1, address2, city, state, postcode, phone,
--   status, notes, warehouse_id.
-- We ADD the missing SO-header fields below.
ALTER TABLE delivery_orders
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
  -- Emergency contact (mirrors mfg_sales_orders)
  ADD COLUMN IF NOT EXISTS emergency_contact_name         TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone        TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship TEXT,
  -- Currency
  ADD COLUMN IF NOT EXISTS currency            currency_code NOT NULL DEFAULT 'MYR',
  -- Per-category revenue + cost rollups (mirror the SO recomputeTotals output)
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
  ADD COLUMN IF NOT EXISTS line_count                INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_do_salesperson ON delivery_orders(salesperson_id);
CREATE INDEX IF NOT EXISTS idx_do_debtor      ON delivery_orders(debtor_code);

-- delivery_order_items already carry variant + pricing columns from 0058
-- (item_group, description2, uom, variants, discount_centi, line_total_centi,
--  unit_price_centi, …). Add the per-line cost/margin columns so the DO
-- recompute can roll a cost total like the SO does.
ALTER TABLE delivery_order_items
  ADD COLUMN IF NOT EXISTS unit_cost_centi   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_cost_centi   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_margin_centi INTEGER NOT NULL DEFAULT 0,
  -- Per-line delivery date parity with SO (optional — kept for clone fidelity).
  ADD COLUMN IF NOT EXISTS line_delivery_date            DATE,
  ADD COLUMN IF NOT EXISTS line_delivery_date_overridden BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. delivery_order_payments (mirror of mfg_sales_order_payments) ─────────
CREATE TABLE IF NOT EXISTS delivery_order_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_order_id   uuid NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_dop_do      ON delivery_order_payments(delivery_order_id);
CREATE INDEX IF NOT EXISTS idx_dop_paid_at ON delivery_order_payments(paid_at);

ALTER TABLE delivery_order_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dop_select ON delivery_order_payments;
DROP POLICY IF EXISTS dop_insert ON delivery_order_payments;
DROP POLICY IF EXISTS dop_update ON delivery_order_payments;
DROP POLICY IF EXISTS dop_delete ON delivery_order_payments;

CREATE POLICY dop_select ON delivery_order_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY dop_insert ON delivery_order_payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY dop_update ON delivery_order_payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY dop_delete ON delivery_order_payments FOR DELETE TO authenticated USING (true);

-- ── 3. Idempotent inventory deduction guard ─────────────────────────────────
-- A DO must deduct stock exactly ONCE, no matter how many times its status is
-- advanced into / re-toggled through a shipped state. The API does a pre-insert
-- existence check keyed on the DO id, but this partial UNIQUE index is the hard
-- backstop against a race (two concurrent status PATCHes) double-writing OUT
-- rows. Scoped to DO movements only so it never interferes with GRN / transfer
-- / adjustment movements (those legitimately repeat per product across docs).
--
-- NULLs in source_doc_id would be excluded by UNIQUE anyway, but the WHERE
-- clause keeps the index small + DO-scoped. variant_key is part of the key so a
-- DO shipping the same product_code in two attribute buckets still records both.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_mov_do_source
  ON inventory_movements (source_doc_type, source_doc_id, product_code, variant_key)
  WHERE source_doc_type = 'DO';

COMMIT;
