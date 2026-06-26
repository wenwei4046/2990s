-- 0205 — customer marketing demographics move onto the customers table.
-- race / birthday / gender become customer-level attributes (the Customer
-- Database), replacing Part A's SO-snapshot age-frame capture. Birthday gives an
-- EXACT age (no buckets). Captured at POS handover (required for NEW customers —
-- a client-side gate), never shown on the SO/PDF. customers is empty on prod
-- (0 rows verified 2026-06-03, mig 0146) so there is no backfill.
--
-- ADDITIVE here (columns + RPC). The matching drop of the now-dead SO snapshot
-- columns (customer_race / customer_age_frame, mig 0185) is a separate file
-- (0206) so add-before-use / drop-after-unused stays clean.
-- Apply BEFORE deploying the API/POS code (migrate-before-deploy). Re-run safe.

BEGIN;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS race     text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday date;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender   text;

-- Extend the find-or-create resolver to persist demographics. Adding params
-- changes the function signature, so DROP the 3-arg version and CREATE the
-- 6-arg one (new params DEFAULT NULL → existing 3-arg callers resolve here via
-- defaults). Keep-first coalesce: a returning customer keeps stored demographics;
-- only NULL fields get filled. Same identity key + SECURITY DEFINER as 0146.
DROP FUNCTION IF EXISTS public.upsert_customer_by_name_phone(text, text, text);

CREATE FUNCTION public.upsert_customer_by_name_phone(
  p_name     text,
  p_phone    text,
  p_email    text DEFAULT NULL,
  p_race     text DEFAULT NULL,
  p_birthday date DEFAULT NULL,
  p_gender   text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_id    uuid;
  v_alpha text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 31 chars, no 0/O/1/I/L
  v_code  text;
  i       int;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' OR p_phone IS NULL OR btrim(p_phone) = '' THEN
    RAISE EXCEPTION 'upsert_customer_by_name_phone: name and phone are both required';
  END IF;

  -- Existing customer → keep-first; bump last_seen; coalesce-fill demographics.
  SELECT id INTO v_id FROM customers
    WHERE lower(btrim(name)) = lower(btrim(p_name)) AND phone = p_phone
    LIMIT 1;
  IF FOUND THEN
    UPDATE customers SET
      last_seen_at = now(),
      race     = COALESCE(race,     p_race),
      birthday = COALESCE(birthday, p_birthday),
      gender   = COALESCE(gender,   p_gender)
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  -- New customer → insert with a unique code + demographics, retrying on a
  -- unique_violation (code collision OR concurrent same-(name,phone) insert).
  LOOP
    v_code := '2990S-';
    FOR i IN 1..8 LOOP
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    END LOOP;
    BEGIN
      INSERT INTO customers (name, phone, email, customer_code, race, birthday, gender)
      VALUES (btrim(p_name), p_phone, NULLIF(btrim(coalesce(p_email, '')), ''), v_code,
              p_race, p_birthday, p_gender)
      RETURNING id INTO v_id;
      RETURN v_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_id FROM customers
        WHERE lower(btrim(name)) = lower(btrim(p_name)) AND phone = p_phone
        LIMIT 1;
      IF FOUND THEN
        UPDATE customers SET
          last_seen_at = now(),
          race     = COALESCE(race,     p_race),
          birthday = COALESCE(birthday, p_birthday),
          gender   = COALESCE(gender,   p_gender)
        WHERE id = v_id;
        RETURN v_id;
      END IF;
      -- else a code collision → loop and regenerate.
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_customer_by_name_phone(text, text, text, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_customer_by_name_phone(text, text, text, text, date, text) TO authenticated;

COMMIT;
