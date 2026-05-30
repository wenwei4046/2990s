-- ----------------------------------------------------------------------------
-- 0072 — Stock Transfers (PR — Inv PR4).
--
-- Commander 2026-05-27: move stock between warehouses with a proper document
-- trail (header + lines + post action). Posting writes paired OUT (from) + IN
-- (to) rows into inventory_movements; FIFO trigger consumes from source +
-- creates a new lot at destination so cost basis flows correctly.
--
-- Numbering: ST-YYMM-NNN (month-scoped count + 1), same pattern as PO/GRN/PI.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── Extend source_doc_type catalog ────────────────────────────────────
-- The inventory_movements.source_doc_type column is TEXT (not an enum) at
-- the table level — see migration 0050 — but apps/api/src/lib/inventory-
-- movements.ts narrows it to a literal union. The DB itself doesn't need an
-- enum ALTER here; we just document the new value. If a separate enum type
-- (inventory_source_doc_type) exists in this DB instance, the DO block below
-- extends it idempotently.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'inventory_source_doc_type'
  ) THEN
    ALTER TYPE inventory_source_doc_type ADD VALUE IF NOT EXISTS 'STOCK_TRANSFER';
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ── Header ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_transfers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_no        text NOT NULL UNIQUE,                       -- ST-YYMM-NNN
  status             text NOT NULL DEFAULT 'DRAFT',              -- DRAFT | POSTED | CANCELLED
  from_warehouse_id  uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  to_warehouse_id    uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  transfer_date      date NOT NULL DEFAULT current_date,
  notes              text,
  posted_at          timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES staff(id) ON DELETE SET NULL,
  CHECK (from_warehouse_id <> to_warehouse_id),
  CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED'))
);

-- ── Lines ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_transfer_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_transfer_id  uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_code       text NOT NULL,
  product_name       text,
  qty                integer NOT NULL CHECK (qty > 0),
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_status
  ON stock_transfers (status, transfer_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from_wh
  ON stock_transfers (from_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to_wh
  ON stock_transfers (to_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_lines_xfer
  ON stock_transfer_lines (stock_transfer_id);

COMMIT;
