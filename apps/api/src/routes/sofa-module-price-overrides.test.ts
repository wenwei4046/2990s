import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';

/* Origin-gated instead of authenticated, exactly like /campaign-promos — the
   POS holds only a Houzs token since the cutover and cannot pass 2990's
   supabaseAuth. The gate is the ONLY door, so it gets pinned first. */

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  single: null as Record<string, unknown> | null,
  error: null as { message: string } | null,
  lastUpsert: null as Record<string, unknown> | null,
  lastUpsertOpts: null as Record<string, unknown> | null,
  lastDeleteEq: [] as Array<[string, unknown]>,
  deleted: false,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const obj: any = {};
      obj.select = () => obj;
      obj.order = () => obj;
      obj.upsert = (payload: Record<string, unknown>, opts: Record<string, unknown>) => {
        state.lastUpsert = payload; state.lastUpsertOpts = opts; return obj;
      };
      obj.delete = () => { state.deleted = true; return obj; };
      obj.eq = (col: string, val: unknown) => { state.lastDeleteEq.push([col, val]); return obj; };
      obj.maybeSingle = async () => ({ data: state.single, error: state.error });
      obj.then = (resolve: any) => resolve({ data: state.rows, error: state.error });
      return obj;
    },
  }),
}));

import { sofaModulePriceOverrides } from './sofa-module-price-overrides';

const ORIGIN = 'https://pos.2990shome.com';
const env = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGINS: `${ORIGIN},https://erp.2990shome.com`,
} as unknown as Env;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.route('/sofa-module-price-overrides', sofaModulePriceOverrides);

const call = (path: string, init: RequestInit & { origin?: string | null } = {}) => {
  const { origin = ORIGIN, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (origin) headers.set('origin', origin);
  if (rest.body) headers.set('content-type', 'application/json');
  return app.request(`/sofa-module-price-overrides${path}`, { ...rest, headers }, env);
};

beforeEach(() => {
  state.rows = [];
  state.single = null;
  state.error = null;
  state.lastUpsert = null;
  state.lastUpsertOpts = null;
  state.lastDeleteEq = [];
  state.deleted = false;
});

describe('the Origin gate', () => {
  it('refuses a request with no Origin at all — curl with no header', async () => {
    const res = await call('', { origin: null });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: 'origin_not_allowed' });
  });

  it('refuses an Origin that is not allow-listed', async () => {
    expect((await call('', { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('gates WRITES too, not just reads', async () => {
    const res = await call('/UBORR-L(RHF)', {
      origin: 'https://evil.example',
      method: 'PUT',
      body: JSON.stringify({ sellPriceCenti: 1 }),
    });
    expect(res.status).toBe(403);
    expect(state.lastUpsert).toBeNull();
  });

  it('allows an allow-listed Origin', async () => {
    expect((await call('')).status).toBe(200);
  });
});

describe('GET /', () => {
  it('maps rows to the wire shape and hides nothing unexpected', async () => {
    state.rows = [{
      item_code: 'UBORR-L(RHF)', sell_price_centi: 99_000, note: 'from drift',
      created_at: 'c', updated_at: 'u',
      created_by: 'staff-uuid-should-not-leak',
    }];
    const body = await (await call('')).json() as { overrides: Record<string, unknown>[] };
    expect(body.overrides[0]).toEqual({
      itemCode: 'UBORR-L(RHF)', sellPriceCenti: 99_000, note: 'from drift',
      createdAt: 'c', updatedAt: 'u',
    });
    // toWire is a whitelist, so an internal column can never ride out.
    expect(body.overrides[0]).not.toHaveProperty('created_by');
  });
});

describe('PUT /:itemCode', () => {
  it('upserts on the primary key, so re-entering a corrected figure just fixes the row', async () => {
    state.single = { item_code: 'UBORR-L(RHF)', sell_price_centi: 99_000, note: 'n', created_at: 'c', updated_at: 'u' };
    const res = await call('/UBORR-L(RHF)', {
      method: 'PUT',
      body: JSON.stringify({ sellPriceCenti: 99_000, note: 'n' }),
    });
    expect(res.status).toBe(200);
    expect(state.lastUpsert).toMatchObject({ item_code: 'UBORR-L(RHF)', sell_price_centi: 99_000, note: 'n' });
    expect(state.lastUpsertOpts).toMatchObject({ onConflict: 'item_code' });
  });

  it('keeps the parentheses in a module code intact through the URL', async () => {
    state.single = { item_code: 'UBORR-1A(P)(LHF)', sell_price_centi: 1, note: '', created_at: '', updated_at: '' };
    await call(`/${encodeURIComponent('UBORR-1A(P)(LHF)')}`, {
      method: 'PUT', body: JSON.stringify({ sellPriceCenti: 1 }),
    });
    expect(state.lastUpsert).toMatchObject({ item_code: 'UBORR-1A(P)(LHF)' });
  });

  it('rejects a zero or negative price', async () => {
    /* An override of 0 is indistinguishable from "no override" — it would look
       saved and silently do nothing, which is the worst outcome for a repair
       tool. Negative would be worse still. */
    for (const sellPriceCenti of [0, -1]) {
      const res = await call('/X', { method: 'PUT', body: JSON.stringify({ sellPriceCenti }) });
      expect(res.status).toBe(422);
    }
    expect(state.lastUpsert).toBeNull();
  });

  it('rejects a non-integer price rather than rounding it', async () => {
    expect((await call('/X', { method: 'PUT', body: JSON.stringify({ sellPriceCenti: 99_000.5 }) })).status).toBe(422);
  });

  it('rejects invalid JSON', async () => {
    const res = await call('/X', { method: 'PUT', body: 'not json' });
    expect(res.status).toBe(400);
  });

  it('surfaces a database failure instead of reporting success', async () => {
    state.error = { message: 'permission denied' };
    const res = await call('/X', { method: 'PUT', body: JSON.stringify({ sellPriceCenti: 1 }) });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: 'save_failed' });
  });
});

describe('DELETE /:itemCode', () => {
  it('removes exactly the named row — the revert path', async () => {
    const res = await call('/UBORR-L(RHF)', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(state.deleted).toBe(true);
    expect(state.lastDeleteEq).toContainEqual(['item_code', 'UBORR-L(RHF)']);
  });
});
