-- ----------------------------------------------------------------------------
-- 0086 — User management: 3 new sales roles + venues + venue_id FKs.
-- (Slot 0085 was claimed by 0085_so_dropdown_venue.sql in main.)
--
-- Commander 2026-05-27 spec:
--   Extend staff_role with sales_executive (POS only, picks venue),
--   outlet_manager (POS only, picks venue), sales_director (POS + Backend,
--   all venues). The existing sales / coordinator / finance / admin /
--   showroom_lead values stay as-is.
--
--   Add a NEW `venues` table (distinct from showrooms — showrooms is
--   2990's retail concept; venues is a parallel concept for the broader
--   sales force that may operate from non-showroom locations). Sales-side
--   staff get an optional venue_id; every SO created via POS gets stamped
--   with the salesperson's venue_id so the dashboard can slice by venue.
--
-- View refresh: mfg_sales_orders_with_payment_totals was created in
-- migration 0076 as `SELECT so.*` — Postgres binds the column list at
-- view-creation time, so the new venue_id column on the base table will
-- NOT show up in the view until we DROP + CREATE it. Same pattern as
-- migration 0080.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── Enum extension ────────────────────────────────────────────────────────
-- ADD VALUE inside a transaction works on Postgres 12+; IF NOT EXISTS makes
-- the migration idempotent if it's partially applied.

ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'sales_executive';
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'outlet_manager';
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'sales_director';

-- ── Venues table ─────────────────────────────────────────────────────────
-- Lightweight master record: id / name / address / active. No staff link
-- here — staff.venue_id (added below) is the link, mirroring how
-- staff.showroom_id works for the showrooms table.

CREATE TABLE IF NOT EXISTS venues (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  address     text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS — authenticated staff read/write. Mirrors the warehouses table policy
-- (migration 0050) where finer-grained checks happen at the API layer.
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

CREATE POLICY venues_staff_read  ON venues FOR SELECT TO authenticated USING (true);
CREATE POLICY venues_staff_write ON venues FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- ── FK columns ───────────────────────────────────────────────────────────
-- venue_id on staff: which venue this user belongs to. NULL = no venue
-- (e.g. admin, coordinator, finance — they're not venue-scoped).
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES venues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_staff_venue_id ON staff(venue_id);

-- venue_id on mfg_sales_orders: stamped on create from the salesperson's
-- staff.venue_id. NULL for SOs created from the Backend portal (B2B path)
-- where no venue applies.
ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES venues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mfg_sales_orders_venue_id
  ON mfg_sales_orders(venue_id);

-- ── Refresh dependent view ───────────────────────────────────────────────
-- The view's `SELECT so.*` column list is bound at create time; without
-- a DROP+CREATE the new venue_id column won't appear in the view and the
-- SO list API (which selects from the view) wouldn't see it.

DROP VIEW IF EXISTS mfg_sales_orders_with_payment_totals;

CREATE VIEW mfg_sales_orders_with_payment_totals AS
SELECT
  so.*,
  coalesce(p.paid_total, 0)                                                AS paid_total_centi,
  GREATEST(so.local_total_centi - coalesce(p.paid_total, 0), 0)            AS balance_centi_live
FROM mfg_sales_orders so
LEFT JOIN (
  SELECT so_doc_no, sum(amount_centi)::bigint AS paid_total
  FROM mfg_sales_order_payments
  GROUP BY so_doc_no
) p ON p.so_doc_no = so.doc_no;

-- ── Seed: one venue matching the existing showroom ───────────────────────
-- "Showroom KL" is the MVP single-showroom (UUID aaaa... aaaa). Mirror it
-- as a venue so commander has a starting row in the Venues CRUD; the FK
-- isn't to showrooms, so this is just a name match for human convenience.

INSERT INTO venues (name, address, active)
SELECT 'Showroom KL', s.address, true
FROM showrooms s
WHERE s.showroom_code = 'KL'
  AND NOT EXISTS (SELECT 1 FROM venues WHERE name = 'Showroom KL')
LIMIT 1;

-- Fallback if no KL showroom yet (fresh DB) — still seed something.
INSERT INTO venues (name, active)
SELECT 'Showroom KL', true
WHERE NOT EXISTS (SELECT 1 FROM venues WHERE name = 'Showroom KL');

COMMIT;
