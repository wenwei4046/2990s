-- 0220 — POS Marketing: a sofa's LAYOUT, as laid out on the Custom build canvas.
--
-- Owner 2026-10-09: the Marketing builder must be "the same as the original
-- space planning — can rotate and edit", so it is now the POS Custom build
-- canvas itself (CustomBuilder in its layoutOnly mode). A sofa built there is
-- more than a left-to-right module list: a chaise turned 90°, a corner, two
-- rows. `modules` keeps the left-to-right read (labels, the spec line, the
-- export); `layout` keeps how it was laid out, so editing reopens it as it was
-- and every preview draws it as built.
--
-- [{ "id": "…", "moduleId": "2A(LHF)", "x": 152.5, "y": 192.5, "rot": 0 }, …]
-- x / y in cm inside the canvas room, rot 0 / 90 / 180 / 270. The API checks
-- each cell's shape (routes/marketing.ts, layoutCell). null = a record saved
-- before the canvas, which still draws from its module list.
--
-- A combo on the reference price list carries its own layout inside
-- combo_rows (jsonb already, no column needed). Arrive carries the layout
-- onto the display it creates, as it carries `modules`.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE marketing_launch_requests ADD COLUMN IF NOT EXISTS layout jsonb;
ALTER TABLE marketing_displays        ADD COLUMN IF NOT EXISTS layout jsonb;

DO $$ BEGIN
  ALTER TABLE marketing_launch_requests
    ADD CONSTRAINT marketing_launch_requests_layout_chk
    CHECK (layout IS NULL OR jsonb_typeof(layout) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE marketing_displays
    ADD CONSTRAINT marketing_displays_layout_chk
    CHECK (layout IS NULL OR jsonb_typeof(layout) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Arrive, now carrying the layout too ─────────────────────────────────────
-- 0219's function plus `layout` onto the display.
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
    fabric, colour, leg, seat, modules, layout, size, height, divan, gap,
    length_cm, width_cm, sofa_category, sofa_function,
    source_request_id, created_by, created_by_name
  ) VALUES (
    r.venue_id, r.type, r.model, r.supplier_code, true,
    r.fabric, r.colour, r.leg, r.seat, r.modules, r.layout, r.size, r.height, r.divan, r.gap,
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

-- CREATE OR REPLACE keeps the grants; restated so this file stands on its own.
REVOKE ALL ON FUNCTION public.marketing_arrive_launch_request(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_arrive_launch_request(uuid, text, text) TO service_role;
