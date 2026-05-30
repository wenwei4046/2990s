-- ----------------------------------------------------------------------------
-- 0109 — Relax DO/DR inventory indexes for per-line re-sync (Commander 2026-05-30).
--
-- After 0108 the partial UNIQUE indexes uq_inv_mov_do_source /
-- uq_inv_mov_dr_source key on
--   (source_doc_type, source_doc_id, movement_type, product_code, variant_key)
-- so a cancel-reversal IN can coexist with the original OUT. That fixed the
-- whole-doc cancel.
--
-- But TASK #24 — re-syncing inventory when a SHIPPED DO line's qty is edited or
-- the line is deleted — needs MULTIPLE delta movements per bucket over time:
--
--   • increase a line qty 3 → 5 → write +2 OUT for the same (DO, product, variant)
--   • decrease a line qty 3 → 1 → write +2 IN  for the same (DO, product, variant)
--   • a SECOND edit on the same bucket → write yet another delta movement
--
-- The FIFO trigger (migration 0053) fires only on AFTER INSERT, so updating
-- an existing row's qty leaves the lot/consumption ledger stale → corruption.
-- The clean pattern is per-edit delta INSERTS, but the UNIQUE indexes above
-- block more than one row per (doc, type, product, variant) bucket.
--
-- The original purpose of the UNIQUE constraint was a backstop against
-- deductInventoryForDo double-deducting. That helper already has a code-level
-- existence check ("does any OUT row exist for this DO? → skip") which is the
-- real idempotency guard. The UNIQUE was belt-and-suspenders.
--
-- Fix: replace the partial UNIQUE indexes with non-unique partial indexes
-- (same column set) so equality lookups stay fast, but multiple delta movements
-- per bucket are allowed. Cancel-reversal (reverseMovements) stays idempotent
-- via its own signed-net check; double-deduction stays blocked via the
-- application-side existence guard.
--
-- Every existing row still satisfies the new index (no UNIQUE to violate), so
-- DROP/CREATE is safe on current data.
-- ----------------------------------------------------------------------------

BEGIN;

DROP INDEX IF EXISTS uq_inv_mov_do_source;
CREATE INDEX IF NOT EXISTS ix_inv_mov_do_source
  ON inventory_movements (source_doc_type, source_doc_id, movement_type, product_code, variant_key)
  WHERE source_doc_type = 'DO';

DROP INDEX IF EXISTS uq_inv_mov_dr_source;
CREATE INDEX IF NOT EXISTS ix_inv_mov_dr_source
  ON inventory_movements (source_doc_type, source_doc_id, movement_type, product_code, variant_key)
  WHERE source_doc_type = 'DR';

COMMIT;
