import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';

/* The gate is the whole security story here: the route runs on the
   service-role client, so a request that passes the gate can write anything
   the schemas allow. Pin who gets through first, then the shapes. */

const state = vi.hoisted(() => ({
  single: null as Record<string, unknown> | null,
  maybe: null as Record<string, unknown> | null,
  list: [] as Record<string, unknown>[],
  error: null as { message: string } | null,
  rpcResult: null as unknown,
  rpcError: null as { message: string } | null,
  inserted: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
  lastRpc: null as { fn: string; args: Record<string, unknown> } | null,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const obj: any = {};
      for (const m of ['select', 'order', 'eq', 'is', 'in', 'delete']) obj[m] = () => obj;
      obj.insert = (p: Record<string, unknown>) => { state.inserted = p; return obj; };
      obj.update = (p: Record<string, unknown>) => { state.updated = p; return obj; };
      obj.upsert = (p: Record<string, unknown>) => { state.inserted = p; return obj; };
      obj.single = async () => ({ data: state.single, error: state.error });
      obj.maybeSingle = async () => ({ data: state.maybe, error: state.error });
      obj.then = (resolve: any) => resolve({ data: state.list, error: state.error });
      return obj;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.lastRpc = { fn, args };
      return { data: state.rpcResult, error: state.rpcError };
    },
  }),
}));

import { marketing, canUseMarketing } from './marketing';

const env = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  HOUZS_API_ROOT: 'https://houzs.test/api',
  HOUZS_COMPANY_ID: '2',
} as unknown as Env;

const app = () => {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.route('/marketing', marketing);
  return a;
};

type MeUser = Record<string, unknown>;
const meAnswers = (user: MeUser | null, status = 200) => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify(user ? { user } : {}), { status })));
};
const MARKETING: MeUser = { id: 41, name: 'Marketing', permissions: [], capabilities: {}, position_name: 'Sales Marketing' };
const SALES: MeUser = { id: 7, name: 'Bernard', permissions: [], capabilities: { 'scm.sales.viewAll': false }, position_name: 'Sales Executive' };

const auth = { authorization: 'Bearer tok' };
const json = (method: string, body: unknown) => ({
  method,
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  state.single = null; state.maybe = null; state.list = []; state.error = null;
  state.rpcResult = null; state.rpcError = null; state.inserted = null; state.updated = null; state.lastRpc = null;
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('canUseMarketing', () => {
  const caller = (over: Partial<Parameters<typeof canUseMarketing>[0]>) => ({
    userId: 1, name: 'x', email: '', permissions: [], capabilities: {}, scmConfigWriter: false, positionName: null, ...over,
  });
  it('admits the marketing account by Houzs capability or Title', () => {
    expect(canUseMarketing(caller({ capabilities: { 'pos.marketing': true } }))).toBe(true);
    expect(canUseMarketing(caller({ positionName: 'Sales Marketing' }))).toBe(true);
  });
  it('admits the Maintain tier', () => {
    expect(canUseMarketing(caller({ permissions: ['*'] }))).toBe(true);
    expect(canUseMarketing(caller({ scmConfigWriter: true }))).toBe(true);
    expect(canUseMarketing(caller({ capabilities: { 'scm.sales.viewAll': true } }))).toBe(true);
  });
  it('refuses a plain salesperson', () => {
    expect(canUseMarketing(caller({ positionName: 'Sales Executive' }))).toBe(false);
  });
});

describe('gate', () => {
  it('401s with no bearer, without asking Houzs', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const res = await app().request('/marketing/state', {}, env);
    expect(res.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it('401s when Houzs does not recognise the session', async () => {
    meAnswers(null, 401);
    const res = await app().request('/marketing/state', { headers: auth }, env);
    expect(res.status).toBe(401);
  });

  it('503s when Houzs is down — an identity check never fails open', async () => {
    meAnswers(null, 502);
    const res = await app().request('/marketing/state', { headers: auth }, env);
    expect(res.status).toBe(503);
  });

  it('403s a salesperson', async () => {
    meAnswers(SALES);
    const res = await app().request('/marketing/state', { headers: auth }, env);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', reason: 'not_marketing' });
  });

  it('lets the marketing account read the board', async () => {
    meAnswers(MARKETING);
    state.list = [];
    const res = await app().request('/marketing/state', { headers: auth }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ displays: [], requests: [], floorplans: [] });
  });
});

describe('displays', () => {
  it('refuses a sofa with no components', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/displays', json('POST', { venueId: '107', type: 'sofa', name: 'AM9036' }), env);
    expect(res.status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it('stamps the caller on a new display and never sets is_new', async () => {
    meAnswers(MARKETING);
    state.single = { id: 'd1', venue_id: '107', type: 'mattress', name: 'AKKA-FIRM', modules: [], qty: 1, is_new: false };
    const res = await app().request('/marketing/displays', json('POST', { venueId: '107', type: 'mattress', name: 'AKKA-FIRM', size: 'King', height: '12' }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ venue_id: '107', type: 'mattress', size: 'King', height: '12', is_new: false, created_by: '41', created_by_name: 'Marketing' });
  });

  it('removes by stamping, not deleting', async () => {
    meAnswers(MARKETING);
    state.maybe = { id: '6f1f6c1e-0000-4000-8000-000000000001' };
    const res = await app().request('/marketing/displays/6f1f6c1e-0000-4000-8000-000000000001', { method: 'DELETE', headers: auth }, env);
    expect(res.status).toBe(200);
    expect(state.updated).toMatchObject({ removed_by: '41', removed_by_name: 'Marketing' });
    expect(typeof state.updated?.removed_at).toBe('string');
  });
});

describe('launch requests', () => {
  const base = { type: 'sofa', status: 'pending', venueId: '107', action: 'add' };

  it('needs the showroom and Add / Replace to save at all', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/requests', json('POST', { type: 'sofa', status: 'pending' }), env);
    expect(res.status).toBe(400);
  });

  it('saves a bare pending request and snapshots who asked', async () => {
    meAnswers(MARKETING);
    state.single = { id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [] };
    const res = await app().request('/marketing/requests', json('POST', base), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ requested_by: '41', requested_by_name: 'Marketing', requested_by_role: 'Marketing', completed_at: null });
  });

  it('will not complete a Replace without the piece it replaces', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/requests', json('POST', { ...base, status: 'completed', action: 'replace' }), env);
    expect(res.status).toBe(409);
  });

  it('refuses to replace a piece from another showroom', async () => {
    meAnswers(MARKETING);
    state.maybe = { id: 'x', venue_id: '999', type: 'sofa', removed_at: null };
    const res = await app().request('/marketing/requests', json('POST', {
      ...base, action: 'replace', replaceId: '6f1f6c1e-0000-4000-8000-000000000002',
    }), env);
    expect(res.status).toBe(409);
  });

  it('keeps an untyped combo price as null, not zero', async () => {
    meAnswers(MARKETING);
    state.single = { id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', modules: [], combo_rows: [{ modules: ['2A(LHF)'], price: null }] };
    const res = await app().request('/marketing/requests', json('POST', { ...base, rows: [{ modules: ['2A(LHF)'], price: null }] }), env);
    const body = await res.json() as { request: { rows: unknown[] } };
    expect(body.request.rows).toEqual([{ modules: ['2A(LHF)'], price: null }]);
  });
});

describe('arrive', () => {
  it('runs the one-transaction function with the caller', async () => {
    meAnswers(MARKETING);
    state.rpcResult = { displayId: 'd9', removedName: '5531' };
    const res = await app().request('/marketing/requests/6f1f6c1e-0000-4000-8000-000000000003/arrive', { method: 'POST', headers: auth }, env);
    expect(res.status).toBe(200);
    expect(state.lastRpc).toEqual({ fn: 'marketing_arrive_launch_request', args: { p_request_id: '6f1f6c1e-0000-4000-8000-000000000003', p_by: '41', p_by_name: 'Marketing' } });
    expect(await res.json()).toEqual({ displayId: 'd9', removedName: '5531' });
  });

  it('409s a request that is not in Completed Info', async () => {
    meAnswers(MARKETING);
    state.rpcError = { message: 'request_not_completed' };
    const res = await app().request('/marketing/requests/6f1f6c1e-0000-4000-8000-000000000003/arrive', { method: 'POST', headers: auth }, env);
    expect(res.status).toBe(409);
  });
});
