-- 0150 — Structured reason code on stock movements.
--
-- Adds inventory_movements.reason_code so manual stock adjustments carry a
-- structured reason (DAMAGE / LOSS / THEFT / FOUND / COUNT / SAMPLE / WRITEOFF
-- / OTHER) instead of only free-text notes. Stock-take posting stamps COUNT.
-- The valid set is enforced in the API (single source of truth lives in
-- packages/shared/src/adjustment-reasons.ts); the column stays free TEXT so the
-- catalogue can evolve without a migration. Nullable — historical movements and
-- all non-ADJUSTMENT movements (IN/OUT) leave it NULL.

BEGIN;

ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS reason_code TEXT;

COMMENT ON COLUMN inventory_movements.reason_code IS
  'Structured adjustment reason for ADJUSTMENT movements (DAMAGE/LOSS/THEFT/FOUND/COUNT/SAMPLE/WRITEOFF/OTHER). Stock-take posts stamp COUNT. NULL for IN/OUT and legacy rows.';

COMMIT;
