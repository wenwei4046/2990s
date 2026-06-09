-- ----------------------------------------------------------------------------
-- 0162 — Fix stock-take creation 500 (status CHECK constraint blocks 'OPEN').
--        (Claude 2026-06-09 — found live: every New Stock Take POST → 500)
--
-- THE BUG
--   Creating a stock take fails on prod with:
--     new row for relation "stock_takes" violates check constraint
--     "stock_takes_status_check"
--   Root cause is a naming mismatch between two migrations:
--     • 0073 created the status check INLINE in CREATE TABLE:
--         CHECK (status IN ('DRAFT','POSTED','CANCELLED'))
--       With no explicit name, Postgres auto-named it
--       stock_takes_status_check  (…_check).
--     • 0078 (DRAFT→OPEN rename) tried to swap it with:
--         DROP CONSTRAINT IF EXISTS stock_takes_status_chk   (…_chk)
--         ADD  CONSTRAINT stock_takes_status_chk CHECK (… 'OPEN' …)
--       The DROP targeted the WRONG name (_chk, not _check), so the original
--       _check constraint — which still forbids 'OPEN' — was never removed.
--   The API inserts status='OPEN' (0078 renamed the working state DRAFT→OPEN),
--   so every create violates the stale _check constraint. Stock takes have been
--   un-creatable on this database (0 rows exist, so the breakage was latent
--   until now). This also blocks the new POSTED-undo (/reverse) path, which
--   can't be exercised without a postable take.
--
-- THE FIX
--   Drop BOTH possible constraint names and re-add a single correct one that
--   allows OPEN/POSTED/CANCELLED, and set the column default to OPEN. Idempotent
--   and safe to re-run; the table is empty so no row can violate the new check.
--
-- ⚠️ APPLIED MANUALLY. Pure constraint swap — no data migration, no table DDL.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE stock_takes DROP CONSTRAINT IF EXISTS stock_takes_status_check;
ALTER TABLE stock_takes DROP CONSTRAINT IF EXISTS stock_takes_status_chk;

ALTER TABLE stock_takes
  ADD CONSTRAINT stock_takes_status_chk
      CHECK (status IN ('OPEN', 'POSTED', 'CANCELLED'));

ALTER TABLE stock_takes ALTER COLUMN status SET DEFAULT 'OPEN';

COMMIT;
