-- ----------------------------------------------------------------------------
-- 0053 — Inventory FIFO COGS layer + all-SKU view (PR #37)
--
-- Commander 2026-05-25:
--   "我们的COGS 是根据FIFO的"
--   "inventory 要跟 products 那边一样可以分 category 或者 all
--    然后全部 products code 都会过去 然后 show 完全部 code"
--
-- Adds:
--   - inventory_lots          — every IN movement becomes a FIFO lot w/ unit cost
--   - inventory_lot_consumptions — every OUT consumes from oldest lots first
--   - unit_cost_sen column on inventory_movements (per-unit cost at time of move)
--   - fn_consume_fifo()       — atomic FIFO consumer
--   - trg_inventory_movement_fifo — AFTER INSERT trigger on inventory_movements
--     • IN  movements w/ unit_cost_sen → create a lot
--     • OUT movements                  → consume FIFO, update movement
--       w/ resolved unit cost
--   - v_inventory_all_skus    — every mfg_products row × every warehouse, with
--                                its current qty (0 when no movement)
--   - v_inventory_lots_open   — lots with qty_remaining > 0
--   - v_cogs_entries          — flat COGS stream
--   - v_inventory_value       — Σ qty_remaining × unit_cost_sen per warehouse
-- ----------------------------------------------------------------------------

BEGIN;

-- ── Inventory lots (one row per IN movement) ───────────────────────────
CREATE TABLE IF NOT EXISTS inventory_lots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id    UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  product_code    TEXT NOT NULL,
  product_name    TEXT,
  qty_received    INTEGER NOT NULL CHECK (qty_received > 0),
  qty_remaining   INTEGER NOT NULL CHECK (qty_remaining >= 0),
  unit_cost_sen   INTEGER NOT NULL DEFAULT 0,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_doc_type TEXT,
  source_doc_id   UUID,
  source_doc_no   TEXT,
  movement_id     UUID,                      -- back-link to inventory_movements.id
  notes           TEXT,
  created_by      UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_lots_wh_product ON inventory_lots(warehouse_id, product_code, received_at);
CREATE INDEX IF NOT EXISTS idx_inv_lots_open       ON inventory_lots(warehouse_id, product_code) WHERE qty_remaining > 0;

-- ── Consumptions (one row per FIFO consume against a lot) ──────────────
CREATE TABLE IF NOT EXISTS inventory_lot_consumptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id          UUID NOT NULL REFERENCES inventory_lots(id) ON DELETE CASCADE,
  warehouse_id    UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  product_code    TEXT NOT NULL,
  qty_consumed    INTEGER NOT NULL CHECK (qty_consumed > 0),
  unit_cost_sen   INTEGER NOT NULL,             -- snapshot of lot.unit_cost_sen
  total_cost_sen  INTEGER NOT NULL,             -- qty_consumed × unit_cost_sen
  consumed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_doc_type TEXT,
  source_doc_id   UUID,
  source_doc_no   TEXT,
  movement_id     UUID,                          -- back-link to inventory_movements.id (OUT row)
  created_by      UUID REFERENCES staff(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_cons_lot      ON inventory_lot_consumptions(lot_id);
CREATE INDEX IF NOT EXISTS idx_inv_cons_doc      ON inventory_lot_consumptions(source_doc_type, source_doc_id);
CREATE INDEX IF NOT EXISTS idx_inv_cons_consumed ON inventory_lot_consumptions(consumed_at DESC);

-- ── Add unit_cost_sen to inventory_movements (for IN movements) ────────
ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS unit_cost_sen   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost_sen  INTEGER DEFAULT 0;
COMMENT ON COLUMN inventory_movements.unit_cost_sen IS 'Per-unit cost at time of movement (sen). For IN: from GRN/PI. For OUT: weighted avg from consumed lots.';
COMMENT ON COLUMN inventory_movements.total_cost_sen IS 'qty × unit_cost_sen. For OUT: sum of FIFO consumption costs.';

-- ── FIFO consumer function ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_consume_fifo(
  p_warehouse_id    UUID,
  p_product_code    TEXT,
  p_qty_needed      INTEGER,
  p_source_doc_type TEXT,
  p_source_doc_id   UUID,
  p_source_doc_no   TEXT,
  p_movement_id     UUID,
  p_created_by      UUID
) RETURNS TABLE (total_cost_sen INTEGER, qty_short INTEGER) AS $$
DECLARE
  v_lot          RECORD;
  v_take         INTEGER;
  v_remaining    INTEGER := p_qty_needed;
  v_total_cost   INTEGER := 0;
BEGIN
  -- Loop oldest-first through open lots, deducting qty_remaining as we go.
  FOR v_lot IN
    SELECT id, qty_remaining, unit_cost_sen
      FROM inventory_lots
     WHERE warehouse_id = p_warehouse_id
       AND product_code = p_product_code
       AND qty_remaining > 0
     ORDER BY received_at ASC, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_lot.qty_remaining, v_remaining);
    v_total_cost := v_total_cost + (v_take * v_lot.unit_cost_sen);
    v_remaining := v_remaining - v_take;

    UPDATE inventory_lots
       SET qty_remaining = qty_remaining - v_take
     WHERE id = v_lot.id;

    INSERT INTO inventory_lot_consumptions (
      lot_id, warehouse_id, product_code,
      qty_consumed, unit_cost_sen, total_cost_sen,
      source_doc_type, source_doc_id, source_doc_no, movement_id, created_by
    ) VALUES (
      v_lot.id, p_warehouse_id, p_product_code,
      v_take, v_lot.unit_cost_sen, v_take * v_lot.unit_cost_sen,
      p_source_doc_type, p_source_doc_id, p_source_doc_no, p_movement_id, p_created_by
    );
  END LOOP;

  -- We allow negative balance (short ship) — return how much we couldn't
  -- fulfil, caller can warn or block.
  RETURN QUERY SELECT v_total_cost, GREATEST(v_remaining, 0);
END;
$$ LANGUAGE plpgsql;

-- ── Trigger: hook into inventory_movements writes ──────────────────────
CREATE OR REPLACE FUNCTION fn_inventory_movement_fifo() RETURNS TRIGGER AS $$
DECLARE
  v_result RECORD;
  v_abs_qty INTEGER;
BEGIN
  IF NEW.movement_type = 'IN' THEN
    -- Create a lot for FIFO consumption later. Skip if zero cost (e.g.
    -- consignment-return) — we still create the lot so FIFO order tracks
    -- it, but unit_cost_sen will be 0.
    INSERT INTO inventory_lots (
      warehouse_id, product_code, product_name,
      qty_received, qty_remaining, unit_cost_sen,
      received_at, source_doc_type, source_doc_id, source_doc_no,
      movement_id, created_by
    ) VALUES (
      NEW.warehouse_id, NEW.product_code, NEW.product_name,
      NEW.qty, NEW.qty, COALESCE(NEW.unit_cost_sen, 0),
      NEW.created_at,
      NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
      NEW.id, NEW.performed_by
    );
    -- Stamp total_cost_sen on the movement
    UPDATE inventory_movements
       SET total_cost_sen = NEW.qty * COALESCE(NEW.unit_cost_sen, 0)
     WHERE id = NEW.id;

  ELSIF NEW.movement_type = 'OUT' THEN
    -- FIFO-consume from open lots. qty is stored as positive here.
    v_abs_qty := ABS(NEW.qty);
    SELECT * INTO v_result
      FROM fn_consume_fifo(
        NEW.warehouse_id, NEW.product_code, v_abs_qty,
        NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
        NEW.id, NEW.performed_by
      );
    UPDATE inventory_movements
       SET total_cost_sen = v_result.total_cost_sen,
           unit_cost_sen  = CASE WHEN v_abs_qty > 0
                                 THEN v_result.total_cost_sen / v_abs_qty
                                 ELSE 0 END
     WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_movement_fifo ON inventory_movements;
CREATE TRIGGER trg_inventory_movement_fifo
  AFTER INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION fn_inventory_movement_fifo();

-- ── View: every SKU × every warehouse, with current qty (LEFT JOIN) ────
-- This is what the Inventory page hits when "show all" is selected. SKUs
-- with zero balance still appear as a row (qty = 0, last_movement_at = NULL).
CREATE OR REPLACE VIEW v_inventory_all_skus AS
SELECT
  p.code              AS product_code,
  p.name              AS product_name,
  p.category          AS category,
  p.size_label        AS size_label,
  w.id                AS warehouse_id,
  w.code              AS warehouse_code,
  w.name              AS warehouse_name,
  COALESCE(b.qty, 0)              AS qty,
  COALESCE(b.last_movement_at, NULL) AS last_movement_at,
  COALESCE(v.value_sen, 0)        AS value_sen
FROM mfg_products p
CROSS JOIN warehouses w
LEFT JOIN inventory_balances b
       ON b.warehouse_id = w.id AND b.product_code = p.code
LEFT JOIN (
  SELECT warehouse_id, product_code, SUM(qty_remaining * unit_cost_sen) AS value_sen
    FROM inventory_lots
   WHERE qty_remaining > 0
   GROUP BY warehouse_id, product_code
) v ON v.warehouse_id = w.id AND v.product_code = p.code
WHERE w.is_active = TRUE
  AND p.status = 'ACTIVE';

-- ── View: open lots (qty_remaining > 0) for drilldown ──────────────────
CREATE OR REPLACE VIEW v_inventory_lots_open AS
SELECT
  l.id, l.warehouse_id, w.code AS warehouse_code,
  l.product_code, l.product_name,
  l.qty_received, l.qty_remaining,
  l.unit_cost_sen,
  (l.qty_remaining * l.unit_cost_sen) AS remaining_value_sen,
  l.received_at, l.source_doc_type, l.source_doc_no
FROM inventory_lots l
LEFT JOIN warehouses w ON w.id = l.warehouse_id
WHERE l.qty_remaining > 0
ORDER BY l.received_at;

-- ── View: COGS stream (flat list of consumptions) ──────────────────────
CREATE OR REPLACE VIEW v_cogs_entries AS
SELECT
  c.id,
  c.consumed_at,
  c.warehouse_id, w.code AS warehouse_code,
  c.product_code,
  c.qty_consumed,
  c.unit_cost_sen,
  c.total_cost_sen,
  c.source_doc_type,
  c.source_doc_no,
  l.received_at        AS lot_received_at,
  l.source_doc_no      AS lot_source_doc_no
FROM inventory_lot_consumptions c
JOIN inventory_lots l ON l.id = c.lot_id
LEFT JOIN warehouses w ON w.id = c.warehouse_id
ORDER BY c.consumed_at DESC;

-- ── View: inventory valuation per (warehouse, product) ─────────────────
CREATE OR REPLACE VIEW v_inventory_value AS
SELECT
  l.warehouse_id,
  w.code AS warehouse_code,
  l.product_code,
  l.product_name,
  SUM(l.qty_remaining)                            AS qty_on_hand,
  SUM(l.qty_remaining * l.unit_cost_sen)          AS value_sen,
  CASE WHEN SUM(l.qty_remaining) > 0
       THEN SUM(l.qty_remaining * l.unit_cost_sen) / SUM(l.qty_remaining)
       ELSE 0 END                                  AS avg_unit_cost_sen
FROM inventory_lots l
LEFT JOIN warehouses w ON w.id = l.warehouse_id
WHERE l.qty_remaining > 0
GROUP BY l.warehouse_id, w.code, l.product_code, l.product_name;

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE inventory_lots               ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_lot_consumptions   ENABLE ROW LEVEL SECURITY;
CREATE POLICY inv_lots_read  ON inventory_lots              FOR SELECT TO authenticated USING (true);
CREATE POLICY inv_lots_write ON inventory_lots              FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY inv_cons_read  ON inventory_lot_consumptions  FOR SELECT TO authenticated USING (true);
CREATE POLICY inv_cons_write ON inventory_lot_consumptions  FOR ALL    TO authenticated USING (true) WITH CHECK (true);

COMMIT;
