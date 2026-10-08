import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';

/* The gate is the whole security story here: the route runs on the
   service-role client, so a request that passes the gate can write anything
   the schemas allow. Pin who gets through first, then the shapes. */

type Answer = {
  single?: Record<string, unknown> | null;
  maybe?: Record<string, unknown> | null;
  list?: Record<string, unknown>[];
  count?: number;
  error?: { message: string; code?: string } | null;
};

const state = vi.hoisted(() => ({
  single: null as Record<string, unknown> | null,
  maybe: null as Record<string, unknown> | null,
  list: [] as Record<string, unknown>[],
  error: null as { message: string; code?: string } | null,
  /** Per-table answers; a table not named here gets the shared ones above. */
  tables: {} as Record<string, Answer>,
  rpcResult: null as unknown,
  rpcError: null as { message: string } | null,
  inserted: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
  lastRpc: null as { fn: string; args: Record<string, unknown> } | null,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const own = () => state.tables[table] ?? {};
      const pick = <K extends keyof Answer>(k: K, shared: unknown) => (k in own() ? own()[k] : shared);
      const obj: any = {};
      for (const m of ['select', 'order', 'eq', 'is', 'in', 'delete']) obj[m] = () => obj;
      obj.insert = (p: Record<string, unknown>) => { state.inserted = p; return obj; };
      obj.update = (p: Record<string, unknown>) => { state.updated = p; return obj; };
      obj.upsert = (p: Record<string, unknown>) => { state.inserted = p; return obj; };
      obj.single = async () => ({ data: pick('single', state.single), error: pick('error', state.error) });
      obj.maybeSingle = async () => ({ data: pick('maybe', state.maybe), error: pick('error', state.error) });
      obj.then = (resolve: any) => resolve({ data: pick('list', state.list), error: pick('error', state.error), count: pick('count', 0) });
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
  // Every write files under a showroom; by default it is a listed one.
  state.tables = { marketing_showrooms: { maybe: { id: '107' } } };
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
    expect(await res.json()).toEqual({ showrooms: [], displays: [], requests: [], floorplans: [] });
  });
});

describe('showrooms', () => {
  it('lists the showrooms that are still listed, first in the read', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_showrooms = { list: [{ id: 's1', name: 'Showroom KL', area: 'Kuala Lumpur', created_by: '41' }] };
    const res = await app().request('/marketing/state', { headers: auth }, env);
    const body = await res.json() as { showrooms: unknown[] };
    // Whitelisted: who added it is not on the wire.
    expect(body.showrooms).toEqual([{ id: 's1', name: 'Showroom KL', area: 'Kuala Lumpur' }]);
  });

  it('adds one and stamps who did', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_showrooms = { single: { id: 's9', name: 'Showroom Ipoh', area: 'Ipoh, Perak' } };
    const res = await app().request('/marketing/showrooms', json('POST', { name: '  Showroom Ipoh ', area: 'Ipoh, Perak' }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ name: 'Showroom Ipoh', area: 'Ipoh, Perak', created_by: '41', created_by_name: 'Marketing' });
    expect(await res.json()).toEqual({ showroom: { id: 's9', name: 'Showroom Ipoh', area: 'Ipoh, Perak' } });
  });

  it('needs a name', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/showrooms', json('POST', { name: '   ' }), env);
    expect(res.status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it('says so when the name is taken, rather than failing', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_showrooms = { single: null, error: { message: 'duplicate key value', code: '23505' } };
    const res = await app().request('/marketing/showrooms', json('POST', { name: 'Showroom KL' }), env);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'duplicate_name', reason: 'There is already a showroom called Showroom KL.' });
  });

  it('renames one that is still listed', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_showrooms = { maybe: { id: 's1', name: 'Showroom Kuala Lumpur', area: '' } };
    const res = await app().request('/marketing/showrooms/s1', json('PATCH', { name: 'Showroom Kuala Lumpur' }), env);
    expect(res.status).toBe(200);
    expect(state.updated).toMatchObject({ name: 'Showroom Kuala Lumpur', area: '', updated_by: '41' });
  });

  it('will not remove one that still has pieces on display or open requests', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_displays = { count: 3 };
    state.tables.marketing_launch_requests = { count: 1 };
    const res = await app().request('/marketing/showrooms/s1', { method: 'DELETE', headers: auth }, env);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'showroom_in_use',
      reason: 'This showroom still has 3 pieces on display and 1 open launch request. Clear them first.',
    });
    expect(state.updated).toBeNull();
  });

  it('removes an empty one by stamping, not deleting', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/showrooms/s1', { method: 'DELETE', headers: auth }, env);
    expect(res.status).toBe(200);
    expect(state.updated).toMatchObject({ archived_by: '41', archived_by_name: 'Marketing' });
    expect(typeof state.updated?.archived_at).toBe('string');
  });

  it('files nothing under a showroom that is no longer listed', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_showrooms = { maybe: null };
    const display = await app().request('/marketing/displays', json('POST', { venueId: 'gone', type: 'mattress', name: 'AKKA-FIRM' }), env);
    expect(display.status).toBe(409);
    expect(await display.json()).toEqual({ error: 'unknown_showroom', reason: 'This showroom is no longer on the list.' });
    const request = await app().request('/marketing/requests', json('POST', { type: 'sofa', status: 'pending', venueId: 'gone', action: 'add' }), env);
    expect(request.status).toBe(409);
    const plan = await app().request('/marketing/floorplans/gone', json('PUT', { contentType: 'image/png', dataB64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' }), env);
    expect(plan.status).toBe(409);
    expect(state.inserted).toBeNull();
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
