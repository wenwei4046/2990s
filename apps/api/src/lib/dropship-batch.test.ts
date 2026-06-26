import { describe, it, expect } from 'vitest';
import { resolveExpectedBatchBySoItem, buildDropshipOffenders } from './dropship-batch';

// ── Minimal chainable Supabase mock ─────────────────────────────────────────
// Supports the exact chains resolveExpectedBatchBySoItem uses:
//   from('purchase_order_items').select(...).in(...).not(...)        → { data }
//   from('purchase_orders').select(...).in(...)                      → { data }
// The terminal call (.not for poi, .in for po) is awaited, so we make every
// chain link thenable and resolve to the table's canned rows.
type Rows = Record<string, unknown[]>;
function mockSb(rows: Rows) {
  const make = (table: string) => {
    const result = { data: rows[table] ?? [], error: null };
    const chain: any = {
      select: () => chain,
      in: () => chain,
      not: () => chain,
      // thenable so `await chain` resolves to the canned result at any depth.
      then: (resolve: (v: unknown) => void) => resolve(result),
    };
    return chain;
  };
  return { from: (table: string) => make(table) };
}

describe('resolveExpectedBatchBySoItem', () => {
  it('maps an SO line to its bound PO number + effective ETA', async () => {
    const sb = mockSb({
      purchase_order_items: [
        { so_item_id: 'so-1', purchase_order_id: 'po-1', created_at: '2026-06-01T00:00:00Z' },
      ],
      purchase_orders: [
        { id: 'po-1', po_number: 'PO-2606-001', expected_at: '2026-07-01', supplier_delivery_date_2: null, supplier_delivery_date_3: null, supplier_delivery_date_4: null },
      ],
    });
    const out = await resolveExpectedBatchBySoItem(sb, ['so-1']);
    expect(out.get('so-1')).toEqual({ poNumber: 'PO-2606-001', eta: '2026-07-01' });
  });

  it('effective ETA = the LATEST of expected_at + supplier-revised dates', async () => {
    const sb = mockSb({
      purchase_order_items: [
        { so_item_id: 'so-1', purchase_order_id: 'po-1', created_at: '2026-06-01T00:00:00Z' },
      ],
      purchase_orders: [
        { id: 'po-1', po_number: 'PO-1', expected_at: '2026-07-01', supplier_delivery_date_2: '2026-08-15', supplier_delivery_date_3: '2026-07-20', supplier_delivery_date_4: null },
      ],
    });
    const out = await resolveExpectedBatchBySoItem(sb, ['so-1']);
    expect(out.get('so-1')?.eta).toBe('2026-08-15'); // the latest revised date wins
  });

  it('null ETA when no dates are set on the PO', async () => {
    const sb = mockSb({
      purchase_order_items: [
        { so_item_id: 'so-1', purchase_order_id: 'po-1', created_at: '2026-06-01T00:00:00Z' },
      ],
      purchase_orders: [
        { id: 'po-1', po_number: 'PO-1', expected_at: null, supplier_delivery_date_2: null, supplier_delivery_date_3: null, supplier_delivery_date_4: null },
      ],
    });
    const out = await resolveExpectedBatchBySoItem(sb, ['so-1']);
    expect(out.get('so-1')).toEqual({ poNumber: 'PO-1', eta: null });
  });

  it('an SO line with NO bound PO is absent from the map (cannot drop-ship)', async () => {
    const sb = mockSb({ purchase_order_items: [], purchase_orders: [] });
    const out = await resolveExpectedBatchBySoItem(sb, ['so-1']);
    expect(out.has('so-1')).toBe(false);
  });

  it('picks the MOST-RECENT PO when a line is linked to several (deterministic batch)', async () => {
    const sb = mockSb({
      purchase_order_items: [
        { so_item_id: 'so-1', purchase_order_id: 'po-old', created_at: '2026-06-01T00:00:00Z' },
        { so_item_id: 'so-1', purchase_order_id: 'po-new', created_at: '2026-06-10T00:00:00Z' },
      ],
      purchase_orders: [
        { id: 'po-old', po_number: 'PO-OLD', expected_at: '2026-07-01', supplier_delivery_date_2: null, supplier_delivery_date_3: null, supplier_delivery_date_4: null },
        { id: 'po-new', po_number: 'PO-NEW', expected_at: '2026-07-09', supplier_delivery_date_2: null, supplier_delivery_date_3: null, supplier_delivery_date_4: null },
      ],
    });
    const out = await resolveExpectedBatchBySoItem(sb, ['so-1']);
    expect(out.get('so-1')?.poNumber).toBe('PO-NEW');
  });

  it('empty input → empty map (no query)', async () => {
    const sb = mockSb({});
    const out = await resolveExpectedBatchBySoItem(sb, []);
    expect(out.size).toBe(0);
  });
});

describe('buildDropshipOffenders', () => {
  it('enriches offenders with poNumber + eta; no-PO line gets null poNumber', async () => {
    const sb = mockSb({
      purchase_order_items: [
        { so_item_id: 'so-1', purchase_order_id: 'po-1', created_at: '2026-06-01T00:00:00Z' },
      ],
      purchase_orders: [
        { id: 'po-1', po_number: 'PO-1', expected_at: '2026-07-01', supplier_delivery_date_2: null, supplier_delivery_date_3: null, supplier_delivery_date_4: null },
      ],
    });
    const out = await buildDropshipOffenders(sb, [
      { itemCode: 'BOOQIT-1A(LHF)', soItemId: 'so-1' },
      { itemCode: 'BOOQIT-1A(RHF)', soItemId: 'so-2' }, // no PO bound
    ]);
    expect(out).toEqual([
      { itemCode: 'BOOQIT-1A(LHF)', soItemId: 'so-1', poNumber: 'PO-1', eta: '2026-07-01' },
      { itemCode: 'BOOQIT-1A(RHF)', soItemId: 'so-2', poNumber: null, eta: null },
    ]);
  });
});
