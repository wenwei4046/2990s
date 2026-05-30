// /mfg-sales-orders — B2B sales orders (HOUZS pattern).
// Separate from retail `orders` (POS) — different lifecycle, different ID format.

import { Hono } from 'hono';
import { z } from 'zod';
import { normalizePhone } from '@2990s/shared/phone';
import {
  pickComboMatch, spreadComboTotal, splitSofaCode, sofaHeightKey,
  buildVariantSummary, type SofaComboRow, type SofaPriceTier,
} from '@2990s/shared';
import { supabaseAuth } from '../middleware/auth';
import { recordSoAudit, diffFields, type FieldChange } from '../lib/so-audit';
import { signSoItemPhotoUrl, soItemPhotoBindings } from '../lib/r2';
import {
  loadMaintenanceConfig,
  recomputeFromSnapshot,
  loadProductByCode,
  loadFabricByCode,
  type MfgItemForRecompute,
  type RecomputedLine,
} from '../lib/mfg-pricing-recompute';
/* PR #216 — per-Model variant chip enforcement (Commander 2026-05-27
   follow-up to PR #205). Reject POST/PATCH SO line items that carry a
   variant excluded by the Model's allowed_options. Empty pool = no
   restriction; null model_id = skip entirely. */
import {
  checkAllowedOptions,
  loadProductAndModel,
} from '../lib/allowed-options-check';
import { findIncompleteVariantLines } from '../lib/so-variant-check';
import { validateItemCodes, unknownItemCodeResponse } from '../lib/validate-item-codes';
import { recomputeSoStockAllocation } from '../lib/so-stock-allocation';
import { creditFromCancelledSo, getCustomerCreditBalance } from '../lib/customer-credits';
import { summariseReadiness } from '../lib/so-readiness';
import type { Env, Variables } from '../env';

export const mfgSalesOrders = new Hono<{ Bindings: Env; Variables: Variables }>();
mfgSalesOrders.use('*', supabaseAuth);

/* ── SO child-lock guard (Tier 2 — downstream lock) ─────────────────────────
   An SO locks (read-only — no line edit / no CANCELLED transition) once it has
   ANY non-cancelled Delivery Order OR Sales Invoice referencing it. Convert-to-
   DO (partial delivery) is NOT gated by this: the SO can keep emitting DOs;
   only line MUTATIONS + the CANCELLED status transition are blocked. Mirrors
   grnHasDownstream in apps/api/src/routes/grns.ts. Returns the blocking JSON,
   or null if the SO is free to edit. */
async function soHasDownstream(sb: any, soDocNo: string): Promise<{ error: string; message: string } | null> {
  const [{ count: doCount }, { count: siCount }] = await Promise.all([
    sb.from('delivery_orders')
      .select('id', { head: true, count: 'exact' })
      .eq('so_doc_no', soDocNo)
      .neq('status', 'CANCELLED'),
    sb.from('sales_invoices')
      .select('id', { head: true, count: 'exact' })
      .eq('so_doc_no', soDocNo)
      .neq('status', 'CANCELLED'),
  ]);
  if ((doCount ?? 0) > 0 || (siCount ?? 0) > 0) {
    return { error: 'so_has_downstream', message: 'SO has a Delivery Order / Sales Invoice — delete or cancel it first to edit' };
  }
  return null;
}

/* PR — Commander 2026-05-28 — Server-side combo recompute.
   Fetches all active sofa_combo_pricing rows once (small table; ~64 rows
   in steady state) and returns them as SofaComboRow[] for the pure
   pickComboPrice() picker. Called by POST / and PATCH /:docNo/items/:itemId
   before the line is persisted; if a sofa line's variants.cells match a
   combo's modules at the line's seat-height tier, the combo price OVERRIDES
   the client-submitted unit_price (anti-tamper). */
async function loadActiveSofaCombos(sb: any): Promise<SofaComboRow[]> {
  const { data } = await sb
    .from('sofa_combo_pricing')
    .select('id, base_model, modules, tier, customer_id, prices_by_height, label, effective_from, deleted_at')
    .is('deleted_at', null)
    .is('customer_id', null)   // 2990 B2C — default-scope rows only
    .is('supplier_id', null);  // sales-side only — never auto-price a SO from a supplier's purchasing combos
  return ((data ?? []) as Array<{
    id: string; base_model: string; modules: string[][]; tier: SofaPriceTier | null;
    customer_id: string | null; prices_by_height: Record<string, number | null>;
    label: string | null; effective_from: string; deleted_at: string | null;
  }>).map((r) => ({
    id: r.id, baseModel: r.base_model, modules: r.modules ?? [],
    tier: r.tier, customerId: r.customer_id,
    pricesByHeight: r.prices_by_height ?? {},
    label: r.label, effectiveFrom: r.effective_from, deletedAt: r.deleted_at,
  }));
}

/* Extract module ids + seat-height from a sofa line's `variants` blob.
   POS handover writes variants.cells = [{ moduleId, x, y, rot }] and
   variants.depth = '24' | '28' | '30' | ... so the picker has everything
   it needs to match a combo. Returns null when the line isn't a sofa
   custom build (e.g. quick-pick bundle = `bundleId` only; price already
   matches the bundle row). */
function extractSofaComboLookupArgs(
  itemGroup: string | undefined | null,
  variants: unknown,
): { modules: string[]; height: string; tier: SofaPriceTier } | null {
  if ((itemGroup ?? '').toLowerCase() !== 'sofa') return null;
  if (!variants || typeof variants !== 'object') return null;
  const v = variants as Record<string, unknown>;
  const cells = v.cells as Array<{ moduleId?: string }> | undefined;
  if (!Array.isArray(cells) || cells.length === 0) return null;
  const modules = cells.map((c) => String(c.moduleId ?? '')).filter(Boolean);
  if (modules.length === 0) return null;
  const height = String(v.depth ?? v.seatHeight ?? '24');
  /* Tier: prefer an explicit tier on variants; fall back to PRICE_2 (HOOKKA
     legacy default per the SO rendering code in Products.tsx). When the
     POS fabric model carries a tier per row, wire it here. */
  const tier = (v.tier ?? v.fabricTier ?? 'PRICE_2') as SofaPriceTier;
  return { modules, height, tier };
}

const HEADER =
  'doc_no, transfer_to, so_date, branding, debtor_code, debtor_name, agent, sales_location, ref, po_doc_no, venue, venue_id, ' +
  'address1, address2, address3, address4, phone, ' +
  'mattress_sofa_centi, bedframe_centi, accessories_centi, others_centi, local_total_centi, balance_centi, ' +
  /* Task #114 — per-category cost columns (migration 0079). Mirrors the
     four category revenue columns above so the SO list grid + Totals card
     can show category-level margins without per-item rollups. */
  'mattress_sofa_cost_centi, bedframe_cost_centi, accessories_cost_centi, others_cost_centi, ' +
  'total_cost_centi, total_revenue_centi, total_margin_centi, margin_pct_basis, line_count, ' +
  'currency, status, remark2, remark3, remark4, note, processing_date, sales_exemption_expiry, ' +
  /* PR #35 + #46 — extended PO + POS handover fields */
  'customer_id, customer_po, customer_po_id, customer_po_date, customer_po_image_b64, customer_so_no, hub_id, hub_name, ' +
  /* Task #121 — customer_country snapshot auto-derived from customer_state
     via my_localities lookup on POST/PATCH (migration 0082). */
  'customer_state, customer_country, customer_delivery_date, internal_expected_dd, linked_do_doc_no, ' +
  'ship_to_address, bill_to_address, install_to_address, subtotal_sen, overdue, ' +
  /* PR #46 — POS handover */
  'email, customer_type, salesperson_id, city, postcode, building_type, ' +
  'emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, target_date, ' +
  /* PR #143 + #150 + #157 — Payment (migrations 0068 + 0069 + 0070) */
  'payment_method, installment_months, merchant_provider, approval_code, payment_date, deposit_centi, paid_centi, ' +
  'created_at, created_by, updated_at';
const ITEM =
  'id, doc_no, line_date, debtor_code, debtor_name, agent, item_group, item_code, description, description2, ' +
  'uom, location, qty, unit_price_centi, discount_centi, total_centi, tax_centi, total_inc_centi, balance_centi, ' +
  'payment_status, venue, branding, remark, cancelled, variants, unit_cost_centi, line_cost_centi, line_margin_centi, ' +
  /* PR-E — per-item delivery date + cascade override flag (migration 0074) */
  'line_delivery_date, line_delivery_date_overridden, ' +
  /* PR-F — per-line photo keys (migration 0076) */
  'photo_urls, ' +
  /* PR — Commander 2026-05-28: per-line stock fulfillment flag (migration 0091) */
  'stock_status, ' +
  'created_at';

/* ─────────────────────────── Country auto-derive (Task #121) ──────────
   Given a customer_state, look up any my_localities row carrying that
   state and read its `country` column. Returns null when the state is
   unknown / not yet seeded — caller decides whether to fall back to a
   default. Cheap single-row lookup; the read is on the indexed `state`
   column so it stays under a millisecond even with the full ~7k MY
   postcode set. ─────────────────────────────────────────────────────── */
const deriveCountryFromState = async (
  sb: any,
  state: string | null | undefined,
): Promise<string | null> => {
  if (!state) return null;
  const { data } = await sb
    .from('my_localities')
    .select('country')
    .eq('state', state)
    .limit(1)
    .maybeSingle();
  const country = (data as { country?: string } | null)?.country;
  /* Commander 2026-05-28: a SO with a state set was showing a BLANK Country
     when the state name didn't match a seeded locality — e.g. my_localities
     stores "Pulau Pinang" but the form/caller used the common alias "Penang".
     2990 is Malaysia-only today (every my_localities row is 'Malaysia'), so
     fall back to 'Malaysia' for any non-empty-but-unmatched state instead of
     leaving Country empty. The exact match above still wins first, so a future
     non-MY locality set keeps working. */
  return country ?? 'Malaysia';
};

/* Commander 2026-05-29 — the Sales/shipping Location (warehouse) follows the
   customer's State. The create FORM resolves it via state_warehouse_mappings
   and sends salesLocation; this server-side derive closes the gap for callers
   that set a State but no salesLocation (e.g. API/import) so Location is bound
   to the address everywhere, not only through the form. Returns the warehouse
   name (or code) for the state, or null when unmapped. */
const deriveSalesLocationFromState = async (
  sb: any,
  state: string | null | undefined,
): Promise<string | null> => {
  if (!state) return null;
  // state_warehouse_mappings keys on the canonical state name; map the common
  // WP-KL alias the locality table doesn't carry under the WP prefix.
  const key = state === 'Wilayah Persekutuan Kuala Lumpur' ? 'Kuala Lumpur' : state;
  const { data: m } = await sb
    .from('state_warehouse_mappings')
    .select('warehouse_id')
    .eq('state', key)
    .maybeSingle();
  const whId = (m as { warehouse_id?: string } | null)?.warehouse_id;
  if (!whId) return null;
  const { data: w } = await sb
    .from('warehouses')
    .select('name, code')
    .eq('id', whId)
    .maybeSingle();
  const wh = w as { name?: string; code?: string } | null;
  return wh ? (wh.name ?? wh.code ?? null) : null;
};

const nextDocNo = async (sb: any): Promise<string> => {
  // HOUZS pattern: SO-NNNNNN (6-digit zero-padded counter across all time)
  const { count } = await sb.from('mfg_sales_orders').select('doc_no', { head: true, count: 'exact' });
  return `SO-${String((count ?? 0) + 1 + 9000).padStart(6, '0')}`; // start at SO-009001
};

/* ─────────────────────────── Cost snapshot ────────────────────────────
   Task #114 — Pull cost_price_sen off mfg_products on line create so the
   header's total_cost_centi / category cost columns get populated even
   when the client doesn't snapshot the cost themselves. Falls through in
   order: explicit client value (when > 0) → mfg_products.cost_price_sen
   → 0. Returns sen (integer). itemCode is matched on mfg_products.code
   which is the canonical lookup key (sku_code is denormalized text).

   Note: Houzs builds cost from a live skusMaster store + variant
   surcharges. We use a server snapshot instead (simpler + tamper-proof)
   per Task #114 spec. ─────────────────────────────────────────────────── */
const snapshotUnitCostSen = async (
  sb: any,
  itemCode: string,
  explicit: number,
): Promise<number> => {
  if (explicit > 0) return explicit;
  if (!itemCode) return 0;
  const { data } = await sb
    .from('mfg_products')
    .select('cost_price_sen')
    .eq('code', itemCode)
    .maybeSingle();
  return Number((data as { cost_price_sen?: number } | null)?.cost_price_sen ?? 0);
};

mfgSalesOrders.get('/', async (c) => {
  const sb = c.get('supabase');
  /* Follow-up #83 — read from the view that joins payments ledger totals so
     Balance column is live (= local_total − sum(payments)). Header column
     `balance_centi` is still in the SELECT for backward compat (the grid
     falls back to it if the view's `balance_centi_live` is absent). */
  const LIST_COLS = `${HEADER}, paid_total_centi, balance_centi_live`;
  let q = sb.from('mfg_sales_orders_with_payment_totals').select(LIST_COLS).order('so_date', { ascending: false }).limit(500);
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const debtor = c.req.query('debtor'); if (debtor) q = q.ilike('debtor_name', `%${debtor}%`);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  /* PR — Commander 2026-05-28: Stock Status chip column.
     Per-SO aggregate computed from mfg_sales_order_items.stock_status grouped
     by item_group. UI renders:
       · empty            — no category fully ready
       · ["MATTRESS"]     — all mattress lines READY, but other categories pending
       · isFullyReady     — every non-cancelled line READY (chip column shows "READY")
     We hand the per-row arrays back so the UI doesn't need a second round-trip. */
  const rows = (data ?? []) as Array<{ doc_no?: string } & Record<string, unknown>>;
  const docNos = rows.map((r) => r.doc_no).filter((x): x is string => !!x);
  if (docNos.length > 0) {
    /* Order deterministically so the FIRST line per doc_no is the earliest
       one created (matches the detail endpoint's `.order('created_at')`). We
       add `branding`, `item_code` and `created_at` to the select: branding is
       the mattress brand source for the first-item rule below; item_code lets
       us fall back to mfg_products.branding when a mattress line's own branding
       is blank; created_at drives the first-line pick. */
    const { data: itemRows } = await sb
      .from('mfg_sales_order_items')
      .select('doc_no, item_group, stock_status, cancelled, branding, item_code, created_at')
      .in('doc_no', docNos)
      .eq('cancelled', false)
      .order('doc_no')
      .order('created_at', { ascending: true });
    const agg = new Map<string, Map<string, { total: number; ready: number }>>();
    /* Branding auto-derive (Commander 2026-05-28, refined PR #266): the SO list
       grid derives its Branding pill from the SO's FIRST line item — no longer
       "Mixed" when categories differ. We track per doc_no:
         · item_categories     — DISTINCT normalized categories (kept for back-compat)
         · first_item_category — normalized category of the earliest-created line
         · first_item_branding — that line's own `branding` text (the mattress brand)
       The header revenue columns merge mattress + sofa into one bucket, so the
       grid can't tell SOFA from MATTRESS at the header level — hence this
       per-line first-item read (from the same fetch already running for stock
       status). The UI maps SOFA → "2990 Sofa", BEDFRAME → "Bedframe", MATTRESS
       → first_item_branding (its own brand) ?? "2990 Mattress", else → "2990". */
    const cats = new Map<string, Set<string>>();
    const firstCat = new Map<string, string>();
    const firstBranding = new Map<string, string | null>();
    const firstItemCode = new Map<string, string | null>();
    const normCategory = (raw: string): string => {
      const g = (raw ?? '').trim().toUpperCase();
      if (g.includes('BEDFRAME')) return 'BEDFRAME';
      if (g.includes('SOFA'))     return 'SOFA';
      if (g.includes('MATTRESS')) return 'MATTRESS';
      if (g.includes('ACCESSOR')) return 'ACCESSORY';
      return 'OTHERS';
    };
    for (const it of (itemRows ?? []) as Array<{ doc_no: string; item_group: string; stock_status: string; cancelled: boolean; branding: string | null; item_code: string | null; created_at: string | null }>) {
      let perGroup = agg.get(it.doc_no);
      if (!perGroup) { perGroup = new Map(); agg.set(it.doc_no, perGroup); }
      const g = (it.item_group ?? '').trim().toUpperCase() || 'OTHERS';
      let cell = perGroup.get(g);
      if (!cell) { cell = { total: 0, ready: 0 }; perGroup.set(g, cell); }
      cell.total += 1;
      if (it.stock_status === 'READY') cell.ready += 1;

      let catSet = cats.get(it.doc_no);
      if (!catSet) { catSet = new Set(); cats.set(it.doc_no, catSet); }
      catSet.add(normCategory(it.item_group));

      /* Rows arrive ordered by (doc_no, created_at ASC) so the first time we
         see a doc_no IS its earliest line — record it once. */
      if (!firstCat.has(it.doc_no)) {
        firstCat.set(it.doc_no, normCategory(it.item_group));
        firstBranding.set(it.doc_no, it.branding ?? null);
        firstItemCode.set(it.doc_no, it.item_code ?? null);
      }
    }

    /* Mattress brand fallback: when the first line is a MATTRESS but carries no
       own branding text, look it up from mfg_products.branding via item_code.
       Batch-fetch only the codes we actually need (first-item mattresses with
       blank line.branding) so this stays a single cheap query. */
    const mattressCodesToLookup = new Set<string>();
    for (const [docNo, cat] of firstCat) {
      if (cat !== 'MATTRESS') continue;
      const b = firstBranding.get(docNo);
      if (b && b.trim()) continue;
      const code = firstItemCode.get(docNo);
      if (code) mattressCodesToLookup.add(code);
    }
    const productBranding = new Map<string, string>();
    if (mattressCodesToLookup.size > 0) {
      const { data: prodRows } = await sb
        .from('mfg_products')
        .select('code, branding')
        .in('code', [...mattressCodesToLookup]);
      for (const p of (prodRows ?? []) as Array<{ code: string; branding: string | null }>) {
        if (p.branding && p.branding.trim()) productBranding.set(p.code, p.branding);
      }
    }

    /* Commander 2026-05-29 (#19) — Payment Method column summarises the
       payments LEDGER, not just the header's single payment_method field. A
       SO can be settled across several methods (e.g. a cash deposit + a card
       balance), so we collect the DISTINCT method labels per doc_no and join
       them with " + " (→ "Cash + Card"). Label rules mirror the payment form
       cascade: cash→"Cash"; merchant→"Card"; transfer→its online_type
       (Bank Transfer / TNG / Cheque / DuitNow) when set, else "Transfer".
       One cheap batched read over the same doc_no set already in play. */
    const paymentMethods = new Map<string, Set<string>>();
    {
      const { data: payRows } = await sb
        .from('mfg_sales_order_payments')
        .select('so_doc_no, method, online_type')
        .in('so_doc_no', docNos);
      for (const p of (payRows ?? []) as Array<{ so_doc_no: string; method: string | null; online_type: string | null }>) {
        const m = (p.method ?? '').trim().toLowerCase();
        let label: string;
        if (m === 'cash') label = 'Cash';
        else if (m === 'merchant') label = 'Card';
        else if (m === 'transfer') label = (p.online_type && p.online_type.trim()) ? p.online_type.trim() : 'Transfer';
        else continue;
        let set = paymentMethods.get(p.so_doc_no);
        if (!set) { set = new Set(); paymentMethods.set(p.so_doc_no, set); }
        set.add(label);
      }
    }

    /* Tier 2 downstream-lock — one extra batched read per doc set: pull every
       non-cancelled DO/SI that points back to a listed SO and mark has_children
       on the row. The list grid uses this to hide Edit / Cancel from SOs that
       are downstream-locked (mirrors computeGrnFlags in routes/grns.ts). */
    const downstreamDocNos = new Set<string>();
    const [doRowsRes, siRowsRes] = await Promise.all([
      sb.from('delivery_orders')
        .select('so_doc_no')
        .in('so_doc_no', docNos)
        .neq('status', 'CANCELLED'),
      sb.from('sales_invoices')
        .select('so_doc_no')
        .in('so_doc_no', docNos)
        .neq('status', 'CANCELLED'),
    ]);
    for (const d of ((doRowsRes.data ?? []) as Array<{ so_doc_no: string | null }>)) {
      if (d.so_doc_no) downstreamDocNos.add(d.so_doc_no);
    }
    for (const s of ((siRowsRes.data ?? []) as Array<{ so_doc_no: string | null }>)) {
      if (s.so_doc_no) downstreamDocNos.add(s.so_doc_no);
    }

    /* B2C readiness summary per SO (Commander 2026-05-30) — derive the
       "Stock Remark" the operator's existing ERP shows: READY when everything
       in, READY (PARTIAL) when MAIN done + ACC outstanding, else list the
       categories still pending. */
    const readinessByDoc = new Map<string, ReturnType<typeof summariseReadiness>>();
    {
      const linesByDoc = new Map<string, Array<{ item_group: string | null; stock_status: string; cancelled: boolean }>>();
      for (const it of (itemRows ?? []) as Array<{ doc_no: string; item_group: string; stock_status: string; cancelled: boolean }>) {
        const arr = linesByDoc.get(it.doc_no) ?? [];
        arr.push({ item_group: it.item_group, stock_status: it.stock_status, cancelled: it.cancelled });
        linesByDoc.set(it.doc_no, arr);
      }
      for (const [docNo, ls] of linesByDoc) {
        readinessByDoc.set(docNo, summariseReadiness(ls));
      }
    }

    for (const r of rows) {
      const docNo = r.doc_no ?? '';
      const perGroup = agg.get(docNo);
      (r as Record<string, unknown>).item_categories = [...(cats.get(docNo) ?? [])].sort();
      (r as Record<string, unknown>).has_children = downstreamDocNos.has(docNo);
      const readiness = readinessByDoc.get(docNo);
      (r as Record<string, unknown>).stock_remark = readiness?.stockRemark ?? '';
      (r as Record<string, unknown>).is_main_ready = readiness?.isMainReady ?? false;
      /* First-item branding source (PR #266). */
      const fCat = firstCat.get(docNo);
      (r as Record<string, unknown>).first_item_category = fCat ?? null;
      let fBranding = firstBranding.get(docNo) ?? null;
      if (fCat === 'MATTRESS' && (!fBranding || !fBranding.trim())) {
        const code = firstItemCode.get(docNo);
        fBranding = (code && productBranding.get(code)) || fBranding;
      }
      (r as Record<string, unknown>).first_item_branding = fBranding;
      /* #19 — distinct ledger payment methods, sorted + joined ("Cash + Card").
         Empty string when no payments recorded yet (UI falls back to the
         header payment_method field). */
      const pm = paymentMethods.get(docNo);
      (r as Record<string, unknown>).payment_methods_summary = pm ? [...pm].sort().join(' + ') : '';
      if (!perGroup) {
        (r as Record<string, unknown>).ready_categories = [];
        (r as Record<string, unknown>).is_fully_ready = false;
        continue;
      }
      const ready: string[] = [];
      let allReady = true;
      for (const [grp, cell] of perGroup) {
        if (cell.total > 0 && cell.ready === cell.total) ready.push(grp);
        else allReady = false;
      }
      (r as Record<string, unknown>).ready_categories = ready;
      (r as Record<string, unknown>).is_fully_ready = allReady && perGroup.size > 0;
    }
  }

  return c.json({ salesOrders: rows });
});

mfgSalesOrders.get('/:docNo', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo');
  const [h, i] = await Promise.all([
    sb.from('mfg_sales_orders').select(HEADER).eq('doc_no', docNo).maybeSingle(),
    sb.from('mfg_sales_order_items').select(ITEM).eq('doc_no', docNo).order('created_at'),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  /* Tier 2 downstream-lock — stamp has_children so the SO Detail page can lock
     once any non-cancelled DO / SI references it. */
  const [{ count: doCount }, { count: siCount }] = await Promise.all([
    sb.from('delivery_orders')
      .select('id', { head: true, count: 'exact' })
      .eq('so_doc_no', docNo)
      .neq('status', 'CANCELLED'),
    sb.from('sales_invoices')
      .select('id', { head: true, count: 'exact' })
      .eq('so_doc_no', docNo)
      .neq('status', 'CANCELLED'),
  ]);
  /* Edge #D — surface the customer's current credit balance on the SO Detail
     response so the page can show "Customer has RM X available" without a
     second round-trip. 0 when no debtor / no credit history. */
  const debtorCode = (h.data as { debtor_code?: string | null }).debtor_code ?? null;
  const customerCreditCenti = debtorCode ? await getCustomerCreditBalance(sb, debtorCode) : 0;
  const salesOrder = {
    ...(h.data as unknown as Record<string, unknown>),
    has_children: (doCount ?? 0) > 0 || (siCount ?? 0) > 0,
    customer_credit_centi: customerCreditCenti,
  };
  return c.json({ salesOrder, items: i.data ?? [] });
});

/* Customer credit balance lookup — used by the New Sales Order form to flash
   "Customer has RM X credit available" once the operator picks the customer.
   Returns 0 (not 404) when there's no history yet. */
mfgSalesOrders.get('/customer-credit/:debtorCode', async (c) => {
  const sb = c.get('supabase');
  const debtorCode = c.req.param('debtorCode');
  const balance = await getCustomerCreditBalance(sb, debtorCode);
  return c.json({ debtorCode, balanceCenti: balance });
});

mfgSalesOrders.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  /* PR #46 — accept customerName as alias for debtorName (rename in flight).
     Commander 2026-05-26: "Debtor Name 其实可以换成 Customer Name". */
  const customerName = (body.debtorName ?? body.customerName) as string | undefined;
  if (!customerName) return c.json({ error: 'customer_name_required' }, 400);
  /* PR #46 — Items optional. POS handover may create the SO header first,
     then add items via POST /:docNo/items. Matches PR #41 PO blank-draft
     pattern. Only B2B-bulk path requires items at create. */
  const items = (body.items as Array<Record<string, unknown>> | undefined) ?? [];

  const sb = c.get('supabase'); const user = c.get('user');

  // Edge #4 — itemCode catalog guard. Reject typos / stale codes before any
  // pricing / variant / inventory work runs.
  if (items.length > 0) {
    const codeCheck = await validateItemCodes(sb, items.map((it) => it.itemCode as string | null | undefined));
    if (!codeCheck.ok) return c.json(unknownItemCodeResponse(codeCheck.unknown), 409);
  }

  /* PR — Commander 2026-05-28 — SO composition rules, enforced on the CREATE
     path so the API matches what the SO Detail edit page already blocks.
     (Bug: the create path let through both "delivery date without a processing
     date" AND a sofa+mattress mixed cart — the test batch hit both.)
       1. Processing Date + Delivery Date are all-or-nothing — never one without
          the other (mirrors the edit page's "must be set together" guard).
       2. SOFA is exclusive among MAIN products (sofa / bedframe / mattress):
          a sofa SO may NOT also contain a bedframe or mattress. SERVICE and
          ACCESSORY (and other add-on lines) ride on ANY SO — they never trip
          this. (Commander 2026-05-28: "main product 不能添加…但 service 或
          accessory 什么 products 都可以配".)
       3. All MATTRESS lines in one SO must share ONE brand — different mattress
          brands bill on separate SOs. (Bedframe may ride with a single-brand
          mattress; that combo stays allowed.) */
  {
    const procDate  = (body.internalExpectedDd  as string | null | undefined) || null;
    const delivDate = (body.customerDeliveryDate as string | null | undefined) || null;
    if (Boolean(procDate) !== Boolean(delivDate)) {
      return c.json({
        error: 'processing_delivery_must_pair',
        reason: 'Processing Date and Delivery Date must be set together (or both left empty).',
      }, 400);
    }
    /* Commander 2026-05-29 — a Processing Date means "ready to build", so every
       line must carry its category-mandatory variants. This guard existed on
       the PATCH header path + the UI but the CREATE path skipped it, so a direct
       POST with a processing date + blank bedframe/sofa variants slipped through
       (found while seeding test SOs). Shared helper keeps POST/PATCH/UI in sync. */
    if (procDate) {
      const offenders = findIncompleteVariantLines(
        items.map((it) => ({
          itemCode: String(it.itemCode ?? ''),
          group:    (it.itemGroup as string | null | undefined) ?? null,
          variants: (it.variants as Record<string, unknown> | null) ?? null,
        })),
      );
      if (offenders.length > 0) {
        return c.json({
          error: 'variants_incomplete',
          message: 'Processing Date requires all category-mandatory variants on every line.',
          offenders,
        }, 409);
      }
    }
    /* Commander 2026-05-28 — Processing Date + Delivery Date can only be today
       or in the future; a past date is rejected. "Today" is Malaysia time
       (UTC+8) so an early-UTC request near midnight doesn't wrongly reject a
       valid MY today. */
    const todayMY = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    if (procDate && procDate < todayMY) {
      return c.json({ error: 'processing_date_past', reason: 'Processing Date cannot be in the past — today or a future date only.' }, 400);
    }
    if (delivDate && delivDate < todayMY) {
      return c.json({ error: 'delivery_date_past', reason: 'Delivery Date cannot be in the past — today or a future date only.' }, 400);
    }
    if (items.length > 0) {
      const lineCodes = items.map((it) => String(it.itemCode ?? '')).filter(Boolean);
      const metaByCode = new Map<string, { category: string; branding: string | null }>();
      if (lineCodes.length > 0) {
        const { data: meta } = await sb
          .from('mfg_products')
          .select('code, category, branding')
          .in('code', lineCodes);
        for (const m of (meta ?? []) as Array<{ code: string; category: string; branding: string | null }>) {
          metaByCode.set(m.code, { category: m.category, branding: m.branding });
        }
      }
      const normCat = (raw: string): string => {
        const g = (raw ?? '').trim().toUpperCase();
        if (g.includes('BEDFRAME')) return 'BEDFRAME';
        if (g.includes('SOFA'))     return 'SOFA';
        if (g.includes('MATTRESS')) return 'MATTRESS';
        if (g.includes('ACCESSOR')) return 'ACCESSORY';
        if (g.includes('SERVICE'))  return 'SERVICE';
        return 'OTHERS';
      };
      // MAIN products carry the mixing constraints; SERVICE / ACCESSORY /
      // OTHERS are universal add-ons that ride on any SO.
      const MAIN = new Set(['SOFA', 'BEDFRAME', 'MATTRESS']);
      const cats = items.map((it) =>
        normCat(metaByCode.get(String(it.itemCode ?? ''))?.category ?? (it.itemGroup as string) ?? ''),
      );
      // Rule 2 — sofa is exclusive among MAIN products: no bedframe / mattress
      // alongside a sofa. Service / accessory add-ons are always fine.
      if (cats.includes('SOFA') && cats.some((cat) => cat !== 'SOFA' && MAIN.has(cat))) {
        return c.json({
          error: 'so_sofa_no_other_main',
          reason: 'A sofa Sales Order cannot also contain a bedframe or mattress. Service and accessory items are fine.',
        }, 400);
      }
      // Rule 3 — single mattress brand. Null/empty brand → 2990 house brand so
      // two unbranded 2990 mattresses don't false-trip the guard.
      const brands = new Set<string>();
      items.forEach((it, i) => {
        if (cats[i] !== 'MATTRESS') return;
        const b = (metaByCode.get(String(it.itemCode ?? ''))?.branding ?? '').trim().toUpperCase() || '2990';
        brands.add(b);
      });
      if (brands.size > 1) {
        return c.json({
          error: 'so_mattress_one_brand',
          reason: 'All mattress lines in one Sales Order must be the same brand. Split different mattress brands into separate SOs.',
          brands: [...brands],
        }, 400);
      }
    }
  }

  const docNo = await nextDocNo(sb);

  /* Migration 0086 — auto-stamp venue_id from the caller's staff.venue_id
     when they're a POS-side role (sales / sales_executive / outlet_manager).
     Backend-only roles leave it NULL. The client may pass an explicit
     venueId in the body to override (e.g. coordinator entering an SO on
     behalf of a specific venue). */
  let venueIdToStamp: string | null = (body.venueId as string | null | undefined) ?? null;
  if (!venueIdToStamp) {
    const { data: callerStaff } = await sb
      .from('staff')
      .select('role, venue_id')
      .eq('id', user.id)
      .maybeSingle();
    if (callerStaff && callerStaff.venue_id &&
        ['sales', 'sales_executive', 'outlet_manager'].includes(callerStaff.role)) {
      venueIdToStamp = callerStaff.venue_id as string;
    }
  }

  // Compute totals + category breakdown
  let mattressSofa = 0, bedframe = 0, accessories = 0, others = 0, total = 0, totalCost = 0;
  // Task #114 — also accumulate per-category COST so the four cost columns
  // on the header (migration 0079) get populated on insert. Mirrors the
  // revenue accumulators above.
  let mattressSofaCost = 0, bedframeCost = 0, accessoriesCost = 0, othersCost = 0;
  /* PR-E — Per-item delivery date inherits the SO header's
     customer_delivery_date on create unless the client explicitly
     supplies a per-line lineDeliveryDate. Override flag mirrors the
     client's choice (defaults false → cascade-tracked). */
  const headerDeliveryDate = (body.customerDeliveryDate as string | null | undefined) ?? null;
  /* MFG-PRICING-ENGINE — Server-side recompute (Commander 2026-05-27
     non-negotiable, mirrors `POST /orders` for POS). Load the master
     maintenance config once, then for each line item recompute the
     unit price from (product, fabric, variants). Drift > 0.5% rejects
     the request with HTTP 400. Manual override path (mfgSoPriceOverrides)
     stays intact at PATCH /:docNo/items/:itemId/override. */
  const cachedConfig = await loadMaintenanceConfig(sb);
  /* PR #216 — allowed_options pre-flight. Run BEFORE the pricing recompute
     so a disallowed variant returns the precise field/value/allowed
     payload instead of getting silently re-priced. Loads (product,model)
     once per line; reused inputs (item_code) hit Supabase's per-request
     cache. First violation across all lines short-circuits the request. */
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it) continue;
    const code = String(it.itemCode ?? '');
    if (!code) continue;
    const { product, model } = await loadProductAndModel(sb, code);
    const err = checkAllowedOptions(
      product,
      model,
      (it.variants as Parameters<typeof checkAllowedOptions>[2]) ?? null,
    );
    if (err) {
      return c.json({ ...err, lineIdx: i, itemCode: code }, 400);
    }
  }
  const recomputes: Array<RecomputedLine | null> = await Promise.all(items.map(async (it) => {
    const itemCode = String(it.itemCode ?? '');
    if (!itemCode) return null;
    const [product, fabric] = await Promise.all([
      loadProductByCode(sb, itemCode),
      loadFabricByCode(sb, (it.variants as { fabricCode?: string } | null)?.fabricCode ?? null),
    ]);
    const draft: MfgItemForRecompute = {
      itemCode,
      itemGroup:      String(it.itemGroup ?? 'others'),
      qty:            Number(it.qty ?? 1),
      unitPriceCenti: Number(it.unitPriceCenti ?? 0),
      variants:       (it.variants as MfgItemForRecompute['variants']) ?? null,
    };
    return recomputeFromSnapshot(draft, product, fabric, cachedConfig);
  }));
  /* Commander 2026-05-29 (system-wide) — the SELLING unit price is now
     operator-authored on every SO line. The product price tables are COST,
     so there is no server-computed selling figure to enforce a combo floor /
     ceiling against. The former combo selling-price override (which replaced
     the line's selling price with a cheaper whole-build combo total, or
     clamped/rejected an out-of-band client price) is therefore retired — it
     would clobber or reject the operator's manual selling price. The COST
     path (computeMfgLineCost → unit_cost_centi / line_cost_centi /
     line_margin_centi) is untouched; combos never fed it.

     Combos DO feed the COST side now (Commander 2026-05-29): recomputeTotals
     applies the master sofa-combo price to a matched sofa set's cost. They are
     still NOT applied to the operator's manual SELLING price here.
     `extractSofaComboLookupArgs` is retained for the POS handover path. */
  void extractSofaComboLookupArgs;

  // Drift rejection retained for structural stability; `r.drift` is always
  // false now (manual selling is accepted in recomputeFromSnapshot), so this
  // loop never fires — but it keeps the SO atomic if a future path sets drift.
  for (let i = 0; i < recomputes.length; i++) {
    const r = recomputes[i];
    if (r && r.drift) {
      return c.json({
        error:    'pricing_drift',
        reason:   'Client unitPriceCenti differs >0.5% from server compute.',
        lineIdx:  i,
        itemCode: r.itemCode,
        client:   Number(items[i]?.unitPriceCenti ?? 0),
        server:   r.unit_price_sen,
        breakdown: r.breakdown,
      }, 400);
    }
  }
  /* Task #114 — snapshot unit cost from mfg_products when client didn't.
     Build itemRows sequentially with Promise.all so the cost lookup runs
     in parallel across lines but each row still has its own awaited cost. */
  const itemRows = await Promise.all(items.map(async (it, idx) => {
    const qty = Number(it.qty ?? 1);
    const recomputed = recomputes[idx] ?? null;
    // Server-computed unit price wins. Client value is informational
    // (already drift-checked above).
    const unit = recomputed ? recomputed.unit_price_sen : Number(it.unitPriceCenti ?? 0);
    const discount = Number(it.discountCenti ?? 0);
    const lineTotal = (qty * unit) - discount;
    // Commander 2026-05-28 — the server-computed cost (base + Σ backend
    // priceSen surcharges via computeMfgLineCost) is the source of truth.
    // Fall back to mfg_products.cost_price_sen / explicit client cost only
    // when the recompute didn't produce a cost (e.g. product not found).
    const itemCode = String(it.itemCode ?? '');
    const unitCost = recomputed && recomputed.unit_cost_sen > 0
      ? recomputed.unit_cost_sen
      : await snapshotUnitCostSen(sb, itemCode, Number(it.unitCostCenti ?? 0));
    const lineCost = unitCost * qty;
    const group = String(it.itemGroup ?? '').toLowerCase();
    total += lineTotal;
    totalCost += lineCost;
    if (group.includes('mattress') || group.includes('sofa')) {
      mattressSofa += lineTotal;
      mattressSofaCost += lineCost;
    } else if (group.includes('bedframe')) {
      bedframe += lineTotal;
      bedframeCost += lineCost;
    } else if (group.includes('accessor')) {
      accessories += lineTotal;
      accessoriesCost += lineCost;
    } else {
      others += lineTotal;
      othersCost += lineCost;
    }
    /* PR-E — Per-line cascade defaults. If the client sent a
       lineDeliveryDate it wins (and overridden=true unless explicitly
       false). Otherwise inherit the header date with overridden=false. */
    const hasExplicitLineDate = it.lineDeliveryDate !== undefined && it.lineDeliveryDate !== null;
    const lineDeliveryDate = hasExplicitLineDate
      ? (it.lineDeliveryDate as string | null)
      : headerDeliveryDate;
    const lineDeliveryDateOverridden = hasExplicitLineDate
      ? (it.lineDeliveryDateOverridden === undefined ? true : Boolean(it.lineDeliveryDateOverridden))
      : Boolean(it.lineDeliveryDateOverridden ?? false);
    return {
      line_date: (it.lineDate as string) ?? new Date().toISOString().slice(0, 10),
      debtor_code: (body.debtorCode as string) ?? null,
      debtor_name: body.debtorName,
      agent: (body.agent as string) ?? null,
      item_group: it.itemGroup ?? 'others',
      item_code: it.itemCode,
      description: (it.description as string) ?? null,
      /* Commander 2026-05-28 — "Description 2" is the auto-combined variant
         summary (the long attribute string). Server-generated from the line's
         variants so it stays the single source of truth. */
      description2: buildVariantSummary(String(it.itemGroup ?? ''), (it.variants as Record<string, unknown> | null) ?? null) || null,
      uom: (it.uom as string) ?? 'UNIT',
      qty,
      unit_price_centi: unit,
      discount_centi: discount,
      total_centi: lineTotal,
      total_inc_centi: lineTotal,
      balance_centi: lineTotal,
      variants: (it.variants as unknown) ?? null,
      unit_cost_centi: unitCost,
      line_cost_centi: lineCost,
      line_margin_centi: lineTotal - lineCost,
      // MFG-PRICING-ENGINE — Persist the line-level breakdown columns from
      // the server recompute so the SO detail page + cost reports show the
      // canonical surcharge mix without re-deriving from the variants blob.
      divan_price_sen:         recomputed?.divan_price_sen ?? 0,
      leg_price_sen:           recomputed?.leg_price_sen ?? 0,
      special_order_price_sen: recomputed?.special_order_sen ?? 0,
      custom_specials:         recomputed?.custom_specials ?? null,
      line_delivery_date: lineDeliveryDate,
      line_delivery_date_overridden: lineDeliveryDateOverridden,
    };
  }));

  const margin = total - totalCost;
  const marginPctBasis = total > 0 ? Math.round((margin / total) * 10000) : 0;

  /* Task #121 — derive country from the picked customer_state via the
     localities lookup. Stays null when the state is unknown so we don't
     forge a country the locality table never declared. */
  const customerCountrySnapshot = await deriveCountryFromState(
    sb,
    (body.customerState as string | null | undefined) ?? null,
  );

  /* Commander 2026-05-29 — Location follows the address (State). When the
     caller already sent a salesLocation it wins; otherwise derive it from the
     State so API/import callers get the same warehouse binding the form gives.
     Stays null when the State is unmapped. */
  const derivedSalesLocation =
    (body.salesLocation as string | null | undefined) ??
    (await deriveSalesLocationFromState(
      sb,
      (body.customerState as string | null | undefined) ?? null,
    ));

  const { error: hErr } = await sb.from('mfg_sales_orders').insert({
    doc_no: docNo,
    transfer_to: (body.transferTo as string) ?? null,
    so_date: (body.soDate as string) ?? new Date().toISOString().slice(0, 10),
    branding: (body.branding as string) ?? null,
    debtor_code: (body.debtorCode ?? body.customerCode as string) ?? null,
    debtor_name: customerName,
    agent: (body.agent as string) ?? null,
    sales_location: derivedSalesLocation ?? null,
    ref: (body.ref as string) ?? null,
    po_doc_no: (body.poDocNo as string) ?? null,
    venue: (body.venue as string) ?? null,
    /* Migration 0086 — venue master FK (separate from legacy `venue` text). */
    venue_id: venueIdToStamp,
    address1: (body.address1 as string) ?? null,
    address2: (body.address2 as string) ?? null,
    address3: (body.address3 as string) ?? null,
    address4: (body.address4 as string) ?? null,
    /* Task #91 — defensively normalize to E.164 storage form. The UI does this
       on blur via <PhoneInput>, but a misbehaving client could still POST a
       raw "+60 12 345 6789" — normalize once on the server so the DB never
       holds a half-typed format. Falls back to the raw value if normalize
       returns null (e.g. non-MY international numbers we don't recognise). */
    phone: typeof body.phone === 'string' ? (normalizePhone(body.phone) ?? body.phone) : null,
    mattress_sofa_centi: mattressSofa,
    bedframe_centi: bedframe,
    accessories_centi: accessories,
    others_centi: others,
    // Task #114 — per-category cost (migration 0079).
    mattress_sofa_cost_centi: mattressSofaCost,
    bedframe_cost_centi:      bedframeCost,
    accessories_cost_centi:   accessoriesCost,
    others_cost_centi:        othersCost,
    local_total_centi: total,
    balance_centi: total,
    total_cost_centi: totalCost,
    total_revenue_centi: total,
    total_margin_centi: margin,
    margin_pct_basis: marginPctBasis,
    line_count: items.length,
    currency: ((body.currency as string) ?? 'MYR').toUpperCase(),
    note: (body.note as string) ?? null,
    /* PR #46 — POS handover fields written at create */
    email: (body.email as string) ?? null,
    customer_type: (body.customerType as string) ?? null,
    salesperson_id: (body.salespersonId as string) ?? null,
    city: (body.city as string) ?? null,
    postcode: (body.postcode as string) ?? null,
    building_type: (body.buildingType as string) ?? null,
    emergency_contact_name: (body.emergencyContactName as string) ?? null,
    /* Task #91 — also normalize the emergency contact phone. */
    emergency_contact_phone: typeof body.emergencyContactPhone === 'string'
      ? (normalizePhone(body.emergencyContactPhone) ?? body.emergencyContactPhone)
      : null,
    emergency_contact_relationship: (body.emergencyContactRelationship as string) ?? null,
    target_date: (body.targetDate as string) ?? null,
    customer_id: (body.customerId as string) ?? null,
    customer_state: (body.customerState as string) ?? null,
    /* Task #121 — country snapshot auto-derived above. */
    customer_country: customerCountrySnapshot,
    customer_delivery_date: (body.customerDeliveryDate as string) ?? null,
    /* PR #144 — Commander: "当我已经 create 好了这个 sales order 的时候，
       为什么我点进去 edit processing 的 delivery date 时，怎么没看到呢".
       internal_expected_dd was wired on PATCH (update header) but missed
       on the POST (create) — so the New SO form's Processing Date field
       never persisted; reopening the SO showed an empty field. */
    internal_expected_dd: (body.internalExpectedDd as string) ?? null,
    // PR #121 — POS-aligned Order Details fields
    customer_so_no: (body.customerSoNo as string) ?? null,
    customer_po: (body.customerPo as string) ?? null,
    hub_id: (body.hubId as string) ?? null,
    hub_name: (body.hubName as string) ?? null,
    /* PR #148 + #150 — Payment fields on create (mirror PATCH handler).
       Lets commander set payment_method + deposit_centi straight from the
       New SO form, including approval_code for merchant transactions. */
    payment_method:     (body.paymentMethod as string) ?? null,
    installment_months: typeof body.installmentMonths === 'number' ? body.installmentMonths : null,
    merchant_provider:  (body.merchantProvider as string) ?? null,
    approval_code:      (body.approvalCode as string) ?? null,
    payment_date:       (body.paymentDate as string) ?? null,
    deposit_centi:      typeof body.depositCenti === 'number' ? body.depositCenti : 0,
    paid_centi:         typeof body.paidCenti === 'number' ? body.paidCenti : 0,
    /* PR #154 — Commander 2026-05-27: "我们的整个系统是没有 Draft 功能的，
       把 Draft 的功能去除掉, 我们 create 的全部都是 confirm 的". 2990 is a
       trading company; we don't need a DRAFT staging step. Every new SO is
       CONFIRMED on insert. The DRAFT enum value still exists for legacy
       row compatibility, but new rows skip it entirely. */
    status: 'CONFIRMED',
    created_by: user.id,
  });
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);

  if (itemRows.length > 0) {
    const rowsWithDoc = itemRows.map((r) => ({ ...r, doc_no: docNo }));
    const { error: iErr } = await sb.from('mfg_sales_order_items').insert(rowsWithDoc);
    if (iErr) { await sb.from('mfg_sales_orders').delete().eq('doc_no', docNo); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
    /* Commander 2026-05-29 — re-roll the header through recomputeTotals so a
       matched sofa SET picks up its MASTER combo cost (spread across the lines).
       The inline rollup above set per-module costs; this corrects them + the
       header totals to the combo. No-op for non-sofa / non-matching SOs. */
    await recomputeTotals(sb, docNo);
  }

  // PR-D — audit row. Emit one CREATE entry with every non-null field the
  // commander typed on the new-SO form so the timeline shows the genesis
  // state. We deliberately include the line count rather than each line
  // (those get their own ADD_LINE rows if they're added later via PATCH).
  const createFields: FieldChange[] = [];
  const captureIfSet = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== '') createFields.push({ field: k, to: v });
  };
  captureIfSet('debtorName', customerName);
  captureIfSet('debtorCode', body.debtorCode);
  captureIfSet('agent', body.agent);
  captureIfSet('phone', body.phone);
  captureIfSet('email', body.email);
  captureIfSet('soDate', body.soDate);
  captureIfSet('lineCount', items.length);
  captureIfSet('localTotalCenti', total);
  captureIfSet('paymentMethod', body.paymentMethod);
  captureIfSet('depositCenti', body.depositCenti);
  captureIfSet('internalExpectedDd', body.internalExpectedDd);
  captureIfSet('customerSoNo', body.customerSoNo);
  captureIfSet('customerPo', body.customerPo);
  await recordSoAudit(sb, {
    docNo,
    action: 'CREATE',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: createFields,
    statusSnapshot: 'CONFIRMED',
  });

  /* B2C auto-allocation — if stock is already on hand, the new SO's lines flip
     to READY immediately and the header advances to READY_TO_SHIP. Best-effort:
     a failure never sinks the SO create (status stays CONFIRMED). */
  try { await recomputeSoStockAllocation(sb, docNo); }
  catch (e) { /* eslint-disable-next-line no-console */ console.error('[so-allocation] post-create failed:', e); }

  return c.json({ docNo }, 201);
});

/* ── POST /recompute-allocation — re-walk every active SO line, flip
       PENDING/READY against live inventory, advance / regress SO header
       status. Manual trigger from the SO list "Re-allocate stock" button or
       admin debug. Best-effort. */
mfgSalesOrders.post('/recompute-allocation', async (c) => {
  const sb = c.get('supabase');
  const res = await recomputeSoStockAllocation(sb);
  return c.json(res);
});

/* ── PATCH /:docNo/priority — manual urgent override (Commander #38).
       Body: { rank: 1 | 2 | 3 … | null, reason?: string }
       Lower rank = higher priority. NULL clears the override → SO falls back
       into the default delivery_date FIFO. Triggers an allocation recompute
       so the SO list refreshes immediately. */
mfgSalesOrders.patch('/:docNo/priority', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const user = c.get('user');
  let body: { rank?: number | null; reason?: string | null };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const rank = body.rank == null ? null : Math.max(1, Math.min(999, Math.round(Number(body.rank))));
  const patch: Record<string, unknown> = {
    priority_rank:   rank,
    priority_set_at: rank == null ? null : new Date().toISOString(),
    priority_set_by: rank == null ? null : user.id,
    priority_reason: rank == null ? null : (body.reason ?? null),
    updated_at:      new Date().toISOString(),
  };
  const { data, error } = await sb.from('mfg_sales_orders')
    .update(patch).eq('doc_no', docNo)
    .select('doc_no, priority_rank, priority_reason').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);

  await recordSoAudit(sb, {
    docNo, action: 'UPDATE_HEADER', actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [{ field: 'priorityRank', from: 'previous', to: String(rank ?? '(cleared)') }],
    note: rank == null ? 'Priority override cleared' : `Marked urgent (rank ${rank}${body.reason ? ` — ${body.reason}` : ''})`,
  });

  /* Priority changed — re-walk allocation so older non-urgent SOs lose their
     claim if this one now sorts to the head. Best-effort. */
  try { await recomputeSoStockAllocation(sb); }
  catch (e) { /* eslint-disable-next-line no-console */ console.error('[so-allocation] post-priority failed:', e); }

  return c.json({ salesOrder: data });
});


// Status transition with audit row. Reads the prior status, updates, then
// inserts to mfg_so_status_changes — best-effort (audit failure does NOT
// roll back the status change).
mfgSalesOrders.patch('/:docNo/status', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const user = c.get('user');
  let body: { status?: string; notes?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.status) return c.json({ error: 'status_required' }, 400);

  const { data: prev } = await sb.from('mfg_sales_orders').select('status').eq('doc_no', docNo).maybeSingle();
  const fromStatus = (prev as { status: string } | null)?.status ?? null;

  /* Tier 2 downstream-lock — only the CANCELLED transition is gated (mirrors
     the GRN cancel guard). Other status transitions (CONFIRMED ↔ READY_TO_SHIP
     ↔ SHIPPED ↔ DELIVERED…) ride through untouched so the existing state
     machine + auto-advance (e.g. all-lines-READY → READY_TO_SHIP) keep working. */
  if (body.status === 'CANCELLED' && fromStatus !== 'CANCELLED') {
    const childLock = await soHasDownstream(sb, docNo);
    if (childLock) return c.json(childLock, 409);
  }

  const { data, error } = await sb.from('mfg_sales_orders').update({
    status: body.status, updated_at: new Date().toISOString(),
  }).eq('doc_no', docNo).select('doc_no, status').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);

  // Audit row — best-effort. We keep writing the legacy mfg_so_status_changes
  // row for now (the existing StatusTimeline panel still reads it) and ALSO
  // emit the unified mfg_so_audit_log row for the PR-D History panel.
  await sb.from('mfg_so_status_changes').insert({
    doc_no: docNo,
    from_status: fromStatus,
    to_status: body.status,
    changed_by: user.id,
    notes: body.notes ?? null,
  });
  await recordSoAudit(sb, {
    docNo,
    action: 'UPDATE_STATUS',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [{ field: 'status', from: fromStatus, to: body.status }],
    statusSnapshot: body.status,
    note: body.notes ?? undefined,
  });

  /* Edge #B — SO cancel with deposit paid turns the deposit into a customer
     credit. Idempotent on (source_type, source_doc_no). Best-effort. */
  if (body.status === 'CANCELLED' && fromStatus !== 'CANCELLED') {
    try {
      const { data: so } = await sb.from('mfg_sales_orders').select('debtor_code, debtor_name').eq('doc_no', docNo).maybeSingle();
      const s = so as { debtor_code: string | null; debtor_name: string | null } | null;
      if (s?.debtor_code) {
        await creditFromCancelledSo(sb, {
          docNo,
          debtorCode: s.debtor_code,
          debtorName: s.debtor_name,
          createdBy: user.id,
        });
      }
    } catch (e) { /* eslint-disable-next-line no-console */ console.error('[customer-credit] so-cancel credit failed:', e); }
  }

  return c.json({ salesOrder: data });
});

// ── GET /mfg-sales-orders/:docNo/audit-log ──────────────────────────
// PR-D — unified history feed (newest first). Returns one envelope:
//   { entries: [{ id, so_doc_no, action, actor_id, actor_name_snapshot,
//                  field_changes, status_snapshot, source, note, created_at }] }
mfgSalesOrders.get('/:docNo/audit-log', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo');
  const { data, error } = await sb.from('mfg_so_audit_log')
    .select('id, so_doc_no, action, actor_id, actor_name_snapshot, field_changes, status_snapshot, source, note, created_at')
    .eq('so_doc_no', docNo)
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ entries: data ?? [] });
});

// GET — list status change history for the SO detail timeline.
mfgSalesOrders.get('/:docNo/status-changes', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo');
  const { data, error } = await sb.from('mfg_so_status_changes')
    .select('id, doc_no, from_status, to_status, changed_by, notes, auto_actions, created_at')
    .eq('doc_no', docNo)
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ statusChanges: data ?? [] });
});

// GET — list line price overrides for the audit panel.
mfgSalesOrders.get('/:docNo/price-overrides', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo');
  const { data, error } = await sb.from('mfg_so_price_overrides')
    .select('id, doc_no, item_id, item_code, original_price_sen, override_price_sen, reason, approved_by, created_at')
    .eq('doc_no', docNo)
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ overrides: data ?? [] });
});

// POST — override the price on a single line item. Captures the original
// in the audit row so we never lose the history.
mfgSalesOrders.post('/:docNo/items/:itemId/override', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const itemId = c.req.param('itemId');
  const user = c.get('user');
  let body: { overridePriceSen?: number; reason?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const newPrice = Number(body.overridePriceSen ?? 0);
  if (!Number.isFinite(newPrice) || newPrice < 0) return c.json({ error: 'invalid_price' }, 400);

  const { data: item } = await sb.from('mfg_sales_order_items')
    .select('id, doc_no, item_code, unit_price_centi, qty, discount_centi')
    .eq('id', itemId).maybeSingle();
  if (!item) return c.json({ error: 'item_not_found' }, 404);
  const i = item as { id: string; doc_no: string; item_code: string; unit_price_centi: number; qty: number; discount_centi: number };
  if (i.doc_no !== docNo) return c.json({ error: 'item_doc_mismatch' }, 400);

  // Audit first (so we don't lose original even if the update fails)
  const originalPriceSen = i.unit_price_centi;
  const overridePriceSen = newPrice;
  await sb.from('mfg_so_price_overrides').insert({
    doc_no: docNo,
    item_id: itemId,
    item_code: i.item_code,
    original_price_sen: originalPriceSen,
    override_price_sen: overridePriceSen,
    reason: body.reason ?? null,
    approved_by: user.id,
  });

  const newLineTotal = (i.qty * newPrice) - i.discount_centi;
  /* Task #114 — pull current line_cost_centi so the price override
     recomputes line_margin_centi correctly. Previous code used `- 0`
     which silently broke margin tracking on every override. */
  const { data: costRow } = await sb.from('mfg_sales_order_items')
    .select('line_cost_centi')
    .eq('id', itemId)
    .maybeSingle();
  const currentLineCost = Number((costRow as { line_cost_centi?: number } | null)?.line_cost_centi ?? 0);
  const { error } = await sb.from('mfg_sales_order_items').update({
    unit_price_centi: newPrice,
    total_centi: newLineTotal,
    total_inc_centi: newLineTotal,
    balance_centi: newLineTotal,
    line_margin_centi: newLineTotal - currentLineCost,
  }).eq('id', itemId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  /* Task #114 — also refresh the header totals after the override so
     total_cost_centi / total_margin_centi / category cost columns stay
     consistent with the new line revenue + margin. */
  await recomputeTotals(sb, docNo);

  // PR-D — also emit a unified audit-log entry so the History drawer
  // shows this price override alongside other UPDATE_LINE actions.
  await recordSoAudit(sb, {
    docNo,
    action: 'UPDATE_LINE',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [
      { field: 'unitPriceCenti', from: originalPriceSen, to: overridePriceSen },
    ],
    note: (body.reason as string) || undefined,
  });

  return c.json({ ok: true, itemId, newPrice });
});

// ── PATCH header — edit debtor info, addresses, note, etc. ───────────
mfgSalesOrders.patch('/:docNo', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const user = c.get('user');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  /* Commander 2026-05-28 — Processing Date + Delivery Date can only be today or
     a future date. Reject a past value on edit too (today = Malaysia UTC+8). */
  {
    const todayMY = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const proc = body['internalExpectedDd'];
    const deliv = body['customerDeliveryDate'];
    if (typeof proc === 'string' && proc && proc < todayMY) {
      return c.json({ error: 'processing_date_past', reason: 'Processing Date cannot be in the past — today or a future date only.' }, 400);
    }
    if (typeof deliv === 'string' && deliv && deliv < todayMY) {
      return c.json({ error: 'delivery_date_past', reason: 'Delivery Date cannot be in the past — today or a future date only.' }, 400);
    }
  }

  const map: Array<[string, string]> = [
    ['debtorCode', 'debtor_code'], ['debtorName', 'debtor_name'], ['agent', 'agent'],
    ['salesLocation', 'sales_location'], ['ref', 'ref'], ['poDocNo', 'po_doc_no'],
    ['venue', 'venue'], ['venueId', 'venue_id'], ['branding', 'branding'], ['transferTo', 'transfer_to'],
    ['address1', 'address1'], ['address2', 'address2'], ['address3', 'address3'],
    ['address4', 'address4'], ['phone', 'phone'], ['note', 'note'],
    ['remark2', 'remark2'], ['remark3', 'remark3'], ['remark4', 'remark4'],
    ['soDate', 'so_date'], ['currency', 'currency'],
    // PR #35 — new header fields
    ['customerId', 'customer_id'], ['customerState', 'customer_state'],
    ['customerPo', 'customer_po'], ['customerPoId', 'customer_po_id'],
    ['customerPoDate', 'customer_po_date'], ['customerPoImageB64', 'customer_po_image_b64'],
    // PR #121 — customer's own SO number (their ERP ref)
    ['customerSoNo', 'customer_so_no'],
    ['hubId', 'hub_id'], ['hubName', 'hub_name'],
    ['customerDeliveryDate', 'customer_delivery_date'],
    ['internalExpectedDd', 'internal_expected_dd'],
    ['linkedDoDocNo', 'linked_do_doc_no'],
    ['shipToAddress', 'ship_to_address'], ['billToAddress', 'bill_to_address'],
    ['installToAddress', 'install_to_address'],
    /* PR #46 — POS handover fields */
    ['email', 'email'], ['customerType', 'customer_type'],
    ['salespersonId', 'salesperson_id'],
    ['city', 'city'], ['postcode', 'postcode'], ['buildingType', 'building_type'],
    ['emergencyContactName', 'emergency_contact_name'],
    ['emergencyContactPhone', 'emergency_contact_phone'],
    ['emergencyContactRelationship', 'emergency_contact_relationship'],
    ['targetDate', 'target_date'],
    /* PR #143 + #150 — Payment fields */
    ['paymentMethod', 'payment_method'],
    ['installmentMonths', 'installment_months'],
    ['merchantProvider', 'merchant_provider'],
    ['approvalCode', 'approval_code'],
    ['paymentDate', 'payment_date'],
    ['depositCenti', 'deposit_centi'],
    ['paidCenti', 'paid_centi'],
  ];
  /* Task #91 — phone columns get normalized to E.164 storage form before any
     UPDATE. UI sends the storage form already (PhoneInput blur), but a
     misbehaving client could still PATCH a raw "+60 12 345 6789". */
  const PHONE_FIELDS = new Set(['phone', 'emergencyContactPhone']);
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [from, to] of map) {
    if (body[from] === undefined) continue;
    if (PHONE_FIELDS.has(from) && typeof body[from] === 'string') {
      const raw = body[from] as string;
      updates[to] = normalizePhone(raw) ?? raw;
    } else {
      updates[to] = body[from];
    }
  }
  /* Task #121 — when customerState changes, re-derive customer_country
     from my_localities so the SO snapshot follows the new state's country.
     A null state explicitly clears the snapshot (so an SO whose state is
     wiped doesn't keep a stale country). */
  if (body['customerState'] !== undefined) {
    updates['customer_country'] = await deriveCountryFromState(
      sb,
      body['customerState'] as string | null,
    );
    /* Commander 2026-05-29 — Location follows the address. When the State
       changes and the caller didn't also send an explicit salesLocation,
       re-derive the warehouse so Location tracks the new State. An explicit
       salesLocation in the same patch still wins (already mapped above). A
       null/unmapped State leaves Location untouched rather than wiping it. */
    if (body['salesLocation'] === undefined) {
      const derived = await deriveSalesLocationFromState(
        sb,
        body['customerState'] as string | null,
      );
      if (derived) updates['sales_location'] = derived;
    }
  }

  if (Object.keys(updates).length === 1) return c.json({ ok: true, changed: 0 });

  /* PR — Commander 2026-05-28 — Server-side variant rule enforcement.
     When the caller sets internalExpectedDd (Processing Date) to a non-null
     value, EVERY non-cancelled line for this SO must have its category-
     required variants filled. Mirrors the UI warning in SalesOrderDetail
     (REQUIRED_BY_CATEGORY: bedframe needs divanHeight+legHeight+gap+fabricCode;
     sofa needs seatHeight+legHeight+fabricCode). Without this guard, the
     coordinator can ignore the red banner and still hit the API directly.

     Bedframes + sofas with incomplete variants block the request with HTTP
     409 + a list of offending lines so the UI can re-render the warning. */
  if (body['internalExpectedDd'] !== undefined && body['internalExpectedDd'] !== null && body['internalExpectedDd'] !== '') {
    const { data: liveItems } = await sb
      .from('mfg_sales_order_items')
      .select('id, item_code, item_group, variants, cancelled')
      .eq('doc_no', docNo);
    // Shared with the POST create path (so-variant-check) — one rule, no drift.
    const offenders = findIncompleteVariantLines(
      ((liveItems ?? []) as Array<{ id: string; item_code: string; item_group: string; variants: Record<string, unknown> | null; cancelled: boolean }>)
        .filter((it) => !it.cancelled)
        .map((it) => ({ id: it.id, itemCode: it.item_code, group: it.item_group, variants: it.variants })),
    );
    if (offenders.length > 0) {
      return c.json({
        error: 'variants_incomplete',
        message: 'Processing Date requires all category-mandatory variants on every line.',
        offenders,
      }, 409);
    }
  }

  // PR-D — snapshot the row before update so we can emit a field-level diff
  // in the audit log. Only fields actually in the patch body are compared.
  const beforeCols = map.map(([, snake]) => snake).concat(['status']).join(', ');
  const { data: before } = await sb.from('mfg_sales_orders').select(beforeCols).eq('doc_no', docNo).maybeSingle();

  const { data, error } = await sb.from('mfg_sales_orders').update(updates).eq('doc_no', docNo).select('doc_no').maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);

  /* PR-E — Master-follower cascade. When the header's
     customer_delivery_date changes, every line that hasn't been
     manually overridden picks up the new date. Mirrors the SoLineCard
     variants cascade pattern (PR #141 / #147). Lines with
     line_delivery_date_overridden=true are left untouched.
     Best-effort: if the cascade UPDATE fails we still report success
     for the header — the audit trail (next header refresh) will show
     the divergence. */
  if (body['customerDeliveryDate'] !== undefined) {
    const newDate = body['customerDeliveryDate'] as string | null;
    await sb.from('mfg_sales_order_items')
      .update({ line_delivery_date: newDate })
      .eq('doc_no', docNo)
      .eq('line_delivery_date_overridden', false);
  }

  /* PR-D — Audit log row capturing field-level from→to diff. */
  if (before) {
    // Cast via `unknown` first: Supabase types the joined select result as
    // `GenericStringError` until proven typed, which doesn't structurally
    // overlap with our Record. The runtime shape IS a Record though, so the
    // double-cast is safe.
    const beforeRow = before as unknown as Record<string, unknown>;
    const fieldChanges = diffFields(beforeRow, body, map);
    if (fieldChanges.length > 0) {
      await recordSoAudit(sb, {
        docNo,
        action: 'UPDATE_DETAILS',
        actorId: user.id,
        actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
        fieldChanges,
        statusSnapshot: (beforeRow as { status?: string }).status ?? null,
      });
    }
  }

  return c.json({ ok: true, docNo });
});

// ── Item CRUD ─────────────────────────────────────────────────────────
//
// Each mutation recomputes the header totals + category breakdown so the
// list view stays accurate without a separate refresh step.
async function recomputeTotals(sb: any, docNo: string) {
  const { data: items } = await sb.from('mfg_sales_order_items')
    .select('id, item_code, item_group, variants, qty, total_centi, line_cost_centi')
    .eq('doc_no', docNo).eq('cancelled', false);
  type Row = { id: string; item_code: string; item_group: string; variants: Record<string, unknown> | null; qty: number; total_centi: number; line_cost_centi: number };
  const rows = (items ?? []) as Row[];

  /* ── Master sofa-combo COST spread (Commander 2026-05-29) ──────────────────
     A sofa is a set of per-module lines. When those lines (same base model)
     match a MASTER combo (sofa_combo_pricing where supplier_id IS NULL — the
     Product-Maintenance combo), the set's COST = the combo price, spread across
     the matched lines (mirror of the PO side, but master-scoped). We spread off
     the stored per-line line_cost_centi (the per-module base cost). Idempotent:
     spreadComboTotal re-normalises an already-spread group to the same total. */
  const sofaRows = rows.filter((r) => (r.item_group ?? '').toLowerCase() === 'sofa');
  if (sofaRows.length > 0) {
    const combos = await loadActiveSofaCombos(sb); // master scope only
    if (combos.length > 0) {
      const fabricCodes = [...new Set(sofaRows.map((r) => String((r.variants ?? {} as Record<string, unknown>).fabricCode ?? '')).filter(Boolean))];
      const tierByFabric = new Map<string, SofaPriceTier>();
      if (fabricCodes.length > 0) {
        const { data: fabs } = await sb.from('fabric_trackings').select('fabric_code, price_tier, sofa_price_tier').in('fabric_code', fabricCodes);
        for (const f of (fabs ?? []) as Array<{ fabric_code: string; price_tier: SofaPriceTier | null; sofa_price_tier: SofaPriceTier | null }>) {
          tierByFabric.set(f.fabric_code, (f.sofa_price_tier ?? f.price_tier ?? 'PRICE_2'));
        }
      }
      const groups = new Map<string, Row[]>();
      for (const r of sofaRows) {
        const { baseModel, sizeCode } = splitSofaCode(r.item_code);
        if (!sizeCode.includes('-')) continue; // non-modular (e.g. BLATT-2S) → no combo
        const key = baseModel.toUpperCase();
        const arr = groups.get(key) ?? [];
        arr.push(r); groups.set(key, arr);
      }
      for (const [bm, members] of groups) {
        const tierOf = (m: Row) => tierByFabric.get(String((m.variants ?? {} as Record<string, unknown>).fabricCode ?? '')) ?? 'PRICE_2';
        const tiers = new Set(members.map(tierOf));
        if (tiers.size !== 1) continue;
        const tier = [...tiers][0]!;
        const heights = new Set(members.map((m) => sofaHeightKey(m.variants)));
        if (heights.size !== 1) continue;
        const height = [...heights][0]!;
        if (!height) continue;
        const named = combos.filter((cmb) => (cmb.baseModel ?? '').toUpperCase() === bm);
        const pool = named.length > 0 ? named : combos;
        const match = pickComboMatch(
          { baseModel: '', modules: members.map((m) => splitSofaCode(m.item_code).sizeCode), customerId: null, tier, height },
          pool,
        );
        if (!match) continue;
        const matched = match.matchedIndices.map((i) => members[i]).filter((m): m is Row => !!m);
        if (matched.length === 0) continue;
        const comboTotal = match.comboPriceCenti;
        if (comboTotal <= 0) continue;
        const spread = spreadComboTotal(matched.map((m) => m.line_cost_centi || 0), comboTotal);
        for (let i = 0; i < matched.length; i++) {
          const m = matched[i]!; const newLineCost = spread[i] ?? 0; const q = Math.max(1, m.qty || 1);
          m.line_cost_centi = newLineCost; // mutate in place so the rollup below sees it
          await sb.from('mfg_sales_order_items').update({
            line_cost_centi:   newLineCost,
            unit_cost_centi:   Math.round(newLineCost / q),
            line_margin_centi: (m.total_centi || 0) - newLineCost,
          }).eq('id', m.id);
        }
      }
    }
  }

  let mattressSofa = 0, bedframe = 0, accessories = 0, others = 0, total = 0, totalCost = 0;
  // Task #114 — per-category cost mirrors the revenue accumulators. Each
  // bucket below tracks both revenue (total_centi) and cost (line_cost_centi)
  // so the SO header's 4 new cost columns (migration 0079) stay in sync
  // with the existing 4 revenue columns.
  let mattressSofaCost = 0, bedframeCost = 0, accessoriesCost = 0, othersCost = 0;
  for (const it of (items ?? []) as Array<{ item_group: string; total_centi: number; line_cost_centi: number }>) {
    const lineTotal = it.total_centi || 0;
    const lineCost  = it.line_cost_centi || 0;
    total += lineTotal;
    totalCost += lineCost;
    const g = (it.item_group ?? '').toLowerCase();
    if (g.includes('mattress') || g.includes('sofa')) {
      mattressSofa += lineTotal;
      mattressSofaCost += lineCost;
    } else if (g.includes('bedframe')) {
      bedframe += lineTotal;
      bedframeCost += lineCost;
    } else if (g.includes('accessor')) {
      accessories += lineTotal;
      accessoriesCost += lineCost;
    } else {
      others += lineTotal;
      othersCost += lineCost;
    }
  }
  const margin = total - totalCost;
  await sb.from('mfg_sales_orders').update({
    mattress_sofa_centi: mattressSofa,
    bedframe_centi: bedframe,
    accessories_centi: accessories,
    others_centi: others,
    // Task #114 — per-category cost (migration 0079).
    mattress_sofa_cost_centi: mattressSofaCost,
    bedframe_cost_centi:      bedframeCost,
    accessories_cost_centi:   accessoriesCost,
    others_cost_centi:        othersCost,
    local_total_centi: total,
    balance_centi: total,
    total_cost_centi: totalCost,
    total_revenue_centi: total,
    total_margin_centi: margin,
    margin_pct_basis: total > 0 ? Math.round((margin / total) * 10000) : 0,
    line_count: (items ?? []).length,
    updated_at: new Date().toISOString(),
  }).eq('doc_no', docNo);
}

mfgSalesOrders.post('/:docNo/items', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const user = c.get('user');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!it.itemCode) return c.json({ error: 'item_code_required' }, 400);

  /* Edge #4 — itemCode catalog guard. */
  {
    const codeCheck = await validateItemCodes(sb, [it.itemCode as string]);
    if (!codeCheck.ok) return c.json(unknownItemCodeResponse(codeCheck.unknown), 409);
  }

  /* Tier 2 downstream-lock — line-add is blocked once a DO / SI exists. */
  const childLock = await soHasDownstream(sb, docNo);
  if (childLock) return c.json(childLock, 409);

  /* PR-E — pull customer_delivery_date alongside debtor/agent/venue so a
     line added later still inherits the SO header's delivery date by
     default. Client can override by sending lineDeliveryDate explicitly. */
  const { data: header } = await sb.from('mfg_sales_orders').select('debtor_code, debtor_name, agent, branding, venue, customer_delivery_date').eq('doc_no', docNo).maybeSingle();
  if (!header) return c.json({ error: 'not_found' }, 404);

  const qty = Number(it.qty ?? 1);
  const discount = Number(it.discountCenti ?? 0);
  // MFG-PRICING-ENGINE — Recompute unit price server-side. Same path as
  // POST /. Drift > 0.5% returns HTTP 400 with the breakdown so the UI can
  // show what went wrong.
  const itemCodeStr = String(it.itemCode ?? '');
  const variantsObj = (it.variants as MfgItemForRecompute['variants']) ?? null;
  /* PR #216 — allowed_options check on add-item. Same shape as POST /. */
  {
    const { product, model } = await loadProductAndModel(sb, itemCodeStr);
    const aoErr = checkAllowedOptions(
      product,
      model,
      variantsObj as Parameters<typeof checkAllowedOptions>[2],
    );
    if (aoErr) return c.json({ ...aoErr, itemCode: itemCodeStr }, 400);
  }
  const [cachedConfig, productLite, fabricLite] = await Promise.all([
    loadMaintenanceConfig(sb),
    loadProductByCode(sb, itemCodeStr),
    loadFabricByCode(sb, variantsObj?.fabricCode ?? null),
  ]);
  const recomputed = recomputeFromSnapshot(
    {
      itemCode:       itemCodeStr,
      itemGroup:      String(it.itemGroup ?? 'others'),
      qty,
      unitPriceCenti: Number(it.unitPriceCenti ?? 0),
      variants:       variantsObj,
    },
    productLite,
    fabricLite,
    cachedConfig,
  );
  if (recomputed.drift) {
    return c.json({
      error:    'pricing_drift',
      reason:   'Client unitPriceCenti differs >0.5% from server compute.',
      itemCode: itemCodeStr,
      client:   Number(it.unitPriceCenti ?? 0),
      server:   recomputed.unit_price_sen,
      breakdown: recomputed.breakdown,
    }, 400);
  }
  const unit = recomputed.unit_price_sen;
  const lineTotal = (qty * unit) - discount;
  // Commander 2026-05-28 — server-computed cost (base + Σ backend priceSen
  // surcharges) wins. Fall back to mfg_products.cost_price_sen / explicit
  // client cost only when the recompute produced no cost.
  const unitCost = recomputed.unit_cost_sen > 0
    ? recomputed.unit_cost_sen
    : await snapshotUnitCostSen(sb, itemCodeStr, Number(it.unitCostCenti ?? 0));
  const lineCost = unitCost * qty;
  /* PR-E — same inheritance rule as POST /. Explicit per-line value wins
     (and flips overridden=true unless the client says otherwise);
     otherwise fall back to header.customer_delivery_date with
     overridden=false so the line tracks future header changes. */
  const hasExplicitLineDate = it.lineDeliveryDate !== undefined && it.lineDeliveryDate !== null;
  const lineDeliveryDate = hasExplicitLineDate
    ? (it.lineDeliveryDate as string | null)
    : (header.customer_delivery_date as string | null) ?? null;
  const lineDeliveryDateOverridden = hasExplicitLineDate
    ? (it.lineDeliveryDateOverridden === undefined ? true : Boolean(it.lineDeliveryDateOverridden))
    : Boolean(it.lineDeliveryDateOverridden ?? false);
  const row = {
    doc_no: docNo,
    line_date: (it.lineDate as string) ?? new Date().toISOString().slice(0, 10),
    debtor_code: header.debtor_code,
    debtor_name: header.debtor_name,
    agent: header.agent,
    item_group: it.itemGroup ?? 'others',
    item_code: it.itemCode,
    description: (it.description as string) ?? null,
    /* Commander 2026-05-28 — "Description 2" auto-generated from variants. */
    description2: buildVariantSummary(String(it.itemGroup ?? ''), (it.variants as Record<string, unknown> | null) ?? null) || null,
    uom: (it.uom as string) ?? 'UNIT',
    qty,
    unit_price_centi: unit,
    discount_centi: discount,
    total_centi: lineTotal,
    total_inc_centi: lineTotal,
    balance_centi: lineTotal,
    venue: header.venue,
    branding: header.branding,
    variants: (it.variants as unknown) ?? null,
    unit_cost_centi: unitCost,
    line_cost_centi: lineCost,
    line_margin_centi: lineTotal - lineCost,
    // MFG-PRICING-ENGINE — Persist breakdown columns (same as POST /).
    divan_price_sen:         recomputed.divan_price_sen,
    leg_price_sen:           recomputed.leg_price_sen,
    special_order_price_sen: recomputed.special_order_sen,
    custom_specials:         recomputed.custom_specials ?? null,
    line_delivery_date: lineDeliveryDate,
    line_delivery_date_overridden: lineDeliveryDateOverridden,
  };
  const { data, error } = await sb.from('mfg_sales_order_items').insert(row).select('*').single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  await recomputeTotals(sb, docNo);

  // PR-D — emit ADD_LINE audit row. Capture item code + qty + unit price
  // so the timeline shows the meaningful what-was-added without an explosion
  // of every column.
  await recordSoAudit(sb, {
    docNo,
    action: 'ADD_LINE',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [
      { field: 'itemCode', to: row.item_code },
      { field: 'qty', to: row.qty },
      { field: 'unitPriceCenti', to: row.unit_price_centi },
      { field: 'totalCenti', to: row.total_centi },
    ],
  });

  return c.json({ item: data }, 201);
});

mfgSalesOrders.patch('/:docNo/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const itemId = c.req.param('itemId'); const user = c.get('user');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  /* Edge #4 — itemCode catalog guard (only when caller is changing it). */
  if (it.itemCode !== undefined) {
    const codeCheck = await validateItemCodes(sb, [it.itemCode as string]);
    if (!codeCheck.ok) return c.json(unknownItemCodeResponse(codeCheck.unknown), 409);
  }

  /* Tier 2 downstream-lock — line-edit is blocked once a DO / SI exists. */
  const childLock = await soHasDownstream(sb, docNo);
  if (childLock) return c.json(childLock, 409);

  // Re-derive totals if qty/price/discount changed. PR-D — also pull the
  // human-facing columns (item_code, description, uom) for the audit diff.
  const { data: prev } = await sb.from('mfg_sales_order_items')
    .select('qty, unit_price_centi, discount_centi, unit_cost_centi, item_code, item_group, description, description2, uom, variants, remark, cancelled')
    .eq('id', itemId).maybeSingle();
  if (!prev) return c.json({ error: 'not_found' }, 404);
  const qty = it.qty !== undefined ? Number(it.qty) : prev.qty;
  const clientUnit = it.unitPriceCenti !== undefined ? Number(it.unitPriceCenti) : prev.unit_price_centi;
  const discount = it.discountCenti !== undefined ? Number(it.discountCenti) : prev.discount_centi;

  /* MFG-PRICING-ENGINE — Server-side recompute on PATCH. Triggered when
     the caller touches variants OR unitPriceCenti (qty alone doesn't move
     the unit price). For variant-driven edits we use the merged item shape
     (prev + patch) so omitted variants stay sticky. The manual-override
     audit path (POST /:docNo/items/:itemId/override → mfg_so_price_overrides)
     is unaffected — it routes around this PATCH entirely. */
  let recomputedPatch: RecomputedLine | null = null;
  const variantsAfter = it.variants !== undefined
    ? (it.variants as MfgItemForRecompute['variants'])
    : ((prev as { variants?: MfgItemForRecompute['variants'] }).variants ?? null);
  const itemCodeAfter = it.itemCode !== undefined ? String(it.itemCode) : prev.item_code;
  const itemGroupAfter = it.itemGroup !== undefined ? String(it.itemGroup) : prev.item_group;
  const shouldRecompute = it.variants !== undefined || it.unitPriceCenti !== undefined || it.itemCode !== undefined;

  /* PR #216 — allowed_options check on PATCH. Only fires when the caller
     touched variants OR itemCode (qty/price/discount alone don't move the
     Model linkage). Uses the merged (prev+patch) shape so a partial PATCH
     of just `specials: [...]` still validates against the existing item
     code's Model. */
  if (it.variants !== undefined || it.itemCode !== undefined) {
    const { product, model } = await loadProductAndModel(sb, itemCodeAfter);
    const aoErr = checkAllowedOptions(
      product,
      model,
      variantsAfter as Parameters<typeof checkAllowedOptions>[2],
    );
    if (aoErr) return c.json({ ...aoErr, itemCode: itemCodeAfter }, 400);
  }
  if (shouldRecompute && itemCodeAfter) {
    const [cfg, prodLite, fabLite] = await Promise.all([
      loadMaintenanceConfig(sb),
      loadProductByCode(sb, itemCodeAfter),
      loadFabricByCode(sb, variantsAfter?.fabricCode ?? null),
    ]);
    recomputedPatch = recomputeFromSnapshot(
      {
        itemCode:       itemCodeAfter,
        itemGroup:      itemGroupAfter,
        qty,
        unitPriceCenti: clientUnit,
        variants:       variantsAfter,
      },
      prodLite,
      fabLite,
      cfg,
    );
    if (recomputedPatch.drift) {
      return c.json({
        error:    'pricing_drift',
        reason:   'Client unitPriceCenti differs >0.5% from server compute.',
        itemCode: itemCodeAfter,
        client:   clientUnit,
        server:   recomputedPatch.unit_price_sen,
        breakdown: recomputedPatch.breakdown,
      }, 400);
    }
  }
  const unit = recomputedPatch ? recomputedPatch.unit_price_sen : clientUnit;
  /* Commander 2026-05-28 — cost snapshot on PATCH. Order of precedence:
       1. Client sent unitCostCenti > 0 → use it (explicit override).
       2. A recompute ran (variants/itemCode/price touched) AND produced a
          cost > 0 → use the server-computed cost (base + Σ backend priceSen
          surcharges via computeMfgLineCost). This is the source of truth.
       3. Client changed itemCode but recompute had no cost → re-snapshot
          mfg_products under the new code.
       4. Otherwise keep the prior unit_cost_centi unchanged. */
  let unitCost: number;
  const explicitCost = it.unitCostCenti !== undefined ? Number(it.unitCostCenti) : 0;
  const itemCodeChanged = it.itemCode !== undefined && it.itemCode !== prev.item_code;
  if (explicitCost > 0) {
    unitCost = explicitCost;
  } else if (recomputedPatch && recomputedPatch.unit_cost_sen > 0) {
    unitCost = recomputedPatch.unit_cost_sen;
  } else if (itemCodeChanged) {
    unitCost = await snapshotUnitCostSen(sb, String(it.itemCode ?? ''), 0);
  } else {
    unitCost = prev.unit_cost_centi;
  }
  const lineTotal = (qty * unit) - discount;
  const lineCost = unitCost * qty;

  const updates: Record<string, unknown> = {
    qty, unit_price_centi: unit, discount_centi: discount, unit_cost_centi: unitCost,
    total_centi: lineTotal, total_inc_centi: lineTotal, balance_centi: lineTotal,
    line_cost_centi: lineCost, line_margin_centi: lineTotal - lineCost,
  };
  // MFG-PRICING-ENGINE — Refresh the persisted breakdown columns when we
  // ran a recompute. Without this they'd drift from `variants` over time.
  if (recomputedPatch) {
    updates.divan_price_sen         = recomputedPatch.divan_price_sen;
    updates.leg_price_sen           = recomputedPatch.leg_price_sen;
    updates.special_order_price_sen = recomputedPatch.special_order_sen;
    updates.custom_specials         = recomputedPatch.custom_specials ?? null;
  }
  for (const [from, to] of [
    ['itemCode', 'item_code'], ['itemGroup', 'item_group'], ['description', 'description'],
    ['description2', 'description2'], ['uom', 'uom'], ['variants', 'variants'],
    ['remark', 'remark'], ['cancelled', 'cancelled'],
  ] as const) {
    if (it[from] !== undefined) updates[to] = it[from];
  }
  /* Commander 2026-05-28 — "Description 2" is ALWAYS the server-generated
     variant summary; never trust a client-sent value. Recompute from the
     effective itemGroup + variants (incoming patch, else the stored row). */
  {
    const effGroup = (it.itemGroup ?? prev.item_group) as string | null | undefined;
    const effVariants = (it.variants ?? prev.variants) as Record<string, unknown> | null | undefined;
    updates['description2'] = buildVariantSummary(String(effGroup ?? ''), effVariants ?? null) || null;
  }

  /* PR-E — Per-item delivery date PATCH. If the caller sends
     lineDeliveryDate (including null to clear it), we ALSO server-side
     flip line_delivery_date_overridden to true. This is defensive — the
     UI should already mark the line as overridden when the user types
     into the field, but enforcing it here protects against clients that
     forget. A separate lineDeliveryDateOverridden=false reset path lets
     the UI deliberately rejoin the header cascade. */
  if (it.lineDeliveryDate !== undefined) {
    updates['line_delivery_date'] = it.lineDeliveryDate as string | null;
    updates['line_delivery_date_overridden'] = true;
  }
  if (it.lineDeliveryDateOverridden !== undefined) {
    updates['line_delivery_date_overridden'] = Boolean(it.lineDeliveryDateOverridden);
  }

  const { error } = await sb.from('mfg_sales_order_items').update(updates).eq('id', itemId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  await recomputeTotals(sb, docNo);

  // PR-D — diff old vs new and emit one UPDATE_LINE row only if any field
  // moved. Compare across both the derived columns (qty/price/discount)
  // and the passthrough columns (code/group/description/uom/etc).
  const fieldChanges: FieldChange[] = [];
  const cmp = (field: string, fromVal: unknown, toVal: unknown) => {
    const a = fromVal == null ? '' : String(fromVal);
    const b = toVal == null ? '' : String(toVal);
    if (a !== b) fieldChanges.push({ field, from: fromVal ?? null, to: toVal ?? null });
  };
  cmp('qty', prev.qty, qty);
  cmp('unitPriceCenti', prev.unit_price_centi, unit);
  cmp('discountCenti', prev.discount_centi, discount);
  cmp('unitCostCenti', prev.unit_cost_centi, unitCost);
  for (const [from, to] of [
    ['itemCode', 'item_code'], ['itemGroup', 'item_group'], ['description', 'description'],
    ['description2', 'description2'], ['uom', 'uom'], ['remark', 'remark'], ['cancelled', 'cancelled'],
  ] as const) {
    if (it[from] !== undefined) cmp(from, (prev as Record<string, unknown>)[to], it[from]);
  }
  if (fieldChanges.length > 0) {
    // Prefix with itemCode so the timeline can show "Updated line ITEM-123"
    // without a dedicated column on the audit row.
    fieldChanges.unshift({ field: 'itemCode', to: prev.item_code });
    await recordSoAudit(sb, {
      docNo,
      action: 'UPDATE_LINE',
      actorId: user.id,
      actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
      fieldChanges,
    });
  }

  return c.json({ ok: true });
});

mfgSalesOrders.delete('/:docNo/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const itemId = c.req.param('itemId'); const user = c.get('user');

  /* Tier 2 downstream-lock — line-delete is blocked once a DO / SI exists. */
  const childLock = await soHasDownstream(sb, docNo);
  if (childLock) return c.json(childLock, 409);

  // PR-D — capture the line snapshot before delete so the timeline can
  // show what was removed (item code + qty + unit price).
  // Task #93 — also fetch photo_urls so we can clean up R2 orphans
  // after the DB row is gone. We grab them BEFORE the delete because
  // the row is the source of truth for which keys belong to this line.
  const { data: prev } = await sb.from('mfg_sales_order_items')
    .select('item_code, qty, unit_price_centi, total_centi, photo_urls')
    .eq('id', itemId).maybeSingle();
  const prevTyped = prev as
    | { item_code: string; qty: number; unit_price_centi: number; total_centi: number; photo_urls: string[] | null }
    | null;

  const { error } = await sb.from('mfg_sales_order_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  await recomputeTotals(sb, docNo);

  // Task #93 — orphan cleanup. Loop over the photo keys and best-effort
  // delete each from R2. Failures are swallowed (logged) so a flaky R2
  // op doesn't leave the user with a "delete failed" toast on top of a
  // DB delete that already succeeded — rolling back the row to recover
  // a few KB of blob is worse than the orphan.
  let photosCleaned = 0;
  const photoKeys = prevTyped?.photo_urls ?? [];
  if (photoKeys.length > 0 && c.env.SO_ITEM_PHOTOS) {
    for (const key of photoKeys) {
      try {
        await c.env.SO_ITEM_PHOTOS.delete(key);
        photosCleaned += 1;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[so-item-photo] orphan cleanup failed for', key, e);
      }
    }
  }

  if (prevTyped) {
    await recordSoAudit(sb, {
      docNo,
      action: 'DELETE_LINE',
      actorId: user.id,
      actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
      fieldChanges: [
        { field: 'itemCode', from: prevTyped.item_code },
        { field: 'qty', from: prevTyped.qty },
        { field: 'unitPriceCenti', from: prevTyped.unit_price_centi },
        { field: 'totalCenti', from: prevTyped.total_centi },
        // Task #93 — note the photo cleanup so the timeline shows
        // "deleted N photos" alongside the line removal.
        ...(photoKeys.length > 0
          ? [{ field: 'photosCleaned', from: photoKeys.length, to: photosCleaned } satisfies FieldChange]
          : []),
      ],
    });
  }
  return c.body(null, 204);
});

// ── Per-line photos — PR-F (migration 0076) ──────────────────────────
//
// Commander 2026-05-27: customisation orders attach photos per line
// (color swatches, sketches, customer-supplied refs). HOOKKA's
// AutoCount-style detail view shows a "Photo" column on each line; we
// mirror that with an R2-backed photo array on every SO item.
//
// Storage: keys live in mfg_sales_order_items.photo_urls (text[]),
// objects live in the SO_ITEM_PHOTOS R2 bucket (private). The proxy
// GET endpoint streams bytes back so the bucket itself never needs
// public access. A custom domain (e.g. r2.2990s.com) can replace the
// proxy later — until then this is the only read path.
//
// Key layout: so-items/<docNo>/<itemId>/<uuid>.<ext>
//   The docNo + itemId prefix keeps the bucket browseable by SO and
//   makes lifecycle policies (delete-on-cancel) straightforward.

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

const extFromMime = (mime: string): string => {
  // Conservative whitelist — image/* only. Fallback to 'bin' if a
  // browser-supplied subtype isn't recognised; the bucket-key suffix
  // is cosmetic (Content-Type stored as R2 metadata).
  const m = mime.toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/png')                       return 'png';
  if (m === 'image/webp')                      return 'webp';
  if (m === 'image/gif')                       return 'gif';
  if (m === 'image/heic')                      return 'heic';
  if (m === 'image/heif')                      return 'heif';
  if (m === 'image/avif')                      return 'avif';
  if (m.startsWith('image/'))                  return 'bin';
  return '';
};

mfgSalesOrders.post('/:docNo/items/:itemId/photos', async (c) => {
  const sb = c.get('supabase');
  const docNo = c.req.param('docNo');
  const itemId = c.req.param('itemId');
  const user = c.get('user');

  if (!c.env.SO_ITEM_PHOTOS) {
    return c.json({ error: 'photo_bucket_not_configured' }, 500);
  }

  // Verify the line exists + belongs to this SO. Cheaper to fail here
  // than after a multi-MB upload to R2.
  const { data: item, error: itemErr } = await sb
    .from('mfg_sales_order_items')
    .select('id, doc_no, item_code, photo_urls')
    .eq('id', itemId)
    .maybeSingle();
  if (itemErr) return c.json({ error: 'item_lookup_failed', reason: itemErr.message }, 500);
  if (!item) return c.json({ error: 'item_not_found' }, 404);
  const i = item as { id: string; doc_no: string; item_code: string; photo_urls: string[] | null };
  if (i.doc_no !== docNo) return c.json({ error: 'item_doc_mismatch' }, 400);

  // Parse multipart body via Hono's c.req.parseBody(). The slip route
  // uses presigned URLs (out-of-band PUT) — this route is the
  // simpler proxy path because per-item photo files are small (<10 MB)
  // and commander wants drag-drop straight from the line card without
  // a two-step handshake.
  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody();
  } catch (e) {
    return c.json({ error: 'invalid_multipart', reason: e instanceof Error ? e.message : String(e) }, 400);
  }
  const file = form.file as File | undefined;
  if (!file || typeof file === 'string') return c.json({ error: 'file_field_required' }, 400);

  if (!file.type || !file.type.toLowerCase().startsWith('image/')) {
    return c.json({ error: 'invalid_mime', got: file.type || '(none)' }, 400);
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return c.json({ error: 'file_too_large', maxBytes: MAX_PHOTO_BYTES, got: file.size }, 400);
  }

  const photoId = crypto.randomUUID();
  const ext = extFromMime(file.type) || 'bin';
  const photoKey = `so-items/${docNo}/${itemId}/${photoId}.${ext}`;

  try {
    await c.env.SO_ITEM_PHOTOS.put(photoKey, file.stream(), {
      httpMetadata: { contentType: file.type },
      customMetadata: {
        docNo,
        itemId,
        itemCode: i.item_code,
        uploadedBy: user.id,
      },
    });
  } catch (e) {
    return c.json({ error: 'r2_put_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
  }

  // Append the new key to photo_urls. Pulled-then-pushed (rather than
  // a Postgres array_append RPC) so the call stays inside the standard
  // Supabase REST surface — supabase-js doesn't expose array operators.
  const nextKeys = [...(i.photo_urls ?? []), photoKey];
  const { error: updErr } = await sb
    .from('mfg_sales_order_items')
    .update({ photo_urls: nextKeys })
    .eq('id', itemId);
  if (updErr) {
    // Rollback the R2 object so we don't leak a dangling blob.
    await c.env.SO_ITEM_PHOTOS.delete(photoKey).catch(() => {});
    return c.json({ error: 'db_update_failed', reason: updErr.message }, 500);
  }

  // PR-D — emit an ADD_LINE-style audit row noting the photo addition.
  // Reuses UPDATE_LINE so the History panel groups it with other line
  // edits; itemCode prefix gives the timeline a human label.
  await recordSoAudit(sb, {
    docNo,
    action: 'UPDATE_LINE',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [
      { field: 'itemCode', to: i.item_code },
      { field: 'photoAdded', to: photoKey },
    ],
  });

  // Task #92 — return a short-lived signed GET URL alongside the key.
  // Frontend uses this directly as <img src> (no Worker proxy roundtrip
  // on first render). When the URL expires the frontend re-fetches via
  // GET /photos/:photoKey/signed. Falling back to the legacy proxy path
  // here keeps existing callers (and stale clients) working until a
  // post-deploy cleanup removes the proxy entirely.
  try {
    const bindings = soItemPhotoBindings(c.env);
    const { signedUrl, expiresAt } = await signSoItemPhotoUrl(bindings, photoKey);
    return c.json({ photoKey, photoUrl: signedUrl, expiresAt }, 201);
  } catch (e) {
    // Signing should never fail in production (creds + endpoint validated
    // at boot), but if it does we fall back to the proxy URL rather than
    // losing the upload — the row is already inserted.
    const photoUrl = `/mfg-sales-orders/${docNo}/items/${itemId}/photos/${encodeURIComponent(photoKey)}`;
    // eslint-disable-next-line no-console
    console.warn('[so-item-photo] signing failed, falling back to proxy:', e);
    return c.json({ photoKey, photoUrl }, 201);
  }
});

// Task #92 — refresh a signed GET URL for an existing key. Frontend
// hits this on mount when no cached URL exists for a key, and on a
// 403 (URL expired). Auth-checked the same way as the proxy: the key
// must belong to this SO+item and currently be in photo_urls.
mfgSalesOrders.get('/:docNo/items/:itemId/photos/:photoKey/signed', async (c) => {
  const sb = c.get('supabase');
  const docNo = c.req.param('docNo');
  const itemId = c.req.param('itemId');
  const photoKey = decodeURIComponent(c.req.param('photoKey'));

  const { data: item } = await sb
    .from('mfg_sales_order_items')
    .select('doc_no, photo_urls')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return c.json({ error: 'item_not_found' }, 404);
  const i = item as { doc_no: string; photo_urls: string[] | null };
  if (i.doc_no !== docNo) return c.json({ error: 'item_doc_mismatch' }, 400);
  if (!(i.photo_urls ?? []).includes(photoKey)) {
    return c.json({ error: 'photo_not_in_item' }, 404);
  }

  try {
    const bindings = soItemPhotoBindings(c.env);
    const { signedUrl, expiresAt } = await signSoItemPhotoUrl(bindings, photoKey);
    return c.json({ signedUrl, expiresAt });
  } catch (e) {
    return c.json({ error: 'signing_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/**
 * @deprecated Task #92 — superseded by signed-URL flow. The frontend
 * now reads photos directly from R2 via short-lived signed URLs minted
 * by `GET /photos/:photoKey/signed`. This proxy endpoint is retained
 * as a fallback for legacy clients holding old proxy URLs in the wild;
 * remove after the post-deploy cooldown (~7 days, longer than any
 * signed-URL TTL or cached page load).
 */
mfgSalesOrders.get('/:docNo/items/:itemId/photos/:photoKey', async (c) => {
  const sb = c.get('supabase');
  const docNo = c.req.param('docNo');
  const itemId = c.req.param('itemId');
  const photoKey = decodeURIComponent(c.req.param('photoKey'));

  if (!c.env.SO_ITEM_PHOTOS) {
    return c.json({ error: 'photo_bucket_not_configured' }, 500);
  }

  // Authorise: the photo key must belong to this SO+item AND be
  // currently listed in photo_urls. Prevents enumeration of unrelated
  // objects via a guessed key.
  const { data: item } = await sb
    .from('mfg_sales_order_items')
    .select('doc_no, photo_urls')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return c.json({ error: 'item_not_found' }, 404);
  const i = item as { doc_no: string; photo_urls: string[] | null };
  if (i.doc_no !== docNo) return c.json({ error: 'item_doc_mismatch' }, 400);
  if (!(i.photo_urls ?? []).includes(photoKey)) {
    return c.json({ error: 'photo_not_in_item' }, 404);
  }

  const obj = await c.env.SO_ITEM_PHOTOS.get(photoKey);
  if (!obj) return c.json({ error: 'photo_not_found_in_r2' }, 404);

  const contentType =
    obj.httpMetadata?.contentType ?? 'application/octet-stream';
  return new Response(obj.body, {
    headers: {
      'content-type': contentType,
      // 1-hour browser cache. Photos are immutable per key (new uploads
      // get a new uuid), so this is safe.
      'cache-control': 'private, max-age=3600',
    },
  });
});

mfgSalesOrders.delete('/:docNo/items/:itemId/photos/:photoKey', async (c) => {
  const sb = c.get('supabase');
  const docNo = c.req.param('docNo');
  const itemId = c.req.param('itemId');
  const photoKey = decodeURIComponent(c.req.param('photoKey'));
  const user = c.get('user');

  if (!c.env.SO_ITEM_PHOTOS) {
    return c.json({ error: 'photo_bucket_not_configured' }, 500);
  }

  const { data: item } = await sb
    .from('mfg_sales_order_items')
    .select('doc_no, item_code, photo_urls')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return c.json({ error: 'item_not_found' }, 404);
  const i = item as { doc_no: string; item_code: string; photo_urls: string[] | null };
  if (i.doc_no !== docNo) return c.json({ error: 'item_doc_mismatch' }, 400);
  const existing = i.photo_urls ?? [];
  if (!existing.includes(photoKey)) {
    return c.json({ error: 'photo_not_in_item' }, 404);
  }

  const nextKeys = existing.filter((k) => k !== photoKey);
  const { error: updErr } = await sb
    .from('mfg_sales_order_items')
    .update({ photo_urls: nextKeys })
    .eq('id', itemId);
  if (updErr) return c.json({ error: 'db_update_failed', reason: updErr.message }, 500);

  // R2 delete best-effort — if it fails we've already removed the key
  // from the array, so the orphan is invisible to the UI. A future
  // reaper job could sweep for dangling objects.
  await c.env.SO_ITEM_PHOTOS.delete(photoKey).catch(() => {});

  await recordSoAudit(sb, {
    docNo,
    action: 'UPDATE_LINE',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [
      { field: 'itemCode', to: i.item_code },
      { field: 'photoRemoved', from: photoKey, to: null },
    ],
  });

  return c.json({ ok: true });
});

// ── Payments — PR #163 (migration 0073) ───────────────────────────────
//
// HOOKKA-style transaction ledger per SO. Each row is one receipt /
// auth slip. UI lists them, sums into a "Deposit Paid" total, and the
// balance computes from header.local_total_centi − sum(amount_centi).
//
// Legacy single-row payment fields on mfg_sales_orders (payment_method,
// merchant_provider, installment_months, approval_code, payment_date,
// paid_centi) are NOT touched here — those columns are scheduled for
// drop in a follow-up migration once live data is migrated.
const PAYMENT_COLS =
  'id, so_doc_no, paid_at, method, merchant_provider, installment_months, ' +
  'online_type, approval_code, amount_centi, account_sheet, collected_by, note, ' +
  'created_at, created_by';

mfgSalesOrders.get('/:docNo/payments', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo');
  const { data, error } = await sb
    .from('mfg_sales_order_payments')
    .select(`${PAYMENT_COLS}, staff:collected_by ( name )`)
    .eq('so_doc_no', docNo)
    .order('paid_at', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  // Flatten the joined `staff.name` onto `collected_by_name` so the UI
  // doesn't need to drill into a nested object.
  const payments = (data ?? []).map((r: unknown) => {
    const row = r as Record<string, unknown> & { staff: { name: string } | null };
    const { staff, ...rest } = row;
    return { ...rest, collected_by_name: staff?.name ?? null };
  });
  return c.json({ payments });
});

/* Task #122 (cascade) — Method is a 3-step pick now. merchantProvider was
   a fixed 4-bank enum and installmentMonths was 6|12 only; both widened.
   Banks are now an open-ended text field sourced from
   so_dropdown_options('payment_merchant'). Installment plans likewise come
   from so_dropdown_options('installment_plan') and are sent here as an
   integer 0..60 (0 = "One-off", which we coerce to NULL below). A new
   onlineType field carries the Online sub-type (Bank Transfer / TNG /
   Cheque / DuitNow). */
const paymentCreateSchema = z.object({
  paidAt:             z.string().min(1),
  method:             z.enum(['merchant', 'transfer', 'cash']),
  merchantProvider:   z.string().trim().min(1).optional().nullable(),
  installmentMonths:  z.number().int().min(0).max(60).optional().nullable(),
  onlineType:         z.string().trim().min(1).optional().nullable(),
  approvalCode:       z.string().optional().nullable(),
  amountCenti:        z.number().int().nonnegative(),
  accountSheet:       z.string().optional().nullable(),
  collectedBy:        z.string().uuid().optional().nullable(),
  note:               z.string().optional().nullable(),
});

mfgSalesOrders.post('/:docNo/payments', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const user = c.get('user');

  // Ensure the SO exists before inserting a child row (gives a cleaner
  // 404 than a deferred FK violation).
  const { data: so } = await sb.from('mfg_sales_orders').select('doc_no').eq('doc_no', docNo).maybeSingle();
  if (!so) return c.json({ error: 'sales_order_not_found' }, 404);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = paymentCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const p = parsed.data;

  // Method-scoped fields per the cascade:
  //   merchant  → merchant_provider + installment_months (0 / null = One-off)
  //   transfer  → online_type
  //   cash      → no extras
  const merchantProvider  = p.method === 'merchant' ? (p.merchantProvider ?? null) : null;
  // 0 = "One-off" — store as NULL so the integer column carries semantic
  // "no installment". Anything > 0 is the term in months.
  const installmentMonths = p.method === 'merchant'
    ? (typeof p.installmentMonths === 'number' && p.installmentMonths > 0 ? p.installmentMonths : null)
    : null;
  const onlineType        = p.method === 'transfer' ? (p.onlineType ?? null) : null;

  const { data, error } = await sb.from('mfg_sales_order_payments').insert({
    so_doc_no:          docNo,
    paid_at:            p.paidAt,
    method:             p.method,
    merchant_provider:  merchantProvider,
    installment_months: installmentMonths,
    online_type:        onlineType,
    approval_code:      p.approvalCode ?? null,
    amount_centi:       p.amountCenti,
    account_sheet:      p.accountSheet ?? null,
    collected_by:       p.collectedBy ?? null,
    note:               p.note ?? null,
    created_by:         user.id,
  }).select(PAYMENT_COLS).single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);

  /* Post-merge stitch — wire ADD_PAYMENT into the PR-D audit ledger.
     Field-changes list mirrors what the user typed so the History panel
     can render a readable diff. */
  await recordSoAudit(sb, {
    docNo,
    action: 'ADD_PAYMENT',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [
      { field: 'paidAt',             from: null, to: p.paidAt },
      { field: 'method',             from: null, to: p.method },
      { field: 'amountCenti',        from: null, to: p.amountCenti },
      ...(merchantProvider  ? [{ field: 'merchantProvider',  from: null, to: merchantProvider  } satisfies FieldChange] : []),
      ...(installmentMonths ? [{ field: 'installmentMonths', from: null, to: installmentMonths } satisfies FieldChange] : []),
      ...(onlineType        ? [{ field: 'onlineType',        from: null, to: onlineType        } satisfies FieldChange] : []),
      ...(p.approvalCode    ? [{ field: 'approvalCode',      from: null, to: p.approvalCode    } satisfies FieldChange] : []),
      ...(p.accountSheet    ? [{ field: 'accountSheet',      from: null, to: p.accountSheet    } satisfies FieldChange] : []),
    ],
  });

  return c.json({ payment: data }, 201);
});

mfgSalesOrders.delete('/:docNo/payments/:id', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const id = c.req.param('id');
  const user = c.get('user');

  // Guard: only delete if the row belongs to this docNo. Prevents a
  // mis-routed call from nuking another SO's payment.
  const { data: row } = await sb.from('mfg_sales_order_payments').select('*').eq('id', id).maybeSingle();
  if (!row) return c.json({ error: 'not_found' }, 404);
  const rowTyped = row as { so_doc_no: string; paid_at: string; method: string; amount_centi: number; approval_code: string | null };
  if (rowTyped.so_doc_no !== docNo) return c.json({ error: 'payment_doc_mismatch' }, 400);

  const { error } = await sb.from('mfg_sales_order_payments').delete().eq('id', id);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);

  /* Post-merge stitch — DELETE_PAYMENT audit row. */
  await recordSoAudit(sb, {
    docNo,
    action: 'DELETE_PAYMENT',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [
      { field: 'paidAt',       from: rowTyped.paid_at,       to: null },
      { field: 'method',       from: rowTyped.method,        to: null },
      { field: 'amountCenti',  from: rowTyped.amount_centi,  to: null },
      ...(rowTyped.approval_code ? [{ field: 'approvalCode', from: rowTyped.approval_code, to: null } satisfies FieldChange] : []),
    ],
  });

  return c.json({ ok: true });
});

// ── Debtor lookup — autocomplete from prior SOs ───────────────────────
mfgSalesOrders.get('/debtors/search', async (c) => {
  const sb = c.get('supabase'); const q = c.req.query('q') ?? '';
  let query = sb.from('mfg_sales_orders').select('debtor_code, debtor_name, phone, address1, address2, address3, address4').order('updated_at', { ascending: false }).limit(200);
  if (q.trim()) query = query.or(`debtor_name.ilike.%${q}%,debtor_code.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  // Dedupe by (debtor_code || debtor_name) — keep most recent only.
  const seen = new Set<string>();
  const out = [];
  for (const r of (data ?? []) as Array<Record<string, string | null>>) {
    const key = (r.debtor_code || r.debtor_name || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= 25) break;
  }
  return c.json({ debtors: out });
});

/* ════════════════════════════════════════════════════════════════════════
   PATCH /:docNo/items/:itemId/stock-status
   ────────────────────────────────────────────────────────────────────────
   Commander 2026-05-28: per-line stock fulfillment flag. body { status:
   'PENDING' | 'READY' }. After the flip, recompute the SO-level aggregate
   and auto-advance the SO's status to READY_TO_SHIP when EVERY non-cancelled
   line is READY (and the order is currently in a pre-ready state). An
   audit log entry is written for both the line flip and the status
   transition.
   ════════════════════════════════════════════════════════════════════════ */
mfgSalesOrders.patch('/:docNo/items/:itemId/stock-status', async (c) => {
  const sb = c.get('supabase');
  const docNo = c.req.param('docNo');
  const itemId = c.req.param('itemId');
  const user = c.get('user');

  let body: { status?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const nextStatus = (body.status ?? '').trim().toUpperCase();
  if (nextStatus !== 'PENDING' && nextStatus !== 'READY') {
    return c.json({ error: 'status_invalid', message: 'PENDING or READY' }, 400);
  }

  // Look up the current row so the audit log can capture from→to.
  const { data: prev, error: findErr } = await sb
    .from('mfg_sales_order_items')
    .select('doc_no, stock_status, item_code, item_group, cancelled')
    .eq('id', itemId)
    .eq('doc_no', docNo)
    .maybeSingle();
  if (findErr) return c.json({ error: 'load_failed', reason: findErr.message }, 500);
  if (!prev) return c.json({ error: 'not_found' }, 404);

  const prevTyped = prev as { stock_status: string; item_code: string; item_group: string; cancelled: boolean };
  if (prevTyped.cancelled) {
    return c.json({ error: 'item_cancelled', message: 'Cannot change stock_status on a cancelled line.' }, 400);
  }
  if (prevTyped.stock_status === nextStatus) {
    return c.json({ ok: true, unchanged: true });
  }

  // Flip the line.
  const { error: updErr } = await sb
    .from('mfg_sales_order_items')
    .update({ stock_status: nextStatus })
    .eq('id', itemId);
  if (updErr) return c.json({ error: 'update_failed', reason: updErr.message }, 500);

  await recordSoAudit(sb, {
    docNo,
    action: 'UPDATE_LINE',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [
      { field: 'stockStatus', from: prevTyped.stock_status, to: nextStatus },
      { field: 'itemCode',    from: prevTyped.item_code,    to: prevTyped.item_code },
    ],
    note: nextStatus === 'READY' ? 'Stock marked ready' : 'Stock marked pending',
  });

  // Re-aggregate at the SO level. B2C semantic: an SO is ship-able once every
  // MAIN product line (sofa/bedframe/mattress) is READY — accessories pending
  // are OK ("READY (PARTIAL)"). So auto-advance fires on main-ready, not
  // all-ready.
  const { data: allLines } = await sb
    .from('mfg_sales_order_items')
    .select('item_group, stock_status, cancelled')
    .eq('doc_no', docNo);
  const liveRows = ((allLines ?? []) as Array<{ item_group: string; stock_status: string; cancelled: boolean }>).filter((l) => !l.cancelled);
  const readiness = summariseReadiness(liveRows);
  const allReady = readiness.isMainReady;

  let advancedTo: string | null = null;
  if (allReady) {
    const { data: header } = await sb
      .from('mfg_sales_orders')
      .select('status')
      .eq('doc_no', docNo)
      .maybeSingle();
    const cur = (header as { status?: string } | null)?.status ?? null;
    if (cur === 'CONFIRMED' || cur === 'IN_PRODUCTION') {
      const { error: stUpdErr } = await sb
        .from('mfg_sales_orders')
        .update({ status: 'READY_TO_SHIP' })
        .eq('doc_no', docNo);
      if (!stUpdErr) {
        advancedTo = 'READY_TO_SHIP';
        await recordSoAudit(sb, {
          docNo,
          action: 'UPDATE_STATUS',
          actorId: user.id,
          actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
          statusSnapshot: 'READY_TO_SHIP',
          fieldChanges: [{ field: 'status', from: cur, to: 'READY_TO_SHIP' }],
          note: 'Auto-advanced: all lines READY',
        });
      }
    }
  }

  return c.json({ ok: true, advancedTo });
});
