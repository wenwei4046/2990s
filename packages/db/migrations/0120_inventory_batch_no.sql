-- ----------------------------------------------------------------------------
-- 0120 — Inventory batch tag (PO number as production batch)
--
-- Sofa is colour-matched and produced as a SET on ONE PO (one dye lot). A set's
-- component SKUs (e.g. 2A + L) are received by SKU, but to ship without colour
-- difference the outbound side must pull the WHOLE set from ONE production
-- batch. We use the source PO number as that batch id.
--
-- Stage 1 of 4 (Commander 2026-05-31): TAG ONLY.
--   • Add batch_no to inventory_movements (caller-supplied on IN) and
--     inventory_lots (copied from the movement by the FIFO trigger).
--   • GRN inbound writes each line's source PO number into batch_no.
--   • FIFO consume logic is UNCHANGED here — batch-aware outbound matching is
--     Stage 3. batch_no is pure metadata until then.
--
-- LOCKED RULES preserved:
--   • Polarity + negative-balance behaviour unchanged.
--   • FIFO still keyed on (warehouse_id, product_code, variant_key).
--   • Trigger re-asserted from 0117 verbatim, with the ONE addition of copying
--     NEW.batch_no onto the new lot on the IN path.
--
-- ⚠️ APPLIED MANUALLY BY IT. Test on a staging / branch DB first.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── 1. Columns (additive, idempotent) ──────────────────────────────────────
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS batch_no TEXT;
ALTER TABLE inventory_lots      ADD COLUMN IF NOT EXISTS batch_no TEXT;

COMMENT ON COLUMN inventory_lots.batch_no IS
  'Production batch = source PO number. A sofa set''s component SKUs are received under one PO and share a batch_no so outbound can ship the full set from one batch (one dye lot, no colour difference). NULL = un-batched / non-sofa stock.';
COMMENT ON COLUMN inventory_movements.batch_no IS
  'Production batch carried onto the IN movement (source PO number); the FIFO trigger copies it onto the lot it creates.';

-- ── 2. Index for batch lookups (Stage 2/3) — open lots by warehouse + batch ─
CREATE INDEX IF NOT EXISTS idx_inv_lots_batch
  ON inventory_lots(warehouse_id, batch_no, product_code, variant_key)
  WHERE qty_remaining > 0 AND batch_no IS NOT NULL;

-- ── 3. Trigger — re-assert 0117 body, copy batch_no onto the lot on IN ──────
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

COMMIT;
