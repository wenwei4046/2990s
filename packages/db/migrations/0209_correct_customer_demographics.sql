-- 0209 — let the Backend correct a customer's marketing demographics.
--
-- Until now demographics (race / birthday / gender) were KEEP-FIRST: once a
-- value was stored, upsert_customer_by_name_phone() (mig 0205) never overwrote
-- it, and the Backend SO Detail locked the field read-only. Loo 2026-06-28: a
-- salesperson who keyed the wrong value (or forgot it) on an earlier SO must be
-- able to fix it from the Backend. This adds an EXPLICIT overwrite resolver used
-- only by the Backend SO Detail edit; the POS handover / SO create path keeps
-- using the keep-first upsert (a returning customer must never have their data
-- silently clobbered just by placing a new order).
--
-- Overwrite-if-provided semantics: a non-NULL param replaces the stored value
-- (correction / fill); a NULL param leaves the stored value untouched. So a
-- blank field in the edit form can never accidentally wipe good data — only an
-- actual pick changes anything. SECURITY DEFINER (same justification as 0144/
-- 0205) so it works regardless of the editing staffer's role, keyed by the
-- already-resolved customer id (no name/phone re-match, no stray customer).
-- Apply BEFORE deploying the API code. Re-run safe (CREATE OR REPLACE).

BEGIN;

CREATE OR REPLACE FUNCTION public.set_customer_demographics(
  p_customer_id uuid,
  p_race        text DEFAULT NULL,
  p_birthday    date DEFAULT NULL,
  p_gender      text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'set_customer_demographics: customer id is required';
  END IF;

  UPDATE customers SET
    race     = COALESCE(p_race,     race),
    birthday = COALESCE(p_birthday, birthday),
    gender   = COALESCE(p_gender,   gender)
  WHERE id = p_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_customer_demographics(uuid, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_customer_demographics(uuid, text, date, text) TO authenticated;

COMMIT;
