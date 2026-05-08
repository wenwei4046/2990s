-- 0003_harden_function_security.sql
-- Hand-written. Applied 2026-05-08 via Supabase MCP after advisor flagged
-- SECURITY DEFINER helpers as RPC-callable from anon/authenticated.
--
-- These functions are meant for internal use only:
--   * is_staff/is_admin/is_coordinator_or_above/is_finance_or_admin —
--     RLS policy predicates; should not be RPC.
--   * current_staff_role/current_staff_showroom — RLS policy helpers.
--   * app_config_get — internal config reader.
--   * bootstrap_owner_staff/bump_pricing_version/trigger_set_updated_at —
--     trigger functions; should never be called as RPC.
--   * next_order_id — server-side default for orders.id.
--
-- service_role retains EXECUTE (it bypasses RLS by default).

REVOKE EXECUTE ON FUNCTION public.is_staff() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_coordinator_or_above() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_finance_or_admin() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_staff_role() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_staff_showroom() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_config_get(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bootstrap_owner_staff() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_pricing_version() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_set_updated_at() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_order_id() FROM anon, authenticated;

-- Fix mutable search_path (the two trigger functions that aren't SECURITY DEFINER).
ALTER FUNCTION public.trigger_set_updated_at() SET search_path = public;
ALTER FUNCTION public.next_order_id() SET search_path = public;
