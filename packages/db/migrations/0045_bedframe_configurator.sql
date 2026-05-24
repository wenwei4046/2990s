-- 0045_bedframe_configurator.sql
-- Bedframe configurator (spec 2026-05-25). Adds pricing_kind 'bedframe_build' +
-- 3 POS-owned tables: bedframe_colours (global) + product_bedframe_colours
-- (per-Model tick, mirrors product_fabrics) + bedframe_options (the gap/leg/
-- divan/total/specials choice-lists, Decision B: snapshot of maintenance_config,
-- then decoupled). All POS pricing is SKU-Master-owned; every surcharge starts 0.
-- Seeds live in packages/db/seeds/bedframe-*.sql (applied separately).

ALTER TYPE pricing_kind ADD VALUE IF NOT EXISTS 'bedframe_build';

CREATE TABLE IF NOT EXISTS bedframe_colours (
  id         text PRIMARY KEY,
  label      text NOT NULL,
  swatch_hex text,
  surcharge  integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_bedframe_colours (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  colour_id  text NOT NULL REFERENCES bedframe_colours(id),
  active     boolean NOT NULL DEFAULT true,
  PRIMARY KEY (product_id, colour_id)
);

CREATE TABLE IF NOT EXISTS bedframe_options (
  id         text PRIMARY KEY,                  -- 'gap-6','leg-7','special-left-drawer'
  kind       text NOT NULL,                     -- 'gap'|'leg_height'|'divan_height'|'total_height'|'special'
  value      text NOT NULL,                     -- '6"','7"','Left Drawer'
  surcharge  integer NOT NULL DEFAULT 0,        -- whole MYR, POS-owned (0 for pilot)
  active     boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bedframe_options_kind ON bedframe_options (kind);

-- RLS: read any authenticated staff, write admin only (same as libraries/pricing).
ALTER TABLE bedframe_colours         ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_bedframe_colours ENABLE ROW LEVEL SECURITY;
ALTER TABLE bedframe_options         ENABLE ROW LEVEL SECURITY;

CREATE POLICY bedframe_colours_select ON bedframe_colours
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY bedframe_colours_admin_write ON bedframe_colours
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY product_bedframe_colours_select ON product_bedframe_colours
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY product_bedframe_colours_admin_write ON product_bedframe_colours
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY bedframe_options_select ON bedframe_options
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY bedframe_options_admin_write ON bedframe_options
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Realtime so POS sees Backend edits in ~300ms (mirrors product_fabrics).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='bedframe_colours') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.bedframe_colours';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='product_bedframe_colours') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.product_bedframe_colours';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='bedframe_options') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.bedframe_options';
  END IF;
END $$;
