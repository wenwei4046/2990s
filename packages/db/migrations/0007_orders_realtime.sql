-- 0007_orders_realtime.sql
-- Phase 2 step E: subscribe Backend to live order arrivals.
--
-- The supabase_realtime publication is opt-in per-table — without this,
-- postgres_changes subscribers silently never fire. Migration 0005 added
-- the catalog tables; this one extends to orders + order_items + lane
-- history so:
--   - Backend's order board refreshes within ~300ms of a new POS sale.
--   - Lane drag in Backend reflects in any other open Backend tab.
--
-- Idempotent via DO-block / pg_publication_tables guard.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'orders'::text,
      'order_items'::text,
      'order_lane_history'::text,
      'order_slip_events'::text,
      'payments'::text
    ]) AS tbl
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = r.tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', r.tbl);
    END IF;
  END LOOP;
END $$;
