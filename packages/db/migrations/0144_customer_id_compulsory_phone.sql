-- 0144_customer_id_compulsory_phone.sql
-- Customer ID + compulsory phone (Chairman 2026-06-03).
-- Spec: docs/superpowers/specs/2026-06-03-customer-id-and-compulsory-phone-design.md
--
-- Two things:
--   1. Give each customer a stable identity keyed on NAME + PHONE (both), so SOs
--      stop relying on fuzzy name text. One customer_id per distinct
--      (lower(trim(name)), phone). A shared phone with a different name = a
--      different customer (Chairman-confirmed, stricter than phone-only).
--   2. The API now enforces compulsory phone on every SO (server-side, not just
--      the POS UI) and resolves the customer via the upsert RPC below.
--
-- The `customers` table already exists (schema.ts) and is effectively empty
-- (0 rows verified on prod 2026-06-03) — no dedupe needed before the unique
-- index. customer_id stays nullable; no NOT NULL added (Decision D1 — enforce
-- at the API first, revisit after a Phase 2 backfill).

-- 1) Composite UNIQUE identity key on the NORMALISED (name, phone). Partial so
--    legacy phone-less rows never collide on a NULL phone. trim() = btrim().
CREATE UNIQUE INDEX IF NOT EXISTS customers_name_phone_unique
  ON customers (lower(trim(name)), phone)
  WHERE phone IS NOT NULL;

-- 2) Atomic find-or-create keyed on (name, phone). SECURITY DEFINER because the
--    SO POST runs as the authenticated staff client, and the customers_update
--    RLS policy is is_coordinator_or_above() — a *sales* staffer placing an
--    order could not take the ON CONFLICT DO UPDATE branch otherwise. Same
--    pattern + justification as next_po_number()/next_order_id(): the function
--    takes only the order's own customer fields and writes one keyed row.
--    Keep-first: an existing match keeps its stored display name/email; only
--    last_seen_at is bumped (the SO still snapshots its own debtor_name).
CREATE OR REPLACE FUNCTION public.upsert_customer_by_name_phone(
  p_name  text,
  p_phone text,
  p_email text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' OR p_phone IS NULL OR btrim(p_phone) = '' THEN
    RAISE EXCEPTION 'upsert_customer_by_name_phone: name and phone are both required';
  END IF;

  INSERT INTO customers (name, phone, email)
  VALUES (btrim(p_name), p_phone, NULLIF(btrim(coalesce(p_email, '')), ''))
  ON CONFLICT (lower(trim(name)), phone) WHERE phone IS NOT NULL
  DO UPDATE SET last_seen_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Only authenticated staff (who already pass the route's auth middleware) may
-- mint/refresh a customer. Mirrors next_po_number()'s grant.
REVOKE ALL ON FUNCTION public.upsert_customer_by_name_phone(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_customer_by_name_phone(text, text, text) TO authenticated;
