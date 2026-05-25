-- ----------------------------------------------------------------------------
-- 0050 — Trading-company inventory: warehouses + movement ledger.
--
-- Commander 2026-05-25: keep it SIMPLE — we're a trading company, not a
-- factory. Two warehouses (KL Warehouse + 2990 PJ). Stock comes in via
-- GRN (PO-receipt) or Consignment-return-in. Stock goes out via DO.
-- Balance per (warehouse, product_code) = SUM(movements). No WIP, no
-- per-unit serial tracking, no racks.
--
-- Apply via Supabase SQL Editor.
-- ----------------------------------------------------------------------------

BEGIN;

CREATE TABLE warehouses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,            -- 'KL', 'PJ'
  name        TEXT NOT NULL,                   -- 'KL Warehouse', '2990 PJ'
  location    TEXT,                            -- free-form address blob
  is_active   BOOLEAN NOT NULL DEFAULT true,
  is_default  BOOLEAN NOT NULL DEFAULT false,  -- one warehouse marked as default for GRN/DO pre-select
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_warehouses_active ON warehouses(is_active);

-- Seed the two warehouses the commander asked for. KL is the default.
INSERT INTO warehouses (code, name, location, is_default) VALUES
  ('KL', 'KL Warehouse', NULL, true),
  ('PJ', '2990 PJ',      NULL, false);

-- ── Movement ledger ────────────────────────────────────────────────────
-- Append-only. Balance for any (warehouse, product_code) pair is derived
-- as SUM(qty) where qty is positive for IN and negative for OUT. We store
-- a single signed integer so reporting becomes a one-line SUM().

CREATE TYPE inventory_movement_type AS ENUM (
  'IN',          -- GRN posted, Consignment RETURN posted
  'OUT',         -- DO dispatched, Purchase Return posted, Consignment OUT
  'ADJUSTMENT', -- manual stock count correction
  'TRANSFER'     -- inter-warehouse (records two rows: OUT from + IN to)
);

CREATE TABLE inventory_movements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_type    inventory_movement_type NOT NULL,
  warehouse_id     UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  product_code     TEXT NOT NULL,                       -- mfg_products.code
  product_name     TEXT,                                -- snapshot for readability
  qty              INTEGER NOT NULL,                    -- always positive; sign derived from type at read time
  -- Source document — what caused this movement
  source_doc_type  TEXT,                                -- 'GRN' | 'DO' | 'CONSIGNMENT_NOTE' | 'PURCHASE_RETURN' | 'ADJUSTMENT'
  source_doc_id    UUID,                                -- the foreign id (no FK because polymorphic)
  source_doc_no    TEXT,                                -- e.g. 'GRN-2605-001' for display
  notes            TEXT,
  performed_by     UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inv_mov_warehouse_product ON inventory_movements(warehouse_id, product_code);
CREATE INDEX idx_inv_mov_doc                ON inventory_movements(source_doc_type, source_doc_id);
CREATE INDEX idx_inv_mov_created            ON inventory_movements(created_at DESC);

-- ── Doc tables get a default warehouse FK ──────────────────────────────
-- GRN, DO, and Consignment Notes need to know which warehouse they touch.
-- All default to KL; user can pick on create.

ALTER TABLE grns
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;

ALTER TABLE delivery_orders
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;

ALTER TABLE consignment_notes
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;

-- Back-fill existing rows with the default warehouse so subsequent
-- balance queries don't miss them.
UPDATE grns              SET warehouse_id = (SELECT id FROM warehouses WHERE code = 'KL') WHERE warehouse_id IS NULL;
UPDATE delivery_orders   SET warehouse_id = (SELECT id FROM warehouses WHERE code = 'KL') WHERE warehouse_id IS NULL;
UPDATE consignment_notes SET warehouse_id = (SELECT id FROM warehouses WHERE code = 'KL') WHERE warehouse_id IS NULL;

-- ── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE warehouses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements  ENABLE ROW LEVEL SECURITY;

CREATE POLICY wh_staff_read   ON warehouses          FOR SELECT TO authenticated USING (true);
CREATE POLICY wh_staff_write  ON warehouses          FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY mv_staff_read   ON inventory_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY mv_staff_write  ON inventory_movements FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- ── Convenience VIEW: current balance per (warehouse, product) ─────────
-- One row per (warehouse, product) with the running net qty. The API can
-- query this directly without computing SUM client-side.

CREATE OR REPLACE VIEW inventory_balances AS
  SELECT
    warehouse_id,
    product_code,
    MAX(product_name) AS product_name,
    SUM(
      CASE
        WHEN movement_type = 'IN'         THEN qty
        WHEN movement_type = 'OUT'        THEN -qty
        WHEN movement_type = 'ADJUSTMENT' THEN qty   -- adjustments store signed qty in the same column
        WHEN movement_type = 'TRANSFER'   THEN qty   -- ditto; we store +qty for the IN row, -qty for the OUT row
        ELSE 0
      END
    ) AS qty,
    MAX(created_at) AS last_movement_at
  FROM inventory_movements
  GROUP BY warehouse_id, product_code;

COMMIT;
