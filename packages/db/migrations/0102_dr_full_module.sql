-- ----------------------------------------------------------------------------
-- 0102 — Delivery Return full module (DO-clone rebuild).
--
-- Rebuilds the Delivery Return module as a faithful clone of the Delivery
-- Order module (itself an SO clone): an editable SO-style header + line-item
-- pricing/variant columns + the INVENTORY-INCREASE idempotency guard. A
-- Delivery Return = goods coming BACK, so processing one ADDS stock — the
-- mirror image of the DO's deduction.
--
-- This migration is ADDITIVE and non-destructive — every new column is
-- nullable / defaulted so existing delivery_returns + delivery_return_items
-- rows survive untouched.
--
-- Three parts:
--   1. delivery_returns gets the editable SO/DO-style header columns it lacks
--      (debtor metadata / salesperson / agent / email / address /
--      customer_state + country / sales_location / branding / venue / ref /
--      per-category + total rollups / note).
--   2. delivery_return_items gets the variant + pricing columns the inventory
--      cascade + recompute need (item_group / variants / uom / description2 /
--      unit_cost / line totals / line cost / line margin).
--   3. inventory_movements gets a partial UNIQUE index on
--      (source_doc_type, source_doc_id, product_code, variant_key) scoped to
--      'DR' so a return can only ever INCREASE stock ONCE — the hard backstop
--      behind the API's pre-insert existence check (mirror of the DO's
--      uq_inv_mov_do_source from migration 0100).
-- ----------------------------------------------------------------------------

BEGIN;

-- ── 1. delivery_returns header columns ──────────────────────────────────────
-- Mirror the editable DO header (delivery_orders, migration 0100). delivery_returns
-- already has: return_number, delivery_order_id, sales_invoice_id, debtor_code,
-- debtor_name, return_date, reason, status, received_at, inspected_at,
-- refunded_at, refund_centi, inspection_notes, notes.
-- We ADD the missing SO/DO-header fields below.
ALTER TABLE delivery_returns
  -- Source DO reference snapshot (the DR is created FROM a DO)
  ADD COLUMN IF NOT EXISTS do_doc_no           TEXT,
  -- Sales agent / salesperson (FK to staff, mirrors delivery_orders.salesperson_id)
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
  ADD COLUMN IF NOT EXISTS sales_location      TEXT,
  ADD COLUMN IF NOT EXISTS customer_state      TEXT,
  ADD COLUMN IF NOT EXISTS customer_country    TEXT,
  ADD COLUMN IF NOT EXISTS note                TEXT,
  -- Delivery address (mirrors delivery_orders)
  ADD COLUMN IF NOT EXISTS address1            TEXT,
  ADD COLUMN IF NOT EXISTS address2            TEXT,
  ADD COLUMN IF NOT EXISTS city                TEXT,
  ADD COLUMN IF NOT EXISTS state               TEXT,
  ADD COLUMN IF NOT EXISTS postcode            TEXT,
  ADD COLUMN IF NOT EXISTS phone               TEXT,
  -- Emergency contact (mirrors delivery_orders)
  ADD COLUMN IF NOT EXISTS emergency_contact_name         TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone        TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship TEXT,
  -- Warehouse the stock returns INTO (defaults to the DO's / default warehouse)
  ADD COLUMN IF NOT EXISTS warehouse_id        UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  -- Currency
  ADD COLUMN IF NOT EXISTS currency            currency_code NOT NULL DEFAULT 'MYR',
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
  ADD COLUMN IF NOT EXISTS line_count                INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_dr_salesperson ON delivery_returns(salesperson_id);

-- ── 2. delivery_return_items pricing + variant columns ──────────────────────
-- delivery_return_items already has: do_item_id, item_code, description,
-- qty_returned, condition, unit_price_centi, refund_centi, notes.
-- Add the variant + cost/margin columns the inventory cascade + recompute need
-- (mirror of delivery_order_items per migration 0058 + 0100).
ALTER TABLE delivery_return_items
  ADD COLUMN IF NOT EXISTS item_group        TEXT,
  ADD COLUMN IF NOT EXISTS description2      TEXT,
  ADD COLUMN IF NOT EXISTS uom               TEXT NOT NULL DEFAULT 'UNIT',
  ADD COLUMN IF NOT EXISTS variants          JSONB,
  ADD COLUMN IF NOT EXISTS discount_centi    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_total_centi  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost_centi   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_cost_centi   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_margin_centi INTEGER NOT NULL DEFAULT 0;

-- ── 3. Idempotent inventory INCREASE guard ──────────────────────────────────
-- A Delivery Return must INCREASE stock exactly ONCE, no matter how many times
-- the create / process path runs (a retried POST, a backfill, a re-fire). The
-- API does a pre-insert existence check keyed on the DR id, but this partial
-- UNIQUE index is the hard backstop against a race (two concurrent creates)
-- double-writing IN rows. Scoped to DR movements only so it never interferes
-- with GRN / DO / transfer / adjustment movements (those legitimately repeat
-- per product across docs).
--
-- variant_key is part of the key so a DR returning the same product_code in two
-- attribute buckets still records both. This is the mirror image of the DO's
-- uq_inv_mov_do_source (migration 0100).
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_mov_dr_source
  ON inventory_movements (source_doc_type, source_doc_id, product_code, variant_key)
  WHERE source_doc_type = 'DR';

COMMIT;
