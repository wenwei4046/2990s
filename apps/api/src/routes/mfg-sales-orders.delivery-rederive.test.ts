// ----------------------------------------------------------------------------
// Tests for the delivery-fee recompute split (fix/delivery-recompute-v2).
//
// The bug: editing an already-placed SO's items did NOT re-derive the delivery
// fee — recomputeTotals only re-summed the existing SVC-DELIVERY* lines, while
// the authoritative computeSoDeliveryFee ran only at create / customer-change.
//
// The fix splits redetectCrossCategoryDelivery into:
//   • recomputeDeliveryFeeCore(sb, docNo, sourceDocNo) — derives the FEE from the
//     CURRENT items for a CALLER-SUPPLIED source (no auto-match), and
//   • rederiveDeliveryFee(sb, docNo) — the ITEM-EDIT path: reads the SO's STORED
//     cross_category_source_doc_no and passes it THROUGH unchanged. It must NEVER
//     re-run the customer auto-match (pickCrossCategoryMatch), so a benign item
//     edit can never drop or flip an operator-pinned cross-category source link.
//
// These focus on the load-bearing guarantees that don't need the full
// recomputeTotals machinery stubbed:
//   1. item-edit passes the STORED source through to the header unchanged, and
//      never issues the auto-match candidate query (a .eq('phone', …) filter);
//   2. a SO with no delivery-fee lines early-bails (null) and still gets a
//      recomputeTotals so the header totals refresh after the edit;
//   3. the SVC-DELIVERY* rebuild goes through ONE atomic RPC (migration 0211,
//      rebuild_mfg_so_delivery_lines) — never a separate delete+insert, whose
//      interleaving under the Backend save's parallel line PATCHes doubled the
//      delivery fee (SO-2606-043 2026-06-28, SO-2607-010 2026-07-12).
//
// The stub dispatches canned rows by TABLE NAME (not call order), so it is
// resilient to internal query reordering. It records every header UPDATE payload
// and whether any query ever filtered on `phone` (the auto-match signature).
// ----------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';

vi.mock('../middleware/auth', () => ({
  supabaseAuth: async (_c: any, next: any) => { await next(); },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: vi.fn() }),
}));

import { recomputeDeliveryFeeCore, rederiveDeliveryFee } from './mfg-sales-orders';

const DOC = 'SO-7000-001';

type Row = Record<string, unknown>;

interface StubState {
  /** Canned rows returned by SELECT, keyed by table name. */
  tables: Record<string, Row[]>;
  /** header UPDATE payloads, in order. */
  headerUpdates: Row[];
  /** rows passed to INSERT into mfg_sales_order_items. */
  inserted: Row[];
  /** RPC calls (migration 0211 — the atomic delivery-line rebuild). */
  rpcCalls: Array<{ fn: string; args: Row }>;
  /** true if ANY query ever filtered on `phone` (the auto-match candidate load). */
  phoneFiltered: boolean;
}

/**
 * Minimal table-aware Supabase stub. Each `.from(table)` opens a fresh chainable
 * builder whose terminal await resolves to that table's canned rows. SELECTs that
 * end in `.single()/.maybeSingle()` get the first row; the bare-await terminal
 * (`.eq(...).eq(...)`) gets the array. UPDATE/DELETE/INSERT are recorded.
 */
function makeStub(state: StubState) {
  const rowsFor = (table: string): Row[] => state.tables[table] ?? [];

  const from = (table: string) => {
    let mode: 'select' | 'update' | 'delete' | 'insert' = 'select';
    let updatePayload: Row | null = null;

    const builder: any = {
      // terminal-ish row resolvers
      select() { return builder; },
      eq(col: string) { if (col === 'phone') state.phoneFiltered = true; return builder; },
      neq() { return builder; },
      in() { return builder; },
      order() { return builder; },
      limit() { return Promise.resolve({ data: rowsFor(table), error: null }); },
      single() { return Promise.resolve({ data: rowsFor(table)[0] ?? null, error: null }); },
      maybeSingle() { return Promise.resolve({ data: rowsFor(table)[0] ?? null, error: null }); },
      update(payload: Row) {
        mode = 'update'; updatePayload = payload;
        if (table === 'mfg_sales_orders') state.headerUpdates.push(payload);
        return builder;
      },
      delete() { mode = 'delete'; return builder; },
      insert(rows: Row | Row[]) {
        mode = 'insert';
        if (table === 'mfg_sales_order_items') {
          for (const r of Array.isArray(rows) ? rows : [rows]) state.inserted.push(r);
        }
        return builder;
      },
      // make the builder awaitable for the bare-terminal SELECT / UPDATE / DELETE
      then(resolve: (v: { data: Row[] | null; error: null }) => void) {
        if (mode === 'select') return resolve({ data: rowsFor(table), error: null });
        void updatePayload;
        return resolve({ data: [], error: null });
      },
    };
    return builder;
  };

  const rpc = (fn: string, args: Row) => {
    state.rpcCalls.push({ fn, args });
    return Promise.resolve({ data: null, error: null });
  };

  return { from, rpc } as any;
}

const baseState = (over: Partial<StubState> = {}): StubState => ({
  tables: {},
  headerUpdates: [],
  inserted: [],
  rpcCalls: [],
  phoneFiltered: false,
  ...over,
});

describe('recomputeDeliveryFeeCore — caller-supplied source, no auto-match', () => {
  it('returns null and writes nothing when the SO has no delivery-fee lines', async () => {
    const state = baseState({
      tables: {
        // only a goods line, no SVC-DELIVERY* line → early bail
        mfg_sales_order_items: [
          { item_code: 'MAT-AKKA-Q', item_group: 'mattress', total_centi: 100000, line_no: 0, variants: null },
        ],
      },
    });
    const res = await recomputeDeliveryFeeCore(makeStub(state), DOC, 'SO-9000');
    expect(res).toBeNull();
    // bailed BEFORE any header write, rebuild RPC or auto-match
    expect(state.headerUpdates).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.phoneFiltered).toBe(false);
  });

  it('passes the supplied source THROUGH to the header (no auto-match query)', async () => {
    const state = baseState({
      tables: {
        mfg_sales_order_items: [
          // a goods line so the recomputed fee is non-zero (followup → cross rate)
          { item_code: 'MAT-AKKA-Q', item_group: 'mattress', total_centi: 100000, line_no: 0, variants: null },
          // a delivery-fee line exists → core proceeds past the early bail
          { item_code: 'SVC-DELIVERY', item_group: 'service', total_centi: 15000, line_no: 1, variants: null },
        ],
        delivery_fee_config: [{ base_fee: 150, cross_category_fee: 250 }],
        // header context read for the rebuilt service rows
        mfg_sales_orders: [{ debtor_name: 'Ali', venue: null, customer_delivery_date: null }],
      },
    });
    const res = await recomputeDeliveryFeeCore(makeStub(state), DOC, 'SO-9000');
    expect(res).not.toBeNull();
    expect(res!.sourceDocNo).toBe('SO-9000');
    expect(res!.isFollowup).toBe(true);
    // the rebuild went through ONE atomic RPC (migration 0211) carrying the
    // SUPPLIED source — passthrough, not re-matched — and the recomputed rows.
    // NO separate delete+insert (the delete/delete/insert/insert interleave
    // that doubled the delivery fee on SO-2606-043 / SO-2607-010).
    expect(state.inserted).toHaveLength(0);
    const rebuilds = state.rpcCalls.filter((r) => r.fn === 'rebuild_mfg_so_delivery_lines');
    expect(rebuilds).toHaveLength(1);
    expect(rebuilds[0]!.args['p_doc_no']).toBe(DOC);
    expect(rebuilds[0]!.args['p_source_doc_no']).toBe('SO-9000');
    const rows = rebuilds[0]!.args['p_rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => String(r['item_code']).startsWith('SVC-DELIVERY'))).toBe(true);
    // the auto-match candidate query (filter on phone) was NEVER issued
    expect(state.phoneFiltered).toBe(false);
  });

  it('a null source yields a non-followup fee (no auto-match)', async () => {
    const state = baseState({
      tables: {
        mfg_sales_order_items: [
          { item_code: 'SVC-DELIVERY', item_group: 'service', total_centi: 15000, line_no: 1, variants: null },
        ],
        delivery_fee_config: [{ base_fee: 150, cross_category_fee: 250 }],
        mfg_sales_orders: [{ debtor_name: 'Ali', venue: null, customer_delivery_date: null }],
      },
    });
    const res = await recomputeDeliveryFeeCore(makeStub(state), DOC, null);
    expect(res!.isFollowup).toBe(false);
    expect(res!.sourceDocNo).toBeNull();
    const rebuild = state.rpcCalls.find((r) => r.fn === 'rebuild_mfg_so_delivery_lines');
    expect(rebuild).toBeTruthy();
    expect(rebuild!.args['p_source_doc_no']).toBeNull();
    expect(state.phoneFiltered).toBe(false);
  });
});

describe('rederiveDeliveryFee — item-edit path keeps the stored source', () => {
  it('reads the stored cross_category_source_doc_no and passes it through, never auto-matching', async () => {
    const state = baseState({
      tables: {
        // header carries an operator-pinned source AND the columns recomputeTotals reads
        mfg_sales_orders: [{
          cross_category_source_doc_no: 'SO-PINNED-123',
          debtor_name: 'Ali', venue: null, customer_delivery_date: null,
          delivery_fee_centi: 15000,
        }],
        mfg_sales_order_items: [
          { item_code: 'SVC-DELIVERY', item_group: 'service', total_centi: 15000, line_no: 1, variants: null },
        ],
        delivery_fee_config: [{ base_fee: 150, cross_category_fee: 250 }],
      },
    });
    await rederiveDeliveryFee(makeStub(state), DOC);
    // the pinned source was written straight back — never re-matched
    const rebuild = state.rpcCalls.find((r) => r.fn === 'rebuild_mfg_so_delivery_lines');
    expect(rebuild).toBeTruthy();
    expect(rebuild!.args['p_source_doc_no']).toBe('SO-PINNED-123');
    expect(state.phoneFiltered).toBe(false);
  });

  it('a SO with no delivery-fee lines still gets a recomputeTotals (header refresh)', async () => {
    // No SVC-DELIVERY* line → core early-bails (null), so rederive must call
    // recomputeTotals itself. recomputeTotals writes a header totals UPDATE.
    const state = baseState({
      tables: {
        mfg_sales_orders: [{
          cross_category_source_doc_no: null,
          delivery_fee_centi: 0,
        }],
        mfg_sales_order_items: [
          { id: 'i1', item_code: 'MAT-AKKA-Q', item_group: 'mattress', variants: null, qty: 1, total_centi: 100000, line_cost_centi: 0 },
        ],
      },
    });
    await rederiveDeliveryFee(makeStub(state), DOC);
    // recomputeTotals ran → its totals UPDATE landed on the header. local_total_centi
    // is written ONLY by recomputeTotals (never by the cross-category source write).
    const totalsWrite = state.headerUpdates.find((u) => 'local_total_centi' in u);
    expect(totalsWrite).toBeTruthy();
    // never auto-matched on the item-edit path
    expect(state.phoneFiltered).toBe(false);
  });
});
