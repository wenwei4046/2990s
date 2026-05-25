-- ----------------------------------------------------------------------------
-- 0048 — Purchase Returns module.
--
-- Closes the procurement audit trail: PO → GRN → (defect/oversupply
-- discovered) → PurchaseReturn → supplier issues credit note.
-- Schema mirrors GRN: header (purchase_returns) + line items
-- (purchase_return_items). Both linked back to PO + GRN so we can show
-- supplier scorecards (defect rate already aggregates qty_rejected from
-- GRN; this gives the formal return process).
--
-- Apply via Supabase SQL Editor.
-- ----------------------------------------------------------------------------

BEGIN;

CREATE TYPE purchase_return_status AS ENUM (
  'DRAFT', 'POSTED', 'COMPLETED', 'CANCELLED'
);

CREATE TABLE purchase_returns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number     TEXT NOT NULL UNIQUE,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  grn_id            UUID REFERENCES grns(id)            ON DELETE SET NULL,
  supplier_id       UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  return_date       DATE NOT NULL DEFAULT now(),
  reason            TEXT,
  status            purchase_return_status NOT NULL DEFAULT 'DRAFT',
  posted_at         TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  credit_note_ref   TEXT,
  refund_centi      INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pr_po       ON purchase_returns(purchase_order_id);
CREATE INDEX idx_pr_supplier ON purchase_returns(supplier_id);
CREATE INDEX idx_pr_status   ON purchase_returns(status);

CREATE TABLE purchase_return_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_return_id  UUID NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  grn_item_id         UUID REFERENCES grn_items(id) ON DELETE SET NULL,
  material_kind       material_kind NOT NULL,
  material_code       TEXT NOT NULL,
  material_name       TEXT NOT NULL,
  qty_returned        INTEGER NOT NULL,
  unit_price_centi    INTEGER NOT NULL DEFAULT 0,
  line_refund_centi   INTEGER NOT NULL DEFAULT 0,
  reason              TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pr_items_pr ON purchase_return_items(purchase_return_id);

-- RLS — match the suppliers / purchase_orders posture (authenticated staff
-- can read + write; service role bypasses).
ALTER TABLE purchase_returns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_return_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY pr_staff_read   ON purchase_returns      FOR SELECT TO authenticated USING (true);
CREATE POLICY pr_staff_write  ON purchase_returns      FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY pri_staff_read  ON purchase_return_items FOR SELECT TO authenticated USING (true);
CREATE POLICY pri_staff_write ON purchase_return_items FOR ALL    TO authenticated USING (true) WITH CHECK (true);

COMMIT;
