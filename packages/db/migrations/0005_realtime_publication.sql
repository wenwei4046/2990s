-- 0005_realtime_publication.sql
-- Phase 1 step 4: enable Supabase Realtime on tables POS subscribes to.
-- Without this, postgres_changes subscriptions silently never fire.
--
-- POS subscribes to `products` for catalog liveness — Backend SKU Master edits
-- should appear in POS within ~300ms. Adding the per-product pricing tables
-- so per-Model price tweaks also bump the catalog. addons added preemptively
-- for the Phase 1.5 add-ons screen.
--
-- ALTER PUBLICATION ... ADD TABLE is idempotent only via the manual exists check;
-- DO block makes it safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'products'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.products';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'product_compartments'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.product_compartments';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'product_bundles'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.product_bundles';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'product_size_variants'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.product_size_variants';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'addons'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.addons';
  END IF;
END $$;
