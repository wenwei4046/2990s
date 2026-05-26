-- ----------------------------------------------------------------------------
-- 0060 — Sales Order columns matching POS handover schema (PR #46).
--
-- Commander 2026-05-26: SO 不是 B2B 的，就是顾客的. POS handover collects
-- (Customer / Address / Emergency / Target date) — these must round-trip
-- into mfg_sales_orders so the backend SO list shows POS-origin orders.
--
-- Adds:
--   - email, customer_type ('NEW' | 'EXISTING')
--   - salesperson_id (FK staff) — replaces free-text 'agent' for the POS
--     case; existing 'agent' column kept for B2B manual entry
--   - city, postcode (separate, was crammed into address3/address4)
--   - building_type (Condo/Landed/Apartment/Office/Shop/Other) — was
--     reused via 'venue' column in PR #39; promoting to proper column
--   - emergency_contact_name / phone / relationship
--   - target_date (different from customer_delivery_date — this is the
--     POS-captured "target installation/use date", commander's term)
--
-- All additive. Existing data unaffected.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS email                            TEXT,
  ADD COLUMN IF NOT EXISTS customer_type                    TEXT,
  ADD COLUMN IF NOT EXISTS salesperson_id                   UUID REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS city                             TEXT,
  ADD COLUMN IF NOT EXISTS postcode                         TEXT,
  ADD COLUMN IF NOT EXISTS building_type                    TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_name           TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone          TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship   TEXT,
  ADD COLUMN IF NOT EXISTS target_date                      DATE;

CREATE INDEX IF NOT EXISTS idx_mfg_so_salesperson ON mfg_sales_orders(salesperson_id) WHERE salesperson_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mfg_so_target_date ON mfg_sales_orders(target_date)    WHERE target_date IS NOT NULL;

COMMIT;
