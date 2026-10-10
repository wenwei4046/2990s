-- 0221 — POS Marketing: save a sofa category and its whole function list in
-- one go.
--
-- Owner 2026-10-10, Marketing › ⋯ › Maintenance: a category's edit button
-- must edit more than its name — the functions under it too ("there is only
-- Add function, no delete"). The edit dialog now holds the category's whole
-- list, and Save sends it in one piece.
--
-- One Save is several writes — rename the category, take the dropped
-- functions off, rename the kept ones, add the new ones — and they must land
-- together: a list applied halfway is a list nobody asked for. supabase-js
-- has no transactions, so they run here, as Arrive does (0217).
--
-- p_functions is the list as the dialog shows it, top to bottom:
--   [{ "id": "<a function kept>", "name": "Push back" }, { "name": "Recliner" }, …]
-- An entry with an id keeps (or renames) that function; one without adds a
-- function; a live function of the category that is not listed is taken off
-- — archived_at stamped, the row stays, as everywhere in this section.
-- p_category_id null adds the category itself. Returns the category's id.
--
-- A request stores the NAMES it was saved with (0219), so nothing here changes
-- a saved request — only what the New product form offers next.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.marketing_save_sofa_category(
  p_category_id uuid,
  p_name        text,
  p_functions   jsonb,
  p_by          text,
  p_by_name     text
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id     uuid := p_category_id;
  v_name   text := btrim(coalesce(p_name, ''));
  v_ids    uuid[];
  v_names  text[];
BEGIN
  IF v_name = '' OR length(v_name) > 60 THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
  END IF;
  IF p_functions IS NULL OR jsonb_typeof(p_functions) <> 'array' THEN
    RAISE EXCEPTION 'invalid_functions' USING ERRCODE = '22023';
  END IF;

  -- The list as sent, in its order: id (null = a new function) and name.
  SELECT coalesce(array_agg(nullif(e.v ->> 'id', '')::uuid ORDER BY e.ord), '{}'),
         coalesce(array_agg(btrim(coalesce(e.v ->> 'name', '')) ORDER BY e.ord), '{}')
    INTO v_ids, v_names
    FROM jsonb_array_elements(p_functions) WITH ORDINALITY AS e(v, ord);

  IF EXISTS (SELECT 1 FROM unnest(v_names) AS u(fname) WHERE fname = '' OR length(fname) > 60) THEN
    RAISE EXCEPTION 'invalid_function_name' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_names) AS u(fname) GROUP BY lower(fname) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'duplicate_function' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) AS u(fid) WHERE fid IS NOT NULL GROUP BY fid HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'invalid_functions' USING ERRCODE = '22023';
  END IF;

  IF v_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM marketing_sofa_options
                WHERE kind = 'category' AND archived_at IS NULL AND lower(btrim(name)) = lower(v_name)) THEN
      RAISE EXCEPTION 'duplicate_category' USING ERRCODE = '23505';
    END IF;
    INSERT INTO marketing_sofa_options (kind, name, created_by, created_by_name, updated_by, updated_by_name)
    VALUES ('category', v_name, p_by, p_by_name, p_by, p_by_name)
    RETURNING id INTO v_id;
  ELSE
    -- Locked, so two people saving the same category queue up rather than
    -- interleave their lists.
    PERFORM 1 FROM marketing_sofa_options
      WHERE id = v_id AND kind = 'category' AND archived_at IS NULL
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'category_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM marketing_sofa_options
                WHERE kind = 'category' AND archived_at IS NULL AND id <> v_id
                  AND lower(btrim(name)) = lower(v_name)) THEN
      RAISE EXCEPTION 'duplicate_category' USING ERRCODE = '23505';
    END IF;
    UPDATE marketing_sofa_options
       SET name = v_name, updated_at = now(), updated_by = p_by, updated_by_name = p_by_name
     WHERE id = v_id AND name IS DISTINCT FROM v_name;
  END IF;

  -- Every listed id must still be a live function of this category: one that
  -- someone else took off meanwhile is not quietly brought back.
  IF EXISTS (
    SELECT 1 FROM unnest(v_ids) AS u(fid)
     WHERE u.fid IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM marketing_sofa_options o
                        WHERE o.id = u.fid AND o.kind = 'function' AND o.parent_id = v_id AND o.archived_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'function_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Off the list: the live functions the dialog no longer shows.
  UPDATE marketing_sofa_options o
     SET archived_at = now(), archived_by = p_by, archived_by_name = p_by_name
   WHERE o.kind = 'function' AND o.parent_id = v_id AND o.archived_at IS NULL
     AND NOT (o.id = ANY (array_remove(v_ids, NULL)));

  -- Renames, in two steps so two names can trade places: each renamed
  -- function first steps aside under a placeholder no one types, then takes
  -- its new name. The live-name unique index (0219) is partial, so it cannot
  -- be deferred, and is checked row by row — one step would refuse a swap.
  UPDATE marketing_sofa_options o
     SET name = '~' || o.id::text
    FROM unnest(v_ids, v_names) AS x(id, name)
   WHERE o.id = x.id AND o.name IS DISTINCT FROM x.name;
  UPDATE marketing_sofa_options o
     SET name = x.name, updated_at = now(), updated_by = p_by, updated_by_name = p_by_name
    FROM unnest(v_ids, v_names) AS x(id, name)
   WHERE o.id = x.id AND o.name = '~' || o.id::text;

  -- The new ones, one at a time so `seq` follows the order listed.
  FOR k IN 1 .. coalesce(array_length(v_ids, 1), 0) LOOP
    IF v_ids[k] IS NULL THEN
      INSERT INTO marketing_sofa_options (kind, parent_id, name, created_by, created_by_name, updated_by, updated_by_name)
      VALUES ('function', v_id, v_names[k], p_by, p_by_name, p_by, p_by_name);
    END IF;
  END LOOP;

  RETURN v_id;
END;
$$;

-- Service role only, like Arrive: EXECUTE is granted to PUBLIC by default.
REVOKE ALL ON FUNCTION public.marketing_save_sofa_category(uuid, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_save_sofa_category(uuid, text, jsonb, text, text) TO service_role;
