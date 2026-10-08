-- 0218 — POS Marketing: the showroom list is the POS's own.
--
-- Owner 2026-10-09: showrooms are added in the POS itself — the Showroom
-- display tab is a record, and need not follow the branch list the order form
-- uses. Until now that tab listed Houzs's venue master (/venues) and every 0217
-- row's `venue_id` held a Houzs project_venues id. From here the list is this
-- table, kept from the Marketing section (add, rename, remove), and `venue_id`
-- points at it. Sales analysis is unaffected: its showrooms are the venue each
-- Houzs order was placed at.
--
-- ── WHY THE COLUMNS KEEP THEIR NAME ─────────────────────────────────────────
-- `venue_id` on marketing_displays / marketing_floorplans /
-- marketing_launch_requests now holds a marketing_showrooms.id. Renaming it
-- would touch the API, the POS wire shapes and the arrive function for no
-- change in meaning that this header and the foreign keys below do not state.
--
-- ── ROWS ALREADY WRITTEN ────────────────────────────────────────────────────
-- A 0217 row already points at a Houzs venue id. Each such id becomes a
-- showroom here, named "Showroom <id>", so the foreign keys go on without
-- losing a record; it can be renamed from the POS. (The three tables were empty
-- on 2026-10-09; this is the backstop, not the expected path.)
--
-- ── NOTHING IS HARD-DELETED ─────────────────────────────────────────────────
-- Remove stamps archived_at, and the API refuses it while the showroom still
-- has a piece on display or an open launch request, so no live record is left
-- under a showroom the screen no longer lists. A name is unique among the
-- showrooms still listed, so a removed showroom's name can be used again.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketing_showrooms (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name              text NOT NULL,
  area              text NOT NULL DEFAULT '',
  created_by        text,
  created_by_name   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text,
  updated_by_name   text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz,
  archived_by       text,
  archived_by_name  text,
  CONSTRAINT marketing_showrooms_name_chk CHECK (btrim(name) <> '' AND length(name) <= 80),
  CONSTRAINT marketing_showrooms_area_chk CHECK (length(area) <= 120)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_showrooms_live_name
  ON marketing_showrooms (lower(btrim(name)))
  WHERE archived_at IS NULL;

-- Service role only, like the 0217 tables: enabling RLS with no policy is the
-- deny-all for anon / authenticated.
ALTER TABLE marketing_showrooms ENABLE ROW LEVEL SECURITY;

-- The backstop above: every venue id a 0217 row carries becomes a showroom.
INSERT INTO marketing_showrooms (id, name)
SELECT v.venue_id, 'Showroom ' || v.venue_id
  FROM (
    SELECT venue_id FROM marketing_displays
    UNION SELECT venue_id FROM marketing_floorplans
    UNION SELECT venue_id FROM marketing_launch_requests
  ) v
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  ALTER TABLE marketing_displays
    ADD CONSTRAINT marketing_displays_showroom_fk
    FOREIGN KEY (venue_id) REFERENCES marketing_showrooms (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE marketing_floorplans
    ADD CONSTRAINT marketing_floorplans_showroom_fk
    FOREIGN KEY (venue_id) REFERENCES marketing_showrooms (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE marketing_launch_requests
    ADD CONSTRAINT marketing_launch_requests_showroom_fk
    FOREIGN KEY (venue_id) REFERENCES marketing_showrooms (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
