import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';

// Mock supabaseAuth so it becomes a passthrough — the outer middleware in
// buildApp sets `user` and `supabase` directly. Without this mock, supabaseAuth
// would try to fetch GoTrue which doesn't exist in tests.
// Note: loadStaffRole and COORDINATOR_ROLES are NOT exported from auth.ts —
// they live locally in purchase-orders.ts. Auth role checks are satisfied by
// making the mock Supabase `staff` table return the desired role.
vi.mock('../middleware/auth', () => ({
  supabaseAuth: async (_c: any, next: any) => { await next(); },
}));

// Import AFTER vi.mock so the hoisted mock is in place
import { purchaseOrders } from './purchase-orders';

const baseEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  ALLOWED_ORIGINS: '*',
  R2_BUCKET_NAME: 'test',
  R2_ENDPOINT: 'https://test.r2.example.com',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  SLIPS: { put: vi.fn(), head: vi.fn(), delete: vi.fn() },
} as unknown as Env;

const STAFF_ID = 'staff-001';

// ---------------------------------------------------------------------------
// Mock Supabase builder
// Each handler receives the accumulated operation descriptor so it can branch
// on kind ('select' | 'insert' | 'update' | 'delete') and table name.
// ---------------------------------------------------------------------------
function createMockSupabase(handlers: Record<string, (op: any) => any>) {
  return {
    from(table: string) {
      const builder: any = {
        _table: table,
        // _baseKind tracks the primary operation; 'select' is the fallback.
        // When .select() is chained after .insert()/.update()/.delete() it
        // should NOT change the base kind — it only adds column hints.
        _op: { kind: 'select', table },
        select(cols: string) {
          // Preserve the existing kind (insert/update/delete stay as-is).
          this._op = { ...this._op, cols };
          return this;
        },
        insert(row: any) { this._op = { ...this._op, kind: 'insert', row }; return this; },
        update(row: any) { this._op = { ...this._op, kind: 'update', row }; return this; },
        delete() { this._op = { ...this._op, kind: 'delete' }; return this; },
        eq(col: string, val: any) { this._op = { ...this._op, eq: { col, val } }; return this; },
        in(col: string, vals: any[]) { this._op = { ...this._op, in: { col, vals } }; return this; },
        maybeSingle() {
          return Promise.resolve(handlers[table]?.(this._op) ?? { data: null, error: null });
        },
        // Thenable so awaiting the builder directly works (used by insert+select chains
        // and by the flag-update `.in()` chain)
        then(resolve: any, reject: any) {
          return Promise.resolve(
            handlers[table]?.(this._op) ?? { data: [], error: null }
          ).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

// ---------------------------------------------------------------------------
// Test app factory
// Sets user + supabase in context before purchaseOrders routes execute.
// ---------------------------------------------------------------------------
function buildApp(supabase: any, env: Env = baseEnv) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: STAFF_ID } as any);
    c.set('supabase', supabase);
    await next();
  });
  app.route('/purchase-orders', purchaseOrders);
  return app;
}

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------
const supplierRow = {
  id: 'sup-slp',
  code: 'SLP',
  name: 'Sleepworks Sdn Bhd',
  whatsapp_number: null,
  email: null,
};

// Staff row for a coordinator (used by loadStaffRole inside the route)
const coordinatorStaffRow = { role: 'coordinator', active: true };
// Staff row for a non-coordinator (sales rep)
const salesStaffRow = { role: 'sales', active: true };

// ---------------------------------------------------------------------------

describe('POST /purchase-orders', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects without coordinator role → 403', async () => {
    const supabase = createMockSupabase({
      // loadStaffRole reads staff table — return a non-coordinator role
      staff: () => ({ data: salesStaffRow, error: null }),
    });
    const app = buildApp(supabase);
    const res = await app.request('/purchase-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ supplier_id: 'sup-slp', line_items: [] }),
    }, baseEnv);
    expect(res.status).toBe(403);
    const json = await res.json() as any;
    expect(json.error).toBe('not_authorized_role');
  });

  it('rejects empty line_items → 400 empty_line_items', async () => {
    const supabase = createMockSupabase({
      staff: () => ({ data: coordinatorStaffRow, error: null }),
    });
    const app = buildApp(supabase);
    const res = await app.request('/purchase-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ supplier_id: 'sup-slp', line_items: [] }),
    }, baseEnv);
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toBe('empty_line_items');
  });

  it('rejects qty <= 0 → 400 invalid_qty', async () => {
    const supabase = createMockSupabase({
      staff: () => ({ data: coordinatorStaffRow, error: null }),
    });
    const app = buildApp(supabase);
    const res = await app.request('/purchase-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplier_id: 'sup-slp',
        line_items: [{ order_id: 'o1', sku: 'X', name: 'X', size: null, colour: null, qty: 0 }],
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toBe('invalid_qty');
  });

  it('rejects when supplier not found → 400 supplier_not_found', async () => {
    const supabase = createMockSupabase({
      staff: () => ({ data: coordinatorStaffRow, error: null }),
      suppliers: () => ({ data: null, error: null }),
    });
    const app = buildApp(supabase);
    const res = await app.request('/purchase-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplier_id: 'sup-x',
        line_items: [{ order_id: 'o1', sku: 'X', name: 'X', size: null, colour: null, qty: 1 }],
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toBe('supplier_not_found');
  });

  it('rejects when order is not in logistics lane → 400 order_not_in_logistics', async () => {
    const supabase = createMockSupabase({
      staff: () => ({ data: coordinatorStaffRow, error: null }),
      suppliers: () => ({ data: supplierRow, error: null }),
      orders: (op: any) => {
        if (op.kind === 'select') {
          return { data: [{ id: 'o1', lane: 'received', po_issued: false }], error: null };
        }
        return { data: null, error: null };
      },
    });
    const app = buildApp(supabase);
    const res = await app.request('/purchase-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplier_id: 'sup-slp',
        line_items: [{ order_id: 'o1', sku: 'X', name: 'X', size: null, colour: null, qty: 1 }],
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toBe('order_not_in_logistics');
    expect(json.detail).toEqual(['o1']);
  });

  it('rejects when order is already PO-issued → 409 already_issued', async () => {
    const supabase = createMockSupabase({
      staff: () => ({ data: coordinatorStaffRow, error: null }),
      suppliers: () => ({ data: supplierRow, error: null }),
      orders: (op: any) => {
        if (op.kind === 'select') {
          return { data: [{ id: 'o1', lane: 'logistics', po_issued: true }], error: null };
        }
        return { data: null, error: null };
      },
    });
    const app = buildApp(supabase);
    const res = await app.request('/purchase-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplier_id: 'sup-slp',
        line_items: [{ order_id: 'o1', sku: 'X', name: 'X', size: null, colour: null, qty: 1 }],
      }),
    }, baseEnv);
    expect(res.status).toBe(409);
    const json = await res.json() as any;
    expect(json.error).toBe('already_issued');
    expect(json.detail).toEqual(['o1']);
  });

  it('happy path: creates PO + lines + flips po_issued → 201', async () => {
    const captured: { poInsert?: any; linesInsert?: any; flagUpdate?: any } = {};

    const supabase = createMockSupabase({
      // loadStaffRole (first staff call) + coordinator name fetch (last staff call)
      staff: () => ({ data: { id: STAFF_ID, name: 'Test Coordinator', role: 'coordinator', active: true }, error: null }),
      suppliers: () => ({ data: supplierRow, error: null }),
      orders: (op: any) => {
        if (op.kind === 'select') {
          return { data: [{ id: 'o1', lane: 'logistics', po_issued: false }], error: null };
        }
        if (op.kind === 'update') {
          captured.flagUpdate = op.row;
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
      purchase_orders: (op: any) => {
        if (op.kind === 'insert') {
          captured.poInsert = op.row;
          return {
            data: {
              id: 'po-1',
              po_number: 'PO-2026-0001',
              supplier_id: 'sup-slp',
              created_at: '2026-05-09T08:30:00Z',
              created_by: STAFF_ID,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      purchase_order_lines: (op: any) => {
        if (op.kind === 'insert') {
          captured.linesInsert = op.row;
          return {
            data: [{
              id: 'line-1',
              purchase_order_id: 'po-1',
              order_id: 'o1',
              sku: 'X',
              name: 'X',
              size: null,
              colour: null,
              qty: 1,
            }],
            error: null,
          };
        }
        return { data: [], error: null };
      },
    });

    const app = buildApp(supabase);
    const res = await app.request('/purchase-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplier_id: 'sup-slp',
        line_items: [{ order_id: 'o1', sku: 'X', name: 'X', size: null, colour: null, qty: 1 }],
      }),
    }, baseEnv);

    expect(res.status).toBe(201);
    const json = await res.json() as any;
    expect(json.po_number).toBe('PO-2026-0001');
    expect(json.supplier.code).toBe('SLP');
    expect(json.referenced_order_ids).toEqual(['o1']);
    expect(json.lines).toHaveLength(1);
    // po_issued flag was flipped on the order
    expect(captured.flagUpdate?.po_issued).toBe(true);
    // PO header was inserted with correct supplier
    expect(captured.poInsert?.supplier_id).toBe('sup-slp');
  });
});

// ---------------------------------------------------------------------------

describe('GET /purchase-orders/:id', () => {
  it('returns 404 when PO not found', async () => {
    const supabase = createMockSupabase({
      staff: () => ({ data: coordinatorStaffRow, error: null }),
      purchase_orders: () => ({ data: null, error: null }),
    });
    const app = buildApp(supabase);
    const res = await app.request('/purchase-orders/po-x', {}, baseEnv);
    expect(res.status).toBe(404);
    const json = await res.json() as any;
    expect(json.error).toBe('not_found');
  });

  it('returns full PO + supplier + lines → 200', async () => {
    const supabase = createMockSupabase({
      // loadStaffRole checks role + active; name fetch also uses this handler
      staff: () => ({ data: { id: STAFF_ID, name: 'Test Coordinator', role: 'coordinator', active: true }, error: null }),
      purchase_orders: () => ({
        data: {
          id: 'po-1',
          po_number: 'PO-2026-0001',
          supplier_id: 'sup-slp',
          created_at: '2026-05-09T08:30:00Z',
          created_by: STAFF_ID,
        },
        error: null,
      }),
      suppliers: () => ({ data: supplierRow, error: null }),
      purchase_order_lines: () => ({
        data: [{
          id: 'line-1',
          purchase_order_id: 'po-1',
          order_id: 'o1',
          sku: 'MAT-001',
          name: 'Cloud mattress',
          size: 'queen',
          colour: null,
          qty: 2,
        }],
        error: null,
      }),
    });
    const app = buildApp(supabase);
    const res = await app.request('/purchase-orders/po-1', {}, baseEnv);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.po_number).toBe('PO-2026-0001');
    expect(json.supplier.code).toBe('SLP');
    expect(json.lines).toHaveLength(1);
    expect(json.referenced_order_ids).toEqual(['o1']);
    expect(json.created_by.name).toBe('Test Coordinator');
  });
});

// ---------------------------------------------------------------------------

describe('GET /purchase-orders/:id/print', () => {
  it('returns text/html with PO number and supplier name visible', async () => {
    const supabase = createMockSupabase({
      staff: () => ({ data: { name: 'Test Coordinator', role: 'coordinator', active: true }, error: null }),
      purchase_orders: () => ({
        data: {
          id: 'po-1',
          po_number: 'PO-2026-0001',
          supplier_id: 'sup-slp',
          created_at: '2026-05-09T08:30:00Z',
          created_by: STAFF_ID,
        },
        error: null,
      }),
      suppliers: () => ({ data: supplierRow, error: null }),
      purchase_order_lines: () => ({
        data: [{
          order_id: 'o1',
          sku: 'MAT-001',
          name: 'Cloud mattress',
          size: 'queen',
          colour: null,
          qty: 2,
        }],
        error: null,
      }),
    });
    const app = buildApp(supabase);
    const res = await app.request('/purchase-orders/po-1/print', {}, baseEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('PO-2026-0001');
    expect(html).toContain('Sleepworks Sdn Bhd');
    expect(html).toContain('MAT-001');
  });
});
