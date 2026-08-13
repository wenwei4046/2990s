import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';

/* These routes are Origin-gated instead of authenticated — the POS holds only a
   Houzs token since the cutover and cannot pass 2990's supabaseAuth. The gate
   is therefore the ONLY door, so it gets pinned here first. */

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  rpcResult: null as unknown,
  rpcError: null as { message: string } | null,
  updateResult: null as Record<string, unknown> | null,
  updateError: null as { message: string } | null,
  lastRpc: null as { fn: string; args: Record<string, unknown> } | null,
  lastEq: [] as Array<[string, unknown]>,
  lastUpdate: null as Record<string, unknown> | null,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const obj: any = {};
      obj.select = () => obj;
      obj.order = () => obj;
      obj.limit = () => obj;
      obj.insert = () => obj;
      obj.update = (payload: Record<string, unknown>) => { state.lastUpdate = payload; return obj; };
      obj.eq = (col: string, val: unknown) => { state.lastEq.push([col, val]); return obj; };
      obj.maybeSingle = async () => ({ data: state.updateResult, error: state.updateError });
      obj.then = (resolve: any) => resolve({ data: state.rows, error: null });
      return obj;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.lastRpc = { fn, args };
      return { data: state.rpcResult, error: state.rpcError };
    },
  }),
}));

import { campaignPromos } from './campaign-promos';

const ORIGIN = 'https://pos.2990shome.com';
const env = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGINS: `${ORIGIN},https://erp.2990shome.com`,
} as unknown as Env;

const app = () => {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.route('/campaign-promos', campaignPromos);
  return a;
};
const from = { headers: { origin: ORIGIN } };
const post = (body: unknown) => ({
  method: 'POST',
  headers: { origin: ORIGIN, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  state.rows = [];
  state.rpcResult = null;
  state.rpcError = null;
  state.updateResult = null;
  state.updateError = null;
  state.lastRpc = null;
  state.lastEq = [];
  state.lastUpdate = null;
});

describe('origin gate', () => {
  it('refuses a request with no Origin at all', async () => {
    const res = await app().request('/campaign-promos', {}, env);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', reason: 'origin_not_allowed' });
  });

  it('refuses an Origin that is not allow-listed', async () => {
    const res = await app().request('/campaign-promos', { headers: { origin: 'https://evil.example' } }, env);
    expect(res.status).toBe(403);
  });

  it('allows an allow-listed Origin', async () => {
    const res = await app().request('/campaign-promos', from, env);
    expect(res.status).toBe(200);
  });

  it('gates writes too, not just reads', async () => {
    const res = await app().request('/campaign-promos', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }, env);
    expect(res.status).toBe(403);
  });
});

describe('GET /campaign-promos', () => {
  it('derives `remaining` so callers never do the subtraction themselves', async () => {
    state.rows = [{ id: 'c1', name: 'RM 500 Home Voucher', value_centi: 50_000, stock_total: 2, stock_used: 1 }];
    const res = await app().request('/campaign-promos', from, env);
    const body = (await res.json()) as { campaigns: Array<Record<string, unknown>> };
    expect(body.campaigns[0]).toMatchObject({ valueCenti: 50_000, stockTotal: 2, stockUsed: 1, remaining: 1 });
  });

  it('never leaks a column that is not on the whitelist', async () => {
    // service-role bypasses RLS, so toWire() is the only thing between this
    // table and the internet.
    state.rows = [{ id: 'c1', name: 'V', value_centi: 1, secret_internal_note: 'do not ship' }];
    const res = await app().request('/campaign-promos', from, env);
    const body = (await res.json()) as { campaigns: Array<Record<string, unknown>> };
    expect(body.campaigns[0]).not.toHaveProperty('secret_internal_note');
  });
});

describe('POST /campaign-promos', () => {
  it('rejects a zero or negative face value', async () => {
    const res = await app().request('/campaign-promos', post({ name: 'V', valueCenti: 0, stockTotal: 5 }), env);
    expect(res.status).toBe(422);
    expect((await res.json() as { error: string }).error).toBe('invalid_body');
  });

  it('rejects a nameless campaign', async () => {
    const res = await app().request('/campaign-promos', post({ name: '', valueCenti: 50_000, stockTotal: 2 }), env);
    expect(res.status).toBe(422);
  });
});

describe('PATCH /campaign-promos/:id', () => {
  it('reports a stock cut below what has already gone out as a conflict, not a crash', async () => {
    state.updateError = { message: 'new row violates check constraint "campaign_promos_stock_sane"' };
    const res = await app().request('/campaign-promos/c1', {
      method: 'PATCH', headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ stockTotal: 1 }),
    }, env);
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe('stock_below_used');
  });
});

describe('POST /:id/claim', () => {
  it('returns the reservation and the terms in force at claim time', async () => {
    state.rpcResult = { id: 'r1', applied_centi: 50_000, terms_snapshot: 'T&C v3' };
    const res = await app().request('/campaign-promos/c1/claim', post({ appliedCenti: 50_000 }), env);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ redemptionId: 'r1', appliedCenti: 50_000, termsSnapshot: 'T&C v3' });
    expect(state.lastRpc?.fn).toBe('claim_campaign_promo');
  });

  it('refuses with 409 when the campaign is sold out or inactive', async () => {
    // The DB function raises this when the atomic UPDATE matches no row —
    // callers MUST treat it as a refusal and not apply any discount.
    state.rpcError = { message: 'campaign_unavailable' };
    const res = await app().request('/campaign-promos/c1/claim', post({ appliedCenti: 50_000 }), env);
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe('campaign_unavailable');
  });

  it('never sends a negative applied amount to the database', async () => {
    state.rpcResult = { id: 'r1', applied_centi: 0, terms_snapshot: '' };
    await app().request('/campaign-promos/c1/claim', post({ appliedCenti: -999 }), env);
    expect(state.lastRpc?.args.p_applied_centi).toBe(0);
  });
});

describe('POST /redemptions/:id/confirm', () => {
  it('requires the Houzs doc number', async () => {
    const res = await app().request('/campaign-promos/redemptions/r1/confirm', post({}), env);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('so_doc_no_required');
  });

  it('only promotes a RESERVED row, so a RELEASED claim cannot be resurrected', async () => {
    state.updateResult = { id: 'r1' };
    await app().request('/campaign-promos/redemptions/r1/confirm', post({ soDocNo: 'SO-2608-001' }), env);
    expect(state.lastEq).toContainEqual(['status', 'RESERVED']);
  });

  it('cannot move applied_centi — the cap is enforced once, at claim time', async () => {
    // claim_campaign_promo() clamps to the campaign's value_centi. If confirm
    // could rewrite the amount there would be a second, uncapped door, and no
    // campaign row in hand here to check against.
    state.updateResult = { id: 'r1' };
    await app().request(
      '/campaign-promos/redemptions/r1/confirm',
      post({ soDocNo: 'SO-2608-001', appliedCenti: 99_999_999 }),
      env,
    );
    expect(state.lastUpdate).not.toHaveProperty('applied_centi');
    expect(state.lastUpdate).toMatchObject({ status: 'APPLIED', so_doc_no: 'SO-2608-001' });
  });

  it('conflicts when the row was already confirmed or released', async () => {
    state.updateResult = null;
    const res = await app().request('/campaign-promos/redemptions/r1/confirm', post({ soDocNo: 'SO-2608-001' }), env);
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe('not_reserved');
  });
});

describe('POST /redemptions/:id/release', () => {
  it('reports ok:false when the row was already released, so stock is not refunded twice', async () => {
    state.rpcResult = false;
    const res = await app().request('/campaign-promos/redemptions/r1/release', post({ reason: 'order failed' }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
  });

  it('reports ok:true on a genuine release', async () => {
    state.rpcResult = true;
    const res = await app().request('/campaign-promos/redemptions/r1/release', post({ reason: 'cancelled' }), env);
    expect(await res.json()).toEqual({ ok: true });
  });
});
