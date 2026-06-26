-- ----------------------------------------------------------------------------
-- 0190 — multi-currency INVENTORY COST (landed-cost core, option A): an exchange
-- rate on the Goods Receipt Note so a foreign-currency receipt (RMB / USD / SGD)
-- records its FIFO lot cost in MYR.
--
-- THE GAP THIS CLOSES
--   Migration 0188 put an exchange_rate on the Purchase Invoice so a foreign PI
--   converts to MYR at GL-POST time (AP journal entry). But the INVENTORY lot
--   cost was still booked at the raw foreign PO price (un-converted): a RMB GRN
--   opened a FIFO lot whose unit_cost_sen was the RMB number treated as if it
--   were MYR → wrong COGS + wrong margin the moment that stock shipped.
--
--   Owner's model (option A): the PO stays PURE FOREIGN (no MYR on it). The
--   conversion to MYR happens at GRN/PI: the user enters an EXCHANGE RATE on the
--   GRN → the inventory IN movement's unit_cost_sen is recorded in MYR
--   (foreign_price × rate) → the FIFO trigger inherits MYR onto the lot. The PI
--   recost later OVERWRITES the lot with the authoritative PI line price × the
--   PI's own 0188 rate (also MYR). Each path converts EXACTLY once.
--
-- DEFINITION (identical shape to 0188): exchange_rate = MYR per 1 unit of the
-- GRN's currency (e.g. RMB→MYR ≈ 0.62). MYR receipts keep rate = 1, so their
-- lot cost / COGS / margin are byte-for-byte unchanged.
--   unit_cost_sen_myr = round(unit_price_centi_foreign * exchange_rate)
--
-- currency already exists on grns (migration 0101, same currency_code enum as
-- purchase_orders); we only add exchange_rate here. The GRN's currency is copied
-- from its source PO at create time so the receiver knows it's RMB.
--
-- Additive + idempotent — safe to re-run.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE grns
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(14,6) NOT NULL DEFAULT 1;

COMMENT ON COLUMN grns.exchange_rate IS
  'MYR per 1 unit of the GRN currency (1 for MYR); converts the inventory IN unit cost (FIFO lot) to MYR at receive time. Mirrors purchase_invoices.exchange_rate (migration 0188).';

COMMIT;
