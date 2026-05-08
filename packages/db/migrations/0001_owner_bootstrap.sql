-- 0001_owner_bootstrap.sql
-- Hand-written migration. Codex P1.8 fold (2026-05-08): replace fragile env-var
-- trigger with app_config-based lookup. Postgres triggers cannot read CF/Vite
-- env vars; reading from app_config table works and admin can ALTER without
-- redeploy.
--
-- Adds:
--   * app_config seed rows (owner_email, pricing_version)
--   * app_config_get(key) helper
--   * bootstrap_owner_staff() trigger function on auth.users INSERT
--   * trigger_set_updated_at() helper + triggers on tables with updated_at

-- ─── Seed app_config (idempotent) ──────────────────────────────────────────
INSERT INTO app_config (key, value, description) VALUES
  ('owner_email', 'wenwei4046@gmail.com',
   'auth.users INSERT trigger compares new user email against this. Match creates owner staff row with role=admin. Codex P1.8 fold.'),
  ('pricing_version', '0',
   'Bumped on any pricing-table UPDATE. Snapshot stamped on orders.pricing_version + quotes.pricing_version for audit. Codex P2.5 fold.')
ON CONFLICT (key) DO NOTHING;

-- ─── Helper: read app_config value by key (SECURITY DEFINER bypasses RLS) ──
CREATE OR REPLACE FUNCTION app_config_get(p_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT value FROM app_config WHERE key = p_key;
$$;

-- ─── Bootstrap trigger: auto-create OWNER staff row on first sign-in ──────
CREATE OR REPLACE FUNCTION bootstrap_owner_staff()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_owner_email text;
BEGIN
  v_owner_email := app_config_get('owner_email');
  IF v_owner_email IS NULL OR NEW.email IS NULL OR NEW.email != v_owner_email THEN
    RETURN NEW;
  END IF;

  -- Idempotent: if staff row already exists for this auth.users id, skip
  IF EXISTS (SELECT 1 FROM staff WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Owner has showroom_id = NULL (oversees all showrooms)
  INSERT INTO staff (id, staff_code, name, role, showroom_id, email, initials, color, active)
  VALUES (
    NEW.id,
    'OWNER',
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    'admin',
    NULL,
    NEW.email,
    'OW',
    '#221F20',
    TRUE
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION bootstrap_owner_staff();

-- ─── updated_at trigger helper + per-table triggers ───────────────────────
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_updated_at ON staff;
CREATE TRIGGER staff_updated_at BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS orders_updated_at ON orders;
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS addons_updated_at ON addons;
CREATE TRIGGER addons_updated_at BEFORE UPDATE ON addons
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS quotes_updated_at ON quotes;
CREATE TRIGGER quotes_updated_at BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS app_config_updated_at ON app_config;
CREATE TRIGGER app_config_updated_at BEFORE UPDATE ON app_config
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ─── pricing_version bumper ────────────────────────────────────────────────
-- When admin UPDATEs anything in products / pricing tables / addons, bump the
-- pricing_version row in app_config. Order placement reads this to stamp
-- orders.pricing_version (Codex P2.5 audit trail).

CREATE OR REPLACE FUNCTION bump_pricing_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE app_config
    SET value = (COALESCE(value::int, 0) + 1)::text,
        updated_at = now()
    WHERE key = 'pricing_version';
  RETURN NULL;  -- AFTER trigger; we don't need to modify the row
END;
$$;

DROP TRIGGER IF EXISTS bump_pricing_version_products ON products;
CREATE TRIGGER bump_pricing_version_products
  AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH STATEMENT EXECUTE FUNCTION bump_pricing_version();

DROP TRIGGER IF EXISTS bump_pricing_version_compartments ON product_compartments;
CREATE TRIGGER bump_pricing_version_compartments
  AFTER INSERT OR UPDATE OR DELETE ON product_compartments
  FOR EACH STATEMENT EXECUTE FUNCTION bump_pricing_version();

DROP TRIGGER IF EXISTS bump_pricing_version_bundles ON product_bundles;
CREATE TRIGGER bump_pricing_version_bundles
  AFTER INSERT OR UPDATE OR DELETE ON product_bundles
  FOR EACH STATEMENT EXECUTE FUNCTION bump_pricing_version();

DROP TRIGGER IF EXISTS bump_pricing_version_sizes ON product_size_variants;
CREATE TRIGGER bump_pricing_version_sizes
  AFTER INSERT OR UPDATE OR DELETE ON product_size_variants
  FOR EACH STATEMENT EXECUTE FUNCTION bump_pricing_version();

DROP TRIGGER IF EXISTS bump_pricing_version_addons ON addons;
CREATE TRIGGER bump_pricing_version_addons
  AFTER INSERT OR UPDATE OR DELETE ON addons
  FOR EACH STATEMENT EXECUTE FUNCTION bump_pricing_version();

-- ─── next_order_id() sequence (moved here so RLS migration depends on it) ─
CREATE SEQUENCE IF NOT EXISTS order_seq START WITH 2050;

CREATE OR REPLACE FUNCTION next_order_id() RETURNS TEXT
  LANGUAGE sql VOLATILE AS
  $$ SELECT 'SO-' || nextval('order_seq')::text $$;

ALTER TABLE orders ALTER COLUMN id SET DEFAULT next_order_id();
