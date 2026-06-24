-- ----------------------------------------------------------------------------
-- 0191 — landed-cost allocation ("平摊"): fold a SERVICE-line charge (e.g.
-- TRANSPORTATION / freight) on a Goods Receipt Note into the FIFO lot cost of
-- its GOODS lines, so inventory carries the TRUE landed cost.
--
-- THE GAP THIS CLOSES
--   Migration 0190 converts each GRN goods line's price to MYR at the GRN rate
--   and books that as the FIFO lot cost. But a freight / transport charge the
--   owner adds as a SERVICE line (item_group='service', no supplier — a pure
--   description + amount, like the SO "charges") was NOT in the lot cost: the
--   inventory cost understated the real landed cost by the freight.
--
--   This adds an ALLOCATION of that charge pool across the goods lines, folded
--   into each line's per-unit MYR lot cost. The allocation BASIS is choosable:
--     · QTY   (default) — split by received quantity
--     · VALUE — split by goods value (qty × base unit MYR cost)
--     · CBM   — split by volume (qty × mfg_products.unit_m3_milli)
--
-- TWO COLUMNS
--   grns.allocation_method        — the chosen basis (enum, default 'QTY').
--   grn_items.allocated_charge_centi — the freight allocated to THIS goods line
--     (MYR sen), STORED so recost.ts can deterministically re-add it after a PI
--     recost re-derives the base goods cost. SERVICE lines store 0.
--
-- NO-OP GUARANTEE
--   A GRN with no SERVICE charge lines allocates 0 everywhere → the lot cost is
--   identical to 0190's. allocation_method defaults to 'QTY' and
--   allocated_charge_centi defaults to 0, so every existing GRN is byte-for-byte
--   unchanged.
--
-- Additive + idempotent — safe to re-run.
-- ----------------------------------------------------------------------------

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'charge_allocation_method') THEN
    CREATE TYPE charge_allocation_method AS ENUM ('QTY', 'VALUE', 'CBM');
  END IF;
END$$;

ALTER TABLE grns
  ADD COLUMN IF NOT EXISTS allocation_method charge_allocation_method NOT NULL DEFAULT 'QTY';

COMMENT ON COLUMN grns.allocation_method IS
  'Basis for allocating SERVICE-line (freight) charges across the GRN goods lines into the FIFO lot cost: QTY (default) | VALUE (qty × base MYR cost) | CBM (qty × unit_m3_milli). Migration 0191.';

ALTER TABLE grn_items
  ADD COLUMN IF NOT EXISTS allocated_charge_centi integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN grn_items.allocated_charge_centi IS
  'Freight/charge (MYR sen) allocated to THIS goods line at GRN-post (Σ over goods lines === the charge pool). Stored so recost re-adds it deterministically after a PI recost. SERVICE lines are 0. Migration 0191.';

COMMIT;
