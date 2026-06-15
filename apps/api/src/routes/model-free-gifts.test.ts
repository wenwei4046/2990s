// Tests for /model-free-gifts — per-Model default free gifts route (migration 0174).
// Mirrors the harness from mfg-products.test.ts:
//   - vi.mock('../middleware/auth') → passthrough
//   - vi.mock('@supabase/supabase-js') → captures service-role client calls via adminFromMock
//   - c.set('user'/'supabase', ...) → drives requireGiftEditor staff lookup

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';

vi.mock('../middleware/auth', () => ({
  supabaseAuth: async (_c: any, next: any) => { await next(); },
}));

// Capture calls made via the service-role createClient (not used by this route,
// but the mock must be present because the module import triggers it).
const adminFromMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: adminFromMock }),
}));

import { modelFreeGifts } from './model-free-gifts';

const baseEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGINS: '*',
  R2_BUCKET_NAME: 't', R2_ENDPOINT: 'r2', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's',
  SLIPS: {} as any,
} as unknown as Env;

const EDITOR_USER_ID = '00000000-0000-0000-0000-000000000001';
const MODEL_ID = 'aaaaaaaa-aaaa-4aaa-baaa-000000000001';
const GIFT_PRODUCT_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-000000000002';

/** Build a minimal Hono app with the supabase context pre-set.
 *  `callerRole` drives the staff lookup; null → not found (403 no_active_staff). */
function buildApp(callerRole: string | null) {
  const userScopedFrom = (table: string) => ({
    select: (_cols?: string) => ({
      eq: (col: string, _val: any) => ({
        maybeSingle: async () => {
          if (table === 'staff' && col === 'id') {
            return callerRole
              ? { data: { role: callerRole, active: true }, error: null }
              : { data: null, error: null };
          }
          return { data: null, error: null };
        },
      }),
    }),
  });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: EDITOR_USER_ID } as any);
    c.set('supabase', { from: userScopedFrom } as any);
    await next();
  });
  app.route('/model-free-gifts', modelFreeGifts);
  return app;
}

/** Build an app whose user-scoped supabase.from() is fully controlled by the
 *  caller-supplied `fromImpl`. Used for tests that need both staff lookup AND
 *  table queries from the same client (GET and upsert checks). */
function buildAppWithFrom(fromImpl: (table: string) => any) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: EDITOR_USER_ID } as any);
    c.set('supabase', { from: fromImpl } as any);
    await next();
  });
  app.route('/model-free-gifts', modelFreeGifts);
  return app;
}

beforeEach(() => {
  adminFromMock.mockReset();
});

// ---------------------------------------------------------------------------
// GET /model-free-gifts
// ---------------------------------------------------------------------------
describe('GET /model-free-gifts', () => {
  it('returns mapped rows with camelCase fields', async () => {
    const rawRows = [
      {
        model_id: MODEL_ID,
        gifts: [{ giftProductId: GIFT_PRODUCT_ID, qty: 1, campaignName: 'Promo A' }],
        updated_at: '2026-06-15T00:00:00.000Z',
        product_models: { name: 'Annsa', model_code: 'ANNSA', category: 'SOFA' },
      },
    ];

    const fromImpl = (table: string) => {
      if (table === 'staff') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'admin', active: true }, error: null }) }) }),
        };
      }
      // model_default_free_gifts — route calls .select(cols) and awaits the result directly.
      return {
        select: (_cols: string) => Promise.resolve({ data: rawRows, error: null }),
      };
    };

    const app = buildAppWithFrom(fromImpl);
    const res = await app.request('/model-free-gifts', {}, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(1);
    const row = body[0];
    expect(row.modelId).toBe(MODEL_ID);
    expect(row.modelName).toBe('Annsa');
    expect(row.modelCode).toBe('ANNSA');
    expect(row.category).toBe('SOFA');
    expect(row.updatedAt).toBe('2026-06-15T00:00:00.000Z');
    expect(row.gifts).toHaveLength(1);
    expect(row.gifts[0].giftProductId).toBe(GIFT_PRODUCT_ID);
    expect(row.gifts[0].qty).toBe(1);
    expect(row.gifts[0].campaignName).toBe('Promo A');
  });

  it('falls back to (unknown model) when product_models join is null', async () => {
    const rawRows = [
      {
        model_id: MODEL_ID,
        gifts: [],
        updated_at: '2026-06-15T00:00:00.000Z',
        product_models: null,
      },
    ];

    const fromImpl = (table: string) => {
      if (table === 'staff') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'admin', active: true }, error: null }) }) }),
        };
      }
      return { select: (_cols: string) => Promise.resolve({ data: rawRows, error: null }) };
    };

    const app = buildAppWithFrom(fromImpl);
    const res = await app.request('/model-free-gifts', {}, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body[0].modelName).toBe('(unknown model)');
    expect(body[0].modelCode).toBeNull();
    expect(body[0].category).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PUT /model-free-gifts
// ---------------------------------------------------------------------------
describe('PUT /model-free-gifts', () => {
  it('returns 403 gift_editor_only for a non-editor role (sales)', async () => {
    const app = buildApp('sales');
    const res = await app.request('/model-free-gifts', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, gifts: [] }),
    }, baseEnv);
    expect(res.status).toBe(403);
    const body = await res.json() as { reason: string };
    expect(body.reason).toBe('gift_editor_only');
  });

  it('returns 403 gift_editor_only for outlet_manager role', async () => {
    const app = buildApp('outlet_manager');
    const res = await app.request('/model-free-gifts', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, gifts: [] }),
    }, baseEnv);
    expect(res.status).toBe(403);
    const body = await res.json() as { reason: string };
    expect(body.reason).toBe('gift_editor_only');
  });

  it('returns 200 {ok:true} for an editor role (admin) with a valid body', async () => {
    const upsertCalls: any[] = [];

    const fromImpl = (table: string) => {
      if (table === 'staff') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'admin', active: true }, error: null }) }) }),
        };
      }
      // model_default_free_gifts
      return {
        upsert: (row: any, _opts: any) => {
          upsertCalls.push(row);
          return {
            select: (_cols: string) => Promise.resolve({ data: [{ model_id: MODEL_ID }], error: null }),
          };
        },
      };
    };

    const app = buildAppWithFrom(fromImpl);
    const payload = {
      modelId: MODEL_ID,
      gifts: [{ giftProductId: GIFT_PRODUCT_ID, qty: 2, campaignName: 'Welcome' }],
    };
    const res = await app.request('/model-free-gifts', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].model_id).toBe(MODEL_ID);
    expect(upsertCalls[0].updated_by).toBe(EDITOR_USER_ID);
  });

  it('returns 200 {ok:true} for coordinator role', async () => {
    const fromImpl = (table: string) => {
      if (table === 'staff') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'coordinator', active: true }, error: null }) }) }),
        };
      }
      return {
        upsert: (_row: any, _opts: any) => ({
          select: (_cols: string) => Promise.resolve({ data: [{ model_id: MODEL_ID }], error: null }),
        }),
      };
    };

    const app = buildAppWithFrom(fromImpl);
    const res = await app.request('/model-free-gifts', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, gifts: [] }),
    }, baseEnv);
    expect(res.status).toBe(200);
  });

  it('returns 403 rls_blocked_zero_rows when upsert returns empty data', async () => {
    const fromImpl = (table: string) => {
      if (table === 'staff') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'admin', active: true }, error: null }) }) }),
        };
      }
      return {
        upsert: (_row: any, _opts: any) => ({
          select: (_cols: string) => Promise.resolve({ data: [], error: null }),
        }),
      };
    };

    const app = buildAppWithFrom(fromImpl);
    const res = await app.request('/model-free-gifts', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, gifts: [] }),
    }, baseEnv);
    expect(res.status).toBe(403);
    const body = await res.json() as { reason: string };
    expect(body.reason).toBe('rls_blocked_zero_rows');
  });

  it('returns 400 validation_failed when modelId is missing', async () => {
    const app = buildApp('admin');
    const res = await app.request('/model-free-gifts', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gifts: [] }),
    }, baseEnv);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('validation_failed');
  });

  it('returns 400 validation_failed when modelId is not a UUID', async () => {
    const app = buildApp('admin');
    const res = await app.request('/model-free-gifts', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'not-a-uuid', gifts: [] }),
    }, baseEnv);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('validation_failed');
  });

  it('returns 400 validation_failed when gifts array has an entry missing giftProductId', async () => {
    const app = buildApp('admin');
    const res = await app.request('/model-free-gifts', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: MODEL_ID, gifts: [{ qty: 1 }] }),
    }, baseEnv);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('validation_failed');
  });
});

// ---------------------------------------------------------------------------
// DELETE /model-free-gifts/:modelId
// ---------------------------------------------------------------------------
describe('DELETE /model-free-gifts/:modelId', () => {
  it('returns 200 {ok:true} for an editor role (super_admin)', async () => {
    const deleteCalls: string[] = [];

    const fromImpl = (table: string) => {
      if (table === 'staff') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'super_admin', active: true }, error: null }) }) }),
        };
      }
      return {
        delete: () => ({
          eq: (_col: string, val: string) => {
            deleteCalls.push(val);
            return Promise.resolve({ error: null });
          },
        }),
      };
    };

    const app = buildAppWithFrom(fromImpl);
    const res = await app.request(`/model-free-gifts/${MODEL_ID}`, { method: 'DELETE' }, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(deleteCalls).toContain(MODEL_ID);
  });

  it('returns 200 {ok:true} for sales_director role', async () => {
    const fromImpl = (table: string) => {
      if (table === 'staff') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'sales_director', active: true }, error: null }) }) }),
        };
      }
      return {
        delete: () => ({
          eq: (_col: string, _val: string) => Promise.resolve({ error: null }),
        }),
      };
    };

    const app = buildAppWithFrom(fromImpl);
    const res = await app.request(`/model-free-gifts/${MODEL_ID}`, { method: 'DELETE' }, baseEnv);
    expect(res.status).toBe(200);
  });

  it('returns 403 gift_editor_only for a non-editor role (finance)', async () => {
    const app = buildApp('finance');
    const res = await app.request(`/model-free-gifts/${MODEL_ID}`, { method: 'DELETE' }, baseEnv);
    expect(res.status).toBe(403);
    const body = await res.json() as { reason: string };
    expect(body.reason).toBe('gift_editor_only');
  });

  it('returns 403 no_active_staff when staff row is not found', async () => {
    const app = buildApp(null);
    const res = await app.request(`/model-free-gifts/${MODEL_ID}`, { method: 'DELETE' }, baseEnv);
    expect(res.status).toBe(403);
    const body = await res.json() as { reason: string };
    expect(body.reason).toBe('no_active_staff');
  });
});
