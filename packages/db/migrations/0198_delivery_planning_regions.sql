-- ----------------------------------------------------------------------------
-- 0198 — Delivery Planning: CONFIG-DRIVEN, MULTI-SELECT region classification.
--
-- Until now the Delivery Planning board (apps/api/src/routes/delivery-planning.ts)
-- bucketed every order into 4 HARDCODED regions (KL / PENANG / EM / SG) via a
-- hardcoded stateToRegion(customer_state) function. The owner wants this to be
-- OWNER-MAINTAINED instead:
--   (a) a maintainable master list of delivery-planning REGIONS, and
--   (b) a per-STATE MULTI mapping of which region(s) a state's orders appear
--       under — one order can be in MULTIPLE regions. The key new case is
--       Singapore → [SG, KL]: SG orders ship from the KL/SLGR warehouse, so they
--       must surface under BOTH the SG tab and the KL tab.
--
-- HOW A STATE IS KEYED (important for the frontend multi-select):
--   A state's identity across this whole subsystem is its NAME (TEXT) — the same
--   value stored in mfg_sales_orders.customer_state, keyed in
--   state_warehouse_mappings.state, and listed in my_localities.state. Singapore
--   is represented as the state NAME 'Singapore' with country='Singapore'. So
--   state_delivery_regions.state_key = the state NAME, and a `country` column
--   disambiguates same-named states across countries.
--
-- This migration is ADDITIVE + idempotent (CREATE TABLE/INDEX IF NOT EXISTS,
-- guarded RLS policies, ON CONFLICT DO NOTHING seeds). It does NOT drop anything
-- and is safe to re-run. The seeded mappings reproduce the OLD hardcoded logic
-- exactly so existing behaviour is preserved once the route reads from config:
--   Pulau Pinang / Penang        → PENANG
--   Sabah / Sarawak / Labuan     → EM
--   all other MY states          → KL
--   Singapore                    → SG  AND  KL   (the new multi case)
--
-- Apply BEFORE deploying the delivery-planning route change that reads these
-- tables instead of the hardcoded stateToRegion (migrate-before-deploy). Until
-- applied + seeded, the route's fallback keeps the old default (state → KL).
-- ----------------------------------------------------------------------------

BEGIN;

-- ── 1. delivery_planning_regions — the owner-maintained region master ────────
-- The Delivery Planning board's tab row (the frontend prepends its own "All").
-- code is the stable key the route + seeds reference; name is the display label.
CREATE TABLE IF NOT EXISTS delivery_planning_regions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,                  -- 'KL' | 'PENANG' | 'EM' | 'SG' (owner-extensible)
  name        TEXT NOT NULL,                         -- display label, e.g. 'Penang'
  sort_order  INTEGER NOT NULL DEFAULT 0,            -- tab order (ascending)
  active      BOOLEAN NOT NULL DEFAULT true,         -- inactive = hidden from the tab row
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dp_regions_active ON delivery_planning_regions(active);

COMMENT ON TABLE delivery_planning_regions IS
  'Owner-maintained master of Delivery Planning region buckets (tabs). Replaces the hardcoded KL/PENANG/EM/SG region list in the delivery-planning route. code = stable key; name = label; sort_order = tab order; active = shown.';

-- ── 2. state_delivery_regions — per-STATE MULTI region mapping ───────────────
-- A state can map to SEVERAL regions, so one order surfaces under several tabs.
-- state_key = the state NAME (matches mfg_sales_orders.customer_state /
-- state_warehouse_mappings.state / my_localities.state). country disambiguates
-- (Singapore carries country='Singapore'). UNIQUE(state_key, country, region_id)
-- so the same (state,country)→region pair can't be added twice.
CREATE TABLE IF NOT EXISTS state_delivery_regions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_key   TEXT NOT NULL,                          -- the state NAME, e.g. 'Selangor' / 'Singapore'
  country     TEXT NOT NULL DEFAULT 'Malaysia',       -- disambiguates same-named states across countries
  region_id   UUID NOT NULL REFERENCES delivery_planning_regions(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (state_key, country, region_id)
);
CREATE INDEX IF NOT EXISTS idx_state_delivery_regions_state_key ON state_delivery_regions(state_key);
CREATE INDEX IF NOT EXISTS idx_state_delivery_regions_region_id ON state_delivery_regions(region_id);

COMMENT ON TABLE state_delivery_regions IS
  'Per-state MULTI mapping → which Delivery Planning region(s) a state''s orders appear under. state_key = state NAME (customer_state); country disambiguates (Singapore→country Singapore). A state can map to many regions (Singapore → SG AND KL).';

-- ── 3. RLS — authenticated staff read + write (matches state_warehouse_mappings / delivery_legs) ─
ALTER TABLE delivery_planning_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE state_delivery_regions    ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY dp_regions_staff_read  ON delivery_planning_regions FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY dp_regions_staff_write ON delivery_planning_regions FOR ALL    TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY state_dr_staff_read    ON state_delivery_regions    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY state_dr_staff_write   ON state_delivery_regions    FOR ALL    TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4. Seed the 4 current regions (idempotent) ───────────────────────────────
-- KL · Penang · EM · SG — exactly the buckets the hardcoded route used today.
INSERT INTO delivery_planning_regions (code, name, sort_order) VALUES
  ('KL',     'KL',     10),
  ('PENANG', 'Penang', 20),
  ('EM',     'EM',     30),
  ('SG',     'SG',     40)
ON CONFLICT (code) DO NOTHING;

-- ── 5. Seed the default per-state mappings (idempotent) ──────────────────────
-- Reproduces the OLD hardcoded stateToRegion logic so behaviour is preserved:
--   Pulau Pinang / Penang     → PENANG
--   Sabah / Sarawak / Labuan  → EM
--   every other MY state      → KL
--   Singapore                 → SG  AND  KL   (the new multi case)
-- The MY state NAMES below are the 16 distinct values seeded into my_localities
-- (seeds/my-localities.sql); Penang is stored there as 'Pulau Pinang'. 'Penang'
-- is ALSO seeded as a safety alias in case a customer_state was captured that
-- way. Region ids are resolved by code so the seed is order-independent.
-- region_id is taken from the just-seeded regions; the join keeps it idempotent
-- (ON CONFLICT on the UNIQUE(state_key, country, region_id) does nothing).

-- 5a. PENANG bucket — Penang state.
INSERT INTO state_delivery_regions (state_key, country, region_id)
SELECT v.state_key, 'Malaysia', r.id
FROM (VALUES ('Pulau Pinang'), ('Penang')) AS v(state_key)
CROSS JOIN delivery_planning_regions r
WHERE r.code = 'PENANG'
ON CONFLICT (state_key, country, region_id) DO NOTHING;

-- 5b. EM bucket — East Malaysia (Sabah / Sarawak / Labuan).
INSERT INTO state_delivery_regions (state_key, country, region_id)
SELECT v.state_key, 'Malaysia', r.id
FROM (VALUES ('Sabah'), ('Sarawak'), ('Labuan')) AS v(state_key)
CROSS JOIN delivery_planning_regions r
WHERE r.code = 'EM'
ON CONFLICT (state_key, country, region_id) DO NOTHING;

-- 5c. KL bucket — every OTHER Peninsular MY state (the old default).
INSERT INTO state_delivery_regions (state_key, country, region_id)
SELECT v.state_key, 'Malaysia', r.id
FROM (VALUES
  ('Johor'), ('Kedah'), ('Kelantan'), ('Kuala Lumpur'), ('Melaka'),
  ('Negeri Sembilan'), ('Pahang'), ('Perak'), ('Perlis'), ('Putrajaya'),
  ('Selangor'), ('Terengganu')
) AS v(state_key)
CROSS JOIN delivery_planning_regions r
WHERE r.code = 'KL'
ON CONFLICT (state_key, country, region_id) DO NOTHING;

-- 5d. Singapore → BOTH SG and KL (the key new MULTI case). country='Singapore'
--     so it never collides with a MY 'Singapore' row (there is none in MY).
INSERT INTO state_delivery_regions (state_key, country, region_id)
SELECT 'Singapore', 'Singapore', r.id
FROM delivery_planning_regions r
WHERE r.code IN ('SG', 'KL')
ON CONFLICT (state_key, country, region_id) DO NOTHING;

COMMIT;
