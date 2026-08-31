-- 0215 — commission moves back to 2990, and the POS becomes the only place it
-- is configured or calculated (Loo 2026-08-31: "我要直接废除掉 Houzs 那边的
-- commission 机制，所有的 commission 机制只会在 POS 这边去算").
--
-- These three tables (0171) are the ORIGINALS; Houzs's scm.hr_* are a port of
-- them. This migration brings them up to what the POS engine needs and undoes
-- the two assumptions that stopped being true at the 2026-07-21 cutover.
--
-- ── WHY THE FOREIGN KEYS GO ─────────────────────────────────────────────────
-- `staff_id REFERENCES staff(id)` and `showroom_id REFERENCES showrooms(id)`
-- were correct in June, when the POS and this database shared one identity
-- space. Since the cutover the POS authenticates against Houzs and every id it
-- can offer — the salesperson picker, the showroom list — is a Houzs
-- `scm.staff.id` / `scm.showrooms.id`. Those rows are in ANOTHER DATABASE, and
-- nothing syncs them here, so an FK to a local table can only do one of two
-- things: reject a legitimate salesperson, or silently pass because the id
-- happens to collide with a stale local row. Both are worse than no constraint.
--
-- This is the same conclusion campaign_promo_redemptions reached in 0212, for
-- the same reason and with the same mitigation: keep the id as an opaque
-- reference and SNAPSHOT the display name beside it, because there is nothing
-- to join to. A snapshot also survives a rename, which for a payroll record is
-- a feature — the payslip should say what it said when it was approved.
--
-- ⚠️ AMENDED SAME DAY: `showroom_id` now holds a VENUE id, not a showrooms id.
-- Loo, on finding the commission screen saying "Showroom KL" while the order
-- form said "2990s PJ" for one address: "确保和 venue 是一样的，因为以后会有其他
-- 分行". The branch a salesperson earns under is now picked from the SAME
-- `/venues` list the order form reads, so a new branch is added once instead of
-- twice. The column keeps its name (renaming it would rewrite a live payroll
-- table for a label); the FK is already gone, which is what made this possible.
-- Rows written before the switch hold an old `showrooms` id and are shown
-- flagged in the UI until they are re-picked.
--
-- ── WHY flag_type STOPS BEING AN ENUM ───────────────────────────────────────
-- It needs a fourth value ('category' — one rule covering every item in a
-- product category). `ALTER TYPE ... ADD VALUE` cannot be used in the same
-- transaction that then references the new value, which is exactly how a
-- migration runner applies this file. A CHECK-constrained text column is the
-- same guarantee without the transaction trap, and the vocabulary will grow
-- again.
--
-- ── THE NEW OPTION THIS IS ALL FOR ──────────────────────────────────────────
-- hr_item_kpi.counts_as_revenue (Loo 2026-08-31): "有一些 KPI item 它有一个
-- option，就是它可以同时算 product revenue … product revenue 也会拿到
-- commission，但同样的，它 KPI item 那边也会拿到 special 的 KPI amount".
--
-- DEFAULT false — every existing rule keeps today's behaviour exactly ("no
-- double commission": the fixed amount is earned INSTEAD of the percentage on
-- the flagged portion). Turning it ON for one rule means that rule's amount
-- STAYS in the goods that drive the percentage AND the RM 100k / RM 400k gates,
-- while still paying its fixed amount. That cascades — a salesperson can cross
-- a threshold, which can lift the whole showroom's rate — which is why it is
-- per-rule and off by default.
-- ────────────────────────────────────────────────────────────────────────────

-- ── config: the override mode Houzs's port added, brought home ──────────────
ALTER TABLE hr_commission_config
  ADD COLUMN IF NOT EXISTS override_mode text NOT NULL DEFAULT 'showroom';

DO $$ BEGIN
  ALTER TABLE hr_commission_config
    ADD CONSTRAINT hr_commission_config_override_mode_chk
    CHECK (override_mode IN ('showroom', 'chain'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── item KPI: the new option, plus the category vocabulary ──────────────────
ALTER TABLE hr_item_kpi
  ADD COLUMN IF NOT EXISTS counts_as_revenue boolean NOT NULL DEFAULT false;

-- enum -> CHECK-constrained text (see header). USING casts the existing rows.
ALTER TABLE hr_item_kpi
  ALTER COLUMN flag_type TYPE text USING flag_type::text;

DO $$ BEGIN
  ALTER TABLE hr_item_kpi
    ADD CONSTRAINT hr_item_kpi_flag_type_chk
    CHECK (flag_type IN ('product', 'category', 'fabric', 'special'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The type is now unreferenced. Dropped rather than left behind so the next
-- reader does not think it is still the source of truth.
DROP TYPE IF EXISTS hr_item_kpi_type;

-- ── profiles: drop the cross-database FKs, snapshot the labels ──────────────
-- Dropped by lookup rather than by name: 0171 let Postgres generate the
-- constraint names, and a hard-coded guess that misses would leave the FK in
-- place and this migration would still report success.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'hr_salesperson_profiles'
       AND con.contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE hr_salesperson_profiles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE hr_salesperson_profiles
  ADD COLUMN IF NOT EXISTS staff_name     text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS staff_code     text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS showroom_name  text NOT NULL DEFAULT '';

-- ── chain-mode override ladder ──────────────────────────────────────────────
-- One rate per rung of the reporting line: level 1 = a person's DIRECT reports.
-- Only read when config.override_mode = 'chain'. A level with no row earns
-- nothing — the owner's configured rows ARE the definition of who earns.
CREATE TABLE IF NOT EXISTS hr_override_levels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level      integer NOT NULL CHECK (level >= 1),
  rate_bps   integer NOT NULL DEFAULT 0 CHECK (rate_bps >= 0),
  label      text NOT NULL DEFAULT '',
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- one rate per level: two rows for level 2 would make "the level 2 rate"
  -- ambiguous, i.e. a payout nobody can predict.
  CONSTRAINT hr_override_levels_level_uniq UNIQUE (level)
);

-- ── payout periods: a closed range is frozen ────────────────────────────────
-- The report recomputes from CURRENT config on every load, so editing one rate
-- silently rewrites every past period's payout and no figure anyone has
-- approved is reproducible. Closing a period stores its rows; the report then
-- SERVES them instead of recomputing.
--
-- ⚠️ rows_json IS CLIENT-AUTHORED. Commission is computed in the POS (that is
-- where the Houzs session lives, and therefore the only place the orders can be
-- read), so what is frozen here is a snapshot of what the approver was LOOKING
-- AT when they approved it. That is the honest description of this record and
-- the reason it is stored whole rather than recomputed: it is evidence of an
-- approval, not an independent derivation. `engine_version` records which
-- arithmetic produced it.
CREATE TABLE IF NOT EXISTS hr_payout_periods (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_from    date NOT NULL,
  period_to      date NOT NULL,
  revision       integer NOT NULL DEFAULT 1,
  status         text NOT NULL DEFAULT 'CLOSED'
                   CHECK (status IN ('CLOSED', 'REOPENED')),
  engine_version text NOT NULL DEFAULT '',
  total_centi    bigint NOT NULL DEFAULT 0,
  row_count      integer NOT NULL DEFAULT 0,
  rows_json      jsonb NOT NULL DEFAULT '[]'::jsonb,
  closed_by_name text NOT NULL DEFAULT '',
  closed_at      timestamptz,
  reopened_by_name text NOT NULL DEFAULT '',
  reopened_at    timestamptz,
  reopen_reason  text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_payout_periods_range_chk CHECK (period_to >= period_from)
);

-- At most ONE live closure per range. A reopened row stays for the audit trail,
-- so the uniqueness is partial: only a CLOSED period holds the range.
CREATE UNIQUE INDEX IF NOT EXISTS hr_payout_periods_live_uniq
  ON hr_payout_periods (period_from, period_to)
  WHERE status = 'CLOSED';

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- The POS reaches these through the API's service-role client (it holds a Houzs
-- token, not a 2990 Supabase session, so no RLS policy can see it). These
-- policies therefore guard the OTHER doors — the Backend portal and anything
-- holding a 2990 session — and keep the tables closed by default.
ALTER TABLE hr_override_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_payout_periods  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY hr_override_levels_admin_all ON hr_override_levels
    FOR ALL TO authenticated
    USING (current_staff_role() IN ('admin', 'super_admin'))
    WITH CHECK (current_staff_role() IN ('admin', 'super_admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY hr_payout_periods_admin_all ON hr_payout_periods
    FOR ALL TO authenticated
    USING (current_staff_role() IN ('admin', 'super_admin'))
    WITH CHECK (current_staff_role() IN ('admin', 'super_admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS hr_payout_periods_live_uniq;
-- DROP TABLE IF EXISTS hr_payout_periods;
-- DROP TABLE IF EXISTS hr_override_levels;
-- ALTER TABLE hr_salesperson_profiles
--   DROP COLUMN IF EXISTS staff_name,
--   DROP COLUMN IF EXISTS staff_code,
--   DROP COLUMN IF EXISTS showroom_name;
-- ALTER TABLE hr_item_kpi DROP CONSTRAINT IF EXISTS hr_item_kpi_flag_type_chk;
-- ALTER TABLE hr_item_kpi DROP COLUMN IF EXISTS counts_as_revenue;
-- ALTER TABLE hr_commission_config
--   DROP CONSTRAINT IF EXISTS hr_commission_config_override_mode_chk,
--   DROP COLUMN IF EXISTS override_mode;
-- (the dropped FKs and the hr_item_kpi_type enum are NOT restored — see header)
