-- 0211: atomic SVC-DELIVERY* line rebuild for one SO (duplicate-delivery-fee race fix)
--
-- Bug: every line PATCH on /mfg-sales-orders/:docNo/items/:id ends by calling
-- rederiveDeliveryFee → recomputeDeliveryFeeCore, which rebuilt the SO's
-- SVC-DELIVERY / SVC-DELIVERY-CROSS / SVC-DELIVERY-ADD lines as TWO separate
-- PostgREST statements (DELETE all, then INSERT the recomputed set). The
-- Backend SO Detail Save fires one PATCH per changed line IN PARALLEL, so two
-- rebuilds could interleave as delete/delete/insert/insert — doubling the
-- delivery fee on the bill (prod incidents: SO-2606-043 on 2026-06-28,
-- SO-2607-010 on 2026-07-12; both data-repaired 2026-07-14).
--
-- Fix: collapse the rebuild into ONE function = ONE transaction, serialized
-- per doc_no with a transaction-scoped advisory lock. Concurrent rebuilds of
-- the same SO now queue; each runs delete→insert→header-update atomically, so
-- the last writer leaves exactly one consistent set of delivery lines.
--
-- SECURITY INVOKER on purpose: the API calls this with the user's JWT (anon
-- key client), and the table RLS policies must keep applying inside.

create or replace function rebuild_mfg_so_delivery_lines(
  p_doc_no             text,
  p_source_doc_no      text,
  p_delivery_fee_centi integer,
  p_rows               jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Serialize concurrent rebuilds of the SAME SO. hashtextextended gives a
  -- bigint key; the xact lock releases automatically at commit/rollback.
  perform pg_advisory_xact_lock(hashtextextended('so-delivery:' || p_doc_no, 0));

  delete from mfg_sales_order_items
   where doc_no = p_doc_no
     and item_code in ('SVC-DELIVERY', 'SVC-DELIVERY-CROSS', 'SVC-DELIVERY-ADD');

  insert into mfg_sales_order_items (
    doc_no, line_no, line_date, debtor_name, item_group, item_code,
    description, description2, remark, uom, qty,
    unit_price_centi, discount_centi, total_centi, total_inc_centi, balance_centi,
    variants, unit_cost_centi, line_cost_centi, line_margin_centi,
    divan_price_sen, leg_price_sen, special_order_price_sen, custom_specials,
    line_delivery_date, line_delivery_date_overridden, warehouse_id,
    branding, venue, stock_status
  )
  select r.doc_no, r.line_no, r.line_date, r.debtor_name, r.item_group, r.item_code,
         r.description, r.description2, r.remark, r.uom, r.qty,
         r.unit_price_centi, r.discount_centi, r.total_centi, r.total_inc_centi, r.balance_centi,
         r.variants, r.unit_cost_centi, r.line_cost_centi, r.line_margin_centi,
         r.divan_price_sen, r.leg_price_sen, r.special_order_price_sen, r.custom_specials,
         r.line_delivery_date, r.line_delivery_date_overridden, r.warehouse_id,
         r.branding, r.venue, r.stock_status
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      doc_no text, line_no integer, line_date date, debtor_name text,
      item_group text, item_code text, description text, description2 text,
      remark text, uom text, qty integer,
      unit_price_centi integer, discount_centi integer, total_centi integer,
      total_inc_centi integer, balance_centi integer,
      variants jsonb, unit_cost_centi integer, line_cost_centi integer,
      line_margin_centi integer, divan_price_sen integer, leg_price_sen integer,
      special_order_price_sen integer, custom_specials jsonb,
      line_delivery_date date, line_delivery_date_overridden boolean,
      warehouse_id uuid, branding text, venue text, stock_status text
    );

  update mfg_sales_orders
     set cross_category_source_doc_no = p_source_doc_no,
         delivery_fee_centi           = p_delivery_fee_centi,
         updated_at                   = now()
   where doc_no = p_doc_no;
end;
$$;
