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
  orFilter: null as string | null,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const own = () => state.tables[table] ?? {};
      const pick = <K extends keyof Answer>(k: K, shared: unknown) => (k in own() ? own()[k] : shared);
      const obj: any = {};
      for (const m of ['select', 'order', 'eq', 'is', 'in', 'delete']) obj[m] = () => obj;
      obj.or = (f: string) => { state.orFilter = f; return obj; };
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
  state.orFilter = null;
});

/** A 1×1 PNG, base64 — small enough for any size check. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** A sofa request with everything saving needs since 0219. */
const SOFA = {
  type: 'sofa', status: 'pending', venueId: '107', action: 'add', supplierCode: 'SL-2207',
  lengthCm: 220, widthCm: 95, sofaCategory: 'Seater', sofaFunction: 'Push back',
  photoMatch: 'exact', photo: { contentType: 'image/png', dataB64: PNG, fileName: 'sofa.png' },
};
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
    expect(await res.json()).toEqual({ showrooms: [], displays: [], requests: [], floorplans: [], sofaOptions: [] });
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
    const request = await app().request('/marketing/requests', json('POST', { ...SOFA, venueId: 'gone' }), env);
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

  it('stamps the caller on a new display, and an ordinary add is not NEW', async () => {
    meAnswers(MARKETING);
    state.single = { id: 'd1', venue_id: '107', type: 'mattress', name: 'AKKA-FIRM', modules: [], qty: 1, is_new: false };
    const res = await app().request('/marketing/displays', json('POST', { venueId: '107', type: 'mattress', name: 'AKKA-FIRM', size: 'King', height: '12', isNew: true }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({
      venue_id: '107', type: 'mattress', size: 'King', height: '12', is_new: false, source_request_id: null,
      created_by: '41', created_by_name: 'Marketing',
    });
  });

  /* Duplicate (owner 2026-10-10): a copy of a new product. */
  const RID = '6f1f6c1e-0000-4000-8000-0000000000a1';
  const COPY = {
    venueId: '107', type: 'sofa', modelId: null, name: 'Untitled sofa', code: 'SL-2207', modules: ['2A(LHF)', 'L(RHF)'],
    lengthCm: 280, widthCm: 160, sofaCategory: 'Seater', sofaFunction: 'Push back', sourceRequestId: RID,
  };

  it('brings a new product’s size, category, function and request with a copy — and NEW', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_launch_requests = { maybe: { id: RID, type: 'sofa' } };
    state.single = { id: 'd4', venue_id: '107', type: 'sofa', name: 'Untitled sofa', modules: COPY.modules, qty: 1, is_new: true, source_request_id: RID };
    const res = await app().request('/marketing/displays', json('POST', COPY), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({
      model_id: null, code: 'SL-2207', is_new: true, source_request_id: RID,
      length_cm: 280, width_cm: 160, sofa_category: 'Seater', sofa_function: 'Push back',
    });
    expect((await res.json() as { display: { sourceRequestId: unknown } }).display.sourceRequestId).toBe(RID);
  });

  it('refuses a copy naming a request that is not on record, or not of its kind', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_launch_requests = { maybe: null };
    const gone = await app().request('/marketing/displays', json('POST', COPY), env);
    expect(gone.status).toBe(409);
    expect(await gone.json()).toEqual({ error: 'unknown_request', reason: 'The launch request this is copied from is not on record.' });
    state.tables.marketing_launch_requests = { maybe: { id: RID, type: 'mattress' } };
    const other = await app().request('/marketing/displays', json('POST', COPY), env);
    expect(other.status).toBe(409);
    expect(state.inserted).toBeNull();
  });

  it('keeps a sofa’s size, category and function off any other piece', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_launch_requests = { maybe: { id: RID, type: 'mattress' } };
    state.single = { id: 'd5', venue_id: '107', type: 'mattress', name: 'ARRUS-PLUS', modules: [], qty: 1, is_new: true };
    const res = await app().request('/marketing/displays', json('POST', { ...COPY, type: 'mattress', name: 'ARRUS-PLUS', modules: [] }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ length_cm: null, width_cm: null, sofa_category: '', sofa_function: '', source_request_id: RID, is_new: true });
  });

  it('keeps a sofa’s layout, and gives a mattress none', async () => {
    meAnswers(MARKETING);
    const layout = [{ moduleId: '1S', x: 240, y: 190, rot: 270 }];
    state.single = { id: 'd2', venue_id: '107', type: 'sofa', name: 'BOOQIT', modules: ['1S'], qty: 1, is_new: false, layout };
    const sofa = await app().request('/marketing/displays', json('POST', { venueId: '107', type: 'sofa', name: 'BOOQIT', modules: ['1S'], layout }), env);
    expect(sofa.status).toBe(201);
    expect(state.inserted).toMatchObject({ layout });
    expect((await sofa.json() as { display: { layout: unknown } }).display.layout).toEqual(layout);
    state.single = { id: 'd3', venue_id: '107', type: 'mattress', name: 'AKKA', modules: [], qty: 1, is_new: false };
    await app().request('/marketing/displays', json('POST', { venueId: '107', type: 'mattress', name: 'AKKA', layout }), env);
    expect(state.inserted).toMatchObject({ layout: null });
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
  const base = SOFA;
  const RID = '6f1f6c1e-0000-4000-8000-000000000004';

  it('needs the showroom and Add / Replace to save at all', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/requests', json('POST', { type: 'sofa', status: 'pending' }), env);
    expect(res.status).toBe(400);
  });

  it('saves a pending sofa and snapshots who asked', async () => {
    meAnswers(MARKETING);
    state.single = { id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [] };
    const res = await app().request('/marketing/requests', json('POST', base), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ requested_by: '41', requested_by_name: 'Marketing', requested_by_role: 'Marketing', completed_at: null });
  });

  /* Owner 2026-10-09: these are needed to SAVE, not only to Complete. */
  it('will not save a sofa without its supplier code, size, category, function and photo', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/requests', json('POST', { type: 'sofa', status: 'pending', venueId: '107', action: 'add' }), env);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; missing: string[]; reason: string };
    expect(body.error).toBe('missing_fields');
    expect(body.missing).toEqual(['Supplier code', 'Sofa size', 'Category', 'Function', 'Photo']);
    expect(body.reason).toBe('Fill in Supplier code, Sofa size, Category, Function and Photo before saving. If the form does not show them, reload the POS.');
    expect(state.inserted).toBeNull();
  });

  it('wants the photo marked Exact or Non-exact, and a Non-exact one explained', async () => {
    meAnswers(MARKETING);
    const unmarked = await app().request('/marketing/requests', json('POST', { ...base, photoMatch: '' }), env);
    expect((await unmarked.json() as { missing: string[] }).missing).toEqual(['Exact / Non-exact']);
    const unexplained = await app().request('/marketing/requests', json('POST', { ...base, photoMatch: 'non_exact', photoNote: '  ' }), env);
    expect((await unexplained.json() as { missing: string[] }).missing).toEqual(['Photo note']);
    expect(state.inserted).toBeNull();
  });

  it('needs only the supplier code on a mattress or bed frame', async () => {
    meAnswers(MARKETING);
    const bare = await app().request('/marketing/requests', json('POST', { type: 'mattress', status: 'pending', venueId: '107', action: 'add' }), env);
    expect((await bare.json() as { missing: string[] }).missing).toEqual(['Supplier code']);
    state.single = { id: 'r2', type: 'bedframe', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [] };
    const ok = await app().request('/marketing/requests', json('POST', { type: 'bedframe', status: 'pending', venueId: '107', action: 'add', supplierCode: 'BF-9' }), env);
    expect(ok.status).toBe(201);
  });

  it('writes the size, category, function and photo with the request in one insert', async () => {
    meAnswers(MARKETING);
    state.single = { id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [] };
    const res = await app().request('/marketing/requests', json('POST', { ...base, photoNote: 'kept only for Non-exact' }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({
      length_cm: 220, width_cm: 95, sofa_category: 'Seater', sofa_function: 'Push back',
      photo_match: 'exact', photo_note: '', photo_content_type: 'image/png', photo_b64: PNG, photo_file_name: 'sofa.png',
    });
    expect(state.inserted?.photo_bytes).toBeGreaterThan(0);
    expect(typeof state.inserted?.photo_updated_at).toBe('string');
  });

  it('refuses a size in anything but whole centimetres', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/requests', json('POST', { ...base, lengthCm: 220.5 }), env);
    expect(res.status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it('never puts the photo itself on the wire of a request', async () => {
    meAnswers(MARKETING);
    state.single = {
      id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [],
      photo_b64: PNG, photo_updated_at: '2026-10-09T03:00:00.000Z', photo_match: 'exact', length_cm: 220, width_cm: 95,
    };
    const res = await app().request('/marketing/requests', json('POST', base), env);
    const body = await res.json() as { request: Record<string, unknown> };
    expect(JSON.stringify(body)).not.toContain(PNG);
    expect(body.request).toMatchObject({ photoAt: '2026-10-09T03:00:00.000Z', photoMatch: 'exact', lengthCm: 220, widthCm: 95 });
  });

  it('keeps the saved photo on an edit that sends none', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_launch_requests = {
      maybe: { id: RID, type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [], photo_updated_at: '2026-10-09T03:00:00.000Z' },
    };
    const noPhoto = { ...base, photo: undefined }; // JSON drops it: no photo sent
    const res = await app().request(`/marketing/requests/${RID}`, json('PUT', noPhoto), env);
    expect(res.status).toBe(200);
    expect(state.updated).not.toHaveProperty('photo_b64');
    expect(state.updated).toMatchObject({ length_cm: 220, sofa_function: 'Push back' });
  });

  it('will not save an edit of a sofa that has no photo and sends none', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_launch_requests = { maybe: { id: RID, photo_updated_at: null } };
    const noPhoto = { ...base, photo: undefined }; // JSON drops it: no photo sent
    const res = await app().request(`/marketing/requests/${RID}`, json('PUT', noPhoto), env);
    expect(res.status).toBe(400);
    expect((await res.json() as { missing: string[] }).missing).toEqual(['Photo']);
    expect(state.updated).toBeNull();
  });

  it('404s an edit of a request that has left the board', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_launch_requests = { maybe: null };
    const res = await app().request(`/marketing/requests/${RID}`, json('PUT', base), env);
    expect(res.status).toBe(404);
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
    expect(body.request.rows).toEqual([{ modules: ['2A(LHF)'], price: null, layout: null }]);
  });

  /* 0220: the sofa as laid out on the Custom build canvas. */
  const LAYOUT = [
    { id: 'c1', moduleId: '2A(LHF)', x: 152.5, y: 192.5, rot: 90 },
    { id: 'c2', moduleId: 'L(RHF)', x: 152.5, y: 337.5, rot: 180 },
  ];

  it('stores the layout, and each combo’s, as laid out', async () => {
    meAnswers(MARKETING);
    state.single = { id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [] };
    const res = await app().request('/marketing/requests', json('POST', {
      ...base, modules: ['2A(LHF)', 'L(RHF)'], layout: LAYOUT,
      rows: [{ modules: ['2A(LHF)', 'L(RHF)'], price: 3540, layout: LAYOUT }],
    }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ layout: LAYOUT, combo_rows: [{ modules: ['2A(LHF)', 'L(RHF)'], price: 3540, layout: LAYOUT }] });
  });

  it('refuses a layout cell turned anything but a quarter turn', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/requests', json('POST', {
      ...base, layout: [{ moduleId: '2A(LHF)', x: 0, y: 0, rot: 45 }],
    }), env);
    expect(res.status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it('reads a layout back, dropping a malformed cell and keeping none as null', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_launch_requests = {
      list: [
        { id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [], layout: [...LAYOUT, { moduleId: '', x: 'x', rot: 7 }] },
        { id: 'r2', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: ['1S'], layout: null },
      ],
    };
    const res = await app().request('/marketing/state', { headers: auth }, env);
    const body = await res.json() as { requests: Array<{ id: string; layout: unknown }> };
    expect(body.requests.map((r) => r.layout)).toEqual([LAYOUT, null]);
  });

  it('serves a request photo with its Exact / Non-exact note, or null', async () => {
    meAnswers(MARKETING);
    state.maybe = { id: RID, photo_content_type: 'image/png', photo_b64: PNG, photo_file_name: 'sofa.png', photo_updated_at: '2026-10-09T03:00:00.000Z', photo_match: 'non_exact', photo_note: 'Slimmer arms' };
    const res = await app().request(`/marketing/requests/${RID}/photo`, { headers: auth }, env);
    expect(await res.json()).toEqual({
      photo: { dataUrl: `data:image/png;base64,${PNG}`, fileName: 'sofa.png', updatedAt: '2026-10-09T03:00:00.000Z', match: 'non_exact', note: 'Slimmer arms' },
    });
    state.maybe = { id: RID, photo_b64: null };
    const none = await app().request(`/marketing/requests/${RID}/photo`, { headers: auth }, env);
    expect(await none.json()).toEqual({ photo: null });
  });
});

describe('sofa category + function lists', () => {
  const CAT = '6f1f6c1e-0000-4000-8000-0000000000c1';

  it('reads each category with its functions, in the order they were added', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_sofa_options = {
      list: [
        { id: 'f2', kind: 'function', parent_id: 'c1', name: 'Push back', seq: 4, created_by: '41' },
        { id: 'c1', kind: 'category', parent_id: null, name: 'Seater', seq: 1 },
        { id: 'f1', kind: 'function', parent_id: 'c1', name: 'Fixed', seq: 3 },
        { id: 'c2', kind: 'category', parent_id: null, name: 'Chair', seq: 2 },
      ],
    };
    const res = await app().request('/marketing/state', { headers: auth }, env);
    const body = await res.json() as { sofaOptions: unknown };
    expect(body.sofaOptions).toEqual([
      { id: 'c1', name: 'Seater', functions: [{ id: 'f1', name: 'Fixed' }, { id: 'f2', name: 'Push back' }] },
      { id: 'c2', name: 'Chair', functions: [] },
    ]);
  });

  it('adds a category, and a function under a listed one', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_sofa_options = { single: { id: 'c9', kind: 'category', parent_id: null, name: 'Recliner', seq: 9 } };
    const cat = await app().request('/marketing/sofa-options', json('POST', { name: ' Recliner ' }), env);
    expect(cat.status).toBe(201);
    expect(state.inserted).toMatchObject({ kind: 'category', parent_id: null, name: 'Recliner', created_by: '41' });

    state.tables.marketing_sofa_options = {
      maybe: { id: CAT, kind: 'category' },
      single: { id: 'f9', kind: 'function', parent_id: CAT, name: 'Electric', seq: 10 },
    };
    const fn = await app().request('/marketing/sofa-options', json('POST', { name: 'Electric', categoryId: CAT }), env);
    expect(fn.status).toBe(201);
    expect(state.inserted).toMatchObject({ kind: 'function', parent_id: CAT, name: 'Electric' });
    expect(await fn.json()).toEqual({ option: { id: 'f9', kind: 'function', categoryId: CAT, name: 'Electric' } });
  });

  it('files no function under a removed category, or under a function', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_sofa_options = { maybe: null };
    const gone = await app().request('/marketing/sofa-options', json('POST', { name: 'Electric', categoryId: CAT }), env);
    expect(gone.status).toBe(409);
    state.tables.marketing_sofa_options = { maybe: { id: CAT, kind: 'function' } };
    const nested = await app().request('/marketing/sofa-options', json('POST', { name: 'Electric', categoryId: CAT }), env);
    expect(nested.status).toBe(409);
    expect(state.inserted).toBeNull();
  });

  it('says so when a name is already on the list', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_sofa_options = { single: null, error: { message: 'duplicate key value', code: '23505' } };
    const res = await app().request('/marketing/sofa-options', json('POST', { name: 'Seater' }), env);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'duplicate_name', reason: 'There is already a category called Seater.' });
  });

  it('renames one', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_sofa_options = { maybe: { id: CAT, kind: 'category', parent_id: null, name: 'Seaters', seq: 1 } };
    const res = await app().request(`/marketing/sofa-options/${CAT}`, json('PATCH', { name: 'Seaters' }), env);
    expect(res.status).toBe(200);
    expect(state.updated).toMatchObject({ name: 'Seaters', updated_by: '41' });
  });

  it('removes a category together with its functions, by stamping', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_sofa_options = { maybe: { id: CAT, kind: 'category' } };
    const res = await app().request(`/marketing/sofa-options/${CAT}`, { method: 'DELETE', headers: auth }, env);
    expect(res.status).toBe(200);
    expect(state.updated).toMatchObject({ archived_by: '41', archived_by_name: 'Marketing' });
    expect(state.orFilter).toBe(`id.eq.${CAT},parent_id.eq.${CAT}`);
  });

  it('removes a function on its own', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_sofa_options = { maybe: { id: CAT, kind: 'function' } };
    const res = await app().request(`/marketing/sofa-options/${CAT}`, { method: 'DELETE', headers: auth }, env);
    expect(res.status).toBe(200);
    expect(state.orFilter).toBeNull();
  });

  it('keeps a salesperson out of the lists', async () => {
    meAnswers(SALES);
    const res = await app().request('/marketing/sofa-options', json('POST', { name: 'Recliner' }), env);
    expect(res.status).toBe(403);
    expect(state.inserted).toBeNull();
    const whole = await app().request(`/marketing/sofa-categories/${CAT}`, json('PUT', { name: 'Seater', functions: [] }), env);
    expect(whole.status).toBe(403);
    expect(state.lastRpc).toBeNull();
  });

  /* 0221 (owner 2026-10-10): the edit dialog saves a category and its whole
     function list at once. */
  const F1 = '6f1f6c1e-0000-4000-8000-0000000000f1';

  it('saves a category and its whole list in one transaction, as the caller', async () => {
    meAnswers(MARKETING);
    state.rpcResult = CAT;
    state.tables.marketing_sofa_options = {
      list: [
        { id: CAT, kind: 'category', parent_id: null, name: 'Sitter', seq: 1 },
        { id: F1, kind: 'function', parent_id: CAT, name: 'Fixed', seq: 3 },
        { id: 'f9', kind: 'function', parent_id: CAT, name: 'Recliner', seq: 12 },
      ],
    };
    const res = await app().request(`/marketing/sofa-categories/${CAT}`, json('PUT', {
      name: ' Sitter ', functions: [{ id: F1, name: 'Fixed ' }, { name: 'Recliner' }],
    }), env);
    expect(res.status).toBe(200);
    expect(state.lastRpc).toEqual({
      fn: 'marketing_save_sofa_category',
      args: { p_category_id: CAT, p_name: 'Sitter', p_functions: [{ id: F1, name: 'Fixed' }, { name: 'Recliner' }], p_by: '41', p_by_name: 'Marketing' },
    });
    expect(state.orFilter).toBe(`id.eq.${CAT},parent_id.eq.${CAT}`);
    expect(await res.json()).toEqual({
      category: { id: CAT, name: 'Sitter', functions: [{ id: F1, name: 'Fixed' }, { id: 'f9', name: 'Recliner' }] },
    });
  });

  it('adds a category with its functions', async () => {
    meAnswers(MARKETING);
    state.rpcResult = CAT;
    state.tables.marketing_sofa_options = { list: [{ id: CAT, kind: 'category', parent_id: null, name: 'Chaise', seq: 9 }] };
    const res = await app().request('/marketing/sofa-categories', json('POST', { name: 'Chaise', functions: [{ name: 'Fixed' }] }), env);
    expect(res.status).toBe(201);
    expect(state.lastRpc?.args).toMatchObject({ p_category_id: null, p_name: 'Chaise', p_functions: [{ name: 'Fixed' }] });
  });

  it('refuses a function listed twice before writing anything', async () => {
    meAnswers(MARKETING);
    const res = await app().request(`/marketing/sofa-categories/${CAT}`, json('PUT', {
      name: 'Sitter', functions: [{ id: F1, name: 'Fixed' }, { name: 'fixed' }],
    }), env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'duplicate_name', reason: 'fixed is on the list twice.' });
    expect(state.lastRpc).toBeNull();
  });

  it('says what the transaction refused', async () => {
    meAnswers(MARKETING);
    const put = () => app().request(`/marketing/sofa-categories/${CAT}`, json('PUT', { name: 'Chair', functions: [] }), env);
    state.rpcError = { message: 'duplicate_category' };
    let res = await put();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'duplicate_name', reason: 'There is already a category called Chair.' });
    state.rpcError = { message: 'function_not_found' };
    res = await put();
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe('list_changed');
    state.rpcError = { message: 'category_not_found' };
    res = await put();
    expect(res.status).toBe(404);
  });

  it('404s an id that is not one', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/sofa-categories/c1', json('PUT', { name: 'Chair', functions: [] }), env);
    expect(res.status).toBe(404);
    expect(state.lastRpc).toBeNull();
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
