-- 0171 — HR commission tables (Claude / Loo 2026-06-14).
--
-- New admin-only HR module: computes commission-only salaries for salespeople.
-- Three tables, all gated to admin + super_admin via RLS (mirrors is_admin
-- pattern from 0002). Additive only — no existing object is touched, so this
-- is deploy-order safe (apply before the API ships; pre-deploy code ignores
-- the new tables entirely).
--
--   hr_salesperson_profiles — per salesperson: tier (sales|manager) + showroom.
--   hr_commission_config    — singleton (id=1) rate/threshold config, seeded
--                             with Loo's stated rates (1% base, 0.5% KPIs,
--                             RM100k personal / RM400k showroom, 0.5% override).
--   hr_item_kpi             — flagged product/fabric/special add-ons with a
--                             fixed RM bonus per unit sold.
-- ────────────────────────────────────────────────────────────────────────

CREATE TYPE hr_tier AS ENUM ('sales', 'manager');
CREATE TYPE hr_item_kpi_type AS ENUM ('product', 'fabric', 'special');

CREATE TABLE hr_salesperson_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL UNIQUE REFERENCES staff(id) ON DELETE CASCADE,
  tier        hr_tier NOT NULL DEFAULT 'sales',
  showroom_id uuid NOT NULL REFERENCES showrooms(id),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_commission_config (
  id                            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_bps                      integer NOT NULL DEFAULT 100,
  personal_kpi_threshold_centi  integer NOT NULL DEFAULT 10000000,
  personal_kpi_bonus_bps        integer NOT NULL DEFAULT 50,
  showroom_kpi_threshold_centi  integer NOT NULL DEFAULT 40000000,
  showroom_kpi_bonus_bps        integer NOT NULL DEFAULT 50,
  override_base_bps             integer NOT NULL DEFAULT 50,
  override_kpi_bonus_bps        integer NOT NULL DEFAULT 50,
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  updated_by                    uuid
);

CREATE TABLE hr_item_kpi (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_type   hr_item_kpi_type NOT NULL,
  ref         text NOT NULL,
  label       text NOT NULL DEFAULT '',
  bonus_centi integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- seed the singleton config row (defaults supply the values)
INSERT INTO hr_commission_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- RLS: admin + super_admin only on all three tables.
ALTER TABLE hr_salesperson_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_commission_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_item_kpi              ENABLE ROW LEVEL SECURITY;

CREATE POLICY hr_profiles_admin_all ON hr_salesperson_profiles
  FOR ALL TO authenticated
  USING (current_staff_role() IN ('admin', 'super_admin'))
  WITH CHECK (current_staff_role() IN ('admin', 'super_admin'));

CREATE POLICY hr_config_admin_all ON hr_commission_config
  FOR ALL TO authenticated
  USING (current_staff_role() IN ('admin', 'super_admin'))
  WITH CHECK (current_staff_role() IN ('admin', 'super_admin'));

CREATE POLICY hr_item_kpi_admin_all ON hr_item_kpi
  FOR ALL TO authenticated
  USING (current_staff_role() IN ('admin', 'super_admin'))
  WITH CHECK (current_staff_role() IN ('admin', 'super_admin'));
