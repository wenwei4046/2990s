// ----------------------------------------------------------------------------
// /delivery-planning — STAGE 4 (the core) of the Delivery / TMS module.
//
// The Delivery Planning board: which live Sales Orders still need delivering,
// bucketed into 4 DERIVED states (PENDING_DELIVERY / PENDING_SCHEDULE /
// OVERDUE / DELIVERED) and grouped by delivery REGION (one per delivery
// warehouse). One order can be split across TWO region trips on two dates via
// delivery_legs (a KL transit leg then a Penang/SG final leg) — so it surfaces
// under every leg's region tab with that leg's date.
//
// delivery_state is DERIVED LIVE here (migration 0195 added a nullable
// mfg_sales_orders.delivery_state / delivery_orders.delivery_state column, but
// that is for manual overrides / caching only — never the source of truth):
//   - DELIVERED        — the SO's goods are fully handed over (status DELIVERED,
//                        or every deliverable line remaining == 0 once any qty
//                        has shipped).
//   - PENDING_SCHEDULE — ready to ship (summariseReadiness.isMainReady — every
//                        MAIN line READY) but not yet fully delivered.
//   - OVERDUE          — NOT ready AND today >= customer_delivery_date − 3 days
//                        (owner rule: "3 days before delivery and goods still
//                        not ready").
//   - PENDING_DELIVERY — NOT ready and not yet inside the 3-day window.
// A manual override stored on the SO header (delivery_state) wins when present.
//
// Region = the SO LINE warehouse_id grouped to one of:
//   PJ·KL (PJ SHOWROOM + SLGR WAREHOUSE) · Penang (PG WAREHOUSE) ·
//   Sabah (SBH WAREHOUSE) · Sarawak (SRK WAREHOUSE) · Singapore (no warehouse
//   — filtered by customer_state = Singapore). CHINA WAREHOUSE (transit) and
//   CONSIGN-OUT are NOT delivery regions and are skipped.
//
// DRAFT / CANCELLED SOs (and DRAFT / CANCELLED DOs) are excluded everywhere —
// the DRAFT guards just shipped on the SO/DO side and an uncommitted doc must
// never enter delivery planning.
//
// Mounted at '/delivery-planning' in apps/api/src/index.ts.
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { paginateAll } from '../lib/paginate-all';
import { summariseReadiness, type ReadinessLine } from '../lib/so-readiness';
import { soDeliverableRemaining } from './delivery-orders-mfg';

export const deliveryPlanning = new Hono<{ Bindings: Env; Variables: Variables }>();
deliveryPlanning.use('*', supabaseAuth);

/* ── Region model ─────────────────────────────────────────────────────────
   ONE region per DELIVERY warehouse (CLAUDE.md: stock never crosses
   warehouses). Codes verified live in prod. PJ·KL pools the two Klang-valley
   warehouses (PJ SHOWROOM + SLGR WAREHOUSE) into one delivery region. CHINA
   WAREHOUSE (transit) + CONSIGN-OUT are NOT delivery regions → SKIP. Singapore
   has no warehouse — it is detected from customer_state instead. */
type RegionKey = 'PJKL' | 'PENANG' | 'SABAH' | 'SARAWAK' | 'SINGAPORE';

const WAREHOUSE_CODE_TO_REGION: Record<string, RegionKey> = {
  'PJ SHOWROOM': 'PJKL',
  'SLGR WAREHOUSE': 'PJKL',
  'PG WAREHOUSE': 'PENANG',
  'SBH WAREHOUSE': 'SABAH',
  'SRK WAREHOUSE': 'SARAWAK',
};
/* Warehouse codes that are NOT delivery regions (transit / consignment). */
const NON_REGION_CODES = new Set(['CHINA WAREHOUSE', 'CONSIGN-OUT']);

const REGION_LABEL: Record<RegionKey, string> = {
  PJKL: 'PJ·KL',
  PENANG: 'Penang',
  SABAH: 'Sabah',
  SARAWAK: 'Sarawak',
  SINGAPORE: 'Singapore',
};

/* Is a free-text customer_state Singapore? (SG SOs carry no MY warehouse.) */
function isSingaporeState(state: string | null | undefined): boolean {
  const s = (state ?? '').trim().toUpperCase();
  return s === 'SINGAPORE' || s === 'SG' || s === 'SGP';
}

type DeliveryState = 'PENDING_DELIVERY' | 'PENDING_SCHEDULE' | 'OVERDUE' | 'DELIVERED';
const DELIVERY_STATES: DeliveryState[] = ['PENDING_DELIVERY', 'PENDING_SCHEDULE', 'OVERDUE', 'DELIVERED'];

/* Malaysian "today" (UTC+8), timezone-stable on the Workers UTC runtime. The
   day boundary must be MYT so days_left / the 3-day overdue window match what
   the coordinator sees on the floor. */
function todayMY(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/* Whole-day difference (target − today) in integer days, both as YYYY-MM-DD. */
function daysBetween(fromISO: string, toISO: string | null | undefined): number | null {
  if (!toISO) return null;
  const a = new Date(`${fromISO}T00:00:00Z`).getTime();
  const b = new Date(`${String(toISO).slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/* A leg as returned to the client — surfaces an order under its region tab. */
type LegOut = {
  id: string;
  source_type: 'SO' | 'DO';
  source_id: string;
  leg_no: number;
  warehouse_id: string | null;
  warehouse_code: string | null;
  region: RegionKey | null;
  trip_id: string | null;
  leg_date: string | null;
  leg_kind: 'transit' | 'final';
  notes: string | null;
};

/* ──────────────────────────────────────────────────────────────────────────
   GET /delivery-planning?region=<warehouseId|ALL|SG>&state=<delivery_state|ALL>
   The board. Source = live (status NOT DRAFT/CANCELLED) mfg_sales_orders that
   need delivery (have a customer_delivery_date or internal_expected_dd) +
   their DOs. delivery_state derived LIVE per SO. Region grouped from the SO
   LINE warehouse_id; SG by customer_state. Legs let an order appear in two
   regions with two dates.
   ─────────────────────────────────────────────────────────────────────────*/
deliveryPlanning.get('/', async (c) => {
  const sb = c.get('supabase');
  const today = todayMY();

  const regionParam = (c.req.query('region') ?? 'ALL').trim();   // warehouseId | ALL | SG
  const stateParam = (c.req.query('state') ?? 'ALL').trim().toUpperCase();

  /* 1. Warehouse master → code map + region map (read-only label lookup). */
  const { data: whRows, error: whErr } = await sb
    .from('warehouses')
    .select('id, code, name');
  if (whErr) return c.json({ error: 'load_failed', reason: whErr.message }, 500);
  const whCode = new Map<string, string>();
  const whName = new Map<string, string>();
  const whRegion = new Map<string, RegionKey>();
  for (const w of (whRows ?? []) as Array<{ id: string; code: string | null; name: string | null }>) {
    const code = (w.code ?? '').trim();
    whCode.set(w.id, code);
    whName.set(w.id, w.name ?? code);
    const region = WAREHOUSE_CODE_TO_REGION[code.toUpperCase()] ?? WAREHOUSE_CODE_TO_REGION[code];
    if (region) whRegion.set(w.id, region);
  }
  const regionForWarehouse = (id: string | null | undefined): RegionKey | null =>
    (id && whRegion.get(id)) || null;

  /* 2. Live SO headers needing delivery — NOT DRAFT / CANCELLED, and carrying a
        delivery date signal (customer_delivery_date or internal_expected_dd).
        Paginated so the 1000-row PostgREST cap never silently truncates. */
  type SoHeaderRow = {
    doc_no: string | null; debtor_code: string | null; debtor_name: string | null;
    phone: string | null; branding: string | null; status: string | null; delivery_state: string | null;
    customer_state: string | null; customer_country: string | null;
    customer_delivery_date: string | null; internal_expected_dd: string | null; processing_date: string | null;
    local_total_centi: number | null; balance_centi: number | null;
  };
  const { data: soRowsRaw, error: soErr } = await paginateAll<SoHeaderRow>((from, to) =>
    sb.from('mfg_sales_orders')
      .select('doc_no, debtor_code, debtor_name, phone, branding, status, delivery_state, customer_state, customer_country, customer_delivery_date, internal_expected_dd, processing_date, local_total_centi, balance_centi')
      .neq('status', 'DRAFT')
      .neq('status', 'CANCELLED')
      .order('customer_delivery_date', { ascending: true, nullsFirst: false })
      .range(from, to),
  );
  if (soErr) return c.json({ error: 'load_failed', reason: soErr.message }, 500);
  /* Only SOs that actually need delivering — they carry a date signal
     (customer_delivery_date OR internal_expected_dd / processing_date). Filtered
     in JS (not a PostgREST .or()) to keep the paginated query's row type clean. */
  const soRows = (soRowsRaw ?? []).filter(
    (r) => r.customer_delivery_date != null || r.internal_expected_dd != null || r.processing_date != null,
  );
  const docNos = soRows.map((r) => String(r.doc_no ?? '')).filter(Boolean);

  if (docNos.length === 0) {
    return c.json({ orders: [], counts: emptyCounts(), regions: regionList() });
  }

  /* 3. Per-line readiness + per-line warehouse. One batched, paginated read of
        the non-cancelled lines for every candidate SO. stock_status drives
        summariseReadiness (isMainReady = every MAIN line READY); warehouse_id
        (per SO line, migration 0118) drives the region grouping. */
  const { data: itemRowsRaw } = await paginateAll<{
    doc_no: string; item_group: string | null; item_code: string | null;
    stock_status: string | null; cancelled: boolean | null; warehouse_id: string | null;
  }>((from, to) =>
    sb.from('mfg_sales_order_items')
      .select('doc_no, item_group, item_code, stock_status, cancelled, warehouse_id')
      .in('doc_no', docNos)
      .eq('cancelled', false)
      .range(from, to),
  );
  const linesByDoc = new Map<string, ReadinessLine[]>();
  const warehousesByDoc = new Map<string, Set<string>>();
  for (const it of (itemRowsRaw ?? [])) {
    const dn = it.doc_no;
    if (!dn) continue;
    const arr = linesByDoc.get(dn) ?? [];
    arr.push({ item_group: it.item_group, item_code: it.item_code, stock_status: (it.stock_status ?? 'PENDING') as ReadinessLine['stock_status'], cancelled: it.cancelled });
    linesByDoc.set(dn, arr);
    if (it.warehouse_id) {
      const ws = warehousesByDoc.get(dn) ?? new Set<string>();
      ws.add(it.warehouse_id);
      warehousesByDoc.set(dn, ws);
    }
  }

  /* 4. Delivery progress per SO (live remaining) — drives DELIVERED detection.
        soDeliverableRemaining excludes DRAFT / CANCELLED DOs already; an SO is
        fully delivered once every line's remaining == 0 AND at least one qty has
        shipped (delivered > 0). */
  const deliveredByDoc = new Map<string, number>();
  const remainingByDoc = new Map<string, number>();
  {
    const deliverableMap = await soDeliverableRemaining(sb, docNos);
    for (const line of deliverableMap.values()) {
      deliveredByDoc.set(line.docNo, (deliveredByDoc.get(line.docNo) ?? 0) + line.delivered);
      remainingByDoc.set(line.docNo, (remainingByDoc.get(line.docNo) ?? 0) + line.remaining);
    }
  }

  /* 5. DOs for these SOs — the cut DO doc_no + status + per-DO crew (driver /
        helper / lorry from delivery_order_crew, Stage 3). Non-DRAFT/CANCELLED. */
  const { data: doRowsRaw } = await paginateAll<{
    id: string; do_number: string | null; so_doc_no: string | null; status: string | null;
    delivery_state: string | null; customer_delivery_date: string | null;
  }>((from, to) =>
    sb.from('delivery_orders')
      .select('id, do_number, so_doc_no, status, delivery_state, customer_delivery_date')
      .in('so_doc_no', docNos)
      .range(from, to),
  );
  const doByDoc = new Map<string, Array<{ id: string; doNumber: string; status: string }>>();
  const doIds: string[] = [];
  for (const d of (doRowsRaw ?? [])) {
    const st = (d.status ?? '').toUpperCase();
    if (st === 'DRAFT' || st === 'CANCELLED') continue;  // exclude uncommitted / voided
    const dn = d.so_doc_no ?? '';
    if (!dn) continue;
    const arr = doByDoc.get(dn) ?? [];
    arr.push({ id: d.id, doNumber: d.do_number ?? '—', status: st });
    doByDoc.set(dn, arr);
    doIds.push(d.id);
  }

  /* Crew snapshot per DO (Stage 3). Best-effort — read the assign-time snapshot
     so the board shows the driver/helper/lorry without joining the masters. */
  const crewByDo = new Map<string, { driver: string | null; helper: string | null; lorry: string | null }>();
  if (doIds.length > 0) {
    const { data: crewRows } = await paginateAll<{
      do_id: string; driver_1_name: string | null; driver_2_name: string | null;
      helper_1_name: string | null; helper_2_name: string | null; lorry_plate: string | null;
    }>((from, to) =>
      sb.from('delivery_order_crew')
        .select('do_id, driver_1_name, driver_2_name, helper_1_name, helper_2_name, lorry_plate')
        .in('do_id', doIds)
        .range(from, to),
    );
    for (const cr of (crewRows ?? [])) {
      crewByDo.set(cr.do_id, {
        driver: [cr.driver_1_name, cr.driver_2_name].filter(Boolean).join(' / ') || null,
        helper: [cr.helper_1_name, cr.helper_2_name].filter(Boolean).join(' / ') || null,
        lorry: cr.lorry_plate ?? null,
      });
    }
  }

  /* 6. Legs for these SOs — let one order surface in TWO region tabs/dates. */
  const legsByDoc = new Map<string, LegOut[]>();
  {
    const { data: legRows } = await paginateAll<{
      id: string; source_type: string; source_id: string; leg_no: number;
      warehouse_id: string | null; trip_id: string | null; leg_date: string | null;
      leg_kind: string; notes: string | null;
    }>((from, to) =>
      sb.from('delivery_legs')
        .select('id, source_type, source_id, leg_no, warehouse_id, trip_id, leg_date, leg_kind, notes')
        .eq('source_type', 'SO')
        .in('source_id', docNos)
        .order('leg_no', { ascending: true })
        .range(from, to),
    );
    for (const lg of (legRows ?? [])) {
      const dn = lg.source_id;
      const arr = legsByDoc.get(dn) ?? [];
      arr.push({
        id: lg.id,
        source_type: lg.source_type === 'DO' ? 'DO' : 'SO',
        source_id: lg.source_id,
        leg_no: Number(lg.leg_no ?? 1),
        warehouse_id: lg.warehouse_id,
        warehouse_code: lg.warehouse_id ? (whCode.get(lg.warehouse_id) ?? null) : null,
        region: regionForWarehouse(lg.warehouse_id),
        trip_id: lg.trip_id,
        leg_date: lg.leg_date,
        leg_kind: lg.leg_kind === 'transit' ? 'transit' : 'final',
        notes: lg.notes,
      });
    }
  }

  /* 7. Assemble one board row per SO with its derived state + regions. An SO's
        "home" region(s) = the distinct regions of its LINE warehouses; an SG SO
        (no MY warehouse) maps to SINGAPORE by customer_state. Legged orders ALSO
        carry each leg's region so the UI can place the same order under two
        tabs with two dates. */
  const orders = soRows.map((r) => {
    const docNo = String(r.doc_no ?? '');
    const readiness = summariseReadiness(linesByDoc.get(docNo) ?? []);
    const delivered = deliveredByDoc.get(docNo) ?? 0;
    const remaining = remainingByDoc.get(docNo) ?? 0;
    const status = String(r.status ?? '').toUpperCase();
    const customerDD = r.customer_delivery_date ?? null;
    const internalDD = r.internal_expected_dd ?? r.processing_date ?? null;

    /* delivery_state derivation (the core rule). A manual override stored on the
       SO header wins; else compute live. */
    const stored = r.delivery_state ?? null;
    let state: DeliveryState;
    if (stored && (DELIVERY_STATES as string[]).includes(stored)) {
      state = stored as DeliveryState;
    } else if (status === 'DELIVERED' || (delivered > 0 && remaining <= 0)) {
      state = 'DELIVERED';
    } else if (readiness.isMainReady) {
      state = 'PENDING_SCHEDULE';
    } else {
      // NOT ready. OVERDUE once we're within 3 days of (or past) the customer
      // delivery date and the goods still aren't ready.
      const daysLeft = daysBetween(today, customerDD);
      state = daysLeft != null && daysLeft <= 3 ? 'OVERDUE' : 'PENDING_DELIVERY';
    }

    /* Regions for this SO. Distinct line-warehouse regions; SG by state. */
    const regionSet = new Set<RegionKey>();
    for (const wid of (warehousesByDoc.get(docNo) ?? new Set<string>())) {
      const reg = regionForWarehouse(wid);
      if (reg) regionSet.add(reg);
    }
    if (isSingaporeState(r.customer_state) || isSingaporeState(r.customer_country)) {
      regionSet.add('SINGAPORE');
    }
    const legs = legsByDoc.get(docNo) ?? [];
    for (const lg of legs) if (lg.region) regionSet.add(lg.region);

    const dos = doByDoc.get(docNo) ?? [];
    const crew = dos.length > 0 ? (crewByDo.get(dos[dos.length - 1]!.id) ?? null) : null;
    const warehouseIds = [...(warehousesByDoc.get(docNo) ?? new Set<string>())];
    const primaryWh = warehouseIds[0] ?? null;

    return {
      so_doc_no: docNo,
      debtor_code: r.debtor_code ?? null,
      debtor_name: r.debtor_name ?? null,
      phone: r.phone ?? null,
      branding: r.branding ?? null,
      status,
      delivery_state: state,
      delivery_state_override: stored && (DELIVERY_STATES as string[]).includes(stored) ? stored : null,
      // money — balance / outstanding (centi). local_total_centi is the SO grand total.
      balance_centi: Number(r.balance_centi ?? 0),
      local_total_centi: Number(r.local_total_centi ?? 0),
      // dates
      customer_delivery_date: customerDD,
      internal_expected_dd: internalDD,
      days_left: daysBetween(today, customerDD),
      // stock
      stock_status: readiness.isFullyReady ? 'READY' : readiness.isMainReady ? 'READY (PARTIAL)' : 'PENDING',
      stock_remark: readiness.stockRemark,
      is_main_ready: readiness.isMainReady,
      // region(s) + warehouse label
      regions: [...regionSet],
      warehouse_id: primaryWh,
      warehouse_code: primaryWh ? (whCode.get(primaryWh) ?? null) : null,
      warehouse_name: primaryWh ? (whName.get(primaryWh) ?? null) : null,
      customer_state: r.customer_state ?? null,
      // delivery progress
      delivered_qty: delivered,
      remaining_qty: remaining,
      // crew (from the latest DO, Stage 3) + the DOs themselves
      crew,
      delivery_orders: dos.map((d) => ({ id: d.id, do_number: d.doNumber, status: d.status })),
      // legs — the dual-trip; each carries its own region + date
      legs,
    };
  });

  /* 8. Counts per state — computed over the REGION-filtered set so the 4 state
        tab badges reflect the active region. The state filter is applied AFTER
        counting (so switching state tabs doesn't change the badge numbers). */
  const regionFiltered = orders.filter((o) => matchesRegion(o, regionParam, whRegion));
  const counts = emptyCounts();
  for (const o of regionFiltered) counts[o.delivery_state] += 1;
  counts.ALL = regionFiltered.length;

  const stateFiltered = stateParam === 'ALL'
    ? regionFiltered
    : regionFiltered.filter((o) => o.delivery_state === stateParam);

  return c.json({ orders: stateFiltered, counts, regions: regionList() });
});

/* Region match: ALL → everything; SG → Singapore region; a RegionKey (PJKL /
   PENANG / SABAH / SARAWAK / SINGAPORE) → that region directly; else a
   warehouseId → resolve to its region key (any of the order's line / leg
   warehouses mapping to it). The frontend tabs send a RegionKey; a warehouseId
   is still accepted for callers that pass one. */
const REGION_KEYS = new Set<RegionKey>(['PJKL', 'PENANG', 'SABAH', 'SARAWAK', 'SINGAPORE']);
function matchesRegion(
  o: { regions: RegionKey[] },
  regionParam: string,
  whRegion: Map<string, RegionKey>,
): boolean {
  if (regionParam === 'ALL' || regionParam === '') return true;
  if (regionParam === 'SG' || regionParam.toUpperCase() === 'SINGAPORE') {
    return o.regions.includes('SINGAPORE');
  }
  if (REGION_KEYS.has(regionParam as RegionKey)) {
    return o.regions.includes(regionParam as RegionKey);
  }
  // regionParam is a warehouse id → resolve to its region key.
  const reg = whRegion.get(regionParam);
  if (!reg) return false;
  return o.regions.includes(reg);
}

function emptyCounts(): Record<'ALL' | DeliveryState, number> {
  return { ALL: 0, PENDING_DELIVERY: 0, PENDING_SCHEDULE: 0, OVERDUE: 0, DELIVERED: 0 };
}

/* Static region descriptor for the UI tab row. */
function regionList(): Array<{ key: RegionKey; label: string }> {
  return (Object.keys(REGION_LABEL) as RegionKey[]).map((k) => ({ key: k, label: REGION_LABEL[k] }));
}

/* ──────────────────────────────────────────────────────────────────────────
   LEGS CRUD — the dual-trip. A leg = (SO/DO) × region warehouse × date × kind.
   Adding a transit leg (KL, date A) + a final leg (Penang/SG, date B) makes one
   order appear under TWO region tabs with two dates.
   ─────────────────────────────────────────────────────────────────────────*/
const LEG_COLS =
  'id, source_type, source_id, leg_no, warehouse_id, trip_id, leg_date, leg_kind, notes, created_at, updated_at';

const legCreateSchema = z.object({
  sourceType: z.enum(['SO', 'DO']).default('SO'),
  sourceId: z.string().min(1),          // SO doc_no or DO id
  legNo: z.number().int().positive().optional(),
  warehouseId: z.string().uuid().nullable().optional(),
  tripId: z.string().uuid().nullable().optional(),
  legDate: z.string().nullable().optional(),    // YYYY-MM-DD
  legKind: z.enum(['transit', 'final']).default('final'),
  notes: z.string().nullable().optional(),
});

deliveryPlanning.post('/legs', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = legCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_body', reason: parsed.error.message }, 400);
  const p = parsed.data;
  const sb = c.get('supabase');
  const user = c.get('user');

  /* Next leg_no for this order if the caller didn't pin one (1 = first hop).
     The UNIQUE(source_type, source_id, leg_no) constraint keeps legs ordered. */
  let legNo = p.legNo ?? null;
  if (legNo == null) {
    const { data: existing } = await sb.from('delivery_legs')
      .select('leg_no').eq('source_type', p.sourceType).eq('source_id', p.sourceId);
    const max = ((existing ?? []) as Array<{ leg_no: number | null }>)
      .reduce((m, r) => Math.max(m, Number(r.leg_no ?? 0)), 0);
    legNo = max + 1;
  }

  const { data, error } = await sb.from('delivery_legs').insert({
    source_type: p.sourceType,
    source_id: p.sourceId,
    leg_no: legNo,
    warehouse_id: p.warehouseId ?? null,
    trip_id: p.tripId ?? null,
    leg_date: p.legDate ?? null,
    leg_kind: p.legKind,
    notes: p.notes ?? null,
    created_by: (user as { id?: string } | null)?.id ?? null,
  }).select(LEG_COLS).single();
  if (error) {
    if (error.code === '23505') return c.json({ error: 'duplicate_leg', reason: 'A leg with that number already exists for this order.' }, 409);
    if (error.code === '42501') return c.json({ error: 'forbidden', reason: error.message }, 403);
    return c.json({ error: 'insert_failed', reason: error.message }, 500);
  }
  return c.json({ leg: data }, 201);
});

const legPatchSchema = z.object({
  warehouseId: z.string().uuid().nullable().optional(),
  tripId: z.string().uuid().nullable().optional(),
  legDate: z.string().nullable().optional(),
  legKind: z.enum(['transit', 'final']).optional(),
  legNo: z.number().int().positive().optional(),
  notes: z.string().nullable().optional(),
});

deliveryPlanning.patch('/legs/:id', async (c) => {
  const id = c.req.param('id');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = legPatchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_body', reason: parsed.error.message }, 400);
  const p = parsed.data;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.warehouseId !== undefined) updates.warehouse_id = p.warehouseId;
  if (p.tripId !== undefined) updates.trip_id = p.tripId;
  if (p.legDate !== undefined) updates.leg_date = p.legDate;
  if (p.legKind !== undefined) updates.leg_kind = p.legKind;
  if (p.legNo !== undefined) updates.leg_no = p.legNo;
  if (p.notes !== undefined) updates.notes = p.notes;
  if (Object.keys(updates).length === 1) return c.json({ error: 'no_changes' }, 400);

  const sb = c.get('supabase');
  const { data, error } = await sb.from('delivery_legs').update(updates).eq('id', id).select(LEG_COLS).single();
  if (error) {
    if (error.code === '23505') return c.json({ error: 'duplicate_leg' }, 409);
    return c.json({ error: 'update_failed', reason: error.message }, 500);
  }
  return c.json({ leg: data });
});

deliveryPlanning.delete('/legs/:id', async (c) => {
  const id = c.req.param('id');
  const sb = c.get('supabase');
  const { error } = await sb.from('delivery_legs').delete().eq('id', id);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

/* ──────────────────────────────────────────────────────────────────────────
   PATCH /delivery-planning/:type/:id/schedule — set the concrete schedule date
   (+ optional manual delivery_state override) on an SO or DO. :type = so | do;
   :id = SO doc_no or DO id.
   ─────────────────────────────────────────────────────────────────────────*/
const scheduleSchema = z.object({
  // The firm trip date the coordinator commits to. Stored on the header's
  // customer_delivery_date so the existing date column stays the single source.
  scheduleDate: z.string().nullable().optional(),  // YYYY-MM-DD
  // Optional MANUAL override of the derived delivery_state (cache column).
  deliveryState: z.enum(['PENDING_DELIVERY', 'PENDING_SCHEDULE', 'OVERDUE', 'DELIVERED']).nullable().optional(),
});

deliveryPlanning.patch('/:type/:id/schedule', async (c) => {
  const type = c.req.param('type').toLowerCase();
  const id = c.req.param('id');
  if (type !== 'so' && type !== 'do') return c.json({ error: 'bad_type', reason: 'type must be so | do' }, 400);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_body', reason: parsed.error.message }, 400);
  const p = parsed.data;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.scheduleDate !== undefined) updates.customer_delivery_date = p.scheduleDate;
  if (p.deliveryState !== undefined) updates.delivery_state = p.deliveryState;
  if (Object.keys(updates).length === 1) return c.json({ error: 'no_changes' }, 400);

  const sb = c.get('supabase');
  const table = type === 'so' ? 'mfg_sales_orders' : 'delivery_orders';
  const keyCol = type === 'so' ? 'doc_no' : 'id';
  const selectCols = type === 'so'
    ? 'doc_no, customer_delivery_date, delivery_state, status'
    : 'id, do_number, customer_delivery_date, delivery_state, status';
  const { data, error } = await sb.from(table).update(updates).eq(keyCol, id).select(selectCols).single();
  if (error) {
    if (error.code === '42501') return c.json({ error: 'forbidden', reason: error.message }, 403);
    return c.json({ error: 'update_failed', reason: error.message }, 500);
  }
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, [type]: data });
});
