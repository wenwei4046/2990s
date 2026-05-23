import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';

// Mock supabaseAuth → passthrough. The outer middleware in buildApp() sets
// `user` and `supabase` directly, so the route's auth check is satisfied by
// whatever the mock `staff` row returns.
vi.mock('../middleware/auth', () => ({
  supabaseAuth: async (_c: any, next: any) => { await next(); },
}));

// Import AFTER vi.mock so the hoisted mock is in place
import { orders } from './orders';

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

const STAFF_ID = '11111111-1111-1111-1111-111111111111';

// A real UUID for the product id so Zod's .uuid() validator passes.
const PRODUCT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// ---------------------------------------------------------------------------
// Mock Supabase builder
// Each handler receives the accumulated operation descriptor so it can branch
// on kind ('select' | 'insert' | 'update' | 'delete') and table name.
// Subset of purchase-orders.test.ts pattern, extended with rpc(...) capture.
// ---------------------------------------------------------------------------
function createMockSupabase(
  handlers: Record<string, (op: any) => any>,
  rpcCapture?: { last?: { name: string; args: any } },
  rpcReturn?: { data: any; error: any },
) {
  return {
    from(table: string) {
      const builder: any = {
        _table: table,
        _op: { kind: 'select', table },
        select(cols: string) {
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
        // .single() mirrors maybeSingle() for the test mock — real supabase
        // distinguishes 0-row errors but our handlers always return a row when
        // configured. Added for the delivery_fee_config singleton fetch
        // (orders.ts line 132–136, migration 0029).
        single() {
          return Promise.resolve(handlers[table]?.(this._op) ?? { data: null, error: null });
        },
        then(resolve: any, reject: any) {
          return Promise.resolve(
            handlers[table]?.(this._op) ?? { data: [], error: null },
          ).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc(name: string, args: any) {
      if (rpcCapture) rpcCapture.last = { name, args };
      return Promise.resolve(rpcReturn ?? { data: 'SO-2050', error: null });
    },
  };
}

// Default delivery_fee_config row — matches migration 0029 seed values so
// every existing single-category test picks up +250 reliably. Multi-category
// tests would add +175 on top.
const defaultDeliveryFeeCfg = () => ({
  data: { base_fee: 250, cross_category_fee: 175 },
  error: null,
});

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------
function buildApp(supabase: any, env: Env = baseEnv) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: STAFF_ID } as any);
    c.set('supabase', supabase);
    await next();
  });
  app.route('/', orders);
  return app;
}

// ---------------------------------------------------------------------------
// Shared product / addon fixtures
// ---------------------------------------------------------------------------
const productFlatRow = {
  id: PRODUCT_ID,
  // category_id drives the delivery fee cross-category surcharge (migration
  // 0029). A single-category cart picks up just the base fee.
  category_id: 'sofa',
  pricing_kind: 'flat',
  flat_price: 2990,
  recliner_upgrade_price: null,
};

// Second product in a different category — used by the multi-category
// delivery-fee snapshot test below.
const SECOND_PRODUCT_ID = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
const productMattressRow = {
  id: SECOND_PRODUCT_ID,
  category_id: 'mattress',
  pricing_kind: 'flat',
  flat_price: 1500,
  recliner_upgrade_price: null,
};

// Sales-role staff row so POS_ORDER_ROLES gate passes.
const salesStaffRow = { role: 'sales', active: true };

// Build a minimal POST body that the schema accepts.
function buildBody(
  overrides: Partial<{
    addons: any[];
    clientTotal: number;
    customerType: string;
    buildingType: string;
    salespersonId: string;
    specialInstructions: string;
    billingSame: boolean;
    addressLater: boolean;
  }> = {},
) {
  return {
    customer: {
      name: 'Test Customer',
      phone: '0123456789',
      address: '123 Test Lane',
    },
    paymentMethod: 'merchant' as const,
    merchantProvider: 'GHL' as const,
    approvalCode: 'TEST123',
    lines: [
      {
        qty: 1,
        config: { kind: 'flat' as const, productId: PRODUCT_ID },
      },
    ],
    clientTotal: overrides.clientTotal ?? 2990,
    ...(overrides.customerType        ? { customerType: overrides.customerType } : {}),
    ...(overrides.buildingType        ? { buildingType: overrides.buildingType } : {}),
    ...(overrides.salespersonId       ? { salespersonId: overrides.salespersonId } : {}),
    ...(overrides.specialInstructions ? { specialInstructions: overrides.specialInstructions } : {}),
    ...(overrides.billingSame  !== undefined ? { billingSame:  overrides.billingSame  } : {}),
    ...(overrides.addressLater !== undefined ? { addressLater: overrides.addressLater } : {}),
    ...(overrides.addons       ? { addons: overrides.addons } : {}),
  };
}

// ---------------------------------------------------------------------------

describe('POST /orders — handover redesign fields', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('stores customer_type and building_type on the order row', async () => {
    const rpcCapture: { last?: { name: string; args: any } } = {};
    const supabase = createMockSupabase(
      {
        staff: () => ({ data: salesStaffRow, error: null }),
        products: () => ({ data: [productFlatRow], error: null }),
        product_compartments: () => ({ data: [], error: null }),
        product_bundles: () => ({ data: [], error: null }),
        product_size_variants: () => ({ data: [], error: null }),
        addons: () => ({ data: [], error: null }),
        delivery_fee_config: defaultDeliveryFeeCfg,
      },
      rpcCapture,
      { data: 'SO-2051', error: null },
    );

    // 2990 product + 250 delivery base = 3240 (single-category cart).
    const app = buildApp(supabase);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify(buildBody({
        clientTotal: 3240,
        customerType: 'new',
        buildingType: 'condo',
      })),
    }, baseEnv);

    expect(res.status).toBe(201);
    expect(rpcCapture.last?.name).toBe('create_order_with_items');
    const payload = rpcCapture.last?.args?.p;
    expect(payload.customerType).toBe('new');
    expect(payload.buildingType).toBe('condo');
    // Delivery fee folded onto the RPC payload (snapshot columns from
    // migration 0029 → orders.delivery_fee_base / cross_category / additional).
    expect(payload.deliveryFeeBase).toBe(250);
    expect(payload.deliveryFeeCrossCategory).toBe(0);
    expect(payload.deliveryFeeAdditional).toBe(0);
    expect(payload.total).toBe(3240);
  });

  it('persists addon line items via the SQL function', async () => {
    const rpcCapture: { last?: { name: string; args: any } } = {};
    const supabase = createMockSupabase(
      {
        staff: () => ({ data: salesStaffRow, error: null }),
        products: () => ({ data: [productFlatRow], error: null }),
        product_compartments: () => ({ data: [], error: null }),
        product_bundles: () => ({ data: [], error: null }),
        product_size_variants: () => ({ data: [], error: null }),
        // 2 enabled addons — server reload returns the kind + price + per_floor_item.
        addons: () => ({
          data: [
            {
              id: 'dispose-mattress',
              kind: 'qty',
              price: 120,
              per_floor_item: null,
              enabled: true,
            },
            {
              id: 'lift',
              kind: 'floors_items',
              price: 0,
              per_floor_item: 50,
              enabled: true,
            },
          ],
          error: null,
        }),
        delivery_fee_config: defaultDeliveryFeeCfg,
      },
      rpcCapture,
      { data: 'SO-2052', error: null },
    );

    // Canonical lift formula: max(0, 5-2) * 2 * 50 = 300
    // dispose-mattress: 120 * 1 = 120
    // Total addon: 420. Subtotal 2990. Delivery fee 250 (single category).
    // ClientTotal 2990 + 420 + 250 = 3660.
    const app = buildApp(supabase);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify(buildBody({
        clientTotal: 3660,
        addons: [
          { addonId: 'dispose-mattress', qty: 1 },
          { addonId: 'lift', floorsCount: 5, itemsCount: 2 },
        ],
      })),
    }, baseEnv);

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.subtotal).toBe(2990);
    expect(body.addonTotal).toBe(420);
    expect(body.total).toBe(3660);
    expect(body.deliveryFee).toEqual({ base: 250, crossCategory: 0, additional: 0, total: 250 });

    const payload = rpcCapture.last?.args?.p;
    expect(payload.addonTotal).toBe(420);
    expect(payload.total).toBe(3660);
    expect(payload.deliveryFeeBase).toBe(250);
    expect(payload.deliveryFeeCrossCategory).toBe(0);
    expect(payload.deliveryFeeAdditional).toBe(0);
    expect(payload.addons).toEqual([
      { addonId: 'dispose-mattress', qty: 1 },
      { addonId: 'lift', floorsCount: 5, itemsCount: 2 },
    ]);
  });

  it('passes unknown handover addonId through to the SQL function (server-authoritative INNER JOIN filters at persist)', async () => {
    const rpcCapture: { last?: { name: string; args: any } } = {};
    const supabase = createMockSupabase(
      {
        staff: () => ({ data: salesStaffRow, error: null }),
        products: () => ({ data: [productFlatRow], error: null }),
        product_compartments: () => ({ data: [], error: null }),
        product_bundles: () => ({ data: [], error: null }),
        product_size_variants: () => ({ data: [], error: null }),
        // The unknown id should not be returned from the addons table. The
        // `.in('id', allAddonIds)` query asks for it but Supabase returns
        // nothing (no row with that id).
        addons: () => ({ data: [], error: null }),
        delivery_fee_config: defaultDeliveryFeeCfg,
      },
      rpcCapture,
      { data: 'SO-2053', error: null },
    );

    // computeOrderTotal silently filters unknown id → addonTotal=0,
    // serverTotal=2990 + 250 delivery base = 3240. clientTotal=3240 matches → 201.
    const app = buildApp(supabase);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify(buildBody({
        clientTotal: 3240,
        addons: [{ addonId: 'definitely-fake', qty: 1 }],
      })),
    }, baseEnv);

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.addonTotal).toBe(0);

    // The unknown id is still forwarded to the SQL function — it will be
    // filtered out by migration 0023's INNER JOIN on addons (enabled=TRUE),
    // not at the API layer. This preserves server-authoritative behavior.
    const payload = rpcCapture.last?.args?.p;
    expect(payload.addons).toEqual([{ addonId: 'definitely-fake', qty: 1 }]);
  });

  it('returns 409 pricing_drift when client total ignores selected addons', async () => {
    const rpcCapture: { last?: { name: string; args: any } } = {};
    const supabase = createMockSupabase(
      {
        staff: () => ({ data: salesStaffRow, error: null }),
        products: () => ({ data: [productFlatRow], error: null }),
        product_compartments: () => ({ data: [], error: null }),
        product_bundles: () => ({ data: [], error: null }),
        product_size_variants: () => ({ data: [], error: null }),
        addons: () => ({
          data: [
            {
              id: 'dispose-mattress',
              kind: 'qty',
              price: 120,
              per_floor_item: null,
              enabled: true,
            },
          ],
          error: null,
        }),
        delivery_fee_config: defaultDeliveryFeeCfg,
      },
      rpcCapture,
      // RPC should not even be called on a drift reject.
      { data: 'never-called', error: null },
    );

    // Server computes 2990 (product) + 120 (addon) + 250 (delivery base) = 3360.
    // Client submits 2990 (ignored addons AND delivery fee).
    // Drift = 370/3360 ≈ 11% > 0.5% threshold → 409. With delivery folded in
    // the drift is now even larger than pre-Task-5 (was 120/3110 ≈ 3.86%).
    const app = buildApp(supabase);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify(buildBody({
        clientTotal: 2990,
        addons: [{ addonId: 'dispose-mattress', qty: 1 }],
      })),
    }, baseEnv);

    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error).toBe('pricing_drift');
    expect(body.clientTotal).toBe(2990);
    expect(body.serverTotal).toBe(3360);
    // 409 response now exposes the recomputed delivery fee so the POS modal
    // can show the delivery-fee column when it asks the user to confirm.
    expect(body.deliveryFee).toEqual({
      base: 250,
      crossCategory: 0,
      additional: 0,
      total: 250,
    });
    // RPC must not have been called on drift reject.
    expect(rpcCapture.last).toBeUndefined();
  });

  it('snapshots delivery fee onto orders.* and includes deliveryFee in response', async () => {
    const rpcCapture: { last?: { name: string; args: any } } = {};
    const supabase = createMockSupabase(
      {
        staff: () => ({ data: salesStaffRow, error: null }),
        // Two products in DIFFERENT categories — triggers cross-category +175.
        products: () => ({ data: [productFlatRow, productMattressRow], error: null }),
        product_compartments: () => ({ data: [], error: null }),
        product_bundles: () => ({ data: [], error: null }),
        product_size_variants: () => ({ data: [], error: null }),
        addons: () => ({ data: [], error: null }),
        delivery_fee_config: defaultDeliveryFeeCfg,
      },
      rpcCapture,
      { data: 'SO-2054', error: null },
    );

    // Subtotal: 2990 (sofa) + 1500 (mattress) = 4490
    // Delivery: base 250 + crossCategory 175 + additional 50 = 475
    // Total:    4490 + 475 = 4965
    const body = {
      customer: {
        name: 'Test Customer',
        phone: '0123456789',
        address: '123 Test Lane',
      },
      paymentMethod: 'merchant' as const,
      merchantProvider: 'GHL' as const,
      approvalCode: 'TEST123',
      lines: [
        { qty: 1, config: { kind: 'flat' as const, productId: PRODUCT_ID } },
        { qty: 1, config: { kind: 'flat' as const, productId: SECOND_PRODUCT_ID } },
      ],
      additionalDeliveryFee: 50,
      clientTotal: 4965,
    };

    const app = buildApp(supabase);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify(body),
    }, baseEnv);

    expect(res.status).toBe(201);
    const resBody = await res.json() as any;
    expect(resBody.subtotal).toBe(4490);
    expect(resBody.addonTotal).toBe(0);
    expect(resBody.total).toBe(4965);
    expect(resBody.deliveryFee).toEqual({
      base: 250,
      crossCategory: 175,
      additional: 50,
      total: 475,
    });

    // RPC payload carries the three snapshot columns for orders.delivery_fee_*.
    const payload = rpcCapture.last?.args?.p;
    expect(payload.deliveryFeeBase).toBe(250);
    expect(payload.deliveryFeeCrossCategory).toBe(175);
    expect(payload.deliveryFeeAdditional).toBe(50);
    expect(payload.total).toBe(4965);
  });

  it('rejects clientTotal drifting from server total once delivery fee is folded in', async () => {
    const rpcCapture: { last?: { name: string; args: any } } = {};
    const supabase = createMockSupabase(
      {
        staff: () => ({ data: salesStaffRow, error: null }),
        products: () => ({ data: [productFlatRow], error: null }),
        product_compartments: () => ({ data: [], error: null }),
        product_bundles: () => ({ data: [], error: null }),
        product_size_variants: () => ({ data: [], error: null }),
        addons: () => ({ data: [], error: null }),
        delivery_fee_config: defaultDeliveryFeeCfg,
      },
      rpcCapture,
      { data: 'never-called', error: null },
    );

    // Single-category cart. Server: 2990 + 250 base = 3240. Client "forgets"
    // the 250 base fee and submits 2990. Drift = 250/3240 ≈ 7.7% > 0.5%.
    const app = buildApp(supabase);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify(buildBody({ clientTotal: 2990 })),
    }, baseEnv);

    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error).toBe('pricing_drift');
    expect(body.clientTotal).toBe(2990);
    expect(body.serverTotal).toBe(3240);
    expect(body.deliveryFee.base).toBe(250);
    // RPC must not have been called on drift reject.
    expect(rpcCapture.last).toBeUndefined();
  });
});

describe('POST /orders installmentMonths', () => {
  it('forwards installmentMonths to the RPC payload for installment orders', async () => {
    const rpcCapture: { last?: { name: string; args: any } } = {};
    const supabase = createMockSupabase({
      staff: () => ({ data: { role: 'sales', active: true }, error: null }),
      products: () => ({ data: [{ id: PRODUCT_ID, category_id: 'sofa', pricing_kind: 'flat', flat_price: 5980, recliner_upgrade_price: 0 }], error: null }),
      product_compartments: () => ({ data: [], error: null }),
      product_bundles: () => ({ data: [], error: null }),
      product_size_variants: () => ({ data: [], error: null }),
      addons: () => ({ data: [], error: null }),
      delivery_fee_config: defaultDeliveryFeeCfg,
    }, rpcCapture, { data: 'SO-2991', error: null });
    const app = buildApp(supabase);

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customer: { name: 'Hafiz Rahman' },
        paymentMethod: 'installment',
        installmentMonths: 12,
        approvalCode: 'CONTRACT-1',
        lines: [{ qty: 1, config: { kind: 'flat', productId: PRODUCT_ID } }],
        clientTotal: 5980 + 250,
      }),
    }, baseEnv);

    expect(res.status).toBe(201);
    expect(rpcCapture.last?.args?.p?.installmentMonths).toBe(12);
  });
});
