-- 0127_fabric_library_from_converter.sql
-- Chairman 2026-06-01: the POS *selling* fabric library (fabric_library + fabric_colours)
-- becomes a SERIES / COLOUR projection of the Backend Fabric Converter (fabric_trackings).
--   • series  = the fabric_code prefix before the first '-'   (BF-01  -> 'BF')
--   • colour  = each fabric_trackings.fabric_code             (BF-01 ; CG-002 'Sand' ; ...)
-- The colour LABEL is the colour name after the code in fabric_description
-- ("CG-002 Sand" -> "Sand"), falling back to the bare code when the description
-- carries no colour name (e.g. "BF-01").
--
-- Selling tiers (fabric_library.sofa_tier / bedframe_tier) + the Δ config stay
-- POS-only and are left untouched here (NULL = Price 1 = +RM0 until Master Admin
-- sets them). The COST ledger (fabric_trackings) is NOT touched.
--
-- The 3 seed demo fabrics (linen / velvet / leather-pu) + their orphan
-- product_fabrics links are removed — they were testing scaffolding only.
--
-- Ongoing sync (Backend "+ New Fabric" / bulk import) is handled INSERT-only in
-- apps/api/src/routes/fabric-tracking.ts (RLS-safe). This one-time backfill runs
-- as the migration's service role, so RLS does not gate it.

begin;

-- 1. Remove the seed demo fabrics + their orphan per-product links.
--    product_fabrics has a RESTRICT FK to fabric_library, so clear it first;
--    fabric_colours cascades on fabric delete but we clear it explicitly too.
delete from product_fabrics where fabric_id in ('linen', 'velvet', 'leather-pu');
delete from fabric_colours  where fabric_id in ('linen', 'velvet', 'leather-pu');
delete from fabric_library  where id        in ('linen', 'velvet', 'leather-pu');

-- 2. Backfill SERIES rows into the selling library (one per fabric_code prefix).
--    Selling tier left at its default (NULL) so nothing changes price until set.
insert into fabric_library (id, label, tier, default_surcharge, active, sort_order)
select prefix, prefix, 'standard', 0, true, (row_number() over (order by prefix)) * 10
from (
  select distinct split_part(fabric_code, '-', 1) as prefix
  from fabric_trackings
  where fabric_code is not null and fabric_code <> ''
) s
on conflict (id) do nothing;

-- 3. Backfill COLOUR rows — one per fabric_code, grouped under its series.
insert into fabric_colours (fabric_id, colour_id, label, swatch_hex, active, sort_order)
select
  split_part(ft.fabric_code, '-', 1)                                   as fabric_id,
  ft.fabric_code                                                       as colour_id,
  case
    when position(' ' in coalesce(ft.fabric_description, '')) > 0
      then trim(substring(ft.fabric_description from position(' ' in ft.fabric_description) + 1))
    else ft.fabric_code
  end                                                                  as label,
  null,
  true,
  (row_number() over (partition by split_part(ft.fabric_code, '-', 1) order by ft.fabric_code))::int as sort_order
from fabric_trackings ft
where ft.fabric_code is not null and ft.fabric_code <> ''
on conflict (fabric_id, colour_id) do nothing;

commit;
