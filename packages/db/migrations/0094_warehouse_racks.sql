-- ----------------------------------------------------------------------------
-- 0094 — Warehouse rack/bin management (ported from Hookka ERP).
--
-- Adds a physical-location layer on top of the existing warehouses table:
-- every warehouse can be sub-divided into racks, each rack holds zero-to-many
-- stored items, and every stock-in / stock-out / transfer is recorded as a
-- rack movement for an audit trail.
--
-- Three tables:
--   · warehouse_racks       — one row per physical rack/bin. Status is derived
--                             (OCCUPIED when it has items, RESERVED when the
--                             reserved flag is set, otherwise EMPTY) but is
--                             persisted so the rack-grid list query stays a
--                             single SELECT.
--   · warehouse_rack_items  — the items currently sitting on a rack. A rack
--                             can hold any number of items (no per-rack limit,
--                             matching the source system's behaviour).
--   · warehouse_rack_movements — append-only ledger of every stock-in/out/
--                             transfer against a rack, used by the Movement
--                             History tab.
--
-- This is intentionally separate from the trading-company FIFO ledger
-- (inventory_movements / inventory_lots): that ledger tracks per-warehouse
-- quantity + cost basis, while these tables track *where in the warehouse* a
-- finished item physically sits. The two are complementary.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── Racks ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_racks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id  UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  -- Human label shown on the grid tile, e.g. "Rack 1". Unique per warehouse.
  rack          TEXT NOT NULL,
  -- Optional finer position within a rack (level/column). Free text for now.
  position      TEXT,
  status        TEXT NOT NULL DEFAULT 'EMPTY'
                  CHECK (status IN ('OCCUPIED', 'EMPTY', 'RESERVED')),
  -- When true (and no items present) the rack shows as RESERVED on the grid.
  reserved      BOOLEAN NOT NULL DEFAULT false,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_racks_warehouse_rack_key UNIQUE (warehouse_id, rack)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_racks_warehouse
  ON warehouse_racks (warehouse_id, rack);
CREATE INDEX IF NOT EXISTS idx_warehouse_racks_status
  ON warehouse_racks (status);

-- ── Items currently on a rack ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_rack_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rack_id         UUID NOT NULL REFERENCES warehouse_racks(id) ON DELETE CASCADE,
  product_code    TEXT NOT NULL,
  product_name    TEXT,
  size_label      TEXT,
  -- Optional human-facing reference to the document/customer that put the item
  -- here (e.g. an SO doc_no). Free text so it works even before any allocation
  -- workflow exists.
  customer_name   TEXT,
  source_doc_no   TEXT,
  qty             INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  stocked_in_date DATE NOT NULL DEFAULT now(),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_rack_items_rack
  ON warehouse_rack_items (rack_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_rack_items_product
  ON warehouse_rack_items (product_code);

-- ── Movement ledger (append-only) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_rack_movements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_type TEXT NOT NULL
                  CHECK (movement_type IN ('STOCK_IN', 'STOCK_OUT', 'TRANSFER')),
  -- Rack reference kept loose (no FK) so movement history survives a rack
  -- being deleted/renamed — the rack_label snapshot preserves the display.
  rack_id       UUID,
  rack_label    TEXT,
  warehouse_id  UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  product_code  TEXT,
  product_name  TEXT,
  source_doc_no TEXT,
  quantity      INTEGER NOT NULL DEFAULT 1,
  reason        TEXT,
  performed_by  UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_rack_movements_type
  ON warehouse_rack_movements (movement_type);
CREATE INDEX IF NOT EXISTS idx_warehouse_rack_movements_rack
  ON warehouse_rack_movements (rack_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_rack_movements_created
  ON warehouse_rack_movements (created_at);

COMMENT ON TABLE warehouse_racks IS
  'Physical rack/bin locations within a warehouse (ported from Hookka ERP). '
  'Status is derived (OCCUPIED/RESERVED/EMPTY) and persisted for cheap grid reads.';
COMMENT ON TABLE warehouse_rack_items IS
  'Items physically stored on a rack. No per-rack limit — a rack can hold many items.';
COMMENT ON TABLE warehouse_rack_movements IS
  'Append-only stock-in/out/transfer ledger per rack, powering the Movement History tab.';

COMMIT;
