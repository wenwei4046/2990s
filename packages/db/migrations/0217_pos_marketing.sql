-- 0217 — POS Marketing: what is on display in each showroom, each showroom's
-- floor plan, and the Management → Marketing hand-off for new products.
--
-- Owner 2026-10-08: a Marketing section in the POS sidebar, used to talk to
-- Management — what every showroom physically has on the floor, and the new
-- products on their way to it. Design: "Marketing 展厅陈列系统" (Claude Design
-- handoff, screens 02–09).
--
-- ── WHY HERE AND NOT IN HOUZS ───────────────────────────────────────────────
-- Same reasoning as commission (0215): this is POS-owned data that no Houzs
-- screen reads, so it lives in the POS's own database and is reached through
-- apps/api/src/routes/marketing.ts, which authenticates the caller by replaying
-- their HOUZS bearer to Houzs /auth/me (lib/houzs-identity.ts).
--
-- ── NO FOREIGN KEYS ACROSS THE BOUNDARY ─────────────────────────────────────
-- `venue_id` is a Houzs project_venues id (the SAME branch list the order form
-- and commission use — Loo 2026-08-31, "确保和 venue 是一样的"); `model_id` is a
-- Houzs product_models id; the `*_by` columns are Houzs user ids. Every one of
-- those rows is in another database, so each is an opaque text reference with
-- a display-name SNAPSHOT beside it where a person reads it later (0212, 0215).
--
-- ── NO RECORD IS HARD-DELETED ───────────────────────────────────────────────
-- "Remove from display" stamps removed_at; "Delete request" moves the request
-- to status 'deleted'; "Arrive" moves it to 'arrived' and records the display
-- row it created. The screens only ever show live rows, but who took what off
-- which floor, and when, stays answerable. (A floor plan is an image, not a
-- record: Replace overwrites it and Remove deletes it.)
--
-- ── PRICES ──────────────────────────────────────────────────────────────────
-- A launch request's combo price list is a REFERENCE for Marketing's price
-- list, whole ringgit, held as JSON on the request. It is deliberately not
-- carried onto the display row: the selling price is still set in the SKU
-- Master, and nothing here may become a second price source.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketing_displays (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          text NOT NULL,
  type              text NOT NULL,
  model_id          text,
  name              text NOT NULL DEFAULT '',
  code              text NOT NULL DEFAULT '',
  photo_url         text,
  is_new            boolean NOT NULL DEFAULT false,
  fabric            text NOT NULL DEFAULT '',
  colour            text NOT NULL DEFAULT '',
  leg               text NOT NULL DEFAULT '',
  seat              text NOT NULL DEFAULT '',
  modules           text[] NOT NULL DEFAULT '{}',
  size              text NOT NULL DEFAULT '',
  height            text NOT NULL DEFAULT '',
  divan             text NOT NULL DEFAULT '',
  gap               text NOT NULL DEFAULT '',
  qty               integer NOT NULL DEFAULT 1,
  source_request_id uuid,
  created_by        text,
  created_by_name   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  removed_at        timestamptz,
  removed_by        text,
  removed_by_name   text,
  CONSTRAINT marketing_displays_type_chk CHECK (type IN ('sofa', 'mattress', 'bedframe', 'accessory')),
  CONSTRAINT marketing_displays_qty_chk  CHECK (qty >= 1)
);

-- The screen only ever lists what is still on the floor, per showroom.
CREATE INDEX IF NOT EXISTS idx_marketing_displays_live
  ON marketing_displays (venue_id, created_at)
  WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS marketing_floorplans (
  venue_id          text PRIMARY KEY,
  content_type      text NOT NULL,
  -- A layout image from the design team, downscaled in the browser before
  -- upload. Held inline rather than in a bucket: one row per showroom, read one
  -- at a time, and no new storage to provision or reap.
  image_b64         text NOT NULL,
  byte_size         integer NOT NULL,
  file_name         text NOT NULL DEFAULT '',
  uploaded_by       text,
  uploaded_by_name  text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_floorplans_type_chk CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  -- ~3 MB of image. The POS sends ≤ 1.5 MB after downscaling; this is the
  -- backstop against a hand-rolled request, not the working limit.
  CONSTRAINT marketing_floorplans_size_chk CHECK (byte_size > 0 AND byte_size <= 3145728)
);

CREATE TABLE IF NOT EXISTS marketing_launch_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type                text NOT NULL,
  status              text NOT NULL DEFAULT 'pending',
  supplier_code       text NOT NULL DEFAULT '',
  model               text NOT NULL DEFAULT '',
  fabric              text NOT NULL DEFAULT '',
  colour              text NOT NULL DEFAULT '',
  leg                 text NOT NULL DEFAULT '',
  seat                text NOT NULL DEFAULT '',
  size                text NOT NULL DEFAULT '',
  height              text NOT NULL DEFAULT '',
  divan               text NOT NULL DEFAULT '',
  gap                 text NOT NULL DEFAULT '',
  modules             text[] NOT NULL DEFAULT '{}',
  -- [{ "modules": ["2A(LHF)", "L(RHF)"], "price": 3540 }] — price whole RM,
  -- or null while not yet typed. Reference only (header).
  combo_rows          jsonb NOT NULL DEFAULT '[]'::jsonb,
  venue_id            text NOT NULL,
  action              text NOT NULL,
  replace_display_id  uuid REFERENCES marketing_displays (id),
  requested_by        text,
  requested_by_name   text,
  requested_by_role   text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text,
  updated_by_name     text,
  completed_at        timestamptz,
  arrived_at          timestamptz,
  arrived_by          text,
  arrived_by_name     text,
  arrived_display_id  uuid REFERENCES marketing_displays (id),
  deleted_at          timestamptz,
  deleted_by          text,
  deleted_by_name     text,
  CONSTRAINT marketing_launch_requests_type_chk   CHECK (type IN ('sofa', 'mattress', 'bedframe')),
  CONSTRAINT marketing_launch_requests_status_chk CHECK (status IN ('pending', 'completed', 'arrived', 'deleted')),
  CONSTRAINT marketing_launch_requests_action_chk CHECK (action IN ('add', 'replace')),
  CONSTRAINT marketing_launch_requests_rows_chk   CHECK (jsonb_typeof(combo_rows) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_marketing_launch_requests_open
  ON marketing_launch_requests (status, created_at DESC)
  WHERE status IN ('pending', 'completed');

-- The display row an arrival created points back at its request.
DO $$ BEGIN
  ALTER TABLE marketing_displays
    ADD CONSTRAINT marketing_displays_source_request_fk
    FOREIGN KEY (source_request_id) REFERENCES marketing_launch_requests (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── RLS: service role only ──────────────────────────────────────────────────
-- No RLS policy can see a Houzs identity, so the API runs on the service-role
-- client and these tables grant nothing to anon / authenticated. Enabling RLS
-- with no policy is the deny-all.
ALTER TABLE marketing_displays        ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_floorplans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_launch_requests ENABLE ROW LEVEL SECURITY;

-- ── Arrive ──────────────────────────────────────────────────────────────────
-- "Arrive" is three writes that must land together or not at all: the new
-- piece goes on the floor, the piece it replaces comes off, and the request
-- leaves the board. Run as one function so a failure halfway cannot leave a
-- showroom with both sofas, or with neither.
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
    source_request_id, created_by, created_by_name
  ) VALUES (
    r.venue_id, r.type, r.model, r.supplier_code, true,
    r.fabric, r.colour, r.leg, r.seat, r.modules, r.size, r.height, r.divan, r.gap,
    r.id, p_by, p_by_name
  ) RETURNING id INTO new_id;

  UPDATE marketing_launch_requests
     SET status = 'arrived', arrived_at = now(), arrived_by = p_by,
         arrived_by_name = p_by_name, arrived_display_id = new_id, updated_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object('displayId', new_id, 'removedName', old_name);
END;
$$;

-- EXECUTE is granted to PUBLIC by default; REVOKE alone is not enough (0212).
REVOKE ALL ON FUNCTION public.marketing_arrive_launch_request(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_arrive_launch_request(uuid, text, text) TO service_role;
