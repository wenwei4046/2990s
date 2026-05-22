import { describe, it, expect, beforeEach, vi } from 'vitest';
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

type FakeRow = {
  id: string;
  placed_at: string;
  customer_name: string;
  total: number;
  payment_method: string;
  approval_code: string | null;
  slip_key: string | null;
  showroom_id: string;
  salesperson_id: string | null;
  staff_id: string;
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
      if (table === 'orders') {
        const builder: any = {
          select: () => builder,
          gte: () => builder,
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

  it('returns 200 for finance and admin roles', async () => {
    for (const role of ['finance', 'admin']) {
      const app = buildApp(role, []);
      const res = await app.request('/admin/audit-log', {}, baseEnv);
      expect(res.status).toBe(200);
    }
  });

  it('maps DB rows to the audit-log shape', async () => {
    const app = buildApp('coordinator', [{
      id: 'SO-2990',
      placed_at: '2026-05-22T10:14:00Z',
      customer_name: 'Tan Wei Ming',
      total: 5980,
      payment_method: 'transfer',
      approval_code: 'BNK-784512',
      slip_key: 'slips/SO-2990/abc.jpg',
      showroom_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      salesperson_id: 'sp-1',
      staff_id: 'staff-1',
    }]);
    const res = await app.request('/admin/audit-log', {}, baseEnv);
    const body = await res.json() as any;
    expect(body.count).toBe(1);
    expect(body.rows[0]).toMatchObject({
      id: 'SO-2990',
      total: 5980,
      paymentMethod: 'transfer',
      approvalCode: 'BNK-784512',
      slipUploaded: true,
    });
  });

  it('rejects malformed amountMin', async () => {
    const app = buildApp('coordinator');
    const res = await app.request('/admin/audit-log?amountMin=abc', {}, baseEnv);
    expect(res.status).toBe(400);
  });
});
