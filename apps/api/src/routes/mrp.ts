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
  qty: number;
  received_qty: number | null;
  delivery_date: string | null;
  warehouse_id: string | null;
  po: { po_number: string; status: string; expected_at: string | null } | null;
};

type ProductRow = { code: string; name: string | null; category: string | null };
type BalanceRow = { product_code: string; warehouse_id: string; qty: number };

type AllocSource = 'stock' | 'po' | 'shortage';

type MrpLine = {
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

  // ── 1. Demand — outstanding SO lines ──────────────────────────────────
  const { data: demandRaw, error: demandErr } = await sb
    .from('mfg_sales_order_items')
    .select(`
      id, doc_no, item_code, description, qty, line_delivery_date, cancelled,
      so:mfg_sales_orders!inner ( debtor_name, status, customer_delivery_date )
    `)
    .eq('cancelled', false)
    .limit(5000);
  if (demandErr) return c.json({ error: 'load_failed', reason: demandErr.message }, 500);

  const demand = ((demandRaw ?? []) as unknown as DemandRow[]).filter(
    (r) => r.item_code && r.so && !SO_DONE.has(r.so.status) && r.qty > 0,
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

  // ── 3. Stock on hand — inventory_balances summed by product_code ───────
  let balQ = sb.from('inventory_balances').select('product_code, warehouse_id, qty');
  if (whFilter) balQ = balQ.eq('warehouse_id', whFilter);
  const { data: balances } = await balQ;
  const stockByCode = new Map<string, number>();
  for (const b of (balances ?? []) as BalanceRow[]) {
    stockByCode.set(b.product_code, (stockByCode.get(b.product_code) ?? 0) + (b.qty ?? 0));
  }

  // ── 4. Outstanding PO supply — open PO lines with ETA ──────────────────
  const { data: poRaw } = await sb
    .from('purchase_order_items')
    .select(`
      material_code, qty, received_qty, delivery_date, warehouse_id,
      po:purchase_orders!inner ( po_number, status, expected_at )
    `)
    .limit(5000);
  type PoSupply = { poNumber: string; eta: string | null; qtyLeft: number };
  const poByCode = new Map<string, PoSupply[]>();
  const poOutstandingByCode = new Map<string, number>();
  for (const r of (poRaw ?? []) as unknown as PoLineRow[]) {
    if (!r.po || PO_DEAD.has(r.po.status)) continue;
    const left = (r.qty ?? 0) - (r.received_qty ?? 0);
    if (left <= 0) continue;
    if (whFilter && r.warehouse_id && r.warehouse_id !== whFilter) continue;
    const eta = r.delivery_date ?? r.po.expected_at ?? null;
    const arr = poByCode.get(r.material_code) ?? [];
    arr.push({ poNumber: r.po.po_number, eta, qtyLeft: left });
    poByCode.set(r.material_code, arr);
    poOutstandingByCode.set(r.material_code, (poOutstandingByCode.get(r.material_code) ?? 0) + left);
  }
  for (const arr of poByCode.values()) arr.sort((a, b) => byDateAsc(a.eta, b.eta));

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

  // ── 6. Group demand by SKU, apply category filter ──────────────────────
  const demandByCode = new Map<string, DemandRow[]>();
  for (const d of demand) {
    const prod = prodByCode.get(d.item_code);
    const cat = prod?.category ?? null;
    if (catFilter && cat !== catFilter) continue;
    const arr = demandByCode.get(d.item_code) ?? [];
    arr.push(d);
    demandByCode.set(d.item_code, arr);
  }

  // ── 7. Allocate (greedy by SO delivery date) ───────────────────────────
  const skus: MrpSku[] = [];
  for (const [code, rows] of demandByCode.entries()) {
    const prod = prodByCode.get(code);
    rows.sort((a, b) => byDateAsc(a.line_delivery_date ?? a.so?.customer_delivery_date ?? null,
                                  b.line_delivery_date ?? b.so?.customer_delivery_date ?? null));

    let stockLeft = stockByCode.get(code) ?? 0;
    // Clone PO supply so the greedy walk can mutate qtyLeft without touching
    // the shared map (a SKU only appears once here, but stay defensive).
    const poQueue: PoSupply[] = (poByCode.get(code) ?? []).map((p) => ({ ...p }));

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

    const stock = stockByCode.get(code) ?? 0;
    const poOutstanding = poOutstandingByCode.get(code) ?? 0;
    const shortage = Math.max(0, qtyNeeded - stock - poOutstanding);
    const main = mainByCode.get(code);
    skus.push({
      itemCode: code,
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

  // Shortage SKUs first, then by code — so the rows that need ordering float
  // to the top (the orange ones the commander acts on).
  skus.sort((a, b) => {
    if ((b.shortage > 0 ? 1 : 0) !== (a.shortage > 0 ? 1 : 0)) {
      return (b.shortage > 0 ? 1 : 0) - (a.shortage > 0 ? 1 : 0);
    }
    return a.itemCode < b.itemCode ? -1 : a.itemCode > b.itemCode ? 1 : 0;
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
