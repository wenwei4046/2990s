// /document-flow — the SAP-Business-One-style "Relationship Map".
//
// Given ANY document (SO / DO / SI / AR-payment / PO / GRN / PI) it resolves the
// Sales Order(s) that document descends from, then expands the WHOLE family in
// both directions:
//
//   sales chain:     SO ──▶ DO ──▶ Sales Invoice ──▶ AR Payment
//                            └──▶ Delivery Return (goods sent back)
//   purchase chain:  SO ──▶ PO ──▶ GRN ──▶ Purchase Invoice
//                                   └──▶ Purchase Return (goods sent back)
//
// and returns a flat { nodes, edges } graph the frontend lays out in fixed
// stage-columns. Every edge carries a `kind` so the UI can colour it:
//   full     — the child took 100% of the qty it referenced       (blue)
//   partial  — the child took only part                           (red)
//   value    — SO ▶ PO, a value/qty purchase transfer             (orange)
//   payment  — Sales Invoice ▶ AR Payment                         (green)
//
// All linkage columns are the real FKs (confirmed against the migrations):
//   delivery_orders.so_doc_no / delivery_order_items.so_item_id
//   sales_invoices.so_doc_no / .delivery_order_id / sales_invoice_items.do_item_id
//   sales_invoice_payments.sales_invoice_id
//   purchase_order_items.so_item_id
//   grns.purchase_order_id / grn_items.purchase_order_item_id
//   purchase_invoices.grn_id / purchase_invoice_items.grn_item_id
//
// Read-only: this route never writes. Mounted at '/document-flow'.

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const documentFlow = new Hono<{ Bindings: Env; Variables: Variables }>();
documentFlow.use('*', supabaseAuth);

type NodeType = 'so' | 'do' | 'si' | 'payment' | 'po' | 'grn' | 'pi' | 'dr' | 'pr';
type EdgeKind = 'full' | 'partial' | 'value' | 'payment';

type FlowNode = {
  key: string;            // unique `${type}:${id}`
  type: NodeType;
  id: string;             // navigation key (doc_no for SO, uuid for the rest)
  label: string;          // human document number
  status: string | null;
  isAnchor: boolean;
};
type FlowEdge = { from: string; to: string; kind: EdgeKind };

const keyOf = (type: NodeType, id: string) => `${type}:${id}`;
const cover = (childQty: number, parentQty: number): EdgeKind =>
  parentQty > 0 && childQty + 1e-9 < parentQty ? 'partial' : 'full';
const uniq = (xs: Array<string | null | undefined>) =>
  [...new Set(xs.filter((x): x is string => !!x))];

/* Resolve the set of Sales Order doc_nos the anchor document descends from. */
async function resolveRootSos(sb: any, type: NodeType, id: string): Promise<string[]> {
  switch (type) {
    case 'so':
      return [id];
    case 'do': {
      const { data } = await sb.from('delivery_orders').select('so_doc_no').eq('id', id).maybeSingle();
      if (data?.so_doc_no) return [data.so_doc_no];
      const { data: lines } = await sb.from('delivery_order_items').select('so_item_id').eq('delivery_order_id', id);
      return soDocNosFromSoItems(sb, uniq((lines ?? []).map((l: any) => l.so_item_id)));
    }
    case 'si': {
      const { data } = await sb.from('sales_invoices').select('so_doc_no, delivery_order_id').eq('id', id).maybeSingle();
      if (data?.so_doc_no) return [data.so_doc_no];
      if (data?.delivery_order_id) return resolveRootSos(sb, 'do', data.delivery_order_id);
      const { data: lines } = await sb.from('sales_invoice_items').select('so_item_id, do_item_id').eq('sales_invoice_id', id);
      const soItems = uniq((lines ?? []).map((l: any) => l.so_item_id));
      if (soItems.length) return soDocNosFromSoItems(sb, soItems);
      const doItems = uniq((lines ?? []).map((l: any) => l.do_item_id));
      return soDocNosFromDoItems(sb, doItems);
    }
    case 'payment': {
      const { data } = await sb.from('sales_invoice_payments').select('sales_invoice_id').eq('id', id).maybeSingle();
      return data?.sales_invoice_id ? resolveRootSos(sb, 'si', data.sales_invoice_id) : [];
    }
    case 'po': {
      const { data: lines } = await sb.from('purchase_order_items').select('so_item_id').eq('purchase_order_id', id);
      return soDocNosFromSoItems(sb, uniq((lines ?? []).map((l: any) => l.so_item_id)));
    }
    case 'grn': {
      const { data } = await sb.from('grns').select('purchase_order_id').eq('id', id).maybeSingle();
      return data?.purchase_order_id ? resolveRootSos(sb, 'po', data.purchase_order_id) : [];
    }
    case 'pi': {
      const { data } = await sb.from('purchase_invoices').select('grn_id').eq('id', id).maybeSingle();
      return data?.grn_id ? resolveRootSos(sb, 'grn', data.grn_id) : [];
    }
    case 'dr': {
      // Delivery Return hangs off its Delivery Order — resolve through the DO.
      const { data } = await sb.from('delivery_returns').select('delivery_order_id').eq('id', id).maybeSingle();
      return data?.delivery_order_id ? resolveRootSos(sb, 'do', data.delivery_order_id) : [];
    }
    case 'pr': {
      // Purchase Return hangs off its Goods Receipt (or, failing that, its PO).
      const { data } = await sb.from('purchase_returns').select('grn_id, purchase_order_id').eq('id', id).maybeSingle();
      if (data?.grn_id) return resolveRootSos(sb, 'grn', data.grn_id);
      return data?.purchase_order_id ? resolveRootSos(sb, 'po', data.purchase_order_id) : [];
    }
    default:
      return [];
  }
}

async function soDocNosFromSoItems(sb: any, soItemIds: string[]): Promise<string[]> {
  if (soItemIds.length === 0) return [];
  const { data } = await sb.from('mfg_sales_order_items').select('doc_no').in('id', soItemIds);
  return uniq((data ?? []).map((r: any) => r.doc_no));
}
async function soDocNosFromDoItems(sb: any, doItemIds: string[]): Promise<string[]> {
  if (doItemIds.length === 0) return [];
  const { data } = await sb.from('delivery_order_items').select('so_item_id').in('id', doItemIds);
  return soDocNosFromSoItems(sb, uniq((data ?? []).map((r: any) => r.so_item_id)));
}

documentFlow.get('/:type/:id', async (c) => {
  const sb = c.get('supabase');
  const type = c.req.param('type') as NodeType;
  const id = c.req.param('id');
  if (!['so', 'do', 'si', 'payment', 'po', 'grn', 'pi', 'dr', 'pr'].includes(type)) {
    return c.json({ error: 'bad_type' }, 400);
  }

  const rootSos = await resolveRootSos(sb, type, id);
  const anchorKey = keyOf(type, id);
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const addEdge = (from: string, to: string, kind: EdgeKind) => {
    if (nodes.has(from) && nodes.has(to)) edges.push({ from, to, kind });
  };

  if (rootSos.length === 0) {
    // Orphan document with no resolvable SO — still show it alone so the map
    // is never blank. (Rare: an ad-hoc invoice with no SO/DO link.)
    nodes.set(anchorKey, { key: anchorKey, type, id, label: id, status: null, isAnchor: true });
    return c.json({ nodes: [...nodes.values()], edges, rootSos });
  }

  // ── 1. SO headers + lines ───────────────────────────────────────────────
  const { data: soHeaders } = await sb.from('mfg_sales_orders').select('doc_no, status').in('doc_no', rootSos);
  for (const s of (soHeaders ?? []) as any[]) {
    const k = keyOf('so', s.doc_no);
    nodes.set(k, { key: k, type: 'so', id: s.doc_no, label: s.doc_no, status: s.status ?? null, isAnchor: k === anchorKey });
  }
  const { data: soLines } = await sb.from('mfg_sales_order_items').select('id, doc_no, qty').in('doc_no', rootSos);
  const soItemQty = new Map<string, number>();   // soItemId → qty
  const soItemToDoc = new Map<string, string>(); // soItemId → SO doc_no
  for (const l of (soLines ?? []) as any[]) {
    soItemQty.set(l.id, Number(l.qty ?? 0));
    soItemToDoc.set(l.id, l.doc_no);
  }
  const soItemIds = [...soItemQty.keys()];

  // ── 2. DOs (sales chain) ────────────────────────────────────────────────
  const doLinesBySoItem = soItemIds.length
    ? (await sb.from('delivery_order_items').select('id, delivery_order_id, so_item_id, qty').in('so_item_id', soItemIds)).data ?? []
    : [];
  const { data: doByHeader } = await sb.from('delivery_orders').select('id, do_number, status, so_doc_no').in('so_doc_no', rootSos);
  const doIds = uniq([
    ...((doByHeader ?? []) as any[]).map((d) => d.id),
    ...((doLinesBySoItem) as any[]).map((l) => l.delivery_order_id),
  ]);
  const doHeaderById = new Map<string, any>();
  for (const d of (doByHeader ?? []) as any[]) doHeaderById.set(d.id, d);
  const missingDoIds = doIds.filter((d) => !doHeaderById.has(d));
  if (missingDoIds.length) {
    const { data: more } = await sb.from('delivery_orders').select('id, do_number, status, so_doc_no').in('id', missingDoIds);
    for (const d of (more ?? []) as any[]) doHeaderById.set(d.id, d);
  }
  // do line id → { doId, qty, soItemId } ; and per-DO coverage vs SO
  const doItemMeta = new Map<string, { doId: string; qty: number; soItemId: string | null }>();
  const soToDo = new Map<string, { childQty: number; parentItems: Set<string> }>(); // `${soDocNo}|${doId}`
  for (const l of (doLinesBySoItem) as any[]) {
    doItemMeta.set(l.id, { doId: l.delivery_order_id, qty: Number(l.qty ?? 0), soItemId: l.so_item_id ?? null });
    const soDoc = l.so_item_id ? soItemToDoc.get(l.so_item_id) : undefined;
    if (!soDoc) continue;
    const k = `${soDoc}|${l.delivery_order_id}`;
    const agg = soToDo.get(k) ?? { childQty: 0, parentItems: new Set<string>() };
    agg.childQty += Number(l.qty ?? 0);
    agg.parentItems.add(l.so_item_id);
    soToDo.set(k, agg);
  }
  for (const d of doHeaderById.values()) {
    const k = keyOf('do', d.id);
    nodes.set(k, { key: k, type: 'do', id: d.id, label: d.do_number ?? d.id, status: d.status ?? null, isAnchor: k === anchorKey });
  }
  // SO → DO edges
  for (const d of doHeaderById.values()) {
    const soDoc = d.so_doc_no && rootSos.includes(d.so_doc_no) ? d.so_doc_no : rootSos.find((s) => soToDo.has(`${s}|${d.id}`));
    if (!soDoc) continue;
    const agg = soToDo.get(`${soDoc}|${d.id}`);
    const parentQty = agg ? [...agg.parentItems].reduce((s, si) => s + (soItemQty.get(si) ?? 0), 0) : 0;
    addEdge(keyOf('so', soDoc), keyOf('do', d.id), agg ? cover(agg.childQty, parentQty) : 'full');
  }

  // ── 3. Sales Invoices ───────────────────────────────────────────────────
  const doItemIds = [...doItemMeta.keys()];
  const siByHeaderDo = doIds.length
    ? (await sb.from('sales_invoices').select('id, invoice_number, status, so_doc_no, delivery_order_id').in('delivery_order_id', doIds)).data ?? []
    : [];
  const { data: siBySoDoc } = await sb.from('sales_invoices').select('id, invoice_number, status, so_doc_no, delivery_order_id').in('so_doc_no', rootSos);
  const siLineLinks = doItemIds.length
    ? (await sb.from('sales_invoice_items').select('sales_invoice_id, do_item_id, so_item_id, qty').in('do_item_id', doItemIds)).data ?? []
    : [];
  const siById = new Map<string, any>();
  for (const s of [...(siByHeaderDo as any[]), ...((siBySoDoc ?? []) as any[])]) siById.set(s.id, s);
  // pull SIs reachable only through line links
  const lineSiIds = uniq((siLineLinks as any[]).map((l) => l.sales_invoice_id)).filter((sid) => !siById.has(sid));
  if (lineSiIds.length) {
    const { data: more } = await sb.from('sales_invoices').select('id, invoice_number, status, so_doc_no, delivery_order_id').in('id', lineSiIds);
    for (const s of (more ?? []) as any[]) siById.set(s.id, s);
  }
  for (const s of siById.values()) {
    const k = keyOf('si', s.id);
    nodes.set(k, { key: k, type: 'si', id: s.id, label: s.invoice_number ?? s.id, status: s.status ?? null, isAnchor: k === anchorKey });
  }
  // DO → SI coverage from line links: `${doId}|${siId}`
  const doToSi = new Map<string, { childQty: number; parentItems: Set<string> }>();
  for (const l of (siLineLinks as any[])) {
    const dm = l.do_item_id ? doItemMeta.get(l.do_item_id) : undefined;
    if (!dm) continue;
    const k = `${dm.doId}|${l.sales_invoice_id}`;
    const agg = doToSi.get(k) ?? { childQty: 0, parentItems: new Set<string>() };
    agg.childQty += Number(l.qty ?? 0);
    agg.parentItems.add(l.do_item_id);
    doToSi.set(k, agg);
  }
  for (const s of siById.values()) {
    let linked = false;
    for (const d of doHeaderById.values()) {
      const agg = doToSi.get(`${d.id}|${s.id}`);
      if (agg) {
        const parentQty = [...agg.parentItems].reduce((sum, di) => sum + (doItemMeta.get(di)?.qty ?? 0), 0);
        addEdge(keyOf('do', d.id), keyOf('si', s.id), cover(agg.childQty, parentQty));
        linked = true;
      } else if (s.delivery_order_id === d.id) {
        addEdge(keyOf('do', d.id), keyOf('si', s.id), 'full');
        linked = true;
      }
    }
    // SI tied straight to the SO (no DO in between)
    if (!linked && s.so_doc_no && rootSos.includes(s.so_doc_no)) {
      addEdge(keyOf('so', s.so_doc_no), keyOf('si', s.id), 'full');
    }
  }

  // ── 4. AR Payments ──────────────────────────────────────────────────────
  const siIds = [...siById.keys()];
  if (siIds.length) {
    const { data: pays } = await sb.from('sales_invoice_payments')
      .select('id, sales_invoice_id, method, approval_code, amount_centi').in('sales_invoice_id', siIds);
    for (const p of (pays ?? []) as any[]) {
      const k = keyOf('payment', p.id);
      const label = p.approval_code?.trim() ? p.approval_code.trim() : `${(p.method ?? 'Payment')} ${(Number(p.amount_centi ?? 0) / 100).toFixed(0)}`;
      nodes.set(k, { key: k, type: 'payment', id: p.id, label, status: null, isAnchor: k === anchorKey });
      addEdge(keyOf('si', p.sales_invoice_id), k, 'payment');
    }
  }

  // ── 8. Delivery Returns (sales chain) ───────────────────────────────────
  // A Delivery Return reverses goods on a Delivery Order. It hangs off the DO,
  // mirroring how a GRN hangs off its PO. Coverage compares returned qty to the
  // DO line qty (a full return greys out blue, a partial one red).
  if (doIds.length) {
    const { data: drByHeader } = await sb.from('delivery_returns')
      .select('id, return_number, status, delivery_order_id').in('delivery_order_id', doIds);
    const drIds = uniq((drByHeader ?? []).map((d: any) => d.id));
    const drLineLinks = drIds.length
      ? (await sb.from('delivery_return_items').select('delivery_return_id, do_item_id, qty_returned').in('delivery_return_id', drIds)).data ?? []
      : [];
    const doToDr = new Map<string, { childQty: number; parentItems: Set<string> }>(); // `${doId}|${drId}`
    for (const l of (drLineLinks as any[])) {
      const dm = l.do_item_id ? doItemMeta.get(l.do_item_id) : undefined;
      if (!dm) continue;
      const k = `${dm.doId}|${l.delivery_return_id}`;
      const agg = doToDr.get(k) ?? { childQty: 0, parentItems: new Set<string>() };
      agg.childQty += Number(l.qty_returned ?? 0);
      agg.parentItems.add(l.do_item_id);
      doToDr.set(k, agg);
    }
    for (const d of (drByHeader ?? []) as any[]) {
      const k = keyOf('dr', d.id);
      nodes.set(k, { key: k, type: 'dr', id: d.id, label: d.return_number ?? d.id, status: d.status ?? null, isAnchor: k === anchorKey });
      if (d.delivery_order_id) {
        const agg = doToDr.get(`${d.delivery_order_id}|${d.id}`);
        const parentQty = agg ? [...agg.parentItems].reduce((s, di) => s + (doItemMeta.get(di)?.qty ?? 0), 0) : 0;
        addEdge(keyOf('do', d.delivery_order_id), k, agg ? cover(agg.childQty, parentQty) : 'full');
      }
    }
  }

  // ── 5. POs (purchase chain) ─────────────────────────────────────────────
  const poItemLinks = soItemIds.length
    ? (await sb.from('purchase_order_items').select('id, purchase_order_id, so_item_id, qty').in('so_item_id', soItemIds)).data ?? []
    : [];
  const poIds = uniq((poItemLinks as any[]).map((l) => l.purchase_order_id));
  const poItemMeta = new Map<string, { poId: string; qty: number }>();
  for (const l of (poItemLinks as any[])) poItemMeta.set(l.id, { poId: l.purchase_order_id, qty: Number(l.qty ?? 0) });
  if (poIds.length) {
    const { data: pos } = await sb.from('purchase_orders').select('id, po_number, status').in('id', poIds);
    for (const p of (pos ?? []) as any[]) {
      const k = keyOf('po', p.id);
      nodes.set(k, { key: k, type: 'po', id: p.id, label: p.po_number ?? p.id, status: p.status ?? null, isAnchor: k === anchorKey });
    }
    // SO → PO: a purchase raised against the SO is a value transfer.
    const poToSo = new Map<string, Set<string>>(); // poId → soDocNos
    for (const l of (poItemLinks as any[])) {
      const soDoc = l.so_item_id ? soItemToDoc.get(l.so_item_id) : undefined;
      if (!soDoc) continue;
      const set = poToSo.get(l.purchase_order_id) ?? new Set<string>();
      set.add(soDoc);
      poToSo.set(l.purchase_order_id, set);
    }
    for (const [poId, soDocs] of poToSo) for (const soDoc of soDocs) addEdge(keyOf('so', soDoc), keyOf('po', poId), 'value');
  }

  // ── 6. GRNs ─────────────────────────────────────────────────────────────
  const poItemIds = [...poItemMeta.keys()];
  const grnByHeader = poIds.length
    ? (await sb.from('grns').select('id, grn_number, status, purchase_order_id').in('purchase_order_id', poIds)).data ?? []
    : [];
  const grnLineLinks = poItemIds.length
    ? (await sb.from('grn_items').select('id, grn_id, purchase_order_item_id, qty').in('purchase_order_item_id', poItemIds)).data ?? []
    : [];
  const grnById = new Map<string, any>();
  for (const g of (grnByHeader as any[])) grnById.set(g.id, g);
  const grnItemMeta = new Map<string, { grnId: string; qty: number }>();
  const poToGrn = new Map<string, { childQty: number; parentItems: Set<string> }>(); // `${poId}|${grnId}`
  for (const l of (grnLineLinks as any[])) {
    grnItemMeta.set(l.id, { grnId: l.grn_id, qty: Number(l.qty ?? 0) });
    const pm = poItemMeta.get(l.purchase_order_item_id);
    if (!pm) continue;
    const k = `${pm.poId}|${l.grn_id}`;
    const agg = poToGrn.get(k) ?? { childQty: 0, parentItems: new Set<string>() };
    agg.childQty += Number(l.qty ?? 0);
    agg.parentItems.add(l.purchase_order_item_id);
    poToGrn.set(k, agg);
  }
  for (const g of grnById.values()) {
    const k = keyOf('grn', g.id);
    nodes.set(k, { key: k, type: 'grn', id: g.id, label: g.grn_number ?? g.id, status: g.status ?? null, isAnchor: k === anchorKey });
    if (g.purchase_order_id) {
      const agg = poToGrn.get(`${g.purchase_order_id}|${g.id}`);
      const parentQty = agg ? [...agg.parentItems].reduce((s, pi) => s + (poItemMeta.get(pi)?.qty ?? 0), 0) : 0;
      addEdge(keyOf('po', g.purchase_order_id), k, agg ? cover(agg.childQty, parentQty) : 'full');
    }
  }

  // ── 7. Purchase Invoices ────────────────────────────────────────────────
  const grnIds = [...grnById.keys()];
  const grnItemIds = [...grnItemMeta.keys()];
  if (grnIds.length) {
    const { data: pis } = await sb.from('purchase_invoices').select('id, invoice_number, status, grn_id').in('grn_id', grnIds);
    const piLineLinks = grnItemIds.length
      ? (await sb.from('purchase_invoice_items').select('purchase_invoice_id, grn_item_id, qty').in('grn_item_id', grnItemIds)).data ?? []
      : [];
    const grnToPi = new Map<string, { childQty: number; parentItems: Set<string> }>();
    for (const l of (piLineLinks as any[])) {
      const gm = l.grn_item_id ? grnItemMeta.get(l.grn_item_id) : undefined;
      if (!gm) continue;
      const k = `${gm.grnId}|${l.purchase_invoice_id}`;
      const agg = grnToPi.get(k) ?? { childQty: 0, parentItems: new Set<string>() };
      agg.childQty += Number(l.qty ?? 0);
      agg.parentItems.add(l.grn_item_id);
      grnToPi.set(k, agg);
    }
    for (const p of (pis ?? []) as any[]) {
      const k = keyOf('pi', p.id);
      nodes.set(k, { key: k, type: 'pi', id: p.id, label: p.invoice_number ?? p.id, status: p.status ?? null, isAnchor: k === anchorKey });
      if (p.grn_id) {
        const agg = grnToPi.get(`${p.grn_id}|${p.id}`);
        const parentQty = agg ? [...agg.parentItems].reduce((s, gi) => s + (grnItemMeta.get(gi)?.qty ?? 0), 0) : 0;
        addEdge(keyOf('grn', p.grn_id), k, agg ? cover(agg.childQty, parentQty) : 'full');
      }
    }
  }

  // ── 9. Purchase Returns (purchase chain) ────────────────────────────────
  // A Purchase Return reverses goods on a Goods Receipt. It hangs off the GRN,
  // mirroring how a Delivery Return hangs off its DO. Coverage compares returned
  // qty to the GRN line qty.
  if (grnIds.length) {
    const { data: prByHeader } = await sb.from('purchase_returns')
      .select('id, return_number, status, grn_id').in('grn_id', grnIds);
    const prIds = uniq((prByHeader ?? []).map((p: any) => p.id));
    const prLineLinks = prIds.length
      ? (await sb.from('purchase_return_items').select('purchase_return_id, grn_item_id, qty_returned').in('purchase_return_id', prIds)).data ?? []
      : [];
    const grnToPr = new Map<string, { childQty: number; parentItems: Set<string> }>(); // `${grnId}|${prId}`
    for (const l of (prLineLinks as any[])) {
      const gm = l.grn_item_id ? grnItemMeta.get(l.grn_item_id) : undefined;
      if (!gm) continue;
      const k = `${gm.grnId}|${l.purchase_return_id}`;
      const agg = grnToPr.get(k) ?? { childQty: 0, parentItems: new Set<string>() };
      agg.childQty += Number(l.qty_returned ?? 0);
      agg.parentItems.add(l.grn_item_id);
      grnToPr.set(k, agg);
    }
    for (const p of (prByHeader ?? []) as any[]) {
      const k = keyOf('pr', p.id);
      nodes.set(k, { key: k, type: 'pr', id: p.id, label: p.return_number ?? p.id, status: p.status ?? null, isAnchor: k === anchorKey });
      if (p.grn_id) {
        const agg = grnToPr.get(`${p.grn_id}|${p.id}`);
        const parentQty = agg ? [...agg.parentItems].reduce((s, gi) => s + (grnItemMeta.get(gi)?.qty ?? 0), 0) : 0;
        addEdge(keyOf('grn', p.grn_id), k, agg ? cover(agg.childQty, parentQty) : 'full');
      }
    }
  }

  return c.json({ nodes: [...nodes.values()], edges, rootSos });
});
