// ----------------------------------------------------------------------------
// Tests for GET /mfg-sales-orders/customer-search — the POS returning-customer
// autocomplete. Focus: the per-identity dedup keeps per-FIELD coalesce for
// contact/address, but the emergency contact coalesces as a GROUP (newest
// order carrying any of the three wins all three) so one order's name can
// never pair with another order's phone.
// Mock pattern follows mfg-products.test.ts / admin.test.ts.
// ----------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';

vi.mock('../middleware/auth', () => ({
  supabaseAuth: async (_c: any, next: any) => { await next(); },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: vi.fn() }),
}));

import { mfgSalesOrders } from './mfg-sales-orders';

const baseEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGINS: '*',
  R2_BUCKET_NAME: 't', R2_ENDPOINT: 'r2', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's',
  SLIPS: {} as any,
} as unknown as Env;

type SoRow = Record<string, string | null>;

/** Base header row — the route reads these columns; tests override per case. */
const row = (over: Partial<SoRow>): SoRow => ({
  doc_no: 'SO-2606-001',
  debtor_name: 'Alvin',
  phone: '+60123455444',
  email: null,
  customer_type: null,
  address1: null,
  address2: null,
  city: null,
  postcode: null,
  customer_state: null,
  building_type: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  emergency_contact_relationship: null,
  created_at: '2026-06-01T00:00:00Z',
  ...over,
});

/** rows must be passed NEWEST-FIRST — the live query orders created_at desc. */
let queryRows: SoRow[] = [];

const buildApp = () => {
  const chain = {
    select: () => chain,
    ilike: () => chain,
    neq: () => chain,
    // DRAFT/Confirmed two-state (2026-06-25) — the live customer-search query now
    // excludes DRAFT via `.not('status', 'in', ...)`; mirror the real PostgREST
    // client's .not() so the chainable mock doesn't throw (→ 500).
    not: () => chain,
    order: () => chain,
    limit: async () => ({ data: queryRows, error: null }),
  };
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: '00000000-0000-0000-0000-000000000001' } as any);
    c.set('supabase', { from: () => chain } as any);
    await next();
  });
  app.route('/mfg-sales-orders', mfgSalesOrders);
  return app;
};

const search = async (name = 'Alvin') => {
  const res = await buildApp().request(
    `/mfg-sales-orders/customer-search?name=${encodeURIComponent(name)}`,
    { method: 'GET' },
    baseEnv,
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { customers: Record<string, unknown>[] }).customers;
};

beforeEach(() => { queryRows = []; });

describe('GET /mfg-sales-orders/customer-search — emergency contact in the snapshot', () => {
  it('coalesces per field for contact/address but takes the emergency trio from one order', async () => {
    queryRows = [
      // Newest: "fill in later" order — no email/address, no emergency.
      row({ doc_no: 'SO-2606-030', created_at: '2026-06-10T00:00:00Z' }),
      // Middle: full snapshot including the emergency contact.
      row({
        doc_no: 'SO-2606-020', created_at: '2026-06-05T00:00:00Z',
        email: 'alvin@example.com', address1: 'Jalan 1',
        emergency_contact_name: 'Mei', emergency_contact_phone: '+60111111111',
        emergency_contact_relationship: 'Wife',
      }),
      // Oldest: a DIFFERENT emergency contact — must not leak into the hit.
      row({
        doc_no: 'SO-2606-010', created_at: '2026-06-01T00:00:00Z',
        emergency_contact_name: 'Bob', emergency_contact_phone: '+60122222222',
        emergency_contact_relationship: 'Friend',
      }),
    ];
    const hits = await search();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      debtorName: 'Alvin',
      email: 'alvin@example.com',
      address1: 'Jalan 1',
      emergencyContactName: 'Mei',
      emergencyContactPhone: '+60111111111',
      emergencyContactRelationship: 'Wife',
      lastDocNo: 'SO-2606-030',
    });
  });

  it('never mixes one order\'s contact name with another order\'s phone', async () => {
    queryRows = [
      // Newest carries only a name — the group rule means it wins ALL three,
      // leaving phone/relationship empty rather than borrowing Bob's.
      row({
        doc_no: 'SO-2606-030', created_at: '2026-06-10T00:00:00Z',
        emergency_contact_name: 'Mei',
      }),
      row({
        doc_no: 'SO-2606-010', created_at: '2026-06-01T00:00:00Z',
        emergency_contact_name: 'Bob', emergency_contact_phone: '+60122222222',
        emergency_contact_relationship: 'Friend',
      }),
    ];
    const hits = await search();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      emergencyContactName: 'Mei',
      emergencyContactPhone: null,
      emergencyContactRelationship: null,
    });
  });

  it('keeps emergency contacts separate across (name, phone) identities', async () => {
    queryRows = [
      row({
        doc_no: 'SO-2606-030', created_at: '2026-06-10T00:00:00Z',
        phone: '+60123455444',
        emergency_contact_name: 'Mei', emergency_contact_phone: '+60111111111',
        emergency_contact_relationship: 'Wife',
      }),
      // Same name, different phone = a different customer (0144 identity rule).
      row({
        doc_no: 'SO-2606-010', created_at: '2026-06-01T00:00:00Z',
        phone: '+60199999999',
        emergency_contact_name: 'Bob', emergency_contact_phone: '+60122222222',
        emergency_contact_relationship: 'Friend',
      }),
    ];
    const hits = await search();
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ emergencyContactName: 'Mei' });
    expect(hits[1]).toMatchObject({ emergencyContactName: 'Bob' });
  });
});
