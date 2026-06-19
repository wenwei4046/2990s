// ----------------------------------------------------------------------------
// Tests for POST /:id/activate-one-shot
// Uses the same mock pattern as admin.test.ts:
//   - vi.mock('../middleware/auth') → passthrough
//   - vi.mock('@supabase/supabase-js') → captures admin client calls
//   - c.set('supabase', userScopedStub) → drives requireRole staff lookup
// ----------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';

vi.mock('../middleware/auth', () => ({
  supabaseAuth: async (_c: any, next: any) => { await next(); },
}));

// Capture calls made via the service-role createClient.
const adminFromMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: adminFromMock }),
}));

import { mfgProducts } from './mfg-products';

const baseEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGINS: '*',
  R2_BUCKET_NAME: 't', R2_ENDPOINT: 'r2', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's',
  SLIPS: {} as any,
} as unknown as Env;

const ADMIN_USER_ID = '00000000-0000-0000-0000-000000000001';
const SKU_ID = 'mfg-aabbccddeeff';
const MODEL_ID = 'model-11223344556677';

function buildApp(callerRole: string) {
  const userScopedFrom = (table: string) => ({
    select: () => ({
      eq: (col: string, _val: any) => ({
        maybeSingle: async () => {
          if (table === 'staff' && col === 'id') {
            return { data: { role: callerRole, active: true }, error: null };
          }
          return { data: null, error: null };
        },
      }),
    }),
  });
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: ADMIN_USER_ID } as any);
    c.set('supabase', { from: userScopedFrom } as any);
    await next();
  });
  app.route('/mfg-products', mfgProducts);
  return app;
}

beforeEach(() => {
  adminFromMock.mockReset();
});

describe('POST /mfg-products/:id/activate-one-shot', () => {
  it('returns 400 not_one_shot when the SKU has one_shot=false', async () => {
    // Admin lookup returns a non-one-shot SKU.
    adminFromMock.mockImplementation((table: string) => {
      if (table === 'mfg_products') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { id: SKU_ID, code: 'ANNSA-1NA', category: 'SOFA', base_model: 'Annsa', model_id: MODEL_ID, one_shot: false }, error: null }) }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }), update: () => ({ eq: async () => ({ error: null }) }) };
    });

    const app = buildApp('admin');
    const res = await app.request(`/mfg-products/${SKU_ID}/activate-one-shot`, { method: 'POST' }, baseEnv);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('not_one_shot');
  });

  it('activates a SOFA one-shot SKU: sets pos_active=true and appends compartment to allowed_options', async () => {
    // Track calls by table + operation.
    const mfgProductsUpdateCalls: any[] = [];
    const productModelsUpdateCalls: any[] = [];
    const callCount = 0; // mfg_products.select is called once, product_models.select is called once

    adminFromMock.mockImplementation((table: string) => {
      if (table === 'mfg_products') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              maybeSingle: async () => ({
                data: { id: SKU_ID, code: 'ANNSA-1NA(TALL)', category: 'SOFA', base_model: 'Annsa', model_id: MODEL_ID, one_shot: true },
                error: null,
              }),
            }),
          }),
          update: (patch: any) => ({
            eq: async (_col: string, _val: string) => {
              mfgProductsUpdateCalls.push(patch);
              return { error: null };
            },
          }),
        };
      }
      if (table === 'product_models') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              maybeSingle: async () => ({
                data: { allowed_options: { compartments: ['1A(LHF)', '1A(RHF)'] } },
                error: null,
              }),
            }),
          }),
          update: (patch: any) => ({
            eq: async (_col: string, _val: string) => {
              productModelsUpdateCalls.push(patch);
              return { error: null };
            },
          }),
        };
      }
      return {};
    });

    const app = buildApp('admin');
    const res = await app.request(`/mfg-products/${SKU_ID}/activate-one-shot`, { method: 'POST' }, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    // pos_active=true was written to mfg_products.
    expect(mfgProductsUpdateCalls).toHaveLength(1);
    expect(mfgProductsUpdateCalls[0]).toMatchObject({ pos_active: true });

    // The compartment derived from ANNSA-1NA(TALL) + base_model 'Annsa' is '1NA(TALL)'.
    // It should be appended to allowed_options.compartments.
    expect(productModelsUpdateCalls).toHaveLength(1);
    const updatedOpts = productModelsUpdateCalls[0].allowed_options as { compartments: string[] };
    expect(updatedOpts.compartments).toContain('1NA(TALL)');
    expect(updatedOpts.compartments).toContain('1A(LHF)');
    expect(updatedOpts.compartments).toContain('1A(RHF)');
  });

  it('does not update allowed_options if the compartment is already present', async () => {
    const productModelsUpdateCalls: any[] = [];

    adminFromMock.mockImplementation((table: string) => {
      if (table === 'mfg_products') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: SKU_ID, code: 'ANNSA-1NA', category: 'SOFA', base_model: 'Annsa', model_id: MODEL_ID, one_shot: true },
                error: null,
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === 'product_models') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { allowed_options: { compartments: ['1NA', '1A(LHF)'] } },
                error: null,
              }),
            }),
          }),
          update: (patch: any) => ({
            eq: async () => {
              productModelsUpdateCalls.push(patch);
              return { error: null };
            },
          }),
        };
      }
      return {};
    });

    const app = buildApp('admin');
    const res = await app.request(`/mfg-products/${SKU_ID}/activate-one-shot`, { method: 'POST' }, baseEnv);
    expect(res.status).toBe(200);
    // allowed_options was NOT updated because '1NA' is already in the list.
    expect(productModelsUpdateCalls).toHaveLength(0);
  });

  it('returns 403 when caller role is not in EDIT_ROLES', async () => {
    const app = buildApp('sales');
    const res = await app.request(`/mfg-products/${SKU_ID}/activate-one-shot`, { method: 'POST' }, baseEnv);
    expect(res.status).toBe(403);
  });
});
