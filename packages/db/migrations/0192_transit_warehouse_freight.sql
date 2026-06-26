-- ----------------------------------------------------------------------------
-- 0192 — TRANSIT warehouse + sea-FREIGHT cost uplift on stock transfers.
--
-- THE GAP THIS CLOSES
--   The owner's goods land in a CHINA warehouse, then ship by sea to Malaysia.
--   A stock transfer between warehouses is COST-NEUTRAL today: the IN lot opens
--   at the SOURCE lot's weighted-avg cost (stock-transfers.ts re-queries the OUT
--   movement's consumed cost and feeds it into the IN). The sea-freight the
--   owner pays a MY forwarder to ship China → MY was NOT in the lot cost, so MY
--   inventory understated the true landed cost by the freight.
--
--   This adds, mirroring the GRN landed-cost path (migration 0191 "平摊"):
--     · warehouses.is_transit              — flag the China/overseas warehouse.
--     · stock_transfers.freight_centi      — sea-freight (MYR sen — a MY forwarder
--                                            bill, already MYR, NO FX here).
--     · stock_transfers.allocation_method  — basis for splitting the freight pool
--                                            across the transfer lines (QTY|VALUE|CBM).
--     · stock_transfer_lines.allocated_charge_centi — freight allocated to THIS
--                                            line (MYR sen, Σ === freight pool),
--                                            STORED like grn_items.allocated_charge_centi.
--
--   stock-transfers.ts allocates freight_centi across the goods lines and folds
--   each line's per-unit share into the IN movement's unit_cost_sen, so the MY
--   destination lot opens at the TRUE landed cost.
--
-- NO-OP GUARANTEE
--   freight_centi defaults to 0 → allocation 0 everywhere → the IN lot cost is
--   identical to today's (source weighted-avg). allocation_method defaults to
--   'QTY' and allocated_charge_centi to 0, so every existing transfer is
--   byte-for-byte unchanged, and a no-freight transfer stays cost-neutral.
--
-- REUSE — the charge_allocation_method enum already exists from migration 0191
-- (GRN landed cost). Guard, do NOT recreate it.
--
-- Additive + idempotent — safe to re-run.
-- ----------------------------------------------------------------------------

BEGIN;

-- charge_allocation_method enum: created by 0191. Guard so this migration is
-- self-contained + safe to run even if 0191 hasn't (idempotent either way).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'charge_allocation_method') THEN
    CREATE TYPE charge_allocation_method AS ENUM ('QTY', 'VALUE', 'CBM');
  END IF;
END$$;

-- 1) Transit flag on the warehouse (the China/overseas landing warehouse).
ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS is_transit BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN warehouses.is_transit IS
  'Marks an overseas / in-transit warehouse (e.g. the China landing warehouse). A stock transfer OUT of a transit warehouse can carry a sea-freight cost uplift onto the receiving (MY) lot. Migration 0192.';

-- 2) Sea-freight pool + allocation basis on the transfer header.
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS freight_centi integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN stock_transfers.freight_centi IS
  'Sea-freight (MYR sen) paid to ship this transfer (e.g. China → MY). A MY forwarder bill — already MYR, NO FX. Pooled + allocated across the lines into each receiving lot''s cost. 0 ⇒ cost-neutral transfer (no uplift). Migration 0192.';

ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS allocation_method charge_allocation_method NOT NULL DEFAULT 'QTY';

COMMENT ON COLUMN stock_transfers.allocation_method IS
  'Basis for allocating freight_centi across the transfer lines into the receiving lot cost: QTY (default) | VALUE (qty × source unit cost) | CBM (qty × unit_m3_milli). Mirrors grns.allocation_method. Migration 0192.';

-- 3) Per-line stored allocation (like grn_items.allocated_charge_centi).
ALTER TABLE stock_transfer_lines
  ADD COLUMN IF NOT EXISTS allocated_charge_centi integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN stock_transfer_lines.allocated_charge_centi IS
  'Sea-freight (MYR sen) allocated to THIS line at transfer-post (Σ over lines === freight_centi). Folded per-unit into the IN movement unit_cost_sen so the MY lot carries the landed cost. 0 ⇒ no uplift. Migration 0192.';

COMMIT;
