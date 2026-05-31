-- ----------------------------------------------------------------------------
-- 0119 — pos_pin_attempts (durable PIN brute-force lockout) — security hardening
--
-- /pos/pin-login is UNAUTHENTICATED, takes a public staffId (enumerable via GET
-- /pos/sales-staff) + a 6-digit PIN, and on success mints a full session. The
-- lockout must therefore be a real, globally-consistent control. The previous
-- limiter was an in-memory Map inside the Worker — but Cloudflare runs many
-- short-lived V8 isolates across edge POPs, so a per-isolate Map does NOT bound
-- global attempts (ride isolate churn / fan across POPs → fresh bucket). This
-- table is the single source of truth; the API limiter calls the SECURITY
-- DEFINER functions below via the service-role client. (WS2 review, 2026-05-31.)
-- ----------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS pos_pin_attempts (
  staff_id   UUID PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
  count      INTEGER NOT NULL DEFAULT 0,
  reset_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS ENABLED with NO policies (deny-all). The public anon key ships in the POS
-- bundle, so a no-RLS public table would be reachable via PostgREST directly —
-- an attacker could DELETE their own lockout row and defeat the limiter. Zero
-- policies means anon/authenticated get NO direct access; the service-role API
-- and the SECURITY DEFINER functions below (owned by the migration role) bypass
-- RLS and keep working.
ALTER TABLE pos_pin_attempts ENABLE ROW LEVEL SECURITY;

-- Atomic check: is this staff currently locked out? An expired window counts as
-- fresh (allowed). Returns the lockout countdown + remaining attempts.
CREATE OR REPLACE FUNCTION pin_attempt_check(p_staff_id UUID, p_max INT)
RETURNS TABLE(allowed BOOLEAN, retry_after INT, remaining INT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r pos_pin_attempts%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pos_pin_attempts WHERE staff_id = p_staff_id;
  IF NOT FOUND OR r.reset_at <= NOW() THEN
    RETURN QUERY SELECT TRUE, 0, p_max;
  ELSIF r.count >= p_max THEN
    RETURN QUERY SELECT FALSE, CEIL(EXTRACT(EPOCH FROM (r.reset_at - NOW())))::INT, 0;
  ELSE
    RETURN QUERY SELECT TRUE, 0, (p_max - r.count);
  END IF;
END;
$$;

-- Atomic record-failure: the window starts at the FIRST failure; later failures
-- within the window increment but do NOT extend it. One INSERT ... ON CONFLICT
-- statement = race-safe across concurrent edge requests.
CREATE OR REPLACE FUNCTION pin_attempt_fail(p_staff_id UUID, p_window_seconds INT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO pos_pin_attempts (staff_id, count, reset_at)
  VALUES (p_staff_id, 1, NOW() + make_interval(secs => p_window_seconds))
  ON CONFLICT (staff_id) DO UPDATE SET
    count    = CASE WHEN pos_pin_attempts.reset_at <= NOW() THEN 1
                    ELSE pos_pin_attempts.count + 1 END,
    reset_at = CASE WHEN pos_pin_attempts.reset_at <= NOW() THEN NOW() + make_interval(secs => p_window_seconds)
                    ELSE pos_pin_attempts.reset_at END;
$$;

-- Clear the counter on a successful login.
CREATE OR REPLACE FUNCTION pin_attempt_reset(p_staff_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM pos_pin_attempts WHERE staff_id = p_staff_id;
$$;

COMMENT ON TABLE pos_pin_attempts IS
  'Durable PIN brute-force lockout counter (WS2 security hardening 2026-05-31). '
  'Globally consistent across Cloudflare edge isolates — replaces the per-isolate '
  'in-memory limiter. Written only by the service-role API via pin_attempt_* fns.';

COMMIT;
