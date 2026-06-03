-- 0146_customer_code.sql
-- Human-readable customer code (Chairman 2026-06-03).
--
-- Recognition stays exactly as migration 0144: one customer per (name + phone) —
-- BOTH are required and BOTH form the identity (unchanged here). This migration
-- ONLY adds a shareable code `2990S-XXXXXXXX` (8 random alnum, ambiguous
-- 0/O/1/I/L removed) minted when a customer is first created — the refer /
-- recognition handle a human can read and say. customer_id (uuid) stays the
-- internal FK; the code is just its readable label. Same resolver name + the
-- same (name, phone) ON CONFLICT key, so NO API change is needed.
--
-- `customers` is empty on prod (0 rows verified 2026-06-03) so nothing backfills.
-- ⚠️ Additive (one column + index) + a CREATE OR REPLACE of the existing resolver.
-- No index/key change. Apply to prod only after Chairman's explicit OK (red line).

-- 1. Shareable code column. Unique; nullable (legacy rows stay null until next seen).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_code text;
CREATE UNIQUE INDEX IF NOT EXISTS customers_customer_code_unique
  ON customers (customer_code) WHERE customer_code IS NOT NULL;

-- 2. Resolver UNCHANGED in identity (still find-or-create by name + phone); the
--    only addition is minting customer_code on the INSERT (new customer) path.
--    Keep-first: an existing (name, phone) keeps its stored name/email/code, only
--    last_seen bumps. SECURITY DEFINER — same justification as 0144 (a sales
--    staffer placing an order can't take the write path under the coordinator
--    RLS). Replaces the 0144 body in place; signature + name are identical so the
--    SO POST caller is untouched.
CREATE OR REPLACE FUNCTION public.upsert_customer_by_name_phone(
  p_name  text,
  p_phone text,
  p_email text DEFAULT NULL
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

  -- Existing customer for this (name, phone) → keep-first, bump last_seen.
  SELECT id INTO v_id FROM customers
    WHERE lower(btrim(name)) = lower(btrim(p_name)) AND phone = p_phone
    LIMIT 1;
  IF FOUND THEN
    UPDATE customers SET last_seen_at = now() WHERE id = v_id;
    RETURN v_id;
  END IF;

  -- New customer → insert with a unique code, retrying on a unique_violation
  -- (a code collision OR a concurrent same-(name, phone) insert).
  LOOP
    v_code := '2990S-';
    FOR i IN 1..8 LOOP
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    END LOOP;
    BEGIN
      INSERT INTO customers (name, phone, email, customer_code)
      VALUES (btrim(p_name), p_phone, NULLIF(btrim(coalesce(p_email, '')), ''), v_code)
      RETURNING id INTO v_id;
      RETURN v_id;
    EXCEPTION WHEN unique_violation THEN
      -- Concurrent insert of the same (name, phone)? Re-find and reuse it.
      SELECT id INTO v_id FROM customers
        WHERE lower(btrim(name)) = lower(btrim(p_name)) AND phone = p_phone
        LIMIT 1;
      IF FOUND THEN
        UPDATE customers SET last_seen_at = now() WHERE id = v_id;
        RETURN v_id;
      END IF;
      -- Else it was a code collision → loop and regenerate.
    END;
  END LOOP;
END;
$$;
