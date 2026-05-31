// ----------------------------------------------------------------------------
// /mrp — Material Requirements Planning (trading-company / finished-goods).
//
// Commander 2026-05-28: port the AutoCount "Stock Status Report". 2990 is a
// TRADING company (buys finished sofas/bedframes/mattresses and resells), so
// this is NOT a BOM-explosion MRP (that's HOOKKA, a manufacturer). It's a
// finished-goods demand-vs-supply reconciliation:
//
//   Demand   = outstanding Sales-Order line items (qty, delivery date, SO no)
//   Supply   = on-hand stock (inventory_balances) + outstanding PO lines
//              (qty - received, with ETA = line delivery_date ?? po.expected_at)
//   Allocate = greedy by SO delivery date (earliest first):
//                stock first → outstanding PO (earliest ETA) → shortage.
//
// Pure calculator — NO dedicated table, NO persistence (v1 per commander:
// "先做即时计算"). Recomputed on every GET.
//
// Output mirrors the xls the commander shared:
//   parent row  (per SKU)  : Qty Needed / Stock / PO Outstanding / Shortage
//   child rows  (per SO)   : SO No · Delivery Date · Qty · source tag
//                            (stock | PO-xxxx + ETA | shortage → orange)
//
// Endpoint:
//   GET /mrp?category=BEDFRAME&warehouseId=<uuid>
//            category  omitted / 'all' → every category
//            warehouseId omitted / 'all' → stock summed across warehouses
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { computeVariantKey, buildVariantSummary, type VariantAttrs } from '@2990s/shared';
import { supabaseAuth } from '../middleware/auth';
import { soDeliverableRemaining } from './delivery-orders-mfg';
import type { Env, Variables } from '../env';

export const mrp = new Hono<{ Bindings: Env; Variables: Variables }>();
mrp.use('*', supabaseAuth);

/* SO statuses that no longer create demand (already shipped / closed). */
const SO_DONE = new Set(['DELIVERED', 'INVOICED', 'CLOSED', 'CANCELLED']);
/* PO statuses that no longer supply goods. */
const PO_DEAD = new Set(['CANCELLED']);

type DemandRow = {
  id: string;
  doc_no: string;
  item_code: string;
  description: string | null;
  item_group: string | null;
  variants: Record<string, unknown> | null;
  qty: number;
  po_qty_picked: number | null; // units of this line already pulled into a PO
  line_delivery_date: string | null;
  cancelled: boolean;
  so: {
    debtor_name: string | null;
    status: string;
    so_date: string | null;
    customer_delivery_date: string | null;
    internal_expected_dd: string | null; // processing date (drives when to order)
  } | null;
};

type PoLineRow = {
  material_code: string;
  item_group: string | null;
  variants: Record<string, unknown> | null;
  qty: number;
  received_qty: number | null;
  delivery_date: string | null;
  warehouse_id: string | null;
  so_item_id: string | null; // SO line this PO line was raised from (release-on-delete + MRP coverage)
  po: { po_number: string; status: string; expected_at: string | null } | null;
};

type ProductRow = { code: string; name: string | null; category: string | null };
type BalanceRow = { product_code: string; warehouse_id: string; variant_key: string | null; qty: number };

type AllocSource = 'stock' | 'po' | 'shortage';

/* Commander 2026-05-29 — bedframe/sofa MRP must follow the variant: two lines
   of the same SKU but a different fabric/colour/divan/leg are DIFFERENT goods
   to stock + order. We key every bucket by (item_code + variant key), where the
   variant key is the shared inventory identity (computeVariantKey — same one
   inventory_balances.variant_key is built from, so stock matches byte-for-byte).
   Mattress/accessory have no soft attrs → key '' → behaves exactly as before. */
const KEY_SEP = '';
const variantKeyOf = (itemGroup: string | null | undefined, variants: unknown): string =>
  computeVariantKey(itemGroup, (variants ?? null) as VariantAttrs | null);
const composite = (code: string, vkey: string): string => `${code}${KEY_SEP}${vkey}`;

type MrpLine = {
  soItemId: string;    // mfg_sales_order_items.id — lets the UI one-click PO this line
  soDocNo: string;
  debtorName: string | null;
  soDate: string | null;
  deliveryDate: string | null;
  processingDate: string | null;
  /* Commander 2026-05-29 — order-by date = delivery date − category lead days.
     "最迟下单日": place the PO by this date to hit the customer's delivery. */
  orderByDate: string | null;
  qty: number;
  source: AllocSource;
  poNumber: string | null;
  poEta: string | null;
  shortageQty: number; // units still uncovered on this line (orange highlight)
};

type MrpSku = {
  itemCode: string;
  variantKey: string;
  variantLabel: string | null;
  description: string | null;
  category: string | null;
  qtyNeeded: number;
  stock: number;
  poOutstanding: number;
  shortage: number;
  mainSupplierCode: string | null;
  mainSupplierName: string | null;
  /* All suppliers bound to this SKU (main first) — lets the UI switch supplier
     in-place before posting the PO. */
  suppliers: Array<{ supplierId: string; code: string; name: string; isMain: boolean }>;
  lines: MrpLine[];
};

/* Commander 2026-05-29 — sofa is ordered as a colour-matched SET, one per SO
   line ("每张 SO 一套"). The inventory variant key only covers fabric+seat+leg,
   NOT the module layout (cells), so two differently-built sofas with the same
   fabric collapse into one bucket. A correct set view therefore keys per SO
   line. Coverage uses po_qty_picked (units already pulled into a PO) — precise
   per line and immune to the variant-key pooling. */
type SofaSet = {
  soItemId: string;
  soDocNo: string;
  debtorName: string | null;
  soDate: string | null;
  deliveryDate: string | null;
  processingDate: string | null;
  orderByDate: string | null; // delivery date − category lead days
  itemCode: string;
  description: string | null;
  variantLabel: string | null; // spec line e.g. "BF-15 / SEAT 24 / LEG 6\""
  modules: string[];   // e.g. ['2A','LL','2A'] from variants.cells
  colour: string | null; // fabricCode + colorCode
  qty: number;
  orderedQty: number;  // po_qty_picked
  shortageQty: number; // qty - orderedQty (still to order)
  poNumber: string | null; // PO(s) this set's units were raised into
  poEta: string | null;    // earliest PO-line delivery date (when goods arrive)
  suppliers: Array<{ supplierId: string; code: string; name: string; isMain: boolean }>;
};

/* Earliest-first comparator that pushes NULL dates to the end. */
function byDateAsc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : 1;
}

export type MrpResult = {
  asOf: string;
  categories: string[];
  warehouses: unknown[];
  skus: MrpSku[];
  sofaSets: SofaSet[];
  totals: {
    skuCount: number;
    shortageSkuCount: number;
    shortageUnits: number;
    sofaSetCount: number;
    sofaSetShortageCount: number;
  };
};

/* Per-SO-line coverage the drill-down needs: is this line covered by stock, by
   an outstanding PO (then which + when), or still short (shows as Pending). */
export type SoLineCoverage = { source: AllocSource; po: string | null; eta: string | null };

/* Shared MRP allocation engine. The /mrp route is a thin wrapper around this;
   the Sales-Order drill-down reads the SAME allocation (via mrpLineCoverage) so
   the Stock column and the MRP page can never disagree. */
export async function computeMrp(
  sb: any,
  opts: { catFilter: string | null; whFilter: string | null; includeUndated: boolean },
): Promise<MrpResult> {
  const { catFilter, whFilter, includeUndated } = opts;

  // ── 0. Per-category lead times (Commander 2026-05-29) ─────────────────
  // order-by date = delivery date − lead_days[category]. Keyed lowercase to
  // match item_group; product category is uppercase so we lowercase on lookup.
  const { data: leadRows } = await sb
    .from('mrp_category_lead_times')
    .select('category, lead_days');
  const leadDaysByCat = new Map<string, number>();
  for (const r of (leadRows ?? []) as Array<{ category: string; lead_days: number }>) {
    leadDaysByCat.set(r.category.toLowerCase(), r.lead_days ?? 0);
  }
  const orderByOf = (deliveryDate: string | null, category: string | null): string | null => {
    if (!deliveryDate) return null;
    const days = leadDaysByCat.get((category ?? '').toLowerCase()) ?? 0;
    if (days <= 0) return deliveryDate;
    const d = new Date(`${deliveryDate.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return deliveryDate;
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };

  // ── 1. Demand — outstanding SO lines ──────────────────────────────────
  const { data: demandRaw, error: demandErr } = await sb
    .from('mfg_sales_order_items')
    .select(`
      id, doc_no, item_code, description, item_group, variants, qty, po_qty_picked, line_delivery_date, cancelled,
      so:mfg_sales_orders!inner ( debtor_name, status, so_date, customer_delivery_date, internal_expected_dd )
    `)
    .eq('cancelled', false)
    .limit(5000);
  if (demandErr) throw new Error(`mrp_load_failed: ${demandErr.message}`);

  const demandActive = ((demandRaw ?? []) as unknown as DemandRow[]).filter(
    (r) => r.item_code && r.so && !SO_DONE.has(r.so.status) && r.qty > 0
      // Undated lines (no line delivery date AND no SO delivery date) are not
      // ready to order — drop them unless the caller explicitly asks for them.
      && (includeUndated || Boolean(r.line_delivery_date ?? r.so.customer_delivery_date)),
  );

  // A partially-delivered SO keeps its header status active (the header only
  // flips to DELIVERED once EVERY line is fully covered), so already-delivered
  // lines would otherwise phantom back in as demand and over-order. Subtract
  // delivered-net-of-returns per line and drop any line with nothing left to
  // fulfil. Single source of truth: soDeliverableRemaining (same query the DO
  // convert flow uses), so MRP can never disagree with the SO's remaining.
  const demandDocNos = [...new Set(demandActive.map((d) => d.doc_no).filter(Boolean))];
  const deliverable = await soDeliverableRemaining(sb, demandDocNos);
  const deliveredNetOf = (soItemId: string): number => {
    const d = deliverable.get(soItemId);
    if (!d) return 0;
    return Math.max(0, (d.delivered ?? 0) - (d.returned ?? 0));
  };
  const effQtyOf = (r: DemandRow): number => Math.max(0, r.qty - deliveredNetOf(r.id));
  const demand = demandActive.filter((r) => effQtyOf(r) > 0);

  // ── 2. Product master — category + name + warehouses + categories list ─
  const { data: products } = await sb
    .from('mfg_products')
    .select('code, name, category');
  const prodByCode = new Map<string, ProductRow>();
  const categorySet = new Set<string>();
  for (const p of (products ?? []) as ProductRow[]) {
    prodByCode.set(p.code, p);
    if (p.category) categorySet.add(p.category);
  }

  const { data: warehouses } = await sb
    .from('warehouses')
    .select('id, code, name')
    .eq('is_active', true)
    .order('code');

  // ── 3. Stock on hand — inventory_balances keyed by (product_code, variant_key) ──
  let balQ = sb.from('inventory_balances').select('product_code, warehouse_id, variant_key, qty');
  if (whFilter) balQ = balQ.eq('warehouse_id', whFilter);
  const { data: balances } = await balQ;
  const stockByKey = new Map<string, number>();
  for (const b of (balances ?? []) as BalanceRow[]) {
    const k = composite(b.product_code, b.variant_key ?? '');
    stockByKey.set(k, (stockByKey.get(k) ?? 0) + (b.qty ?? 0));
  }

  // ── 4. Outstanding PO supply — open PO lines with ETA, keyed by (code, variant) ──
  const { data: poRaw } = await sb
    .from('purchase_order_items')
    .select(`
      material_code, item_group, variants, qty, received_qty, delivery_date, warehouse_id, so_item_id,
      po:purchase_orders!inner ( po_number, status, expected_at )
    `)
    .limit(5000);
  type PoSupply = { poNumber: string; eta: string | null; qtyLeft: number };
  const poByKey = new Map<string, PoSupply[]>();
  const poOutstandingByKey = new Map<string, number>();
  /* Commander 2026-05-30 — map each SO line to the PO(s) its units were raised
     into (via so_item_id), with the earliest PO-line delivery date (the date we
     set for the supplier). Lets a line covered by its OWN pick show the PO
     number + supplier delivery date instead of a bare "ordered". Includes
     fully-received PO lines, since po_qty_picked counts them as ordered. */
  const pickedPoByLineId = new Map<string, { poNumbers: string[]; eta: string | null }>();
  for (const r of (poRaw ?? []) as unknown as PoLineRow[]) {
    if (!r.po || PO_DEAD.has(r.po.status)) continue;
    const eta = r.delivery_date ?? r.po.expected_at ?? null;
    if (r.so_item_id) {
      const entry = pickedPoByLineId.get(r.so_item_id) ?? { poNumbers: [], eta: null };
      if (!entry.poNumbers.includes(r.po.po_number)) entry.poNumbers.push(r.po.po_number);
      if (eta && (!entry.eta || eta < entry.eta)) entry.eta = eta;
      pickedPoByLineId.set(r.so_item_id, entry);
    }
    const left = (r.qty ?? 0) - (r.received_qty ?? 0);
    if (left <= 0) continue;
    if (whFilter && r.warehouse_id && r.warehouse_id !== whFilter) continue;
    const k = composite(r.material_code, variantKeyOf(r.item_group, r.variants));
    const arr = poByKey.get(k) ?? [];
    arr.push({ poNumber: r.po.po_number, eta, qtyLeft: left });
    poByKey.set(k, arr);
    poOutstandingByKey.set(k, (poOutstandingByKey.get(k) ?? 0) + left);
  }
  for (const arr of poByKey.values()) arr.sort((a, b) => byDateAsc(a.eta, b.eta));

  // ── 5. Suppliers per SKU — main + alternates (so the UI can switch supplier
  //       in-place before posting the PO, AutoCount-style). ────────────────
  type SupplierOpt = { supplierId: string; code: string; name: string; isMain: boolean };
  const codes = [...new Set(demand.map((d) => d.item_code))];
  const mainByCode = new Map<string, { code: string; name: string }>();
  const suppliersByCode = new Map<string, SupplierOpt[]>();
  if (codes.length > 0) {
    const { data: binds } = await sb
      .from('supplier_material_bindings')
      .select('material_code, is_main_supplier, supplier_id, supplier:suppliers(code, name)')
      .eq('material_kind', 'mfg_product')
      .in('material_code', codes)
      .order('is_main_supplier', { ascending: false });
    for (const b of (binds ?? []) as Array<{ material_code: string; is_main_supplier: boolean; supplier_id: string; supplier: { code: string; name: string } | Array<{ code: string; name: string }> | null }>) {
      const s = Array.isArray(b.supplier) ? b.supplier[0] : b.supplier;
      if (!s) continue; // orphaned binding (supplier deleted) — skip
      const arr = suppliersByCode.get(b.material_code) ?? [];
      arr.push({ supplierId: b.supplier_id, code: s.code, name: s.name, isMain: b.is_main_supplier });
      suppliersByCode.set(b.material_code, arr);
      // First (is_main_supplier first via ORDER BY) wins as the default main.
      if (!mainByCode.has(b.material_code)) mainByCode.set(b.material_code, { code: s.code, name: s.name });
    }
  }

  // ── 6. Group demand by (SKU + variant), apply category filter ──────────
  // Commander 2026-05-29 — bedframe/sofa: each fabric/colour/divan/leg combo is
  // its own demand bucket (own Qty Needed / Stock / Shortage). Mattress has no
  // variant → key '' → one row per SKU as before.
  type Bucket = { code: string; vkey: string; vlabel: string; rows: DemandRow[] };
  const demandByKey = new Map<string, Bucket>();
  for (const d of demand) {
    const prod = prodByCode.get(d.item_code);
    const cat = prod?.category ?? null;
    if (catFilter && cat !== catFilter) continue;
    // Sofa is handled separately as colour-matched SETS (section 8) — keep it
    // out of the per-SKU/variant buckets so it isn't double-counted.
    if (cat === 'SOFA') continue;
    const vkey = variantKeyOf(d.item_group, d.variants);
    const k = composite(d.item_code, vkey);
    const bucket = demandByKey.get(k)
      ?? { code: d.item_code, vkey, vlabel: buildVariantSummary(d.item_group, d.variants), rows: [] };
    bucket.rows.push(d);
    demandByKey.set(k, bucket);
  }

  // ── 7. Allocate (greedy by SO delivery date) per (SKU + variant) ───────
  const skus: MrpSku[] = [];
  for (const [k, bucket] of demandByKey.entries()) {
    const { code, vlabel, rows } = bucket;
    const prod = prodByCode.get(code);
    rows.sort((a, b) => byDateAsc(a.line_delivery_date ?? a.so?.customer_delivery_date ?? null,
                                  b.line_delivery_date ?? b.so?.customer_delivery_date ?? null));

    let stockLeft = stockByKey.get(k) ?? 0;
    // Clone PO supply so the greedy walk can mutate qtyLeft without touching
    // the shared map. Commander 2026-05-29 — also fold in the SKU's
    // EMPTY-variant PO pool (legacy POs created before SO→PO carried variants:
    // their line has no variant → key ''). Without this, a PO you just raised
    // for a bedframe wouldn't show as "PO Outstanding" against the variant row.
    // New POs (post-fix) carry the variant and match exactly, so the legacy
    // pool is empty for them.
    const legacyKey = composite(code, '');
    const useLegacy = bucket.vkey !== '' && legacyKey !== k;
    const poQueue: PoSupply[] = [
      ...(poByKey.get(k) ?? []),
      ...(useLegacy ? (poByKey.get(legacyKey) ?? []) : []),
    ].map((p) => ({ ...p })).sort((a, b) => byDateAsc(a.eta, b.eta));

    // Commander 2026-05-29 (MRP fusion) — each SO line's own po_qty_picked is
    // LOCKED coverage for THAT line: those units are already on a PO raised from
    // this exact line, so they can never be a shortage and must never be
    // re-ordered (raising another PO for them 409s "qty_exceeds_remaining,
    // remaining:0"). The old date-priority pooling ignored po_qty_picked and
    // could hand a line's PO coverage to an earlier-dated sibling, marking the
    // truly-ordered line SHORT. Fix: drain the shared PO pool by the bucket's
    // total picked units (earliest ETA first — they belong to already-ordered
    // lines), then give each line only its UNPICKED remainder (qty - picked) to
    // the stock/PO competition below.
    let lockedPicked = rows.reduce((acc, r) => acc + Math.min(r.po_qty_picked ?? 0, effQtyOf(r)), 0);
    while (lockedPicked > 0 && poQueue.length > 0) {
      const front = poQueue[0];
      if (!front) break;
      const take = Math.min(front.qtyLeft, lockedPicked);
      front.qtyLeft -= take;
      lockedPicked -= take;
      if (front.qtyLeft <= 0) poQueue.shift();
    }

    const lines: MrpLine[] = [];
    let qtyNeeded = 0;
    for (const r of rows) {
      const eff = effQtyOf(r);                              // qty still to fulfil (ordered − delivered + returned)
      qtyNeeded += eff;
      const picked = Math.min(r.po_qty_picked ?? 0, eff);   // units already on this line's own PO (locked)
      let need = eff - picked;                              // only the unpicked remainder competes for supply
      const fromStock = Math.min(stockLeft, need);
      stockLeft -= fromStock;
      need -= fromStock;

      let poNumber: string | null = null;
      let poEta: string | null = null;
      while (need > 0 && poQueue.length > 0) {
        const front = poQueue[0];
        if (!front) break;
        const take = Math.min(front.qtyLeft, need);
        if (poNumber == null) { poNumber = front.poNumber; poEta = front.eta; }
        front.qtyLeft -= take;
        need -= take;
        if (front.qtyLeft <= 0) poQueue.shift();
      }

      // Commander 2026-05-30 — line covered by its OWN pick (po_qty_picked) but
      // no pooled PO matched: surface the PO it was raised into + the supplier
      // delivery date so the UI shows "PO-xxxx · ETA …" instead of bare "ordered".
      if (poNumber == null && picked > 0) {
        const own = pickedPoByLineId.get(r.id);
        if (own && own.poNumbers.length > 0) { poNumber = own.poNumbers.join(', '); poEta = own.eta; }
      }

      // need>0 → still uncovered (SHORT; orderable up to qty-picked). need==0 →
      // covered by the pooled PO (poNumber set), by this line's OWN pick
      // (picked>0 → 'po', the UI shows "ordered"), or by stock.
      const source: AllocSource =
        need > 0 ? 'shortage'
        : poNumber != null ? 'po'
        : picked > 0 ? 'po'
        : 'stock';
      const lineDelivery = r.line_delivery_date ?? r.so?.customer_delivery_date ?? null;
      lines.push({
        soItemId: r.id,
        soDocNo: r.doc_no,
        debtorName: r.so?.debtor_name ?? null,
        soDate: r.so?.so_date ?? null,
        deliveryDate: lineDelivery,
        processingDate: r.so?.internal_expected_dd ?? null,
        orderByDate: orderByOf(lineDelivery, prod?.category ?? null),
        qty: eff,
        source,
        poNumber,
        poEta,
        shortageQty: need,
      });
    }

    const stock = stockByKey.get(k) ?? 0;
    const poOutstanding = (poOutstandingByKey.get(k) ?? 0)
      + (useLegacy ? (poOutstandingByKey.get(legacyKey) ?? 0) : 0);
    // Commander 2026-05-29 (MRP fusion) — shortage = sum of the per-line
    // uncovered units (after locking each line's own pick). This is EXACTLY what
    // Proceed-PO will try to order, so the parent total can never exceed what
    // the lines can actually be ordered for. It also matches the client's own
    // date-window recompute (which already sums line shortageQty), so the
    // checkbox + "Proceed PO (N)" count stay honest in every view.
    const shortage = lines.reduce((acc, l) => acc + l.shortageQty, 0);
    const main = mainByCode.get(code);
    skus.push({
      itemCode: code,
      variantKey: bucket.vkey,
      variantLabel: vlabel || null,
      description: prod?.name ?? rows[0]?.description ?? null,
      category: prod?.category ?? null,
      qtyNeeded,
      stock,
      poOutstanding,
      shortage,
      mainSupplierCode: main?.code ?? null,
      mainSupplierName: main?.name ?? null,
      suppliers: suppliersByCode.get(code) ?? [],
      lines,
    });
  }

  // Shortage SKUs first, then by code + variant — so the rows that need
  // ordering float to the top (the orange ones the commander acts on).
  // Commander 2026-05-29 — within the shortage group, the soonest ORDER-BY date
  // floats to the top ("插队": most-urgent-to-order first), then code/variant.
  const earliestOrderBy = (s: MrpSku): string | null =>
    s.lines.reduce<string | null>((min, l) => (l.orderByDate && (!min || l.orderByDate < min) ? l.orderByDate : min), null);
  skus.sort((a, b) => {
    if ((b.shortage > 0 ? 1 : 0) !== (a.shortage > 0 ? 1 : 0)) {
      return (b.shortage > 0 ? 1 : 0) - (a.shortage > 0 ? 1 : 0);
    }
    const byOrderBy = byDateAsc(earliestOrderBy(a), earliestOrderBy(b));
    if (byOrderBy !== 0) return byOrderBy;
    if (a.itemCode !== b.itemCode) return a.itemCode < b.itemCode ? -1 : 1;
    return (a.variantLabel ?? '') < (b.variantLabel ?? '') ? -1 : 1;
  });

  // ── 8. Sofa SETS — one per SO line ("每张 SO 一套"). ────────────────────
  const sstr = (v: unknown): string => (v == null ? '' : String(v).trim());
  const sofaSets: SofaSet[] = demand
    .filter((d) => (prodByCode.get(d.item_code)?.category ?? null) === 'SOFA')
    .map((d) => {
      const v = (d.variants ?? {}) as Record<string, unknown>;
      const cells = Array.isArray(v.cells) ? (v.cells as Array<{ moduleId?: string }>) : [];
      const modules = cells.map((c) => sstr(c.moduleId)).filter(Boolean);
      const colour = [sstr(v.fabricCode), sstr(v.colorCode) || sstr(v.colourCode)].filter(Boolean).join(' ');
      const eff = effQtyOf(d);                        // set qty still to fulfil (ordered − delivered + returned)
      const ordered = Math.min(d.po_qty_picked ?? 0, eff);
      const prod = prodByCode.get(d.item_code);
      const setDelivery = d.line_delivery_date ?? d.so?.customer_delivery_date ?? null;
      // PO(s) this SO line's units were raised into, with the earliest supplier
      // delivery date — so an "ordered" set shows which PO + when it lands.
      const picked = pickedPoByLineId.get(d.id);
      return {
        soItemId: d.id,
        soDocNo: d.doc_no,
        debtorName: d.so?.debtor_name ?? null,
        soDate: d.so?.so_date ?? null,
        deliveryDate: setDelivery,
        processingDate: d.so?.internal_expected_dd ?? null,
        orderByDate: orderByOf(setDelivery, prod?.category ?? null),
        itemCode: d.item_code,
        description: prod?.name ?? d.description ?? null,
        variantLabel: buildVariantSummary(d.item_group, v) || null,
        modules,
        colour: colour || null,
        qty: eff,
        orderedQty: ordered,
        shortageQty: Math.max(0, eff - ordered),
        poNumber: picked && picked.poNumbers.length > 0 ? picked.poNumbers.join(', ') : null,
        poEta: picked?.eta ?? null,
        suppliers: suppliersByCode.get(d.item_code) ?? [],
      };
    });
  // To-order sets float to the top, then by earliest delivery date.
  sofaSets.sort((a, b) => {
    const sa = a.shortageQty > 0 ? 1 : 0;
    const sb = b.shortageQty > 0 ? 1 : 0;
    if (sa !== sb) return sb - sa;
    // Commander 2026-05-29 — soonest order-by date first.
    return byDateAsc(a.orderByDate, b.orderByDate);
  });

  return {
    asOf: new Date().toISOString(),
    categories: [...categorySet].sort(),
    warehouses: warehouses ?? [],
    skus,
    sofaSets,
    totals: {
      skuCount: skus.length,
      shortageSkuCount: skus.filter((s) => s.shortage > 0).length,
      shortageUnits: skus.reduce((acc, s) => acc + s.shortage, 0),
      sofaSetCount: sofaSets.length,
      sofaSetShortageCount: sofaSets.filter((s) => s.shortageQty > 0).length,
    },
  };
}

/* Flatten an MRP result into a per-SO-line coverage map (keyed by
   mfg_sales_order_items.id). The Sales-Order drill-down stamps each line from
   this so its Stock column shows the exact same Stock / PO·ETA / Pending the
   MRP page computed — one allocation, one source of truth. */
export function mrpLineCoverage(result: MrpResult): Map<string, SoLineCoverage> {
  const map = new Map<string, SoLineCoverage>();
  for (const sku of result.skus) {
    for (const l of sku.lines) {
      map.set(l.soItemId, { source: l.source, po: l.poNumber, eta: l.poEta });
    }
  }
  // Sofa SETS aren't in skus[].lines — derive their source from picked vs short.
  for (const s of result.sofaSets) {
    const source: AllocSource =
      s.shortageQty > 0 ? (s.poNumber ? 'po' : 'shortage')
      : s.poNumber ? 'po'
      : 'stock';
    map.set(s.soItemId, { source, po: s.poNumber, eta: s.poEta });
  }
  return map;
}

mrp.get('/', async (c) => {
  const sb = c.get('supabase');
  const category = c.req.query('category');
  const warehouseId = c.req.query('warehouseId');
  const catFilter = category && category !== 'all' ? category.toUpperCase() : null;
  const whFilter = warehouseId && warehouseId !== 'all' ? warehouseId : null;
  // Commander 2026-05-29 — an SO line with NO delivery date means the customer
  // isn't ready for goods yet, so it shouldn't drive ordering. Exclude undated
  // demand by default; ?includeUndated=true brings it back for a full view.
  const includeUndated = c.req.query('includeUndated') === 'true';
  try {
    const result = await computeMrp(sb, { catFilter, whFilter, includeUndated });
    return c.json(result);
  } catch (e) {
    return c.json({ error: 'load_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
  }
});
