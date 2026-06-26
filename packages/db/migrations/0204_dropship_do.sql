-- ----------------------------------------------------------------------------
-- 0204 — Sofa drop-ship / supplier-direct DO (Wei Siang 2026-06-26)
--
-- THE NEED
--   The warehouse holds no stock; the supplier ships the sofa straight to the
--   customer. The operator must open a DO now — but the sofa whole-set rule
--   (findSofaLinesWithoutCompleteBatch, "Type A") blocks it because no single
--   received batch can fulfil the set. Drop-ship waives that ONE block: the OUT
--   posts against the EXPECTED production batch (= the bound PO number) even
--   though nothing is received yet, so stock goes NEGATIVE under that batch.
--   When the PO's GRN later posts an IN for the same batch, the two NET inside
--   inventory_balances (SUM(IN−OUT), batch-agnostic) automatically.
--
-- THE GAP THIS MIGRATION CLOSES (the only DB work)
--   A drop-ship OUT consumes NO lot — at OUT time the batch has no open lot, so
--   fn_consume_fifo_batch (0121) reports the whole qty as short and writes ZERO
--   inventory_lot_consumptions rows. When the GRN later creates a FULL positive
--   lot for that batch, the sofa coverage helper (sofa-set-coverage.loadSofaBatch
--   Stock, reads v_inventory_lots_open.qty_remaining) would DOUBLE-COUNT units
--   already shipped on the drop-ship DO — making the set look ready again.
--
--   fn_reconcile_dropship_batch() closes it: at GRN post (called from grns.ts
--   right after the IN movements write) it consumes the outstanding drop-ship
--   SHORTFALL from the freshly-created lots so qty_remaining (hence coverage AND
--   valuation) reflects only the truly-available remainder.
--
--   LEDGER-DRIVEN + IDEMPOTENT — the shortfall is recomputed from the ledger on
--   every call, NOT a consume-once flag:
--       shortfall = Σ OUT(batch B, bucket)        -- inventory_movements
--                 − Σ already-lot-consumed(batch B, bucket)  -- inventory_lot_consumptions
--   A first GRN finds shortfall > 0 and consumes min(shortfall, new-lot-qty). A
--   SECOND GRN for the same batch recomputes shortfall = 0 (the first call's
--   consumptions are now counted) and consumes nothing extra. Negative-balance
--   posture is preserved: it never consumes more than the lots hold and never
--   raises.
--
--   COGS: the reconcile consumes the ARRIVING lot at its real landed cost (the
--   same FIFO cost a normal short-ship would pick up once stock arrives) and
--   writes the consumption rows + cost exactly like fn_consume_fifo_batch, so
--   the drop-shipped units are costed at the lot they net against — no invented
--   cost. The original drop-ship OUT movement was stamped 0-cost at ship time
--   (no lot to consume); a follow-up restamp is left to the route's normal
--   actual-cost path. The valuation (v_inventory_value) is correct because the
--   lot's qty_remaining is reduced to the true remainder.
--
-- NOTE ON is_dropship: a flag column on delivery_orders drives ONLY the UI badge
--   ("Drop-ship · batch not received"). The reconcile itself is fully ledger-
--   driven and does NOT read it, so a missed flag can never corrupt inventory.
--
-- ⚠️ APPLIED MANUALLY BY IT. Additive + idempotent. Depends on 0121
--    (fn_consume_fifo_batch, inventory_lots.batch_no, inventory_lot_consumptions)
--    and 0098 (purchase_order_items.so_item_id). Apply those first.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── 1. UI badge flag (additive, idempotent) ────────────────────────────────
ALTER TABLE delivery_orders
  ADD COLUMN IF NOT EXISTS is_dropship BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN delivery_orders.is_dropship IS
  'TRUE when any sofa line on this DO was shipped as a supplier-direct drop-ship: the warehouse had no received batch, so the OUT posted against the EXPECTED production batch (bound PO number) and stock went negative until the PO''s GRN arrives and nets it out. Drives the "Drop-ship · batch not received" UI badge ONLY — inventory reconciliation is ledger-driven (fn_reconcile_dropship_batch) and never reads this flag.';

-- ── 2. Receipt-time drop-ship reconcile (the crux) ─────────────────────────
-- For ONE (warehouse, product, variant, batch) bucket, consume the outstanding
-- drop-ship SHORTFALL from the batch's freshly-received open lots, ATTRIBUTING
-- the consumption to the drop-ship DO's own OUT movements so COGS flows through
-- the existing recost/restamp cascade (recost.ts → restampDoActualCost) exactly
-- like a normal short-ship that later receives stock.
--
-- LEDGER-DRIVEN + IDEMPOTENT — per-OUT-movement, not a global flag:
--   For each drop-ship OUT movement of this bucket+batch, its outstanding
--   shortfall = ABS(its qty) − Σ(consumptions already linked to it). We walk the
--   OUTs oldest-first and the open lots oldest-first (FIFO), consuming each OUT's
--   shortfall from the lots. A consumption row is written PER (lot × OUT) carrying
--   that OUT's movement_id + the OUT's DO source-doc, and the OUT movement's
--   total_cost_sen / unit_cost_sen is bumped by the consumed cost. A SECOND GRN
--   for the same batch finds every OUT's shortfall already 0 (its consumptions
--   now cover it) and consumes nothing.
--
-- Negative-balance posture preserved: never consumes more than the lots hold; an
-- OUT whose shortfall can't be fully covered stays partly short (its DO line cost
-- reflects only what was costed) and the NEXT batch GRN tops it up.
--
-- Returns the total qty consumed across all OUTs (0 when nothing outstanding).
CREATE OR REPLACE FUNCTION fn_reconcile_dropship_batch(
  p_warehouse_id  UUID,
  p_product_code  TEXT,
  p_variant_key   TEXT,
  p_batch_no      TEXT,
  p_created_by    UUID
) RETURNS INTEGER AS $$
DECLARE
  v_out         RECORD;
  v_lot         RECORD;
  v_already     INTEGER;
  v_short       INTEGER;   -- this OUT's outstanding (uncosted) qty
  v_take        INTEGER;
  v_consumed    INTEGER := 0;
BEGIN
  IF p_batch_no IS NULL THEN
    RETURN 0;
  END IF;

  -- Walk the drop-ship (batched, DO-sourced) OUT movements of this bucket+batch,
  -- oldest first, FOR UPDATE so a concurrent reconcile can't double-attribute.
  FOR v_out IN
    SELECT id, qty, source_doc_type, source_doc_id, source_doc_no
      FROM inventory_movements
     WHERE movement_type = 'OUT'
       AND warehouse_id  = p_warehouse_id
       AND product_code  = p_product_code
       AND COALESCE(variant_key, '') = COALESCE(p_variant_key, '')
       AND batch_no      = p_batch_no
     ORDER BY created_at ASC, id ASC
     FOR UPDATE
  LOOP
    -- How much of THIS OUT is still uncosted (no consumption linked yet)?
    SELECT COALESCE(SUM(qty_consumed), 0) INTO v_already
      FROM inventory_lot_consumptions
     WHERE movement_id = v_out.id;
    v_short := ABS(v_out.qty) - v_already;
    CONTINUE WHEN v_short <= 0;  -- already fully costed (e.g. a 2nd GRN, or normal ship)

    -- Consume this OUT's shortfall from the batch's open lots (FIFO).
    FOR v_lot IN
      SELECT id, qty_remaining, unit_cost_sen
        FROM inventory_lots
       WHERE warehouse_id = p_warehouse_id
         AND product_code = p_product_code
         AND COALESCE(variant_key, '') = COALESCE(p_variant_key, '')
         AND batch_no     = p_batch_no
         AND qty_remaining > 0
       ORDER BY received_at ASC, id ASC
       FOR UPDATE
    LOOP
      EXIT WHEN v_short <= 0;
      v_take := LEAST(v_lot.qty_remaining, v_short);

      UPDATE inventory_lots
         SET qty_remaining = qty_remaining - v_take
       WHERE id = v_lot.id;

      -- Consumption tagged with the DO's OUT movement + source doc, so the
      -- recost cascade re-derives this DO's COGS from it.
      INSERT INTO inventory_lot_consumptions (
        lot_id, warehouse_id, product_code, variant_key,
        qty_consumed, unit_cost_sen, total_cost_sen,
        source_doc_type, source_doc_id, source_doc_no, movement_id, created_by
      ) VALUES (
        v_lot.id, p_warehouse_id, p_product_code, p_variant_key,
        v_take, v_lot.unit_cost_sen, v_take * v_lot.unit_cost_sen,
        v_out.source_doc_type, v_out.source_doc_id, v_out.source_doc_no, v_out.id, p_created_by
      );

      v_short    := v_short - v_take;
      v_consumed := v_consumed + v_take;
    END LOOP;

    -- Re-stamp this OUT movement's cost from the SUM of its (now-written)
    -- consumptions, so total_cost_sen / unit_cost_sen reflect the real arriving
    -- lot cost — exactly what restampDoActualCost reads off the DO's OUT rows.
    UPDATE inventory_movements m
       SET total_cost_sen = sub.total_cost,
           unit_cost_sen  = CASE WHEN ABS(m.qty) > 0 THEN sub.total_cost / ABS(m.qty) ELSE 0 END
      FROM (
        SELECT COALESCE(SUM(total_cost_sen), 0) AS total_cost
          FROM inventory_lot_consumptions
         WHERE movement_id = v_out.id
      ) sub
     WHERE m.id = v_out.id;
  END LOOP;

  RETURN v_consumed;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_reconcile_dropship_batch(UUID, TEXT, TEXT, TEXT, UUID) IS
  'Receipt-time drop-ship reconcile (migration 0204). For ONE (warehouse, product, variant, batch) bucket, consumes each drop-ship OUT movement''s outstanding (uncosted) qty from the batch''s newly-received open lots (FIFO, at the lot''s real cost), writing inventory_lot_consumptions linked to that OUT''s movement_id + DO source-doc and re-stamping the OUT''s total/unit cost. Idempotent + ledger-driven: an OUT whose consumptions already cover its qty is skipped, so a second GRN consumes nothing. COGS flows through the existing recost.ts → restampDoActualCost cascade. Called from the GRN post path after the IN movements write; affected DO lines should be restamped after.';

COMMIT;
