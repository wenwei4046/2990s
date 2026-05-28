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
  line_delivery_date: string | null;
  cancelled: boolean;
  so: {
    debtor_name: string | null;
    status: string;
    customer_delivery_date: string | null;
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
  deliveryDate: string | null;
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
  lines: MrpLine[];
};

/* Earliest-first comparator that pushes NULL dates to the end. */
function byDateAsc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : 1;
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

  // ── 1. Demand — outstanding SO lines ──────────────────────────────────
  const { data: demandRaw, error: demandErr } = await sb
    .from('mfg_sales_order_items')
    .select(`
      id, doc_no, item_code, description, item_group, variants, qty, line_delivery_date, cancelled,
      so:mfg_sales_orders!inner ( debtor_name, status, customer_delivery_date )
    `)
    .eq('cancelled', false)
    .limit(5000);
  if (demandErr) return c.json({ error: 'load_failed', reason: demandErr.message }, 500);

  const demand = ((demandRaw ?? []) as unknown as DemandRow[]).filter(
    (r) => r.item_code && r.so && !SO_DONE.has(r.so.status) && r.qty > 0
      // Undated lines (no line delivery date AND no SO delivery date) are not
      // ready to order — drop them unless the caller explicitly asks for them.
      && (includeUndated || Boolean(r.line_delivery_date ?? r.so.customer_delivery_date)),
  );

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
      material_code, item_group, variants, qty, received_qty, delivery_date, warehouse_id,
      po:purchase_orders!inner ( po_number, status, expected_at )
    `)
    .limit(5000);
  type PoSupply = { poNumber: string; eta: string | null; qtyLeft: number };
  const poByKey = new Map<string, PoSupply[]>();
  const poOutstandingByKey = new Map<string, number>();
  for (const r of (poRaw ?? []) as unknown as PoLineRow[]) {
    if (!r.po || PO_DEAD.has(r.po.status)) continue;
    const left = (r.qty ?? 0) - (r.received_qty ?? 0);
    if (left <= 0) continue;
    if (whFilter && r.warehouse_id && r.warehouse_id !== whFilter) continue;
    const k = composite(r.material_code, variantKeyOf(r.item_group, r.variants));
    const eta = r.delivery_date ?? r.po.expected_at ?? null;
    const arr = poByKey.get(k) ?? [];
    arr.push({ poNumber: r.po.po_number, eta, qtyLeft: left });
    poByKey.set(k, arr);
    poOutstandingByKey.set(k, (poOutstandingByKey.get(k) ?? 0) + left);
  }
  for (const arr of poByKey.values()) arr.sort((a, b) => byDateAsc(a.eta, b.eta));

  // ── 5. Main supplier per SKU (display + later one-click PO) ─────────────
  const codes = [...new Set(demand.map((d) => d.item_code))];
  const mainByCode = new Map<string, { code: string; name: string }>();
  if (codes.length > 0) {
    const { data: binds } = await sb
      .from('supplier_material_bindings')
      .select('material_code, is_main_supplier, supplier:suppliers(code, name)')
      .eq('material_kind', 'mfg_product')
      .in('material_code', codes)
      .order('is_main_supplier', { ascending: false });
    for (const b of (binds ?? []) as Array<{ material_code: string; supplier: { code: string; name: string } | Array<{ code: string; name: string }> | null }>) {
      if (mainByCode.has(b.material_code)) continue;
      const s = Array.isArray(b.supplier) ? b.supplier[0] : b.supplier;
      if (s) mainByCode.set(b.material_code, { code: s.code, name: s.name });
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
    // the shared map.
    const poQueue: PoSupply[] = (poByKey.get(k) ?? []).map((p) => ({ ...p }));

    const lines: MrpLine[] = [];
    let qtyNeeded = 0;
    for (const r of rows) {
      qtyNeeded += r.qty;
      let need = r.qty;
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

      const source: AllocSource = need > 0 ? 'shortage' : poNumber != null ? 'po' : 'stock';
      lines.push({
        soItemId: r.id,
        soDocNo: r.doc_no,
        debtorName: r.so?.debtor_name ?? null,
        deliveryDate: r.line_delivery_date ?? r.so?.customer_delivery_date ?? null,
        qty: r.qty,
        source,
        poNumber,
        poEta,
        shortageQty: need,
      });
    }

    const stock = stockByKey.get(k) ?? 0;
    const poOutstanding = poOutstandingByKey.get(k) ?? 0;
    const shortage = Math.max(0, qtyNeeded - stock - poOutstanding);
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
      lines,
    });
  }

  // Shortage SKUs first, then by code + variant — so the rows that need
  // ordering float to the top (the orange ones the commander acts on).
  skus.sort((a, b) => {
    if ((b.shortage > 0 ? 1 : 0) !== (a.shortage > 0 ? 1 : 0)) {
      return (b.shortage > 0 ? 1 : 0) - (a.shortage > 0 ? 1 : 0);
    }
    if (a.itemCode !== b.itemCode) return a.itemCode < b.itemCode ? -1 : 1;
    return (a.variantLabel ?? '') < (b.variantLabel ?? '') ? -1 : 1;
  });

  return c.json({
    asOf: new Date().toISOString(),
    categories: [...categorySet].sort(),
    warehouses: warehouses ?? [],
    skus,
    totals: {
      skuCount: skus.length,
      shortageSkuCount: skus.filter((s) => s.shortage > 0).length,
      shortageUnits: skus.reduce((acc, s) => acc + s.shortage, 0),
    },
  });
});
