-- 0015_create_purchase_orders.sql
-- Phase 4 sub-project D: purchase_orders + purchase_order_lines + year-prefixed PO sequence.

CREATE TABLE po_sequences (
  year INTEGER PRIMARY KEY,
  current_value INTEGER NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION next_po_number() RETURNS TEXT AS $$
DECLARE
  cur_year INTEGER := EXTRACT(YEAR FROM NOW())::INTEGER;
  next_seq INTEGER;
BEGIN
  INSERT INTO po_sequences (year, current_value)
  VALUES (cur_year, 1)
  ON CONFLICT (year) DO UPDATE SET current_value = po_sequences.current_value + 1
  RETURNING current_value INTO next_seq;
  RETURN 'PO-' || cur_year || '-' || LPAD(next_seq::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT UNIQUE NOT NULL DEFAULT next_po_number(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT
);

CREATE TABLE purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  size TEXT,
  colour TEXT,
  qty INTEGER NOT NULL CHECK (qty > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pol_purchase_order ON purchase_order_lines(purchase_order_id);
CREATE INDEX idx_pol_order ON purchase_order_lines(order_id);
