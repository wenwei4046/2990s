-- 0222 — POS Marketing › Showroom display: remarks, a photo and a diagram-only
-- size on a piece on display (ticket 2990-0021).
--
--   remarks            free text, editable later in the piece's detail panel.
--   dims_width_cm /
--   dims_depth_cm      the overall W x D printed on the sofa layout diagram,
--                      typed in Marketing. Display-specific: the product, the
--                      launch request and every other module keep their own
--                      size. NULL = draw the size computed from the layout.
--   own_photo_*        a PNG / JPG attached when the piece is added, stored
--                      inline like a launch request's photo (0219). Never in
--                      /state; read one piece at a time.
--
-- Reverse (nothing else reads these columns):
--   ALTER TABLE marketing_displays
--     DROP CONSTRAINT IF EXISTS marketing_displays_dims_chk,
--     DROP COLUMN remarks, DROP COLUMN dims_width_cm, DROP COLUMN dims_depth_cm,
--     DROP COLUMN own_photo_content_type, DROP COLUMN own_photo_b64,
--     DROP COLUMN own_photo_file_name, DROP COLUMN own_photo_updated_at;
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE marketing_displays
  ADD COLUMN IF NOT EXISTS remarks                text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS dims_width_cm          integer,
  ADD COLUMN IF NOT EXISTS dims_depth_cm          integer,
  ADD COLUMN IF NOT EXISTS own_photo_content_type text,
  ADD COLUMN IF NOT EXISTS own_photo_b64          text,
  ADD COLUMN IF NOT EXISTS own_photo_file_name    text,
  ADD COLUMN IF NOT EXISTS own_photo_updated_at   timestamptz;

DO $$ BEGIN
  ALTER TABLE marketing_displays
    ADD CONSTRAINT marketing_displays_dims_chk
    CHECK (
      (dims_width_cm IS NULL AND dims_depth_cm IS NULL)
      OR (dims_width_cm BETWEEN 1 AND 1000 AND dims_depth_cm BETWEEN 1 AND 1000)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
