-- ----------------------------------------------------------------------------
-- 0203 — Canonicalize variants vocabulary (backfill).
--
-- One-time data normalization that mirrors, in SQL, the pure translator
-- `canonicalizeVariants(itemGroup, variants)` in
-- packages/shared/src/so-variant-rule.ts. The POS handover speaks a DIFFERENT
-- vocabulary for the same physical sofa facts than the Backend editors:
--
--     seat   : canonical `seatHeight` <- alias `depth`
--     leg    : canonical `legHeight`  <- alias `sofaLegHeight`
--     fabric : canonical `fabricCode` <- aliases `colorCode` / `colourCode` / `fabricColor`
--
-- Until the persist-time normalization shipped (apps/api mfg-sales-orders.ts —
-- the 3 SO persist seams + the sofa-exchange seam), POS-origin sofa rows were
-- stored with the alias keys. The 9 downstream read seams (SO/DO/SI/PO/GRN/PI/PR
-- editors) read the CANONICAL keys, so those rows rendered blank Seat/Leg/Fabric
-- dropdowns and could mis-price on a cost recompute. The code change makes every
-- NEW row canonical; this migration normalizes the EXISTING rows so the whole
-- corpus is canonical and the read-time safety nets become moot.
--
-- Semantics (per axis), faithful to canonicalizeVariants:
--   1. If the canonical key is ABSENT and the alias is PRESENT (non-empty), copy
--      the alias value into the canonical key (canonical wins if both already
--      exist — we never overwrite an existing canonical value). Aliases are tried
--      in the SAME precedence order as so-variant-rule.ts: for fabric that is
--      colorCode, then colourCode, then fabricColor — the first non-empty one
--      that fills an absent fabricCode wins (the later UPDATEs then see fabricCode
--      present and skip, exactly like the JS loop's `isEmpty(v[axis.key])` guard).
--   2. ALWAYS drop the alias keys afterwards (so a later edit of the canonical
--      value isn't shadowed by a stale alias in `alias ?? canonical` consumers).
--
-- Idempotent + re-runnable: every move is gated on the canonical key being
-- absent (`NOT (variants ? 'seatHeight')`), and every WHERE only touches rows
-- where an alias actually exists, so a second run is a no-op. No item_group
-- filter is needed — a non-sofa row simply never carries these alias keys.
--
-- Applies to the 7 tables that carry a `variants` jsonb column. Apply via the
-- Supabase MCP (the owner applies this to prod manually). Whole file is
-- transactional.
-- ----------------------------------------------------------------------------

BEGIN;

-- == mfg_sales_order_items ==
UPDATE mfg_sales_order_items
SET variants = variants || jsonb_build_object('seatHeight', variants->'depth')
WHERE variants ? 'depth'
  AND NOT (variants ? 'seatHeight')
  AND COALESCE(btrim(variants->>'depth'), '') <> '';
UPDATE mfg_sales_order_items
SET variants = variants || jsonb_build_object('legHeight', variants->'sofaLegHeight')
WHERE variants ? 'sofaLegHeight'
  AND NOT (variants ? 'legHeight')
  AND COALESCE(btrim(variants->>'sofaLegHeight'), '') <> '';
UPDATE mfg_sales_order_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'colorCode')
WHERE variants ? 'colorCode'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'colorCode'), '') <> '';
UPDATE mfg_sales_order_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'colourCode')
WHERE variants ? 'colourCode'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'colourCode'), '') <> '';
UPDATE mfg_sales_order_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'fabricColor')
WHERE variants ? 'fabricColor'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'fabricColor'), '') <> '';
UPDATE mfg_sales_order_items
SET variants = variants - 'depth' - 'sofaLegHeight' - 'fabricColor' - 'colorCode' - 'colourCode'
WHERE variants ?| array['depth', 'sofaLegHeight', 'fabricColor', 'colorCode', 'colourCode'];

-- == delivery_order_items ==
UPDATE delivery_order_items
SET variants = variants || jsonb_build_object('seatHeight', variants->'depth')
WHERE variants ? 'depth'
  AND NOT (variants ? 'seatHeight')
  AND COALESCE(btrim(variants->>'depth'), '') <> '';
UPDATE delivery_order_items
SET variants = variants || jsonb_build_object('legHeight', variants->'sofaLegHeight')
WHERE variants ? 'sofaLegHeight'
  AND NOT (variants ? 'legHeight')
  AND COALESCE(btrim(variants->>'sofaLegHeight'), '') <> '';
UPDATE delivery_order_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'colorCode')
WHERE variants ? 'colorCode'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'colorCode'), '') <> '';
UPDATE delivery_order_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'colourCode')
WHERE variants ? 'colourCode'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'colourCode'), '') <> '';
UPDATE delivery_order_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'fabricColor')
WHERE variants ? 'fabricColor'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'fabricColor'), '') <> '';
UPDATE delivery_order_items
SET variants = variants - 'depth' - 'sofaLegHeight' - 'fabricColor' - 'colorCode' - 'colourCode'
WHERE variants ?| array['depth', 'sofaLegHeight', 'fabricColor', 'colorCode', 'colourCode'];

-- == sales_invoice_items ==
UPDATE sales_invoice_items
SET variants = variants || jsonb_build_object('seatHeight', variants->'depth')
WHERE variants ? 'depth'
  AND NOT (variants ? 'seatHeight')
  AND COALESCE(btrim(variants->>'depth'), '') <> '';
UPDATE sales_invoice_items
SET variants = variants || jsonb_build_object('legHeight', variants->'sofaLegHeight')
WHERE variants ? 'sofaLegHeight'
  AND NOT (variants ? 'legHeight')
  AND COALESCE(btrim(variants->>'sofaLegHeight'), '') <> '';
UPDATE sales_invoice_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'colorCode')
WHERE variants ? 'colorCode'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'colorCode'), '') <> '';
UPDATE sales_invoice_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'colourCode')
WHERE variants ? 'colourCode'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'colourCode'), '') <> '';
UPDATE sales_invoice_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'fabricColor')
WHERE variants ? 'fabricColor'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'fabricColor'), '') <> '';
UPDATE sales_invoice_items
SET variants = variants - 'depth' - 'sofaLegHeight' - 'fabricColor' - 'colorCode' - 'colourCode'
WHERE variants ?| array['depth', 'sofaLegHeight', 'fabricColor', 'colorCode', 'colourCode'];

-- == purchase_order_items ==
UPDATE purchase_order_items
SET variants = variants || jsonb_build_object('seatHeight', variants->'depth')
WHERE variants ? 'depth'
  AND NOT (variants ? 'seatHeight')
  AND COALESCE(btrim(variants->>'depth'), '') <> '';
UPDATE purchase_order_items
SET variants = variants || jsonb_build_object('legHeight', variants->'sofaLegHeight')
WHERE variants ? 'sofaLegHeight'
  AND NOT (variants ? 'legHeight')
  AND COALESCE(btrim(variants->>'sofaLegHeight'), '') <> '';
UPDATE purchase_order_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'colorCode')
WHERE variants ? 'colorCode'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'colorCode'), '') <> '';
UPDATE purchase_order_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'colourCode')
WHERE variants ? 'colourCode'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'colourCode'), '') <> '';
UPDATE purchase_order_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'fabricColor')
WHERE variants ? 'fabricColor'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'fabricColor'), '') <> '';
UPDATE purchase_order_items
SET variants = variants - 'depth' - 'sofaLegHeight' - 'fabricColor' - 'colorCode' - 'colourCode'
WHERE variants ?| array['depth', 'sofaLegHeight', 'fabricColor', 'colorCode', 'colourCode'];

-- == grn_items ==
UPDATE grn_items
SET variants = variants || jsonb_build_object('seatHeight', variants->'depth')
WHERE variants ? 'depth'
  AND NOT (variants ? 'seatHeight')
  AND COALESCE(btrim(variants->>'depth'), '') <> '';
UPDATE grn_items
SET variants = variants || jsonb_build_object('legHeight', variants->'sofaLegHeight')
WHERE variants ? 'sofaLegHeight'
  AND NOT (variants ? 'legHeight')
  AND COALESCE(btrim(variants->>'sofaLegHeight'), '') <> '';
UPDATE grn_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'colorCode')
WHERE variants ? 'colorCode'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'colorCode'), '') <> '';
UPDATE grn_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'colourCode')
WHERE variants ? 'colourCode'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'colourCode'), '') <> '';
UPDATE grn_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'fabricColor')
WHERE variants ? 'fabricColor'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'fabricColor'), '') <> '';
UPDATE grn_items
SET variants = variants - 'depth' - 'sofaLegHeight' - 'fabricColor' - 'colorCode' - 'colourCode'
WHERE variants ?| array['depth', 'sofaLegHeight', 'fabricColor', 'colorCode', 'colourCode'];

-- == purchase_invoice_items ==
UPDATE purchase_invoice_items
SET variants = variants || jsonb_build_object('seatHeight', variants->'depth')
WHERE variants ? 'depth'
  AND NOT (variants ? 'seatHeight')
  AND COALESCE(btrim(variants->>'depth'), '') <> '';
UPDATE purchase_invoice_items
SET variants = variants || jsonb_build_object('legHeight', variants->'sofaLegHeight')
WHERE variants ? 'sofaLegHeight'
  AND NOT (variants ? 'legHeight')
  AND COALESCE(btrim(variants->>'sofaLegHeight'), '') <> '';
UPDATE purchase_invoice_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'colorCode')
WHERE variants ? 'colorCode'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'colorCode'), '') <> '';
UPDATE purchase_invoice_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'colourCode')
WHERE variants ? 'colourCode'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'colourCode'), '') <> '';
UPDATE purchase_invoice_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'fabricColor')
WHERE variants ? 'fabricColor'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'fabricColor'), '') <> '';
UPDATE purchase_invoice_items
SET variants = variants - 'depth' - 'sofaLegHeight' - 'fabricColor' - 'colorCode' - 'colourCode'
WHERE variants ?| array['depth', 'sofaLegHeight', 'fabricColor', 'colorCode', 'colourCode'];

-- == purchase_return_items ==
UPDATE purchase_return_items
SET variants = variants || jsonb_build_object('seatHeight', variants->'depth')
WHERE variants ? 'depth'
  AND NOT (variants ? 'seatHeight')
  AND COALESCE(btrim(variants->>'depth'), '') <> '';
UPDATE purchase_return_items
SET variants = variants || jsonb_build_object('legHeight', variants->'sofaLegHeight')
WHERE variants ? 'sofaLegHeight'
  AND NOT (variants ? 'legHeight')
  AND COALESCE(btrim(variants->>'sofaLegHeight'), '') <> '';
UPDATE purchase_return_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'colorCode')
WHERE variants ? 'colorCode'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'colorCode'), '') <> '';
UPDATE purchase_return_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'colourCode')
WHERE variants ? 'colourCode'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'colourCode'), '') <> '';
UPDATE purchase_return_items
SET variants = variants || jsonb_build_object('fabricCode', variants->'fabricColor')
WHERE variants ? 'fabricColor'
  AND NOT (variants ? 'fabricCode')
  AND COALESCE(btrim(variants->>'fabricColor'), '') <> '';
UPDATE purchase_return_items
SET variants = variants - 'depth' - 'sofaLegHeight' - 'fabricColor' - 'colorCode' - 'colourCode'
WHERE variants ?| array['depth', 'sofaLegHeight', 'fabricColor', 'colorCode', 'colourCode'];

COMMIT;
