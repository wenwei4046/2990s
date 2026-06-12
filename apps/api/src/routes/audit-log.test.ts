import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';

vi.mock('../middleware/auth', () => ({
  supabaseAuth: async (_c: any, next: any) => { await next(); },
}));

import { auditLog } from './audit-log';

const STAFF_USER_ID = '00000000-0000-0000-0000-000000000010';

const baseEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGINS: '*',
} as unknown as Env;

/** Shape of a mocked mfg_sales_order_payments row WITH the embedded SO. */
type FakeRow = {
  id: string;
  so_doc_no: string;
  paid_at: string;
  created_at: string;
  method: string;
  merchant_provider: string | null;
  installment_months: number | null;
  approval_code: string | null;
  amount_centi: number;
  slip_key: string | null;
  is_deposit: boolean;
  created_by: string | null;
  so: {
    debtor_name: string;
    phone: string | null;
    salesperson_id: string | null;
    local_total_centi: number;
    slip_key: string | null;
    venue: { name: string } | null;
  } | null;
};

function buildApp(callerRole: string | null, rows: FakeRow[] = []) {
  const supabase = {
    from: (table: string) => {
      if (table === 'staff') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: callerRole ? { role: callerRole, active: true } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'mfg_sales_order_payments') {
        const builder: any = {
          select: () => builder,
          gte: () => builder,
          lte: () => builder,
          lt:  () => builder,
          in:  () => builder,
          eq:  () => builder,
          is:  () => builder,
          not: () => builder,
          order: () => builder,
          limit: () => builder,
          then: (cb: any) => Promise.resolve({ data: rows, error: null }).then(cb),
        };
        return builder;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: STAFF_USER_ID } as any);
    c.set('supabase', supabase as any);
    await next();
  });
  app.route('/admin/audit-log', auditLog);
  return app;
}

const paymentRow = (over: Partial<FakeRow> = {}): FakeRow => ({
  id: 'b1f5d0aa-0000-0000-0000-000000000001',
  so_doc_no: 'SO-2606-001',
  paid_at: '2026-06-11',
  created_at: '2026-06-11T10:14:00Z',
  method: 'transfer',
  merchant_provider: null,
  installment_months: null,
  approval_code: 'BNK-784512',
  amount_centi: 299_000,
  slip_key: 'slips/SO-2606-001/abc.jpg',
  is_deposit: true,
  created_by: 'staff-1',
  so: {
    debtor_name: 'Tan Wei Ming',
    phone: '+60 12 345 6789',
    salesperson_id: 'sp-1',
    local_total_centi: 598_000,
    slip_key: null,
    venue: { name: 'Showroom KL' },
  },
  ...over,
});

describe('GET /admin/audit-log', () => {
  it('returns 403 for sales role', async () => {
    const app = buildApp('sales');
    const res = await app.request('/admin/audit-log', {}, baseEnv);
    expect(res.status).toBe(403);
  });

  it('returns 403 for showroom_lead role', async () => {
    const app = buildApp('showroom_lead');
    const res = await app.request('/admin/audit-log', {}, baseEnv);
    expect(res.status).toBe(403);
  });

  it('returns 200 for coordinator role', async () => {
    const app = buildApp('coordinator', []);
    const res = await app.request('/admin/audit-log', {}, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ rows: [], count: 0 });
  });

  it('returns 200 for finance, admin AND super_admin roles', async () => {
    for (const role of ['finance', 'admin', 'super_admin']) {
      const app = buildApp(role, []);
      const res = await app.request('/admin/audit-log', {}, baseEnv);
      expect(res.status).toBe(200);
    }
  });

  it('maps a payments-ledger row (joined SO) to the audit-log shape, centi → RM', async () => {
    const app = buildApp('coordinator', [paymentRow()]);
    const res = await app.request('/admin/audit-log', {}, baseEnv);
    const body = await res.json() as any;
    expect(body.count).toBe(1);
    expect(body.rows[0]).toMatchObject({
      id: 'b1f5d0aa-0000-0000-0000-000000000001',
      docNo: 'SO-2606-001',
      placedAt: '2026-06-11T10:14:00Z',
      paidAt: '2026-06-11',
      customerName: 'Tan Wei Ming',
      total: 5980,
      paid: 2990,
      isDeposit: true,
      paymentMethod: 'transfer',
      approvalCode: 'BNK-784512',
      slipUploaded: true,
      venueName: 'Showroom KL',
      salespersonId: 'sp-1',
      staffId: 'staff-1',
    });
  });

  it('falls back to the SO-level slip_key for pre-0159 rows', async () => {
    const app = buildApp('coordinator', [paymentRow({
      slip_key: null,
      so: { ...paymentRow().so!, slip_key: 'slips/SO-2606-001/header.jpg' },
    })]);
    const res = await app.request('/admin/audit-log', {}, baseEnv);
    const body = await res.json() as any;
    expect(body.rows[0]).toMatchObject({
      slipKey: 'slips/SO-2606-001/header.jpg',
      slipUploaded: true,
    });
  });

  it('rejects malformed amountMin', async () => {
    const app = buildApp('coordinator');
    const res = await app.request('/admin/audit-log?amountMin=abc', {}, baseEnv);
    expect(res.status).toBe(400);
  });

  it('rejects a legacy payment-method value', async () => {
    const app = buildApp('coordinator');
    const res = await app.request('/admin/audit-log?paymentMethod=credit', {}, baseEnv);
    expect(res.status).toBe(400);
  });

  it('returns installment details and a missing venue as null', async () => {
    const app = buildApp('coordinator', [paymentRow({
      method: 'installment',
      installment_months: 12,
      amount_centi: 446_600,
      is_deposit: false,
      so: { ...paymentRow().so!, venue: null },
    })]);
    const res = await app.request('/admin/audit-log', {}, baseEnv);
    const body = await res.json() as any;
    expect(body.rows[0]).toMatchObject({
      paid: 4466, installmentMonths: 12, isDeposit: false, venueName: null,
    });
  });
});
