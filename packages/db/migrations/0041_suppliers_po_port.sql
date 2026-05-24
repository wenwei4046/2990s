-- ============================================================================
-- 0041_suppliers_po_port.sql
--
-- Port HOOKKA Suppliers + PO module into 2990s.
--
--   * Extend `suppliers` from 5-col stub to full master record
--   * Add `supplier_material_bindings` — THE two-code mapping table
--     (our material_code ↔ supplier_sku, with price, lead time, currency)
--   * Extend `purchase_orders` with status flow, dates, totals, currency
--   * Add `purchase_order_items` — what we're ordering FROM a supplier
--     (the existing `purchase_order_lines` stays for the retail flow)
--
-- 3 new enums: supplier_status, currency_code, po_status, material_kind
-- ============================================================================

BEGIN;

-- ── Enums ────────────────────────────────────────────────────────────────
CREATE TYPE supplier_status AS ENUM ('ACTIVE','INACTIVE','BLOCKED');
CREATE TYPE currency_code   AS ENUM ('MYR','RMB','USD','SGD');
CREATE TYPE po_status       AS ENUM ('DRAFT','SUBMITTED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED');
CREATE TYPE material_kind   AS ENUM ('mfg_product','fabric','raw');

-- ── Extend suppliers ─────────────────────────────────────────────────────
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS contact_person TEXT,
  ADD COLUMN IF NOT EXISTS phone          TEXT,
  ADD COLUMN IF NOT EXISTS address        TEXT,
  ADD COLUMN IF NOT EXISTS state          TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms  TEXT,
  ADD COLUMN IF NOT EXISTS status         supplier_status NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS rating         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes          TEXT;

-- ── supplier_material_bindings ───────────────────────────────────────────
CREATE TABLE supplier_material_bindings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id              UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  material_kind            material_kind NOT NULL,
  material_code            TEXT NOT NULL,                 -- OUR internal code
  material_name            TEXT NOT NULL,                 -- snapshot
  supplier_sku             TEXT NOT NULL,                 -- SUPPLIER's own code
  unit_price_centi         INTEGER NOT NULL DEFAULT 0,    -- × 100; works for MYR + RMB + USD + SGD
  currency                 currency_code NOT NULL DEFAULT 'MYR',
  lead_time_days           INTEGER NOT NULL DEFAULT 0,
  payment_terms_override   TEXT,
  moq                      INTEGER NOT NULL DEFAULT 0,
  price_valid_from         DATE,
  price_valid_to           DATE,
  is_main_supplier         BOOLEAN NOT NULL DEFAULT FALSE,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_smb_supplier ON supplier_material_bindings(supplier_id);
CREATE INDEX idx_smb_material ON supplier_material_bindings(material_kind, material_code);
-- Partial unique-ish index so we can quickly find "the main supplier" per material.
-- Not a true UNIQUE because we enforce one-main-per-material at app layer (so
-- swap is two SQL statements not a constraint-violating dance).
CREATE INDEX idx_smb_main_per_material
  ON supplier_material_bindings(material_kind, material_code)
  WHERE is_main_supplier = TRUE;

-- ── Extend purchase_orders ───────────────────────────────────────────────
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS status          po_status NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS po_date         DATE NOT NULL DEFAULT current_date,
  ADD COLUMN IF NOT EXISTS expected_at     DATE,
  ADD COLUMN IF NOT EXISTS currency        currency_code NOT NULL DEFAULT 'MYR',
  ADD COLUMN IF NOT EXISTS subtotal_centi  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_centi       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_centi     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes           TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status   ON purchase_orders(status);

-- ── purchase_order_items ─────────────────────────────────────────────────
CREATE TABLE purchase_order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id   UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  binding_id          UUID REFERENCES supplier_material_bindings(id) ON DELETE SET NULL,
  material_kind       material_kind NOT NULL,
  material_code       TEXT NOT NULL,
  material_name       TEXT NOT NULL,
  supplier_sku        TEXT,
  qty                 INTEGER NOT NULL,
  unit_price_centi    INTEGER NOT NULL,
  line_total_centi    INTEGER NOT NULL,
  received_qty        INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_po_items_po ON purchase_order_items(purchase_order_id);

COMMIT;
