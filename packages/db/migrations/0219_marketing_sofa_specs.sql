-- 0219 — POS Marketing: a new sofa's size, photo, category and function on the
-- launch request, and the category / function lists Marketing keeps itself.
--
-- Owner 2026-10-09, on the New product launch form:
--   · Sofa size — the display sofa's length × width, in cm.
--   · Photo — what the sofa looks like, marked Exact (the sofa in the photo)
--     or Non-exact (like it, with some details changed — and a note saying
--     which).
--   · Category (Seater, Chair, …) and, under the category, Function (Push
--     back, Slide out, …). Fabric, leg and seat come from the SKU Master;
--     these have no such source, so Marketing keeps the lists itself
--     (Marketing → ⋯ → Maintenance).
-- Saving a request at all (even to Pending Info) now needs its supplier code,
-- and on a sofa also its size, photo, category and function. The API enforces
-- that (apps/api/src/routes/marketing.ts); the columns stay permissive so a
-- request saved before today still loads.
--
-- ── THE PHOTO LIVES ON THE REQUEST ROW ──────────────────────────────────────
-- One photo per request, written by the same INSERT / UPDATE as the rest of
-- the request, so a sofa can never be saved without the photo it needs.
-- Downscaled in the browser first; held inline like a floor plan (0217) — no
-- bucket to provision or reap. /state never selects photo_b64; GET
-- /marketing/requests/:id/photo does, one request at a time. Arrive does not
-- copy it: the display keeps source_request_id and reads the photo through it.
--
-- ── SIZE, CATEGORY AND FUNCTION GO ONTO THE DISPLAY ─────────────────────────
-- Arrive carries them onto the display it creates, as it carries fabric and
-- seat. Prices are still never carried (0217).
--
-- ── A RECORD STORES THE NAME, NOT A LINK ────────────────────────────────────
-- A request stores the category and function NAME it was saved with, the way
-- it stores its fabric series and leg height. Renaming or removing an option
-- changes what the form offers next, never what a saved request says.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE marketing_launch_requests
  ADD COLUMN IF NOT EXISTS length_cm           integer,
  ADD COLUMN IF NOT EXISTS width_cm            integer,
  ADD COLUMN IF NOT EXISTS sofa_category       text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sofa_function       text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS photo_content_type  text,
  ADD COLUMN IF NOT EXISTS photo_b64           text,
  ADD COLUMN IF NOT EXISTS photo_bytes         integer,
  ADD COLUMN IF NOT EXISTS photo_file_name     text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS photo_updated_at    timestamptz,
  -- '' (not chosen yet) | 'exact' | 'non_exact'
  ADD COLUMN IF NOT EXISTS photo_match         text NOT NULL DEFAULT '',
  -- What differs from the photo; kept only on a Non-exact photo.
  ADD COLUMN IF NOT EXISTS photo_note          text NOT NULL DEFAULT '';

DO $$ BEGIN
  ALTER TABLE marketing_launch_requests
    ADD CONSTRAINT marketing_launch_requests_size_chk
    CHECK ((length_cm IS NULL OR length_cm BETWEEN 1 AND 1000)
       AND (width_cm  IS NULL OR width_cm  BETWEEN 1 AND 1000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A photo is all of its columns or none of them. ~3 MB is the backstop
-- against a hand-rolled request; the POS sends a few hundred KB.
DO $$ BEGIN
  ALTER TABLE marketing_launch_requests
    ADD CONSTRAINT marketing_launch_requests_photo_chk
    CHECK (
      (photo_b64 IS NULL AND photo_content_type IS NULL AND photo_bytes IS NULL AND photo_updated_at IS NULL)
      OR (photo_b64 IS NOT NULL AND photo_updated_at IS NOT NULL
          AND photo_content_type IN ('image/png', 'image/jpeg', 'image/webp')
          AND photo_bytes > 0 AND photo_bytes <= 3145728)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE marketing_launch_requests
    ADD CONSTRAINT marketing_launch_requests_match_chk
    CHECK (photo_match IN ('', 'exact', 'non_exact'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE marketing_displays
  ADD COLUMN IF NOT EXISTS length_cm      integer,
  ADD COLUMN IF NOT EXISTS width_cm       integer,
  ADD COLUMN IF NOT EXISTS sofa_category  text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sofa_function  text NOT NULL DEFAULT '';

DO $$ BEGIN
  ALTER TABLE marketing_displays
    ADD CONSTRAINT marketing_displays_size_chk
    CHECK ((length_cm IS NULL OR length_cm BETWEEN 1 AND 1000)
       AND (width_cm  IS NULL OR width_cm  BETWEEN 1 AND 1000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── The category / function lists ───────────────────────────────────────────
-- Two levels in one table: a 'category' row has no parent; a 'function' row
-- belongs to one category. Listed in the order they were added (seq). Remove
-- stamps archived_at (a category takes its functions with it); a name is
-- unique among the live rows at its level, so a removed name can come back.
CREATE TABLE IF NOT EXISTS marketing_sofa_options (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text NOT NULL,
  parent_id         uuid REFERENCES marketing_sofa_options (id),
  name              text NOT NULL,
  seq               serial NOT NULL,
  created_by        text,
  created_by_name   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text,
  updated_by_name   text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz,
  archived_by       text,
  archived_by_name  text,
  CONSTRAINT marketing_sofa_options_kind_chk   CHECK (kind IN ('category', 'function')),
  CONSTRAINT marketing_sofa_options_parent_chk CHECK ((kind = 'category') = (parent_id IS NULL)),
  CONSTRAINT marketing_sofa_options_name_chk   CHECK (btrim(name) <> '' AND length(name) <= 60)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_sofa_options_live_name
  ON marketing_sofa_options (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)))
  WHERE archived_at IS NULL;

-- Service role only, like the other marketing tables: RLS on, no policy.
ALTER TABLE marketing_sofa_options ENABLE ROW LEVEL SECURITY;

-- The owner's starting lists (2026-10-09): Seater and Chair, each with Fixed
-- for a sofa that has no mechanism, and Seater with Push back and Slide out.
-- Only into an empty table, so running this again never undoes Marketing's
-- own edits.
WITH seeded AS (
  INSERT INTO marketing_sofa_options (kind, name)
  SELECT 'category', c.name
    FROM (VALUES (1, 'Seater'), (2, 'Chair')) AS c (ord, name)
   WHERE NOT EXISTS (SELECT 1 FROM marketing_sofa_options)
   ORDER BY c.ord
  RETURNING id, name
)
INSERT INTO marketing_sofa_options (kind, parent_id, name)
SELECT 'function', seeded.id, f.name
  FROM seeded
  JOIN (VALUES (1, 'Seater', 'Fixed'), (2, 'Seater', 'Push back'), (3, 'Seater', 'Slide out'), (4, 'Chair', 'Fixed'))
       AS f (ord, category, name) ON f.category = seeded.name
 ORDER BY f.ord;

-- ── Arrive, now carrying size, category and function ────────────────────────
-- Same function as 0217 plus the four new columns onto the display.
CREATE OR REPLACE FUNCTION public.marketing_arrive_launch_request(
  p_request_id uuid,
  p_by         text,
  p_by_name    text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r            marketing_launch_requests%ROWTYPE;
  old_name     text;
  new_id       uuid;
BEGIN
  SELECT * INTO r FROM marketing_launch_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF r.status <> 'completed' THEN
    RAISE EXCEPTION 'request_not_completed' USING ERRCODE = 'P0001';
  END IF;

  IF r.action = 'replace' AND r.replace_display_id IS NOT NULL THEN
    UPDATE marketing_displays
       SET removed_at = now(), removed_by = p_by, removed_by_name = p_by_name
     WHERE id = r.replace_display_id AND removed_at IS NULL
     RETURNING name INTO old_name;
  END IF;

  INSERT INTO marketing_displays (
    venue_id, type, name, code, is_new,
    fabric, colour, leg, seat, modules, size, height, divan, gap,
    length_cm, width_cm, sofa_category, sofa_function,
    source_request_id, created_by, created_by_name
  ) VALUES (
    r.venue_id, r.type, r.model, r.supplier_code, true,
    r.fabric, r.colour, r.leg, r.seat, r.modules, r.size, r.height, r.divan, r.gap,
    r.length_cm, r.width_cm, r.sofa_category, r.sofa_function,
    r.id, p_by, p_by_name
  ) RETURNING id INTO new_id;

  UPDATE marketing_launch_requests
     SET status = 'arrived', arrived_at = now(), arrived_by = p_by,
         arrived_by_name = p_by_name, arrived_display_id = new_id, updated_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object('displayId', new_id, 'removedName', old_name);
END;
$$;

-- CREATE OR REPLACE keeps the grants 0217 set; restated so this file stands
-- on its own. EXECUTE is granted to PUBLIC by default (0212).
REVOKE ALL ON FUNCTION public.marketing_arrive_launch_request(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_arrive_launch_request(uuid, text, text) TO service_role;
