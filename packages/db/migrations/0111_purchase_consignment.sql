-- ----------------------------------------------------------------------------
-- 0111 — Purchase Consignment (PC) — buyer-side mirror of the outbound
--        Consignment module (#206).
--
-- Commander 2026-05-30: PC = supplier places goods on consignment WITH YOU.
--   • IN note     → supplier delivers stock to your warehouse (inventory IN).
--   • RETURN note → you ship unsold stock back to the supplier (inventory OUT).
--
-- The shape is a 1:1 mirror of the existing consignment_orders /
-- consignment_order_items / consignment_notes / consignment_note_items quartet
-- (migrations 0042 + 0050 + 0058 + 0110) with purchase semantics:
--   - debtor_* swapped for supplier_id FK
--   - note_type enum is ('IN','RETURN') instead of ('OUT','RETURN')
--   - cancelled_at sentinel column already baked in (Tier-3 state-machine —
--     mirrors the post-0110 consignment shape so the new API doesn't need a
--     follow-up patch migration)
--
-- Wrapped in BEGIN/COMMIT. House style of 0101 / 0110 — additive, RLS opens
-- to authenticated like every other doc table. Run via Supabase SQL Editor
-- (the API + UI assume the DB has this applied).
-- ----------------------------------------------------------------------------

BEGIN;

-- ── Enums ───────────────────────────────────────────────────────────────────
-- Same shape as consignment_status / consignment_note_type. Migrations run
-- once so CREATE TYPE without IF NOT EXISTS is the house convention.
CREATE TYPE purchase_consignment_status AS ENUM (
  'AT_WAREHOUSE', -- stock physically at YOUR warehouse, still owned by supplier
  'SOLD',         -- you've consumed it (downstream PI cuts payment to supplier)
  'RETURNED',     -- returned to supplier
  'DAMAGED'       -- written off
);

CREATE TYPE purchase_consignment_note_type AS ENUM (
  'IN',     -- supplier delivers to your warehouse → inventory IN
  'RETURN'  -- you ship back to supplier         → inventory OUT
);

-- ── purchase_consignment_orders (header) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_consignment_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pc_number           TEXT NOT NULL UNIQUE,                                       -- 'PC-2605-001'
  supplier_id         UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status              purchase_consignment_status NOT NULL DEFAULT 'AT_WAREHOUSE',
  warehouse_id        UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  agreement_date      DATE NOT NULL DEFAULT current_date,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pc_supplier ON purchase_consignment_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_pc_status   ON purchase_consignment_orders(status);

-- ── purchase_consignment_order_items ────────────────────────────────────────
-- Mirrors consignment_order_items (post-0058 variant fields). qty_placed is
-- the supplier-agreed contract qty; the running qty_sold / qty_returned /
-- qty_damaged track consumption (commander-approved cap is qty_placed).
CREATE TABLE IF NOT EXISTS purchase_consignment_order_items (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pc_id                    UUID NOT NULL REFERENCES purchase_consignment_orders(id) ON DELETE CASCADE,
  material_kind            material_kind NOT NULL DEFAULT 'mfg_product',
  material_code            TEXT NOT NULL,
  material_name            TEXT NOT NULL,
  item_group               TEXT,
  description              TEXT,
  description2             TEXT,
  uom                      TEXT NOT NULL DEFAULT 'UNIT',
  qty_placed               INTEGER NOT NULL,
  qty_sold                 INTEGER NOT NULL DEFAULT 0,
  qty_returned             INTEGER NOT NULL DEFAULT 0,
  qty_damaged              INTEGER NOT NULL DEFAULT 0,
  unit_price_centi         INTEGER NOT NULL DEFAULT 0,
  variants                 JSONB,
  -- Variant fields mirrored from consignment_order_items (migration 0058)
  gap_inches               INTEGER,
  divan_height_inches      INTEGER,
  divan_price_sen          INTEGER NOT NULL DEFAULT 0,
  leg_height_inches        INTEGER,
  leg_price_sen            INTEGER NOT NULL DEFAULT 0,
  custom_specials          JSONB,
  line_suffix              TEXT,
  special_order_price_sen  INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pc_items_pc ON purchase_consignment_order_items(pc_id);

-- ── purchase_consignment_notes ──────────────────────────────────────────────
-- IN  → supplier delivers stock to warehouse (inventory IN)
-- RETURN → you ship goods back to supplier   (inventory OUT)
-- cancelled_at is baked in from day-1 (mirrors post-0110 consignment_notes
-- shape — Tier-3 unified state-machine).
CREATE TABLE IF NOT EXISTS purchase_consignment_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_number     TEXT NOT NULL UNIQUE,                                          -- 'PCN-2605-001'
  pc_id           UUID NOT NULL REFERENCES purchase_consignment_orders(id) ON DELETE RESTRICT,
  note_type       purchase_consignment_note_type NOT NULL,
  note_date       DATE NOT NULL DEFAULT current_date,
  warehouse_id    UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  driver_id       UUID REFERENCES drivers(id) ON DELETE SET NULL,
  driver_name     TEXT,
  vehicle         TEXT,
  posted_at       TIMESTAMPTZ,
  signed_at       TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_pcn_pc        ON purchase_consignment_notes(pc_id);
CREATE INDEX IF NOT EXISTS idx_pcn_type      ON purchase_consignment_notes(note_type);
-- Partial index for the cancel/has_children probes (mirrors 0110 idx_cn_cancelled).
CREATE INDEX IF NOT EXISTS idx_pcn_cancelled
  ON purchase_consignment_notes (pc_id)
  WHERE cancelled_at IS NULL;

-- ── purchase_consignment_note_items ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_consignment_note_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pc_note_id      UUID NOT NULL REFERENCES purchase_consignment_notes(id) ON DELETE CASCADE,
  pc_item_id      UUID REFERENCES purchase_consignment_order_items(id) ON DELETE SET NULL,
  item_code       TEXT NOT NULL,
  description     TEXT,
  qty             INTEGER NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pcn_items_pcn ON purchase_consignment_note_items(pc_note_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Open to authenticated for SELECT/INSERT/UPDATE/DELETE — every other doc
-- table in this codebase does the same (auth is enforced by the API middleware
-- pinning a service-role-signed JWT; DB-level RLS is the seatbelt).
ALTER TABLE purchase_consignment_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_consignment_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_consignment_notes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_consignment_note_items  ENABLE ROW LEVEL SECURITY;

CREATE POLICY pc_select ON purchase_consignment_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY pc_insert ON purchase_consignment_orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY pc_update ON purchase_consignment_orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY pc_delete ON purchase_consignment_orders FOR DELETE TO authenticated USING (true);

CREATE POLICY pci_select ON purchase_consignment_order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY pci_insert ON purchase_consignment_order_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY pci_update ON purchase_consignment_order_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY pci_delete ON purchase_consignment_order_items FOR DELETE TO authenticated USING (true);

CREATE POLICY pcn_select ON purchase_consignment_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY pcn_insert ON purchase_consignment_notes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY pcn_update ON purchase_consignment_notes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY pcn_delete ON purchase_consignment_notes FOR DELETE TO authenticated USING (true);

CREATE POLICY pcni_select ON purchase_consignment_note_items FOR SELECT TO authenticated USING (true);
CREATE POLICY pcni_insert ON purchase_consignment_note_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY pcni_update ON purchase_consignment_note_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY pcni_delete ON purchase_consignment_note_items FOR DELETE TO authenticated USING (true);

COMMIT;
