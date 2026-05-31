-- ----------------------------------------------------------------------------
-- 0121 — Sofa batch-aware outbound (Stage 3 of 4, Commander 2026-05-31)
--
-- Sofa is colour-matched and produced as a SET on ONE PO = ONE dye lot = ONE
-- batch (Stage 1 stamped inventory_lots.batch_no = source PO number). To ship a
-- set without colour difference the whole set must leave from ONE batch.
--
-- LOCKED RULES (Commander 2026-05-31):
--   • A batch matches a Sales Order's sofa set ONLY when the batch's surviving
--     component multiset EQUALS the SO's sofa-need multiset (EXACT match).
--   • Whole batch is atomic — all components allocate to one SO together or none.
--   • One batch → exactly one SO. Pure made-to-stock: a batch may go to ANY
--     variant-matching SO, FIFO by delivery date, NOT tied to its origin SO.
--   • Enforced at BOTH layers: allocation (so-stock-allocation stamps the matched
--     batch on the SO line) AND outbound (the DO consumes from that exact batch).
--
-- This migration adds the OUTBOUND plumbing:
--   1. mfg_sales_order_items.allocated_batch_no — the batch the allocator locked
--      to this sofa line (NULL = unbatched / non-sofa / not yet matched).
--   2. fn_consume_fifo_batch() — FIFO consumer scoped to ONE batch_no, so an OUT
--      movement carrying batch_no draws only from that batch's lots.
--   3. Trigger branch — an OUT with NEW.batch_no set consumes batch-scoped; an
--      OUT with NULL batch_no keeps the existing plain FIFO (non-sofa, legacy).
--      The IN path is re-asserted verbatim from 0120 (copies batch_no onto lot).
--
-- BACKWARD-COMPAT: an OUT row that carries a batch_no but where the batch has no
-- matching open lot still reports its shortfall (negative balance allowed, as in
-- fn_consume_fifo) — it never blocks the ship.
--
-- ⚠️ APPLIED MANUALLY BY IT. Test on a staging / branch DB first.
--    Depends on 0120 (batch_no columns + index). Apply 0120 first.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── 1. Per-line allocated batch (additive, idempotent) ─────────────────────
ALTER TABLE mfg_sales_order_items ADD COLUMN IF NOT EXISTS allocated_batch_no TEXT;

COMMENT ON COLUMN mfg_sales_order_items.allocated_batch_no IS
  'Sofa batch (source PO number) the auto-allocator locked to this line so the whole colour-matched set ships from one dye lot. Set by so-stock-allocation when a batch EXACTLY matches the SO''s sofa set; cleared when the match breaks or the line cancels/returns (Stage 4). NULL for non-sofa / unmatched lines.';

-- ── 2. Batch-scoped FIFO consumer — clone of fn_consume_fifo + batch filter ──
CREATE OR REPLACE FUNCTION fn_consume_fifo_batch(
  p_warehouse_id    UUID,
  p_product_code    TEXT,
  p_variant_key     TEXT,
  p_qty_needed      INTEGER,
  p_batch_no        TEXT,
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
  -- Oldest-first through OPEN lots of the EXACT variant bucket AND batch.
  FOR v_lot IN
    SELECT id, qty_remaining, unit_cost_sen
      FROM inventory_lots
     WHERE warehouse_id = p_warehouse_id
       AND product_code = p_product_code
       AND variant_key  = p_variant_key
       AND batch_no     = p_batch_no
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

-- ── 3. Trigger — IN re-asserted from 0120; OUT branches on batch_no ─────────
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
      movement_id, created_by, batch_no
    ) VALUES (
      NEW.warehouse_id, NEW.product_code, NEW.variant_key, NEW.product_name,
      NEW.qty, NEW.qty, COALESCE(NEW.unit_cost_sen, 0),
      NEW.created_at,
      NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
      NEW.id, NEW.performed_by, NEW.batch_no
    );
    UPDATE inventory_movements
       SET total_cost_sen = NEW.qty * COALESCE(NEW.unit_cost_sen, 0)
     WHERE id = NEW.id;

  ELSIF NEW.movement_type = 'OUT' THEN
    v_abs_qty := ABS(NEW.qty);
    IF NEW.batch_no IS NOT NULL THEN
      -- Sofa set ship — consume strictly from the locked batch (one dye lot).
      SELECT * INTO v_result
        FROM fn_consume_fifo_batch(
          NEW.warehouse_id, NEW.product_code, NEW.variant_key, v_abs_qty, NEW.batch_no,
          NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
          NEW.id, NEW.performed_by
        );
    ELSE
      -- Un-batched stock — plain FIFO across all lots of the variant bucket.
      SELECT * INTO v_result
        FROM fn_consume_fifo(
          NEW.warehouse_id, NEW.product_code, NEW.variant_key, v_abs_qty,
          NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
          NEW.id, NEW.performed_by
        );
    END IF;
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

COMMIT;
