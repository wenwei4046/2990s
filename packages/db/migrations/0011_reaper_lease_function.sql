-- 0011_reaper_lease_function.sql
-- Phase 4 step 4: orphan reaper claim function. SECURITY DEFINER because
-- it must UPDATE pending_slip_uploads which authenticated cannot. Worker
-- calls via service_role — DEFINER doesn't expand attack surface for
-- service_role calls but ensures the function works in any execution context.
-- EXECUTE explicitly REVOKED FROM anon, authenticated.

CREATE OR REPLACE FUNCTION public.lease_orphan_slips(p_worker_id text, p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid, r2_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  UPDATE pending_slip_uploads psu
     SET claimed_by = p_worker_id,
         lease_expires_at = now() + INTERVAL '5 minutes'
   WHERE psu.id IN (
     SELECT psu2.id
       FROM pending_slip_uploads psu2
      WHERE psu2.status IN ('pending','uploaded')
        AND psu2.expires_at < now()
        AND (psu2.claimed_by IS NULL OR psu2.lease_expires_at < now())
      ORDER BY psu2.expires_at
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
   )
   RETURNING psu.id, psu.r2_key;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lease_orphan_slips(text, integer) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.count_orphan_slips()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COUNT(*)::integer
    FROM pending_slip_uploads
   WHERE status IN ('pending','uploaded')
     AND expires_at < now();
$$;

REVOKE EXECUTE ON FUNCTION public.count_orphan_slips() FROM anon, authenticated;
