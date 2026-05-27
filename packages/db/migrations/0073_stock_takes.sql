-- ----------------------------------------------------------------------------
-- 0073 — Stock Takes (PR — Inv PR5).
--
-- Commander 2026-05-27: AutoCount-style cycle count. Pick warehouse + scope
-- (all SKUs / category / code prefix), snapshot system_qty for every SKU in
-- scope, type in counted_qty, then Post → write ADJUSTMENT movements for
-- every line with a non-zero variance.
--
-- Numbering: STK-YYMM-NNN (month-scoped count + 1), same pattern as ST/PO/GRN.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── Extend source_doc_type catalog ────────────────────────────────────
-- Same idempotent enum extension as migration 0072 (STOCK_TRANSFER).
-- The TS literal union in apps/api/src/lib/inventory-movements.ts also
-- gets STOCK_TAKE added in this PR.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'inventory_source_doc_type'
  ) THEN
    ALTER TYPE inventory_source_doc_type ADD VALUE IF NOT EXISTS 'STOCK_TAKE';
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ── Header ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_takes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  take_no         text NOT NULL UNIQUE,                       -- STK-YYMM-NNN
  status          text NOT NULL DEFAULT 'DRAFT',              -- DRAFT | POSTED | CANCELLED
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  scope_type      text NOT NULL DEFAULT 'ALL',                -- ALL | CATEGORY | CODE_PREFIX
  scope_value     text,                                       -- category name (e.g. 'BEDFRAME') OR prefix string
  take_date       date NOT NULL DEFAULT current_date,
  notes           text,
  posted_at       timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES staff(id) ON DELETE SET NULL,
  CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
  CHECK (scope_type IN ('ALL', 'CATEGORY', 'CODE_PREFIX'))
);

-- ── Lines ─────────────────────────────────────────────────────────────
-- system_qty is captured at create time (snapshot semantics — the count
-- sheet should reflect what the system thought it had at the moment the
-- sheet was printed). counted_qty stays NULL until commander enters it;
-- on Post, NULL counted_qty is treated as "untouched" → no movement.
CREATE TABLE IF NOT EXISTS stock_take_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_take_id   uuid NOT NULL REFERENCES stock_takes(id) ON DELETE CASCADE,
  product_code    text NOT NULL,
  product_name    text,
  system_qty      integer NOT NULL DEFAULT 0,                  -- snapshot
  counted_qty     integer,                                     -- nullable until count entered
  variance        integer GENERATED ALWAYS AS (COALESCE(counted_qty, 0) - system_qty) STORED,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stock_take_id, product_code)
);

CREATE INDEX IF NOT EXISTS idx_stock_takes_status
  ON stock_takes (status, take_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_takes_warehouse
  ON stock_takes (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_take_lines_take
  ON stock_take_lines (stock_take_id);

COMMIT;
