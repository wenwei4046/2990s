-- ----------------------------------------------------------------------------
-- 0126 — FIFO trigger: make ADJUSTMENT actually move stock layers
--        (Commander 2026-06-01, audit Group B — Critical)
--
-- THE BUG
--   fn_inventory_movement_fifo() (last set in 0121) only branched on IN and OUT.
--   An ADJUSTMENT movement — written by BOTH the stock-take post path
--   (apps/api/src/routes/stock-takes.ts) and the manual adjust endpoint
--   (apps/api/src/routes/inventory.ts) — wrote the movement row but NEVER
--   created or consumed an inventory_lot. Consequences:
--     • The on-hand QTY view (inventory_balances) counts ADJUSTMENT.qty, but the
--       FIFO lots (inventory_lots, the basis of v_inventory_value and every COGS
--       consumption) did NOT change → qty and valuation silently diverged.
--     • A POSITIVE adjustment (stock take found more) added on-hand qty with NO
--       cost layer → that found stock was un-valued AND, when later shipped, had
--       no lot to consume (FIFO reported a shortfall, costed it at 0).
--     • A NEGATIVE adjustment (shrinkage / loss) dropped on-hand qty but left the
--       phantom lots standing → valuation overstated, and the leftover lots would
--       be wrongly FIFO-consumed by a future OUT. The loss was never written off
--       to COGS.
--
-- THE FIX
--   Add an ADJUSTMENT branch to the trigger so an adjustment moves real layers:
--     • qty > 0  → create a lot exactly like IN. Value it at the supplied
--                  unit_cost_sen; if that is 0/NULL (stock-take posts 0) fall
--                  back to the variant's current weighted-AVERAGE open-lot cost so
--                  found goods are valued at what we already carry, not zero
--                  (this also fixes the zero-cost found-lot finding). batch_no is
--                  carried through if present.
--     • qty < 0  → consume FIFO exactly like OUT (batch-scoped when batch_no is
--                  set, else plain FIFO), writing inventory_lot_consumptions and
--                  stamping the movement's total/unit cost — so shrinkage is
--                  written off against the real cost layers.
--   IN and OUT branches are re-asserted verbatim from 0121 (CREATE OR REPLACE
--   rewrites the whole function). Negative-balance-allowed posture is preserved
--   (fn_consume_fifo / _batch report the shortfall, never raise).
--
-- ⚠️ APPLIED MANUALLY BY IT. Trigger-function change only — no table/column DDL.
--    Depends on 0121 (fn_consume_fifo_batch + batch_no) and 0117/0053
--    (fn_consume_fifo). Idempotent: pure CREATE OR REPLACE of one function.
-- ----------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION fn_inventory_movement_fifo() RETURNS TRIGGER AS $$
DECLARE
  v_result    RECORD;
  v_abs_qty   INTEGER;
  v_avg_cost  INTEGER;
  v_unit_cost INTEGER;
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

  ELSIF NEW.movement_type = 'ADJUSTMENT' THEN
    IF NEW.qty > 0 THEN
      -- Positive correction (stock take found more / manual top-up) → create a
      -- lot like IN. Value at supplied cost, else the variant's weighted-average
      -- open-lot cost, else 0 (never leave found stock zero-valued by default).
      SELECT CASE WHEN SUM(qty_remaining) > 0
                  THEN SUM(qty_remaining * unit_cost_sen) / SUM(qty_remaining)
                  ELSE 0 END
        INTO v_avg_cost
        FROM inventory_lots
       WHERE warehouse_id = NEW.warehouse_id
         AND product_code = NEW.product_code
         AND variant_key  = NEW.variant_key
         AND qty_remaining > 0;

      v_unit_cost := COALESCE(NULLIF(NEW.unit_cost_sen, 0), v_avg_cost, 0);

      INSERT INTO inventory_lots (
        warehouse_id, product_code, variant_key, product_name,
        qty_received, qty_remaining, unit_cost_sen,
        received_at, source_doc_type, source_doc_id, source_doc_no,
        movement_id, created_by, batch_no
      ) VALUES (
        NEW.warehouse_id, NEW.product_code, NEW.variant_key, NEW.product_name,
        NEW.qty, NEW.qty, v_unit_cost,
        NEW.created_at,
        NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
        NEW.id, NEW.performed_by, NEW.batch_no
      );
      UPDATE inventory_movements
         SET total_cost_sen = NEW.qty * v_unit_cost,
             unit_cost_sen  = v_unit_cost
       WHERE id = NEW.id;

    ELSIF NEW.qty < 0 THEN
      -- Negative correction (shrinkage / loss) → consume FIFO like OUT so the
      -- loss is written off against the real cost layers.
      v_abs_qty := ABS(NEW.qty);
      IF NEW.batch_no IS NOT NULL THEN
        SELECT * INTO v_result
          FROM fn_consume_fifo_batch(
            NEW.warehouse_id, NEW.product_code, NEW.variant_key, v_abs_qty, NEW.batch_no,
            NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
            NEW.id, NEW.performed_by
          );
      ELSE
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
    -- NEW.qty = 0 ADJUSTMENT is a no-op (callers already guard qty != 0).
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger definition is unchanged (AFTER INSERT, per row) — re-assert for safety.
DROP TRIGGER IF EXISTS trg_inventory_movement_fifo ON inventory_movements;
CREATE TRIGGER trg_inventory_movement_fifo
  AFTER INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION fn_inventory_movement_fifo();

COMMIT;
