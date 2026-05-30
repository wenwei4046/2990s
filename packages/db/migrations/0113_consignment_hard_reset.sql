-- ----------------------------------------------------------------------------
-- 0113 — Consignment Hard Reset.
--
-- Commander 2026-05-30: scrap the "agreement + nested notes" model entirely.
-- The 4 consignment modules (Consignment, Consignment Returns, Purchase
-- Consignment, Purchase Consignment Returns) get rebuilt as carbon copies of
-- DO / DR / PI / PI respectively — same flat single-doc shape as their
-- templates. No more qty_placed caps, no more parent-orders-with-notes.
--
-- Sales side:
--   consignments              ← mirrors delivery_orders   (outbound to debtor)
--   consignment_items         ← mirrors delivery_order_items
--   consignment_returns       ← mirrors delivery_returns  (debtor returns to us)
--   consignment_return_items  ← mirrors delivery_return_items
--
-- Purchase side (both clone PI shape + add warehouse_id for inventory write):
--   purchase_consignments              ← mirrors purchase_invoices  (supplier
--                                        delivers consignment stock to us)
--   purchase_consignment_items         ← mirrors purchase_invoice_items
--   purchase_consignment_returns       ← mirrors purchase_invoices  (we ship
--                                        consignment stock back to supplier)
--   purchase_consignment_return_items  ← mirrors purchase_invoice_items
--
-- DESTRUCTIVE: drops 8 old tables + 4 old enums. Any data in them is gone.
-- Commander confirmed today's PC-2605-001 + PCN-2605-001 test data may go.
--
-- Wrapped in BEGIN/COMMIT. House style of 0110/0111. Run via Supabase SQL
-- Editor.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── PHASE 1: Drop the legacy consignment + PC tables + enums ───────────────
DROP TABLE IF EXISTS consignment_note_items CASCADE;
DROP TABLE IF EXISTS consignment_notes CASCADE;
DROP TABLE IF EXISTS consignment_order_items CASCADE;
DROP TABLE IF EXISTS consignment_orders CASCADE;
DROP TABLE IF EXISTS purchase_consignment_note_items CASCADE;
DROP TABLE IF EXISTS purchase_consignment_notes CASCADE;
DROP TABLE IF EXISTS purchase_consignment_order_items CASCADE;
DROP TABLE IF EXISTS purchase_consignment_orders CASCADE;
DROP TYPE  IF EXISTS consignment_status;
DROP TYPE  IF EXISTS consignment_note_type;
DROP TYPE  IF EXISTS purchase_consignment_status;
DROP TYPE  IF EXISTS purchase_consignment_note_type;

-- ── PHASE 2: Sales side enums ───────────────────────────────────────────────
CREATE TYPE consignment_status AS ENUM (
  'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'SIGNED',
  'DELIVERED', 'INVOICED', 'CANCELLED'
);

CREATE TYPE consignment_return_status AS ENUM (
  'PENDING', 'RECEIVED', 'INSPECTED', 'REFUNDED', 'CANCELLED'
);

-- ── PHASE 3: Sales side tables ──────────────────────────────────────────────

-- Consignments (clone of delivery_orders shape)
CREATE TABLE consignments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_number  TEXT NOT NULL UNIQUE,                           -- 'CN-2605-001'
  debtor_code         TEXT,
  debtor_name         TEXT NOT NULL,
  consignment_date    DATE NOT NULL DEFAULT current_date,
  expected_delivery_at DATE,
  signed_at           TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  dispatched_at       TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  driver_id           UUID REFERENCES drivers(id) ON DELETE SET NULL,
  driver_name         TEXT,
  vehicle             TEXT,
  m3_total_milli      INTEGER NOT NULL DEFAULT 0,
  warehouse_id        UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  -- Address snapshot
  address1            TEXT,
  address2            TEXT,
  city                TEXT,
  state               TEXT,
  postcode            TEXT,
  phone               TEXT,
  pod_r2_key          TEXT,
  signature_data      TEXT,
  status              consignment_status NOT NULL DEFAULT 'LOADED',
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cn_status ON consignments(status);
CREATE INDEX idx_cn_date   ON consignments(consignment_date);
CREATE INDEX idx_cn_debtor ON consignments(debtor_code);

CREATE TABLE consignment_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_id         UUID NOT NULL REFERENCES consignments(id) ON DELETE CASCADE,
  item_code              TEXT NOT NULL,
  description            TEXT,
  qty                    INTEGER NOT NULL,
  m3_milli               INTEGER NOT NULL DEFAULT 0,
  unit_price_centi       INTEGER NOT NULL DEFAULT 0,
  notes                  TEXT,
  gap_inches             INTEGER,
  divan_height_inches    INTEGER,
  divan_price_sen        INTEGER NOT NULL DEFAULT 0,
  leg_height_inches      INTEGER,
  leg_price_sen          INTEGER NOT NULL DEFAULT 0,
  custom_specials        JSONB,
  line_suffix            TEXT,
  special_order_price_sen INTEGER NOT NULL DEFAULT 0,
  variants               JSONB,
  item_group             TEXT,
  description2           TEXT,
  uom                    TEXT NOT NULL DEFAULT 'UNIT',
  discount_centi         INTEGER NOT NULL DEFAULT 0,
  line_total_centi       INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cn_items_cn ON consignment_items(consignment_id);

CREATE TABLE consignment_returns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number       TEXT NOT NULL UNIQUE,                           -- 'CNR-2605-001'
  consignment_id      UUID REFERENCES consignments(id) ON DELETE SET NULL,
  debtor_code         TEXT,
  debtor_name         TEXT NOT NULL,
  return_date         DATE NOT NULL DEFAULT current_date,
  reason              TEXT,
  warehouse_id        UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  status              consignment_return_status NOT NULL DEFAULT 'PENDING',
  received_at         TIMESTAMPTZ,
  inspected_at        TIMESTAMPTZ,
  refunded_at         TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  refund_centi        INTEGER NOT NULL DEFAULT 0,
  inspection_notes    TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cnr_cn     ON consignment_returns(consignment_id);
CREATE INDEX idx_cnr_status ON consignment_returns(status);
CREATE INDEX idx_cnr_debtor ON consignment_returns(debtor_code);

CREATE TABLE consignment_return_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_return_id UUID NOT NULL REFERENCES consignment_returns(id) ON DELETE CASCADE,
  consignment_item_id  UUID REFERENCES consignment_items(id) ON DELETE SET NULL,
  item_code            TEXT NOT NULL,
  description          TEXT,
  qty_returned         INTEGER NOT NULL,
  condition            TEXT,
  unit_price_centi     INTEGER NOT NULL DEFAULT 0,
  refund_centi         INTEGER NOT NULL DEFAULT 0,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cnr_items_cnr ON consignment_return_items(consignment_return_id);

-- ── PHASE 4: Purchase side enums ────────────────────────────────────────────
CREATE TYPE purchase_consignment_status AS ENUM (
  'DRAFT', 'POSTED', 'CANCELLED'
);

CREATE TYPE purchase_consignment_return_status AS ENUM (
  'DRAFT', 'POSTED', 'CANCELLED'
);

-- ── PHASE 5: Purchase side tables (clone PI shape + warehouse_id) ───────────

CREATE TABLE purchase_consignments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pc_number           TEXT NOT NULL UNIQUE,                           -- 'PC-2605-001'
  supplier_invoice_ref TEXT,                                          -- supplier's reference
  supplier_id         UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  warehouse_id        UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  consignment_date    DATE NOT NULL DEFAULT current_date,
  due_date            DATE,
  currency            currency_code NOT NULL DEFAULT 'MYR',
  subtotal_centi      INTEGER NOT NULL DEFAULT 0,
  tax_centi           INTEGER NOT NULL DEFAULT 0,
  total_centi         INTEGER NOT NULL DEFAULT 0,
  status              purchase_consignment_status NOT NULL DEFAULT 'DRAFT',
  notes               TEXT,
  posted_at           TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pc_supplier ON purchase_consignments(supplier_id);
CREATE INDEX idx_pc_status   ON purchase_consignments(status);

CREATE TABLE purchase_consignment_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_consignment_id UUID NOT NULL REFERENCES purchase_consignments(id) ON DELETE CASCADE,
  material_kind          material_kind NOT NULL DEFAULT 'mfg_product',
  material_code          TEXT NOT NULL,
  material_name          TEXT NOT NULL,
  qty                    INTEGER NOT NULL,
  unit_price_centi       INTEGER NOT NULL,
  line_total_centi       INTEGER NOT NULL,
  notes                  TEXT,
  gap_inches             INTEGER,
  divan_height_inches    INTEGER,
  divan_price_sen        INTEGER NOT NULL DEFAULT 0,
  leg_height_inches      INTEGER,
  leg_price_sen          INTEGER NOT NULL DEFAULT 0,
  custom_specials        JSONB,
  line_suffix            TEXT,
  special_order_price_sen INTEGER NOT NULL DEFAULT 0,
  variants               JSONB,
  item_group             TEXT,
  description            TEXT,
  description2           TEXT,
  uom                    TEXT NOT NULL DEFAULT 'UNIT',
  discount_centi         INTEGER NOT NULL DEFAULT 0,
  unit_cost_centi        INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pc_items_pc ON purchase_consignment_items(purchase_consignment_id);

CREATE TABLE purchase_consignment_returns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pcr_number          TEXT NOT NULL UNIQUE,                           -- 'PCR-2605-001'
  supplier_id         UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  purchase_consignment_id UUID REFERENCES purchase_consignments(id) ON DELETE SET NULL,
  warehouse_id        UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  return_date         DATE NOT NULL DEFAULT current_date,
  reason              TEXT,
  status              purchase_consignment_return_status NOT NULL DEFAULT 'DRAFT',
  posted_at           TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  credit_note_ref     TEXT,
  subtotal_centi      INTEGER NOT NULL DEFAULT 0,
  tax_centi           INTEGER NOT NULL DEFAULT 0,
  total_centi         INTEGER NOT NULL DEFAULT 0,
  refund_centi        INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pcr_supplier ON purchase_consignment_returns(supplier_id);
CREATE INDEX idx_pcr_pc       ON purchase_consignment_returns(purchase_consignment_id);
CREATE INDEX idx_pcr_status   ON purchase_consignment_returns(status);

CREATE TABLE purchase_consignment_return_items (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_consignment_return_id UUID NOT NULL REFERENCES purchase_consignment_returns(id) ON DELETE CASCADE,
  purchase_consignment_item_id UUID REFERENCES purchase_consignment_items(id) ON DELETE SET NULL,
  material_kind          material_kind NOT NULL DEFAULT 'mfg_product',
  material_code          TEXT NOT NULL,
  material_name          TEXT NOT NULL,
  qty_returned           INTEGER NOT NULL,
  unit_price_centi       INTEGER NOT NULL DEFAULT 0,
  line_refund_centi      INTEGER NOT NULL DEFAULT 0,
  reason                 TEXT,
  notes                  TEXT,
  gap_inches             INTEGER,
  divan_height_inches    INTEGER,
  divan_price_sen        INTEGER NOT NULL DEFAULT 0,
  leg_height_inches      INTEGER,
  leg_price_sen          INTEGER NOT NULL DEFAULT 0,
  custom_specials        JSONB,
  line_suffix            TEXT,
  special_order_price_sen INTEGER NOT NULL DEFAULT 0,
  variants               JSONB,
  item_group             TEXT,
  description            TEXT,
  description2           TEXT,
  uom                    TEXT NOT NULL DEFAULT 'UNIT',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pcr_items_pcr ON purchase_consignment_return_items(purchase_consignment_return_id);

-- ── PHASE 6: RLS — enable + open to authenticated (mirrors PI/DO pattern) ────
ALTER TABLE consignments                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_items                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_returns               ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_return_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_consignments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_consignment_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_consignment_returns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_consignment_return_items ENABLE ROW LEVEL SECURITY;

-- Full CRUD policies for authenticated (matches what PCN+PCN-items have from
-- migration 0111, and what we just added to purchase_orders in 0112).
DO $$
DECLARE
  tbl text;
  short text;
BEGIN
  FOR tbl, short IN
    SELECT * FROM (VALUES
      ('consignments',                      'cn'),
      ('consignment_items',                 'cni'),
      ('consignment_returns',               'cnr'),
      ('consignment_return_items',          'cnri'),
      ('purchase_consignments',             'pc'),
      ('purchase_consignment_items',        'pci'),
      ('purchase_consignment_returns',      'pcr'),
      ('purchase_consignment_return_items', 'pcri')
    ) AS t(tbl, short)
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (true)',           short || '_select', tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (true)',     short || '_insert', tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', short || '_update', tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (true)',           short || '_delete', tbl);
  END LOOP;
END$$;

COMMIT;
