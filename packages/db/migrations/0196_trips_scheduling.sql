-- ----------------------------------------------------------------------------
-- 0196 — Trips scheduling layer (Delivery / TMS Stage 5A).
--
-- 0195 laid the foundation (delivery_legs with a nullable trip_id but NO FK yet,
-- delivery_order_crew, the lorries/helpers masters, mfg_sales_orders.
-- delivery_state). This migration adds the TRIPS HEADER that the scheduling
-- layer hangs off, the per-stop rows that link a DO/SO into a trip, and the
-- lorry-unavailability calendar — the data foundation the Stage 5B "Lorry
-- Capacity" performance dashboard aggregates (revenue per trip, stops per lorry,
-- in-house vs outsourced, repair days from lorry_maintenance).
--
-- Modelled on Houzs's trips/trip_stops (003_trips_and_planner.sql) +
-- lorry_maintenance (005_fleet_management.sql) — ADAPTED to 2990 Postgres
-- conventions (UUID PKs gen_random_uuid(), centi money as BIGINT integers,
-- enums via the DO $$ ... duplicate_object guard, guarded RLS authenticated
-- read+write, references staff(id)). The D1 SQLite shapes (INTEGER AUTOINCREMENT
-- PKs, TEXT dates, REAL money, CHECK-constraint pseudo-enums, GPS/odometer/fuel
-- columns) are NOT copied — 2990 is a furniture RETAILER, not a fleet tracker.
--
--   1. enums: trip_type, trip_status, trip_stop_type.
--   2. trips — one trip = one lorry + driver(+helpers) + date + origin warehouse
--      (region). is_outsourced derives from the lorry's is_internal at create
--      time (set by the route). trip_no is a human doc number minted server-side
--      (TRIP-YYMM-NNN), like every other 2990 document.
--   3. trip_stops — the ordered stops on a trip; each links a DO (or an SO) with
--      a stop_type and the delivery value attributable to that stop
--      (revenue_centi, BIGINT cents — feeds the dashboard's revenue-per-trip).
--   4. lorry_maintenance — a lorry's unavailable_from/to windows (repair days).
--   5. wire the delivery_legs.trip_id FK (0195 left it a bare uuid, NO FK, on
--      purpose — "wire the FK in the migration that creates trips"). Guarded:
--      added only if not already present. ON DELETE SET NULL so deleting a trip
--      orphans its legs back to unplanned rather than cascading them away.
--
-- Additive + idempotent — safe to re-run (guarded enum/policy/constraint creates,
-- CREATE TABLE/INDEX IF NOT EXISTS).
--
-- NOTE: all enum CREATEs here are fresh (no ALTER TYPE ADD VALUE), so the whole
-- file is transactional — it runs inside the BEGIN block.
-- Apply this migration BEFORE deploying the /trips route (migrate-before-deploy).
-- ----------------------------------------------------------------------------

BEGIN;

-- ── 1. enums ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE trip_type AS ENUM ('DELIVERY', 'SETUP', 'DISMANTLE', 'SG', 'MIXED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE trip_status AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE trip_stop_type AS ENUM ('DELIVERY', 'PICKUP', 'SERVICE', 'SETUP', 'DISMANTLE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. trips — the scheduling header ─────────────────────────────────────────
-- One trip = one lorry + a primary driver (+ up to 2 helpers) leaving an origin
-- warehouse (the region) on a date, carrying an ordered list of stops. The DO's
-- existing per-DO crew (delivery_order_crew, 0195) is the crew assigned to a cut
-- DO; a trip groups several DOs/SOs onto one lorry-day for the planning board.
CREATE TABLE IF NOT EXISTS trips (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_no            TEXT NOT NULL UNIQUE,                 -- 'TRIP-2606-001' (human, server-minted)
  trip_date          DATE NOT NULL,
  lorry_id           UUID REFERENCES lorries(id)     ON DELETE SET NULL,
  driver_id          UUID REFERENCES drivers(id)     ON DELETE SET NULL,  -- primary driver
  helper_1_id        UUID REFERENCES helpers(id)     ON DELETE SET NULL,
  helper_2_id        UUID REFERENCES helpers(id)     ON DELETE SET NULL,
  warehouse_id       UUID REFERENCES warehouses(id)  ON DELETE SET NULL,  -- origin/region
  trip_type          trip_type   NOT NULL DEFAULT 'DELIVERY',
  status             trip_status NOT NULL DEFAULT 'PLANNED',
  -- true = outsourced lorry, false = in-house. Derived from lorries.is_internal
  -- at create time by the route (is_outsourced = NOT is_internal); the column is
  -- the at-trip-time snapshot so a later master flip doesn't rewrite history.
  is_outsourced      BOOLEAN NOT NULL DEFAULT false,
  clock_in_at        TIMESTAMPTZ,                          -- driver clock-in (nullable until started)
  clock_out_at       TIMESTAMPTZ,                          -- driver clock-out (nullable until done)
  total_distance_km  NUMERIC(10,2),                        -- optional odometer/route distance
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES staff(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trips_date      ON trips(trip_date);
CREATE INDEX IF NOT EXISTS idx_trips_lorry     ON trips(lorry_id);
CREATE INDEX IF NOT EXISTS idx_trips_driver    ON trips(driver_id);
CREATE INDEX IF NOT EXISTS idx_trips_warehouse ON trips(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_trips_status    ON trips(status);

COMMENT ON TABLE trips IS
  'A scheduled lorry-day: one lorry + primary driver (+ up to 2 helpers) leaving an origin warehouse on a date, carrying ordered trip_stops. Feeds the Stage 5B Lorry Capacity dashboard (revenue per trip, stops/lorry, in-house vs outsourced).';
COMMENT ON COLUMN trips.is_outsourced IS
  'true = outsourced lorry, false = in-house. Snapshot of NOT lorries.is_internal at create time; drives the In-house vs Outsource performance split.';
COMMENT ON COLUMN trips.trip_no IS
  'Human doc number TRIP-YYMM-NNN, minted server-side via nextMonthlyDocNo (max+1, never count+1).';

-- ── 3. trip_stops — ordered stops on a trip ──────────────────────────────────
-- Each stop links a DO (or, before a DO is cut, an SO) with a stop_type and the
-- delivery value attributable to that stop (revenue_centi). do_id / so_id carry
-- NO cross-type FK to the SO (its PK is doc_no TEXT, not a uuid) — so_id is a
-- nullable uuid mirroring delivery_legs.source_id; the app links by DO when one
-- exists. do_id DOES FK delivery_orders so a deleted DO drops its stop link.
CREATE TABLE IF NOT EXISTS trip_stops (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  stop_no        INTEGER NOT NULL DEFAULT 1,            -- ordering of stops on the trip (1 = first)
  stop_type      trip_stop_type NOT NULL DEFAULT 'DELIVERY',
  do_id          UUID REFERENCES delivery_orders(id) ON DELETE SET NULL,  -- the cut DO (nullable)
  so_id          UUID,                                 -- mfg_sales_orders link (nullable; no FK — SO PK is doc_no TEXT)
  customer_name  TEXT,                                 -- snapshot for the stop list / printout
  address        TEXT,                                 -- snapshot delivery address
  revenue_centi  BIGINT NOT NULL DEFAULT 0,            -- delivery value attributable to this stop (cents)
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trip_stops_trip ON trip_stops(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_stops_do   ON trip_stops(do_id);

COMMENT ON TABLE trip_stops IS
  'Ordered stops on a trip. Each links a DO (do_id) or an SO (so_id) with a stop_type and the delivery value attributable to the stop (revenue_centi, cents). Σ revenue_centi per trip = the trip revenue the dashboard aggregates.';
COMMENT ON COLUMN trip_stops.revenue_centi IS
  'Delivery value attributable to this stop, in cents (BIGINT). Sourced from the DO/SO local_total_centi at scheduling time; Σ per trip = trip revenue.';

-- ── 4. lorry_maintenance — unavailability windows (repair days) ──────────────
-- A lorry is out of service from unavailable_from to unavailable_to. The Stage
-- 5B dashboard counts the overlapping days as repair_days when computing a
-- lorry's available capacity for a period.
CREATE TABLE IF NOT EXISTS lorry_maintenance (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lorry_id          UUID NOT NULL REFERENCES lorries(id) ON DELETE CASCADE,
  unavailable_from  DATE NOT NULL,
  unavailable_to    DATE NOT NULL,
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES staff(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_lorry_maint_lorry   ON lorry_maintenance(lorry_id);
CREATE INDEX IF NOT EXISTS idx_lorry_maint_dates   ON lorry_maintenance(unavailable_from, unavailable_to);

COMMENT ON TABLE lorry_maintenance IS
  'Lorry unavailability windows (repair / servicing). The Lorry Capacity dashboard counts overlapping days as repair_days when sizing a lorry''s available capacity for a period.';

-- ── 5. wire delivery_legs.trip_id → trips(id) (0195 left it FK-less) ─────────
-- 0195 created delivery_legs.trip_id as a bare uuid with NO FK so it would not
-- depend on a trips table existing. Now that trips exists, add the FK. Guarded:
-- only if a FK on delivery_legs.trip_id is not already present. ON DELETE SET
-- NULL so deleting a trip orphans its legs back to unplanned (does NOT delete
-- the legs / their orders).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.table_schema   = ccu.table_schema
    WHERE tc.table_name      = 'delivery_legs'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name     = 'trips'
  ) THEN
    ALTER TABLE delivery_legs
      ADD CONSTRAINT delivery_legs_trip_id_fkey
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 6. RLS — authenticated staff read + write (mirror 0195's policy blocks) ──
ALTER TABLE trips             ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_stops        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lorry_maintenance ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY trips_staff_read   ON trips             FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY trips_staff_write  ON trips             FOR ALL    TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY trip_stops_staff_read  ON trip_stops    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY trip_stops_staff_write ON trip_stops    FOR ALL    TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY lorry_maint_staff_read  ON lorry_maintenance FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY lorry_maint_staff_write ON lorry_maintenance FOR ALL    TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
