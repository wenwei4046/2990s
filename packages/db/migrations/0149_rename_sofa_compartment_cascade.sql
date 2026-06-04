-- 0149 — rename_sofa_compartment(): Maintenance-is-master cascade rename.
-- Loo 2026-06-04: "i need this all link automatically with maintenance, what
-- maintenance change all will follow." Renaming a sofa compartment code on
-- the Maintenance master pool now cascades ATOMICALLY through every place
-- the code text is stored, so the system keeps exactly ONE name:
--
--   · mfg_products            code suffix (BLATT-3S) + name suffix (SOFA BLATT 3S)
--   · doc lines               item_code / material_code / supplier_sku suffixes on
--                             SO / DO / DR / SI / GRN / PO / PI / PR / consignment
--                             (+ description word-boundary rename on SO/DO/SI lines)
--   · pwp_codes               trigger_item_code / redeemed_item_code suffixes
--   · supplier_material_bindings material_code / supplier_sku suffixes
--   · product_models          allowed_options JSON token
--   · sofa_combo_pricing      modules JSON token
--   · sofa_quick_picks / sofa_personal_quick_picks  modules JSON token
--   · pos_carts               lines JSON token (in-flight carts)
--   · mfg_sales_order_items   variants JSON token (sofa cell snapshots)
--   · maintenance_config_history  config JSON token (pool array, meta key,
--                             quick presets) — ALL scopes + history rows
--   · compartment_library / product_compartments (legacy retail pricing)
--
-- SECURITY DEFINER + is_admin() gate: callable through PostgREST rpc by an
-- admin staff JWT; RLS on the touched tables is bypassed by design (this is
-- a master-data operation). Raises on empty/same/colliding codes so the API
-- can surface a clean 400. Returns per-table change counts as jsonb.

CREATE OR REPLACE FUNCTION public.rename_sofa_compartment(p_from text, p_to text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_from    text := trim(p_from);
  v_to      text := trim(p_to);
  tok_from  text;
  tok_to    text;
  counts    jsonb := '{}'::jsonb;
  n         int;
  -- word-boundary pattern for plain-text descriptions: the code, not preceded
  -- by a code character, not followed by one — and NOT followed by '(' so a
  -- rename of '1S' never eats the '1S' inside '1S(P)'.
  re_from   text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_from = '' OR v_to = '' THEN
    RAISE EXCEPTION 'empty_code';
  END IF;
  IF v_from = v_to THEN
    RAISE EXCEPTION 'same_code';
  END IF;
  -- Collision guard: the target name must not already exist in the live pool.
  IF EXISTS (
    SELECT 1
      FROM maintenance_config_history h
     WHERE h.scope = 'master'
       AND h.effective_from <= CURRENT_DATE
       AND (h.config->'sofaCompartments') ? v_to
     ORDER BY h.effective_from DESC, h.created_at DESC
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'code_exists';
  END IF;

  tok_from := to_jsonb(v_from)::text;   -- e.g. "1A(LHF)" with proper escaping
  tok_to   := to_jsonb(v_to)::text;
  re_from  := regexp_replace(v_from, '([\\^$.|?*+()\[\]{}])', '\\\1', 'g');

  -- ── SKU master: code suffix + name suffix ────────────────────────────
  UPDATE mfg_products
     SET code = left(code, length(code) - length(v_from)) || v_to,
         name = CASE WHEN right(name, length(v_from) + 1) = ' ' || v_from
                     THEN left(name, length(name) - length(v_from)) || v_to
                     ELSE name END
   WHERE category = 'SOFA'
     AND right(code, length(v_from) + 1) = '-' || v_from;
  GET DIAGNOSTICS n = ROW_COUNT;
  counts := counts || jsonb_build_object('mfg_products', n);

  -- ── Doc line code suffixes (TEXT snapshots across the doc flow) ──────
  -- item_code-style columns: value is '<BASE>-<compartment>'.
  UPDATE mfg_sales_order_items SET item_code = left(item_code, length(item_code) - length(v_from)) || v_to
   WHERE right(item_code, length(v_from) + 1) = '-' || v_from;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('mfg_sales_order_items_code', n);

  UPDATE mfg_so_price_overrides SET item_code = left(item_code, length(item_code) - length(v_from)) || v_to
   WHERE right(item_code, length(v_from) + 1) = '-' || v_from;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('mfg_so_price_overrides', n);

  UPDATE delivery_order_items SET item_code = left(item_code, length(item_code) - length(v_from)) || v_to
   WHERE right(item_code, length(v_from) + 1) = '-' || v_from;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('delivery_order_items', n);

  UPDATE delivery_return_items SET item_code = left(item_code, length(item_code) - length(v_from)) || v_to
   WHERE right(item_code, length(v_from) + 1) = '-' || v_from;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('delivery_return_items', n);

  UPDATE sales_invoice_items SET item_code = left(item_code, length(item_code) - length(v_from)) || v_to
   WHERE right(item_code, length(v_from) + 1) = '-' || v_from;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('sales_invoice_items', n);

  UPDATE consignment_note_items SET item_code = left(item_code, length(item_code) - length(v_from)) || v_to
   WHERE right(item_code, length(v_from) + 1) = '-' || v_from;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('consignment_note_items', n);

  UPDATE consignment_order_items SET item_code = left(item_code, length(item_code) - length(v_from)) || v_to
   WHERE right(item_code, length(v_from) + 1) = '-' || v_from;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('consignment_order_items', n);

  UPDATE purchase_consignment_note_items SET item_code = left(item_code, length(item_code) - length(v_from)) || v_to
   WHERE right(item_code, length(v_from) + 1) = '-' || v_from;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('purchase_consignment_note_items', n);

  UPDATE grn_items SET
         material_code = CASE WHEN right(material_code, length(v_from) + 1) = '-' || v_from
                              THEN left(material_code, length(material_code) - length(v_from)) || v_to ELSE material_code END,
         supplier_sku  = CASE WHEN right(coalesce(supplier_sku, ''), length(v_from) + 1) = '-' || v_from
                              THEN left(supplier_sku, length(supplier_sku) - length(v_from)) || v_to ELSE supplier_sku END
   WHERE right(material_code, length(v_from) + 1) = '-' || v_from
      OR right(coalesce(supplier_sku, ''), length(v_from) + 1) = '-' || v_from;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('grn_items', n);

  UPDATE purchase_order_items SET
         material_code = CASE WHEN right(material_code, length(v_from) + 1) = '-' || v_from
                              THEN left(material_code, length(material_code) - length(v_from)) || v_to ELSE material_code END,
         supplier_sku  = CASE WHEN right(coalesce(supplier_sku, ''), length(v_from) + 1) = '-' || v_from
                              THEN left(supplier_sku, length(supplier_sku) - length(v_from)) || v_to ELSE supplier_sku END
   WHERE right(material_code, length(v_from) + 1) = '-' || v_from
      OR right(coalesce(supplier_sku, ''), length(v_from) + 1) = '-' || v_from;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('purchase_order_items', n);

  UPDATE purchase_consignment_order_items SET material_code = left(material_code, length(material_code) - length(v_from)) || v_to
   WHERE right(material_code, length(v_from) + 1) = '-' || v_from;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('purchase_consignment_order_items', n);

  UPDATE purchase_invoice_items SET material_code = left(material_code, length(material_code) - length(v_from)) || v_to
   WHERE right(material_code, length(v_from) + 1) = '-' || v_from;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('purchase_invoice_items', n);

  UPDATE purchase_return_items SET material_code = left(material_code, length(material_code) - length(v_from)) || v_to
   WHERE right(material_code, length(v_from) + 1) = '-' || v_from;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('purchase_return_items', n);

  UPDATE supplier_material_bindings SET
         material_code = CASE WHEN right(material_code, length(v_from) + 1) = '-' || v_from
                              THEN left(material_code, length(material_code) - length(v_from)) || v_to ELSE material_code END,
         supplier_sku  = CASE WHEN right(coalesce(supplier_sku, ''), length(v_from) + 1) = '-' || v_from
                              THEN left(supplier_sku, length(supplier_sku) - length(v_from)) || v_to ELSE supplier_sku END
   WHERE right(material_code, length(v_from) + 1) = '-' || v_from
      OR right(coalesce(supplier_sku, ''), length(v_from) + 1) = '-' || v_from;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('supplier_material_bindings', n);

  UPDATE pwp_codes SET
         trigger_item_code  = CASE WHEN right(coalesce(trigger_item_code, ''), length(v_from) + 1) = '-' || v_from
                                   THEN left(trigger_item_code, length(trigger_item_code) - length(v_from)) || v_to ELSE trigger_item_code END,
         redeemed_item_code = CASE WHEN right(coalesce(redeemed_item_code, ''), length(v_from) + 1) = '-' || v_from
                                   THEN left(redeemed_item_code, length(redeemed_item_code) - length(v_from)) || v_to ELSE redeemed_item_code END
   WHERE right(coalesce(trigger_item_code, ''), length(v_from) + 1) = '-' || v_from
      OR right(coalesce(redeemed_item_code, ''), length(v_from) + 1) = '-' || v_from;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('pwp_codes', n);

  -- ── Plain-text descriptions (SO/DO/SI snapshots) ─────────────────────
  -- Word-boundary rename: the code must not be preceded/followed by a code
  -- character, and must NOT be followed by '(' (so '1S' never matches the
  -- '1S' inside '1S(P)'). '-' is allowed before (item codes inside text).
  UPDATE mfg_sales_order_items
     SET description  = regexp_replace(description,  '(^|[^A-Za-z0-9)])' || re_from || '($|[^A-Za-z0-9(])', '\1' || v_to || '\2', 'g'),
         description2 = CASE WHEN description2 IS NOT NULL
                             THEN regexp_replace(description2, '(^|[^A-Za-z0-9)])' || re_from || '($|[^A-Za-z0-9(])', '\1' || v_to || '\2', 'g')
                             ELSE description2 END
   WHERE description ~ ('(^|[^A-Za-z0-9)])' || re_from || '($|[^A-Za-z0-9(])')
      OR coalesce(description2, '') ~ ('(^|[^A-Za-z0-9)])' || re_from || '($|[^A-Za-z0-9(])');
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('mfg_sales_order_items_desc', n);

  -- ── JSONB token replacements ─────────────────────────────────────────
  UPDATE product_models
     SET allowed_options = replace(allowed_options::text, tok_from, tok_to)::jsonb
   WHERE position(tok_from in allowed_options::text) > 0;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('product_models', n);

  UPDATE sofa_combo_pricing
     SET modules = replace(modules::text, tok_from, tok_to)::jsonb
   WHERE position(tok_from in modules::text) > 0;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('sofa_combo_pricing', n);

  UPDATE sofa_quick_picks
     SET modules = replace(modules::text, tok_from, tok_to)::jsonb
   WHERE position(tok_from in modules::text) > 0;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('sofa_quick_picks', n);

  UPDATE sofa_personal_quick_picks
     SET modules = replace(modules::text, tok_from, tok_to)::jsonb
   WHERE position(tok_from in modules::text) > 0;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('sofa_personal_quick_picks', n);

  UPDATE pos_carts
     SET lines = replace(lines::text, tok_from, tok_to)::jsonb
   WHERE position(tok_from in lines::text) > 0;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('pos_carts', n);

  UPDATE mfg_sales_order_items
     SET variants = replace(variants::text, tok_from, tok_to)::jsonb
   WHERE variants IS NOT NULL AND position(tok_from in variants::text) > 0;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('mfg_sales_order_items_variants', n);

  -- Maintenance config blobs (ALL scopes + history) — pool array entries,
  -- sofaCompartmentMeta object KEY, sofaQuickPresets module codes. The meta
  -- imageKey VALUES are intentionally untouched: they are storage paths that
  -- still point at the existing R2 object / bundled file.
  UPDATE maintenance_config_history
     SET config = replace(config::text, tok_from, tok_to)::jsonb
   WHERE position(tok_from in config::text) > 0;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('maintenance_config_history', n);

  -- ── Legacy retail compartment library + per-Model pricing ───────────
  INSERT INTO compartment_library (id, comp_group, label, width_cm, depth_cm, cushions, default_price, art_filename, is_accessory, sort_order)
  SELECT v_to, comp_group, label, width_cm, depth_cm, cushions, default_price, art_filename, is_accessory, sort_order
    FROM compartment_library WHERE id = v_from
  ON CONFLICT (id) DO NOTHING;

  UPDATE product_compartments SET compartment_id = v_to WHERE compartment_id = v_from;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('product_compartments', n);

  DELETE FROM compartment_library
   WHERE id = v_from AND EXISTS (SELECT 1 FROM compartment_library WHERE id = v_to);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('compartment_library', n);

  RETURN jsonb_build_object('from', v_from, 'to', v_to, 'changed', counts);
END;
$fn$;

-- PostgREST exposure: only authenticated staff may even attempt the call;
-- the is_admin() gate inside enforces the real permission.
REVOKE ALL ON FUNCTION public.rename_sofa_compartment(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_sofa_compartment(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_sofa_compartment(text, text) TO service_role;
