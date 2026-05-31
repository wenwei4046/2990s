-- ----------------------------------------------------------------------------
-- 0117 — Variant-aware FIFO (re-assert) + stock_transfer_lines.variant_key
--
-- Bug #8 (variant mismatch): the app buckets stock by
-- (warehouse_id, product_code, variant_key) but the ORIGINAL FIFO consumer
-- (migration 0053) keyed lots + fn_consume_fifo only by
-- (warehouse_id, product_code). Migration 0095 already redefined the lot
-- keying + fn_consume_fifo + trigger to include variant_key; this migration
-- RE-ASSERTS that contract idempotently (so a DB that somehow still runs the
-- 0053 definitions is brought to the variant-aware state) and closes the one
-- remaining gap in the document layer this agent owns: stock transfers had no
-- way to carry a variant_key, so every transfer movement fell into the ''
-- (unclassified) bucket and the OUT consumed the wrong batch.
--
-- LOCKED RULES preserved:
--   • Polarity unchanged (this migration touches only FIFO keying + a column).
--   • NEGATIVE BALANCE STILL ALLOWED — fn_consume_fifo returns the shortfall
--     (qty_short) instead of raising; no lot is forced negative, no block.
--   • FIFO keyed on (warehouse_id, product_code, variant_key); '' = legacy /
--     unclassified bucket, behaves exactly as before for un-attributed stock.
--
-- ⚠️ APPLIED MANUALLY BY IT. Test on a staging / branch DB first.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── 1. Columns (additive, idempotent; 0095 may already have added these) ────
ALTER TABLE inventory_lots             ADD COLUMN IF NOT EXISTS variant_key TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_lot_consumptions ADD COLUMN IF NOT EXISTS variant_key TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_movements        ADD COLUMN IF NOT EXISTS variant_key TEXT NOT NULL DEFAULT '';

-- stock_transfer_lines gains variant_key so a transfer can move a SPECIFIC
-- fabric/attribute variant. NULL/'' on legacy rows = unclassified bucket.
ALTER TABLE stock_transfer_lines       ADD COLUMN IF NOT EXISTS variant_key TEXT NOT NULL DEFAULT '';
COMMENT ON COLUMN stock_transfer_lines.variant_key IS 'Canonical attribute composition (packages/shared computeVariantKey). The OUT@from / IN@to inventory movements carry this so FIFO consumes/returns the matching variant batch. '''' = unclassified/legacy.';

-- ── 2. Variant-aware indexes on inventory_lots (re-assert 0095) ─────────────
DROP INDEX IF EXISTS idx_inv_lots_wh_product;
CREATE INDEX IF NOT EXISTS idx_inv_lots_wh_product
  ON inventory_lots(warehouse_id, product_code, variant_key, received_at);
DROP INDEX IF EXISTS idx_inv_lots_open;
CREATE INDEX IF NOT EXISTS idx_inv_lots_open
  ON inventory_lots(warehouse_id, product_code, variant_key) WHERE qty_remaining > 0;

-- ── 3. FIFO consumer — variant-scoped (9-arg). Re-assert; retire any 8-arg ──
CREATE OR REPLACE FUNCTION fn_consume_fifo(
  p_warehouse_id    UUID,
  p_product_code    TEXT,
  p_variant_key     TEXT,
  p_qty_needed      INTEGER,
  p_source_doc_type TEXT,
  p_source_doc_id   UUID,
  p_source_doc_no   TEXT,
  p_movement_id     UUID,
  p_created_by      UUID
) RETURNS TABLE (total_cost_sen INTEGER, qty_short INTEGER) AS $$
DECLARE
  v_lot        RECORD;
  v_take       INTEGER;
  v_remaining  INTEGER := p_qty_needed;
  v_total_cost INTEGER := 0;
BEGIN
  -- Oldest-first through OPEN lots matching the EXACT variant bucket.
  FOR v_lot IN
    SELECT id, qty_remaining, unit_cost_sen
      FROM inventory_lots
     WHERE warehouse_id = p_warehouse_id
       AND product_code = p_product_code
       AND variant_key  = p_variant_key
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
      lot_id, warehouse_id, product_code, variant_key,
      qty_consumed, unit_cost_sen, total_cost_sen,
      source_doc_type, source_doc_id, source_doc_no, movement_id, created_by
    ) VALUES (
      v_lot.id, p_warehouse_id, p_product_code, p_variant_key,
      v_take, v_lot.unit_cost_sen, v_take * v_lot.unit_cost_sen,
      p_source_doc_type, p_source_doc_id, p_source_doc_no, p_movement_id, p_created_by
    );
  END LOOP;

  -- NEGATIVE BALANCE ALLOWED: report shortfall, never raise / block.
  RETURN QUERY SELECT v_total_cost, GREATEST(v_remaining, 0);
END;
$$ LANGUAGE plpgsql;

-- ── 4. Trigger — variant_key into lot creation + FIFO consume (re-assert) ──
CREATE OR REPLACE FUNCTION fn_inventory_movement_fifo() RETURNS TRIGGER AS $$
DECLARE
  v_result  RECORD;
  v_abs_qty INTEGER;
BEGIN
  IF NEW.movement_type = 'IN' THEN
    INSERT INTO inventory_lots (
      warehouse_id, product_code, variant_key, product_name,
      qty_received, qty_remaining, unit_cost_sen,
      received_at, source_doc_type, source_doc_id, source_doc_no,
      movement_id, created_by
    ) VALUES (
      NEW.warehouse_id, NEW.product_code, NEW.variant_key, NEW.product_name,
      NEW.qty, NEW.qty, COALESCE(NEW.unit_cost_sen, 0),
      NEW.created_at,
      NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
      NEW.id, NEW.performed_by
    );
    UPDATE inventory_movements
       SET total_cost_sen = NEW.qty * COALESCE(NEW.unit_cost_sen, 0)
     WHERE id = NEW.id;

  ELSIF NEW.movement_type = 'OUT' THEN
    v_abs_qty := ABS(NEW.qty);
    SELECT * INTO v_result
      FROM fn_consume_fifo(
        NEW.warehouse_id, NEW.product_code, NEW.variant_key, v_abs_qty,
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

-- Retire the obsolete 8-arg (pre-variant) consumer if it lingers from 0053.
DROP FUNCTION IF EXISTS fn_consume_fifo(UUID, TEXT, INTEGER, TEXT, UUID, TEXT, UUID, UUID);

COMMIT;
