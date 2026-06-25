-- ----------------------------------------------------------------------------
-- 0195 — Delivery Planning + Driver/Helper/Lorry TMS foundation.
--
-- Modelled on Houzs's TMS (drivers/helpers as `users` filtered by role,
-- `lorries.is_internal` for in-house vs outsourced, `trips`+`trip_stops` for the
-- per-stop delivery/pickup/setup/dismantle/service kinds that feed the "Lorry
-- Capacity" dashboard). 2990 differs: it already has a `drivers` MASTER (uuid,
-- driver_code/name/phone/ic_number/vehicle/active) and a manufacturing
-- `delivery_orders` (DO) that already carries `driver_id`/`driver_name`/`vehicle`.
-- This migration adds ONLY the missing foundation:
--
--   1. A `delivery_state` planning flag on BOTH mfg_sales_orders and
--      delivery_orders (PENDING_DELIVERY / PENDING_SCHEDULE / OVERDUE /
--      DELIVERED). Nullable + default NULL — only set once a doc enters the
--      delivery-planning pipeline; an unplanned SO/DO reads NULL.
--   2. `delivery_legs` — one order can appear in MULTIPLE region trips on
--      different dates (e.g. KL transit leg then Penang final leg), so a leg is
--      (source doc) × (warehouse/region) × (date) × optional trip, with a
--      transit|final kind.
--   3. Fleet master parity with Houzs: extend `drivers` (in_house/ic/contact —
--      ic already exists, add in_house) and add NEW `helpers` + `lorries`
--      masters (2990 had NEITHER). `lorries.is_internal` mirrors Houzs so the
--      All / In-house / Outsourced fleet filter + In-house checkbox work.
--   4. `delivery_order_crew` — the per-DO assignment (driver_1/2, helper_1/2,
--      lorry) WITH a name/ic/contact/plate SNAPSHOT at assign time (so the DO
--      keeps what was true on the day even if the master later changes — the
--      same denormalised-snapshot pattern the DO already uses for driver_name).
--
-- SCOPE: schema foundation only. No routes, no UI, no backfill, no trip-header
-- table yet (a `trips` header can come later; `delivery_legs.trip_id` is left a
-- nullable plain uuid with NO FK so this migration does not depend on a trips
-- table existing — wire the FK in the migration that creates `trips`).
--
-- delivery_state is DERIVED by the app, not a trigger here (it depends on line
-- stock_status PENDING/READY + customer_delivery_date/internal_expected_dd which
-- live across header+line+today's date — computed in the planning route).
--
-- Additive + idempotent — safe to re-run (ADD VALUE IF NOT EXISTS, ADD COLUMN
-- IF NOT EXISTS, CREATE TABLE/INDEX IF NOT EXISTS, guarded enum/policy creates).
--
-- NOTE: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction, so the enum
-- VALUE adds in §0 run FIRST, bare (auto-committing), BEFORE the BEGIN. Apply
-- this migration BEFORE deploying any code that writes a delivery_state value
-- (migrate-before-deploy).
-- ----------------------------------------------------------------------------

-- ── 0. delivery_state ENUM — created + seeded OUTSIDE any transaction ────────
-- (A fresh CREATE TYPE is transactional, but we want the ADD VALUEs below to be
-- idempotent on re-run too, and ALTER TYPE ADD VALUE cannot live in a txn — so
-- the whole enum lifecycle stays out of the BEGIN block.)
DO $$ BEGIN
  CREATE TYPE delivery_state AS ENUM
    ('PENDING_DELIVERY', 'PENDING_SCHEDULE', 'OVERDUE', 'DELIVERED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Re-run safety: if the type pre-existed missing a value, top it up.
ALTER TYPE delivery_state ADD VALUE IF NOT EXISTS 'PENDING_DELIVERY';
ALTER TYPE delivery_state ADD VALUE IF NOT EXISTS 'PENDING_SCHEDULE';
ALTER TYPE delivery_state ADD VALUE IF NOT EXISTS 'OVERDUE';
ALTER TYPE delivery_state ADD VALUE IF NOT EXISTS 'DELIVERED';

-- ── lorry_type ENUM (mirrors Houzs lorries.size 17ft/21ft/outsource) ─────────
DO $$ BEGIN
  CREATE TYPE lorry_type AS ENUM ('LORRY_10FT', 'LORRY_14FT', 'LORRY_17FT', 'LORRY_21FT', 'VAN', 'OUTSOURCE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── delivery_leg_kind ENUM (transit hop vs final last-mile) ──────────────────
DO $$ BEGIN
  CREATE TYPE delivery_leg_kind AS ENUM ('transit', 'final');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── delivery_leg_source ENUM (a leg can hang off an SO or a DO) ──────────────
DO $$ BEGIN
  CREATE TYPE delivery_leg_source AS ENUM ('SO', 'DO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

BEGIN;

-- ── 1. delivery_state flag on the SO + DO headers ────────────────────────────
-- Nullable, default NULL — an SO/DO only gets a delivery_state once it enters
-- the planning pipeline; null means "not yet in delivery planning".
ALTER TABLE mfg_sales_orders ADD COLUMN IF NOT EXISTS delivery_state delivery_state;
ALTER TABLE delivery_orders  ADD COLUMN IF NOT EXISTS delivery_state delivery_state;

COMMENT ON COLUMN mfg_sales_orders.delivery_state IS
  'Delivery-planning flag (nullable). PENDING_DELIVERY = all lines READY, has a date, not yet shipped; PENDING_SCHEDULE = ready/due but no firm trip date; OVERDUE = past customer_delivery_date and not DELIVERED; DELIVERED = goods handed over. Derived in the planning route from line stock_status + dates, NOT a DB trigger.';
COMMENT ON COLUMN delivery_orders.delivery_state IS
  'Delivery-planning flag (nullable), same semantics as mfg_sales_orders.delivery_state but for the DO once cut.';

CREATE INDEX IF NOT EXISTS idx_mfg_so_delivery_state ON mfg_sales_orders(delivery_state);
CREATE INDEX IF NOT EXISTS idx_do_delivery_state     ON delivery_orders(delivery_state);

-- ── 2. Fleet master parity ───────────────────────────────────────────────────
-- 2a. drivers: add in_house + a dedicated contact (ic_number already exists;
--     `phone` is the existing contact, but Houzs records a separate driver
--     contact on the delivery, so we keep phone as the master contact and add
--     in_house here). Houzs stores in-house via lorries.is_internal; for the
--     crew, in-house vs outsourced lives per driver/helper.
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS in_house BOOLEAN NOT NULL DEFAULT true;
COMMENT ON COLUMN drivers.in_house IS
  'true = in-house staff driver, false = outsourced/3rd-party. Mirrors Houzs is_internal at the crew level; feeds the Fleet All/In-house/Outsourced filter.';

-- 2b. helpers MASTER (2990 had none). Mirrors the driver master shape.
CREATE TABLE IF NOT EXISTS helpers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_code  TEXT NOT NULL UNIQUE,                  -- 'HLP-01'
  name         TEXT NOT NULL,
  contact      TEXT,                                  -- phone, normalized E.164 by the route
  ic_number    TEXT,
  in_house     BOOLEAN NOT NULL DEFAULT true,         -- false = outsourced helper
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_helpers_active ON helpers(active);

-- 2c. lorries MASTER (2990 had none). is_internal mirrors Houzs exactly so the
--     In-house checkbox + Fleet All/In-house/Outsourced filter work identically.
CREATE TABLE IF NOT EXISTS lorries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate          TEXT NOT NULL UNIQUE,
  type           lorry_type NOT NULL DEFAULT 'OTHER',
  is_internal    BOOLEAN NOT NULL DEFAULT true,        -- true = in-house, false = outsourced (Houzs parity)
  warehouse_id   UUID REFERENCES warehouses(id) ON DELETE SET NULL,  -- home warehouse (nullable; outsourced often none)
  capacity_m3    NUMERIC(8,2),                         -- volume capacity (Houzs capacity_m3)
  capacity_kg    NUMERIC(10,2),                        -- weight capacity (Houzs capacity_kg)
  active         BOOLEAN NOT NULL DEFAULT true,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lorries_active      ON lorries(active);
CREATE INDEX IF NOT EXISTS idx_lorries_internal    ON lorries(is_internal);
CREATE INDEX IF NOT EXISTS idx_lorries_warehouse   ON lorries(warehouse_id);

COMMENT ON COLUMN lorries.is_internal IS
  'true = in-house fleet, false = outsourced lorry. Mirrors Houzs lorries.is_internal; drives the Fleet All/In-house/Outsourced filter + the Lorry Capacity In-house checkbox.';

-- ── 3. delivery_legs — one order across MULTIPLE region trips/dates ──────────
-- A leg is (source doc) × (region warehouse) × (date) × optional trip. So an SO
-- delivered KL->Penang has a `transit` leg (KL warehouse, date A) and a `final`
-- leg (Penang warehouse, date B), each able to belong to a different region
-- trip. This is what lets one order surface in two region tabs with two dates.
CREATE TABLE IF NOT EXISTS delivery_legs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type    delivery_leg_source NOT NULL,         -- 'SO' | 'DO'
  source_id      UUID NOT NULL,                         -- mfg_sales_orders.id OR delivery_orders.id (no cross-type FK; app enforces)
  leg_no         INTEGER NOT NULL DEFAULT 1,            -- ordering of legs for one order (1=first hop)
  warehouse_id   UUID REFERENCES warehouses(id) ON DELETE SET NULL,  -- the region this leg dispatches from/to
  trip_id        UUID,                                  -- nullable, NO FK yet (trips header table is a later migration)
  leg_date       DATE,                                  -- planned date for this leg (nullable until scheduled)
  leg_kind       delivery_leg_kind NOT NULL DEFAULT 'final',  -- transit hop vs final last-mile
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES staff(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, leg_no)
);
CREATE INDEX IF NOT EXISTS idx_legs_source    ON delivery_legs(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_legs_warehouse ON delivery_legs(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_legs_trip      ON delivery_legs(trip_id);
CREATE INDEX IF NOT EXISTS idx_legs_date      ON delivery_legs(leg_date);

COMMENT ON TABLE delivery_legs IS
  'One order (SO or DO) can need several region hops on different dates. Each row = one hop: which region warehouse, which date, which trip, transit vs final. Lets a single order appear in two region trip tabs with two dates.';
COMMENT ON COLUMN delivery_legs.trip_id IS
  'Nullable, NO FK yet — the trips header table is a later migration; wire the FK when trips is created.';

-- ── 4. delivery_order_crew — per-DO assignment WITH assign-time snapshot ──────
-- One row per DO (1:1). Driver/helper/lorry FKs to the masters PLUS a snapshot
-- of name/ic/contact/plate captured at assign time — the same denormalised
-- pattern delivery_orders already uses (driver_name alongside driver_id), so the
-- DO keeps what was true on the day even if a master row is later edited.
-- (The DO header's existing driver_id/driver_name/vehicle stay as the "primary
-- driver" quick-fields; this table is the full 2-driver + 2-helper + lorry crew.)
CREATE TABLE IF NOT EXISTS delivery_order_crew (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  do_id              UUID NOT NULL UNIQUE REFERENCES delivery_orders(id) ON DELETE CASCADE,
  driver_1_id        UUID REFERENCES drivers(id) ON DELETE SET NULL,
  driver_2_id        UUID REFERENCES drivers(id) ON DELETE SET NULL,
  helper_1_id        UUID REFERENCES helpers(id) ON DELETE SET NULL,
  helper_2_id        UUID REFERENCES helpers(id) ON DELETE SET NULL,
  lorry_id           UUID REFERENCES lorries(id) ON DELETE SET NULL,
  -- snapshots captured at assign time (mirror the HC delivery-sheet record)
  driver_1_name      TEXT,
  driver_1_ic        TEXT,
  driver_1_contact   TEXT,
  driver_2_name      TEXT,
  driver_2_ic        TEXT,
  driver_2_contact   TEXT,
  helper_1_name      TEXT,
  helper_1_contact   TEXT,
  helper_2_name      TEXT,
  helper_2_contact   TEXT,
  lorry_plate        TEXT,
  assigned_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by        UUID REFERENCES staff(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crew_do       ON delivery_order_crew(do_id);
CREATE INDEX IF NOT EXISTS idx_crew_driver1  ON delivery_order_crew(driver_1_id);
CREATE INDEX IF NOT EXISTS idx_crew_lorry    ON delivery_order_crew(lorry_id);

COMMENT ON TABLE delivery_order_crew IS
  'Full crew assigned to a DO: up to 2 drivers + 2 helpers + 1 lorry, each FK to a master PLUS an assign-time snapshot of name/ic/contact/plate so the DO record is stable if a master is later edited (same pattern as delivery_orders.driver_name).';

-- ── 5. RLS — authenticated staff read + write (matches drivers / payment_vouchers) ─
ALTER TABLE helpers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE lorries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_legs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_order_crew ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY helpers_staff_read   ON helpers             FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY helpers_staff_write  ON helpers             FOR ALL    TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY lorries_staff_read   ON lorries             FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY lorries_staff_write  ON lorries             FOR ALL    TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY legs_staff_read      ON delivery_legs       FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY legs_staff_write     ON delivery_legs       FOR ALL    TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY crew_staff_read      ON delivery_order_crew FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY crew_staff_write     ON delivery_order_crew FOR ALL    TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
