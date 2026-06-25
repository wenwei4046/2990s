-- ----------------------------------------------------------------------------
-- 0197 — Delivery Planning: the remaining HC delivery-sheet raw-data fields.
--
-- 0195/0196 laid the Delivery Planning + TMS foundation (region buckets, legs,
-- crew, trips). The planning board already surfaces most HC columns (address,
-- postcode, property type, dates, stock, crew, balance) but a handful of HC
-- raw-data fields were never captured on 2990. This migration adds them so the
-- board can show the FULL HC column set — split by where the data is owned:
--
--   • SO-CONTEXT fields live on mfg_sales_orders — they describe the ORDER /
--     customer situation, known when the SO is taken (possession date, new
--     house vs replacement, what's being disposed, referral source).
--   • DO-EXECUTION fields live on delivery_orders — they describe the actual
--     DELIVERY run / shipout, filled as the goods move (the time window, the
--     arrival/departure clock, the EM/SG shipout + port ref + the HC "Remark 4"
--     delivery sub-status, the date the customer actually received).
--
-- ALL columns are nullable with NO behaviour-changing default — purely additive
-- raw-data capture. The status-like fields (house_type, delivery_substatus) are
-- TEXT (NOT enums) on purpose: the HC sheet's vocabulary still shifts, so we
-- keep them free-text + whitelist the known values in the app, not the DB.
--
-- Additive + idempotent — safe to re-run (ADD COLUMN IF NOT EXISTS). No enums,
-- no data backfill, no trigger. Whole file is transactional.
--
-- Apply BEFORE deploying the delivery-planning route changes that SELECT / PATCH
-- these columns (migrate-before-deploy).
-- ----------------------------------------------------------------------------

BEGIN;

-- ── 1. SO-CONTEXT fields on mfg_sales_orders ─────────────────────────────────
-- Known at order time; describe the customer's house situation + referral.
ALTER TABLE mfg_sales_orders ADD COLUMN IF NOT EXISTS possession_date       DATE;
ALTER TABLE mfg_sales_orders ADD COLUMN IF NOT EXISTS house_type            TEXT;
ALTER TABLE mfg_sales_orders ADD COLUMN IF NOT EXISTS replacement_disposal  TEXT;
ALTER TABLE mfg_sales_orders ADD COLUMN IF NOT EXISTS referral              TEXT;

COMMENT ON COLUMN mfg_sales_orders.possession_date IS
  'HC: date the customer takes possession of the house (the earliest the goods can go in). Nullable.';
COMMENT ON COLUMN mfg_sales_orders.house_type IS
  'HC: "New House" vs "Replacement" (TEXT, not an enum — HC vocabulary still shifts; whitelisted in the app).';
COMMENT ON COLUMN mfg_sales_orders.replacement_disposal IS
  'HC: when house_type = Replacement, what is being disposed / how the old furniture is handled. Free text.';
COMMENT ON COLUMN mfg_sales_orders.referral IS
  'HC: referral source (who referred this customer / which channel). Free text.';

-- ── 2. DO-EXECUTION fields on delivery_orders ────────────────────────────────
-- Filled as the delivery run / shipout happens. time_range = the booked window,
-- time_confirmed = the customer has confirmed it; arrival/departure = the clock
-- on the day; shipout_date / customer_delivered_date / eta_arriving_port serve
-- the EM/SG cross-border legs; delivery_substatus = the HC "Remark 4" status.
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS time_range              TEXT;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS time_confirmed          BOOLEAN;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS arrival_at              TIMESTAMPTZ;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS departure_at            TIMESTAMPTZ;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS shipout_date            DATE;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS customer_delivered_date DATE;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS eta_arriving_port       TEXT;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS delivery_substatus      TEXT;

COMMENT ON COLUMN delivery_orders.time_range IS
  'HC: the booked delivery time window for the day, e.g. "10am-12pm" / "2-4pm". Free text.';
COMMENT ON COLUMN delivery_orders.time_confirmed IS
  'HC: true once the customer has confirmed the time_range window. Nullable (unknown until set).';
COMMENT ON COLUMN delivery_orders.arrival_at IS
  'HC: timestamp the crew ARRIVED at the customer on the day (clock-in at the door).';
COMMENT ON COLUMN delivery_orders.departure_at IS
  'HC: timestamp the crew LEFT the customer (job done). arrival→departure = on-site time.';
COMMENT ON COLUMN delivery_orders.shipout_date IS
  'HC (EM/SG): date the goods were shipped out from the MY warehouse toward East Malaysia / Singapore.';
COMMENT ON COLUMN delivery_orders.customer_delivered_date IS
  'HC: date the customer ACTUALLY received the goods (the true delivered date, vs the planned customer_delivery_date).';
COMMENT ON COLUMN delivery_orders.eta_arriving_port IS
  'HC (EM/SG): the port / shipment reference for the cross-border leg, e.g. "KUC3012008". Free text (holds the ref, not a date).';
COMMENT ON COLUMN delivery_orders.delivery_substatus IS
  'HC "Remark 4" delivery sub-status (TEXT, not an enum): Pending Pickup / Done Shipout / Arrives EM Warehouse / Done Delivered / Confirm / House Not Ready / Request Hold. Whitelisted in the app.';

COMMIT;
