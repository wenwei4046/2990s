// Tests for /free-item-campaigns — standalone giveaway campaigns (migration 0176).
// Mirrors the harness from model-free-gifts.test.ts:
//   - vi.mock('../middleware/auth') → passthrough
//   - vi.mock('@supabase/supabase-js') → captures service-role client calls via adminFromMock
//   - c.set('user'/'supabase', ...) → drives requireCampaignEditor staff lookup

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

import { freeItemCampaigns } from './free-item-campaigns';

const baseEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGINS: '*',
  R2_BUCKET_NAME: 't', R2_ENDPOINT: 'r2', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's',
  SLIPS: {} as any,
} as unknown as Env;

const EDITOR_USER_ID = '00000000-0000-0000-0000-000000000001';
const CAMPAIGN_ID = 'cccccccc-cccc-4ccc-cccc-000000000001';
const MODEL_ID = 'aaaaaaaa-aaaa-4aaa-baaa-000000000001';

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
  app.route('/free-item-campaigns', freeItemCampaigns);
  return app;
}

/** Build an app whose user-scoped supabase.from() is fully controlled by the
 *  caller-supplied `fromImpl`. Used for tests that need both staff lookup AND
 *  table queries from the same client (GET and insert/update/delete checks). */
function buildAppWithFrom(fromImpl: (table: string) => any) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: EDITOR_USER_ID } as any);
    c.set('supabase', { from: fromImpl } as any);
    await next();
  });
  app.route('/free-item-campaigns', freeItemCampaigns);
  return app;
}

beforeEach(() => {
  adminFromMock.mockReset();
});

// ---------------------------------------------------------------------------
// GET /free-item-campaigns
// ---------------------------------------------------------------------------
describe('GET /free-item-campaigns', () => {
  it('returns all campaigns with mapped fields', async () => {
    const rawRows = [
      {
        id: CAMPAIGN_ID,
        name: 'Q3 Launch Promo',
        active: true,
        max_free_qty: 2,
        eligible: [{ modelId: MODEL_ID, scope: 'model' }],
      },
    ];

    const fromImpl = (table: string) => {
      if (table === 'staff') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'admin', active: true }, error: null }) }) }),
        };
      }
      // free_item_campaigns — route calls .select(cols) and awaits the result directly.
      return {
        select: (_cols: string) => Promise.resolve({ data: rawRows, error: null }),
      };
    };

    const app = buildAppWithFrom(fromImpl);
    const res = await app.request('/free-item-campaigns', {}, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(1);
    const row = body[0];
    expect(row.id).toBe(CAMPAIGN_ID);
    expect(row.name).toBe('Q3 Launch Promo');
    expect(row.active).toBe(true);
    expect(row.maxFreeQty).toBe(2);
    expect(row.eligible).toHaveLength(1);
    expect(row.eligible[0].modelId).toBe(MODEL_ID);
  });

  it('filters to active campaigns only when ?active=1 query param is set', async () => {
    const rawRows = [
      {
        id: CAMPAIGN_ID,
        name: 'Active Campaign',
        active: true,
        max_free_qty: 1,
        eligible: [],
      },
    ];

    const fromImpl = (table: string) => {
      if (table === 'staff') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'admin', active: true }, error: null }) }) }),
        };
      }
      // Simulate .eq('active', true) filtering.
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _val: any) => Promise.resolve({ data: rawRows, error: null }),
        }),
      };
    };

    const app = buildAppWithFrom(fromImpl);
    const res = await app.request('/free-item-campaigns?active=1', {}, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(1);
    expect(body[0].active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /free-item-campaigns
// ---------------------------------------------------------------------------
describe('POST /free-item-campaigns', () => {
  it('returns 403 campaign_editor_only for a non-editor role (sales)', async () => {
    const app = buildApp('sales');
    const res = await app.request('/free-item-campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Test',
        active: true,
        maxFreeQty: 1,
        eligible: [],
      }),
    }, baseEnv);
    expect(res.status).toBe(403);
    const body = await res.json() as { reason: string };
    expect(body.reason).toBe('campaign_editor_only');
  });

  it('returns 200 {ok:true, id} for an editor role (admin) with valid body', async () => {
    const fromImpl = (table: string) => {
      if (table === 'staff') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'admin', active: true }, error: null }) }) }),
        };
      }
      return {
        insert: (_row: any) => ({
          select: (_cols: string) => Promise.resolve({ data: [{ id: CAMPAIGN_ID }], error: null }),
        }),
      };
    };

    const app = buildAppWithFrom(fromImpl);
    const payload = {
      name: 'Summer Sale',
      active: true,
      maxFreeQty: 3,
      eligible: [{ modelId: MODEL_ID, scope: 'model' }],
    };
    const res = await app.request('/free-item-campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toBe(CAMPAIGN_ID);
  });

  it('returns 400 validation_failed when eligible entry lacks modelId', async () => {
    const app = buildApp('admin');
    const res = await app.request('/free-item-campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Test',
        active: true,
        maxFreeQty: 1,
        eligible: [{ scope: 'model' }],
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('validation_failed');
  });
});

// ---------------------------------------------------------------------------
// PATCH /free-item-campaigns/:id
// ---------------------------------------------------------------------------
describe('PATCH /free-item-campaigns/:id', () => {
  it('returns 403 campaign_editor_only for non-editor role (finance)', async () => {
    const app = buildApp('finance');
    const res = await app.request(`/free-item-campaigns/${CAMPAIGN_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Updated', active: true, maxFreeQty: 1, eligible: [] }),
    }, baseEnv);
    expect(res.status).toBe(403);
    const body = await res.json() as { reason: string };
    expect(body.reason).toBe('campaign_editor_only');
  });

  it('returns 200 {ok:true} for coordinator role with valid body', async () => {
    const fromImpl = (table: string) => {
      if (table === 'staff') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'coordinator', active: true }, error: null }) }) }),
        };
      }
      return {
        update: (_row: any) => ({
          eq: (_col: string, _val: string) => ({
            select: (_cols: string) => Promise.resolve({ data: [{ id: CAMPAIGN_ID }], error: null }),
          }),
        }),
      };
    };

    const app = buildAppWithFrom(fromImpl);
    const res = await app.request(`/free-item-campaigns/${CAMPAIGN_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Updated Promo',
        active: false,
        maxFreeQty: 5,
        eligible: [],
      }),
    }, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 404 not_found_or_rls when update returns empty data', async () => {
    const fromImpl = (table: string) => {
      if (table === 'staff') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'admin', active: true }, error: null }) }) }),
        };
      }
      return {
        update: (_row: any) => ({
          eq: (_col: string, _val: string) => ({
            select: (_cols: string) => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    };

    const app = buildAppWithFrom(fromImpl);
    const res = await app.request(`/free-item-campaigns/${CAMPAIGN_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Test',
        active: true,
        maxFreeQty: 1,
        eligible: [],
      }),
    }, baseEnv);
    expect(res.status).toBe(404);
    const body = await res.json() as { reason: string };
    expect(body.reason).toBe('not_found_or_rls');
  });
});

// ---------------------------------------------------------------------------
// DELETE /free-item-campaigns/:id
// ---------------------------------------------------------------------------
describe('DELETE /free-item-campaigns/:id', () => {
  it('returns 200 {ok:true} for editor role (super_admin)', async () => {
    const fromImpl = (table: string) => {
      if (table === 'staff') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'super_admin', active: true }, error: null }) }) }),
        };
      }
      return {
        delete: () => ({
          eq: (_col: string, _val: string) => ({
            select: (_cols: string) => Promise.resolve({ data: [{ id: CAMPAIGN_ID }], error: null }),
          }),
        }),
      };
    };

    const app = buildAppWithFrom(fromImpl);
    const res = await app.request(`/free-item-campaigns/${CAMPAIGN_ID}`, { method: 'DELETE' }, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 403 campaign_editor_only for non-editor role (outlet_manager)', async () => {
    const app = buildApp('outlet_manager');
    const res = await app.request(`/free-item-campaigns/${CAMPAIGN_ID}`, { method: 'DELETE' }, baseEnv);
    expect(res.status).toBe(403);
    const body = await res.json() as { reason: string };
    expect(body.reason).toBe('campaign_editor_only');
  });

  it('returns 403 no_active_staff when staff row is not found', async () => {
    const app = buildApp(null);
    const res = await app.request(`/free-item-campaigns/${CAMPAIGN_ID}`, { method: 'DELETE' }, baseEnv);
    expect(res.status).toBe(403);
    const body = await res.json() as { reason: string };
    expect(body.reason).toBe('no_active_staff');
  });

  it('returns 404 not_found_or_rls when delete returns empty data', async () => {
    const fromImpl = (table: string) => {
      if (table === 'staff') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'admin', active: true }, error: null }) }) }),
        };
      }
      return {
        delete: () => ({
          eq: (_col: string, _val: string) => ({
            select: (_cols: string) => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    };

    const app = buildAppWithFrom(fromImpl);
    const res = await app.request(`/free-item-campaigns/${CAMPAIGN_ID}`, { method: 'DELETE' }, baseEnv);
    expect(res.status).toBe(404);
    const body = await res.json() as { reason: string };
    expect(body.reason).toBe('not_found_or_rls');
  });
});
