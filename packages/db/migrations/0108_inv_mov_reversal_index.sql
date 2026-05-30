-- ----------------------------------------------------------------------------
-- 0108 — Allow inventory reversal rows for DO / DR (Commander 2026-05-30).
--
-- The DO/DR idempotency indexes (uq_inv_mov_do_source migration 0100,
-- uq_inv_mov_dr_source migration 0102) key on
--   (source_doc_type, source_doc_id, product_code, variant_key)
-- WITHOUT movement_type. That made them double-deduct backstops — but it also
-- BLOCKS a cancel-reversal: reverseMovements() writes the OPPOSITE-direction
-- row (OUT→IN for DO, IN→OUT for DR) with the SAME doc + product + variant key,
-- which collides with the original row and never lands. So "cancel a DO →
-- goods go back to stock" (and the DR equivalent) silently did nothing.
--
-- Fix: add movement_type to the unique key. Now:
--   • original OUT (DO, id, OUT, product, variant)  — unique; re-dispatch of the
--     same OUT still collides → still idempotent (no double-deduction).
--   • reversal  IN  (DO, id, IN,  product, variant)  — allowed (different
--     movement_type) → the cancel reversal lands.
--   • a SECOND reversal IN collides → double-reversal is still prevented.
-- Mirror for DR. Every existing row satisfies the wider key (the old key was
-- stricter), so the CREATE UNIQUE INDEX cannot fail on current data.
-- ----------------------------------------------------------------------------

BEGIN;

DROP INDEX IF EXISTS uq_inv_mov_do_source;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_mov_do_source
  ON inventory_movements (source_doc_type, source_doc_id, movement_type, product_code, variant_key)
  WHERE source_doc_type = 'DO';

DROP INDEX IF EXISTS uq_inv_mov_dr_source;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_mov_dr_source
  ON inventory_movements (source_doc_type, source_doc_id, movement_type, product_code, variant_key)
  WHERE source_doc_type = 'DR';

COMMIT;
