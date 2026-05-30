-- ----------------------------------------------------------------------------
-- 0110 — Consignment-note cancel + consumption-tracking unification.
--
-- Brings the Consignment module up to the unified state-machine that GRN / PI /
-- PR / DO / DR already follow (Tier 1+2 work). Two things were missing:
--   1. There is no way to UNPOST a consignment note → its inventory movement
--      stays permanent forever (signed_at flips only forward).
--   2. There is no edit-lock on a consignment header once notes have posted —
--      header edits could silently desync the receipt audit.
--
-- This migration adds the SMALLEST DB change that lets the API close both
-- holes; everything else (consumption guard, lock guard, cancel endpoint) is
-- pure handler-level code on top of columns that already exist.
--
-- WHAT'S ALREADY HERE (verified against schema.ts + 0042/0050):
--   consignment_order_items.qty_placed   integer NOT NULL          (0042)
--   consignment_order_items.qty_sold     integer NOT NULL DEFAULT 0 (0042)
--   consignment_order_items.qty_returned integer NOT NULL DEFAULT 0 (0042)
--   consignment_order_items.qty_damaged  integer NOT NULL DEFAULT 0 (0042)
--   consignment_notes.warehouse_id       UUID                       (0050)
--   consignment_notes.signed_at          timestamptz                (0042)
-- The four qty_* counters give us enough state for the OUT cap (Σ posted OUT
-- note qty ≤ qty_placed) and the RETURN cap (qty_returned + new ≤ qty_placed
-- − qty_sold − qty_damaged) — no new counter column needed.
--
-- WHAT WE'RE ADDING:
--   consignment_notes.cancelled_at timestamptz   (NULL = active / posted; not
--     NULL = unposted). The cancel endpoint sets this; the consumption-guard,
--     edit-lock guard, has_children flag, and reverseMovements idempotency all
--     filter on `cancelled_at IS NULL`. Mirrors the existing "no enum churn"
--     style of 0107 — we DON'T add a new consignment_note_type value.
--
-- ADDITIVE + non-destructive. House style of 0101 / 0106 (ADD COLUMN IF NOT
-- EXISTS, nullable). No RLS changes (consignment_notes already carries policies
-- from 0042). No new enum value (cancel uses the cancelled_at sentinel).
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE consignment_notes
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Idempotency-friendly lookup: the cancel handler + has_children probe both
-- filter on cancelled_at IS NULL, often joined with consignment_order_id.
CREATE INDEX IF NOT EXISTS idx_cn_cancelled
  ON consignment_notes (consignment_order_id)
  WHERE cancelled_at IS NULL;

COMMIT;
