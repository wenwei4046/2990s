-- ----------------------------------------------------------------------------
-- 0051 — Sales Order extensions to match HOOKKA's full SO module + align
-- field naming with ERPNext conventions where it makes sense (commander
-- 2026-05-25 "OK A": referencing ERPNext for industry-standard naming).
--
-- Adds:
--   - 15 new columns on mfg_sales_orders (customer ref, hub, multi-address,
--     internal dates, scan PO image, computed overdue flag, subtotal split)
--   - 7 new columns on mfg_sales_order_items (bedframe variant pricing,
--     custom specials JSON, line suffix for sofa variants)
--   - 2 new audit tables: mfg_so_status_changes, mfg_so_price_overrides
--
-- All additive — no breaking changes to existing rows. Apply via Supabase
-- SQL Editor.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── mfg_sales_orders header additions ──────────────────────────────────
ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS customer_id            UUID REFERENCES customers(id) ON DELETE SET NULL,
  -- Customer PO tracking (3 structured fields + optional scanned image)
  ADD COLUMN IF NOT EXISTS customer_po            TEXT,
  ADD COLUMN IF NOT EXISTS customer_po_id         TEXT,
  ADD COLUMN IF NOT EXISTS customer_po_date       DATE,
  ADD COLUMN IF NOT EXISTS customer_po_image_b64  TEXT,
  -- Multi-branch customer (HOOKKA: delivery_hubs; we keep it as text snapshot)
  ADD COLUMN IF NOT EXISTS hub_id                 UUID,
  ADD COLUMN IF NOT EXISTS hub_name               TEXT,
  ADD COLUMN IF NOT EXISTS customer_state         TEXT,
  -- Delivery date granularity
  ADD COLUMN IF NOT EXISTS customer_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS internal_expected_dd   DATE,
  ADD COLUMN IF NOT EXISTS linked_do_doc_no       TEXT,
  -- Multi-address (3 separate blocks instead of one)
  ADD COLUMN IF NOT EXISTS ship_to_address        TEXT,
  ADD COLUMN IF NOT EXISTS bill_to_address        TEXT,
  ADD COLUMN IF NOT EXISTS install_to_address     TEXT,
  -- Money split + overdue flag
  ADD COLUMN IF NOT EXISTS subtotal_sen           INTEGER,
  ADD COLUMN IF NOT EXISTS overdue                TEXT;     -- 'PENDING'|'DUE'|'OVERDUE'|null

-- ── mfg_sales_order_items additions ────────────────────────────────────
ALTER TABLE mfg_sales_order_items
  -- Bedframe variant pricing (priceSen captured per variant slot)
  ADD COLUMN IF NOT EXISTS gap_inches             INTEGER,
  ADD COLUMN IF NOT EXISTS divan_height_inches    INTEGER,
  ADD COLUMN IF NOT EXISTS divan_price_sen        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leg_height_inches      INTEGER,
  ADD COLUMN IF NOT EXISTS leg_price_sen          INTEGER NOT NULL DEFAULT 0,
  -- Custom specials as JSONB (mix of predefined + free-text surcharges)
  ADD COLUMN IF NOT EXISTS custom_specials        JSONB,
  -- Line suffix for sofa modular variants (e.g. -01, -02)
  ADD COLUMN IF NOT EXISTS line_suffix            TEXT,
  ADD COLUMN IF NOT EXISTS special_order_price_sen INTEGER NOT NULL DEFAULT 0;

-- ── Audit: status change history ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS mfg_so_status_changes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no           TEXT NOT NULL REFERENCES mfg_sales_orders(doc_no) ON DELETE CASCADE,
  from_status      TEXT,
  to_status        TEXT NOT NULL,
  changed_by       UUID REFERENCES staff(id) ON DELETE SET NULL,
  notes            TEXT,
  auto_actions     JSONB,                              -- list of cascade triggers fired (e.g. ['createProductionOrders'])
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_so_status_changes_doc ON mfg_so_status_changes(doc_no);
CREATE INDEX IF NOT EXISTS idx_so_status_changes_at  ON mfg_so_status_changes(created_at DESC);

-- ── Audit: line price overrides ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mfg_so_price_overrides (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no           TEXT NOT NULL REFERENCES mfg_sales_orders(doc_no) ON DELETE CASCADE,
  item_id          UUID NOT NULL REFERENCES mfg_sales_order_items(id) ON DELETE CASCADE,
  item_code        TEXT NOT NULL,
  original_price_sen INTEGER NOT NULL,
  override_price_sen INTEGER NOT NULL,
  reason           TEXT,
  approved_by      UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_so_overrides_doc  ON mfg_so_price_overrides(doc_no);
CREATE INDEX IF NOT EXISTS idx_so_overrides_item ON mfg_so_price_overrides(item_id);

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE mfg_so_status_changes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfg_so_price_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_sc_staff_read  ON mfg_so_status_changes  FOR SELECT TO authenticated USING (true);
CREATE POLICY so_sc_staff_write ON mfg_so_status_changes  FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY so_po_staff_read  ON mfg_so_price_overrides FOR SELECT TO authenticated USING (true);
CREATE POLICY so_po_staff_write ON mfg_so_price_overrides FOR ALL    TO authenticated USING (true) WITH CHECK (true);

COMMIT;
