-- ----------------------------------------------------------------------------
-- 0107 — Delivery Return cancel status.
--
-- A Delivery Return (DR) puts goods BACK into stock the moment it is created
-- (status starts at RECEIVED; see apps/api/src/routes/delivery-returns.ts). The
-- DR detail page / cancel path can flip a DR to CANCELLED, which reverses that
-- inventory IN (writes a balancing OUT via reverseMovements). But the
-- delivery_return_status enum never had a 'CANCELLED' label, so the cancel write
-- hit a Postgres "invalid input value for enum" error at runtime. This adds the
-- missing label so the cancel handler can set it.
--
-- IMPORTANT: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block
-- that subsequently USES the new value, so this migration is deliberately NOT
-- wrapped in BEGIN/COMMIT. It contains ONLY the ALTER TYPE statement. Postgres
-- 12+ allows ADD VALUE outside an explicit txn; the migration runner must apply
-- this file in autocommit mode (no surrounding BEGIN). Mirrors 0105_grn_cancel_status.sql.
-- ----------------------------------------------------------------------------

ALTER TYPE delivery_return_status ADD VALUE IF NOT EXISTS 'CANCELLED';
