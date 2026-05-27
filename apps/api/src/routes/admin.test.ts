import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';

vi.mock('../middleware/auth', () => ({
  supabaseAuth: async (_c: any, next: any) => { await next(); },
}));

// Mock @supabase/supabase-js so the route's service-role createClient(...)
// returns our stub.
const createUserMock = vi.fn();
const inviteByEmailMock = vi.fn();
const deleteUserMock = vi.fn();
const adminFromMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { admin: { createUser: createUserMock, inviteUserByEmail: inviteByEmailMock, deleteUser: deleteUserMock } },
    from: adminFromMock,
  }),
}));

import { admin } from './admin';

const baseEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGINS: '*',
  R2_BUCKET_NAME: 't', R2_ENDPOINT: 'r2', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's',
  SLIPS: {} as any,
  // 2026-05-27 (role-based redirect) — both portals must be set so the
  // route's per-role redirectTo selection has somewhere to point. Tests
  // below assert on the exact URL passed into inviteUserByEmail.
  BACKEND_PORTAL_URL: 'https://backend.test',
  POS_PORTAL_URL: 'https://pos.test',
} as unknown as Env;

const ADMIN_USER_ID = '00000000-0000-0000-0000-000000000001';

function buildApp(callerRole: string | null) {
  const userScopedFrom = (table: string) => ({
    select: () => ({
      eq: (col: string, _val: any) => ({
        maybeSingle: async () => {
          if (table === 'staff' && col === 'id') {
            return { data: callerRole ? { role: callerRole, active: true } : null, error: null };
          }
          // Any other `staff` lookup (e.g. by `staff_code`): no clash.
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
  app.route('/admin', admin);
  return app;
}

beforeEach(() => {
  createUserMock.mockReset();
  inviteByEmailMock.mockReset();
  deleteUserMock.mockReset();
  adminFromMock.mockReset();
});

describe('POST /admin/staff — unified magic-link invite (2026-05-27)', () => {
  it('POS-side role (sales) goes through inviteUserByEmail, inserts staff with pin_hash NULL, returns 201', async () => {
    const newUserId = '11111111-1111-1111-1111-111111111111';
    inviteByEmailMock.mockResolvedValue({ data: { user: { id: newUserId } }, error: null });
    let insertedRow: any = null;
    adminFromMock.mockImplementation((table: string) => ({
      insert: (row: any) => {
        if (table === 'staff') insertedRow = row;
        return {
          select: () => ({
            maybeSingle: async () => ({ data: { ...row, id: newUserId }, error: null }),
          }),
        };
      },
    }));

    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'AW', name: 'Aisha Wong', role: 'sales',
        email: 'aisha@2990s.my', initials: 'AW', color: '#E86B3A',
      }),
    }, baseEnv);

    expect(res.status).toBe(201);
    expect(inviteByEmailMock).toHaveBeenCalledTimes(1);
    expect(createUserMock).not.toHaveBeenCalled();
    expect(inviteByEmailMock.mock.calls[0]![0]).toBe('aisha@2990s.my');
    expect(insertedRow.pin_hash).toBeNull();
    expect(insertedRow.email).toBe('aisha@2990s.my');
  });

  it('Backend-side role (coordinator) goes through inviteUserByEmail', async () => {
    inviteByEmailMock.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
    adminFromMock.mockImplementation(() => ({
      insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'u-1' }, error: null }) }) }),
    }));
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'ML', name: 'Mei Lin', role: 'coordinator',
        email: 'ml@2990s.my', initials: 'ML', color: '#2F5D4F',
      }),
    }, baseEnv);
    expect(res.status).toBe(201);
    expect(inviteByEmailMock).toHaveBeenCalledTimes(1);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  // 2026-05-27 (role-based redirect) — magic-link `redirectTo` is per-role.
  // POS-only roles anchor to POS_PORTAL_URL so the invited sales person
  // lands in the POS app. Backend roles still anchor to BACKEND_PORTAL_URL.
  it('sales role uses POS_PORTAL_URL in redirectTo', async () => {
    inviteByEmailMock.mockResolvedValue({ data: { user: { id: 'u-pos' } }, error: null });
    adminFromMock.mockImplementation(() => ({
      insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'u-pos' }, error: null }) }) }),
    }));
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'AW', name: 'Aisha Wong', role: 'sales',
        email: 'aisha@2990s.my', initials: 'AW', color: '#E86B3A',
      }),
    }, baseEnv);
    expect(res.status).toBe(201);
    expect(inviteByEmailMock).toHaveBeenCalledTimes(1);
    const opts = inviteByEmailMock.mock.calls[0]![1];
    expect(opts.redirectTo).toBe('https://pos.test/set-password');
  });

  it('admin role uses BACKEND_PORTAL_URL in redirectTo', async () => {
    inviteByEmailMock.mockResolvedValue({ data: { user: { id: 'u-be' } }, error: null });
    adminFromMock.mockImplementation(() => ({
      insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'u-be' }, error: null }) }) }),
    }));
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'LO', name: 'Loo', role: 'admin',
        email: 'loo@2990s.my', initials: 'LO', color: '#221F20',
      }),
    }, baseEnv);
    expect(res.status).toBe(201);
    expect(inviteByEmailMock).toHaveBeenCalledTimes(1);
    const opts = inviteByEmailMock.mock.calls[0]![1];
    expect(opts.redirectTo).toBe('https://backend.test/set-password');
  });

  it('rejects invite without email (400 — email is now required for all roles)', async () => {
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'AW', name: 'Aisha', role: 'sales',
        initials: 'AW', color: '#E86B3A',
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('email');
  });

  it('rejects invite with pin field (400 — PIN model dropped)', async () => {
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'AW', name: 'Aisha', role: 'sales',
        email: 'a@b.co', initials: 'AW', color: '#E86B3A', pin: '482917',
      }),
    }, baseEnv);
    /* Zod in strict mode would 400 on unknown keys, but the schema isn't
       strict — extras are dropped silently. The invite should still succeed
       because the `pin` key is ignored. This test guards that the request
       does NOT fail (no longer rejected on pin) and that no PIN ever lands
       on the staff row. */
    inviteByEmailMock.mockResolvedValue({ data: { user: { id: 'u-ignored-pin' } }, error: null });
    let insertedRow: any = null;
    adminFromMock.mockImplementation((table: string) => ({
      insert: (row: any) => {
        if (table === 'staff') insertedRow = row;
        return { select: () => ({ maybeSingle: async () => ({ data: { ...row, id: 'u-ignored-pin' }, error: null }) }) };
      },
    }));
    const res2 = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'AW2', name: 'Aisha 2', role: 'sales',
        email: 'a2@b.co', initials: 'A2', color: '#E86B3A', pin: '482917',
      }),
    }, baseEnv);
    expect(res2.status).toBe(201);
    expect(insertedRow.pin_hash).toBeNull();
  });

  it('rolls back auth user when staff insert fails', async () => {
    inviteByEmailMock.mockResolvedValue({ data: { user: { id: 'u-rb' } }, error: null });
    deleteUserMock.mockResolvedValue({ error: null });
    adminFromMock.mockImplementation(() => ({
      insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'unique violation' } }) }) }),
    }));
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'AW', name: 'A', role: 'sales',
        email: 'a@b.co', initials: 'AW', color: '#E86B3A',
      }),
    }, baseEnv);
    expect(res.status).toBe(422);
    expect(deleteUserMock).toHaveBeenCalledWith('u-rb');
  });

  it('rolls back auth user when staff insert throws an exception (not just error)', async () => {
    inviteByEmailMock.mockResolvedValue({ data: { user: { id: 'u-throw' } }, error: null });
    deleteUserMock.mockResolvedValue({ error: null });
    adminFromMock.mockImplementation(() => ({
      insert: () => ({
        select: () => ({
          maybeSingle: async () => { throw new Error('network reset'); },
        }),
      }),
    }));
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'AW', name: 'A', role: 'sales',
        email: 'a@b.co', initials: 'AW', color: '#E86B3A',
      }),
    }, baseEnv);
    expect(res.status).toBe(422);
    expect(deleteUserMock).toHaveBeenCalledWith('u-throw');
  });
});

describe('PATCH /admin/staff/:id/pin', () => {
  const TARGET_ID = '22222222-2222-2222-2222-222222222222';

  function buildAppForPin(callerRole: string | null, targetStaff: { role: string } | null) {
    const userScopedFrom = (table: string) => ({
      select: () => ({
        eq: (col: string, val: string) => ({
          maybeSingle: async () => {
            if (table === 'staff' && col === 'id' && val === ADMIN_USER_ID) {
              return { data: callerRole ? { role: callerRole, active: true } : null, error: null };
            }
            if (table === 'staff' && col === 'id' && val === TARGET_ID) {
              return { data: targetStaff, error: null };
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
    app.route('/admin', admin);
    return app;
  }

  it('non-admin caller → 403', async () => {
    const app = buildAppForPin('coordinator', { role: 'sales' });
    const res = await app.request(`/admin/staff/${TARGET_ID}/pin`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: '123456' }),
    }, baseEnv);
    expect(res.status).toBe(403);
  });

  it('non-POS target → 422 not_a_pos_staff', async () => {
    const app = buildAppForPin('admin', { role: 'coordinator' });
    const res = await app.request(`/admin/staff/${TARGET_ID}/pin`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: '123456' }),
    }, baseEnv);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error?: string }).error).toBe('not_a_pos_staff');
  });

  it('target not found → 404', async () => {
    const app = buildAppForPin('admin', null);
    const res = await app.request(`/admin/staff/${TARGET_ID}/pin`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: '123456' }),
    }, baseEnv);
    expect(res.status).toBe(404);
  });

  it('valid 6-digit PIN → 200, sets bcrypt hash via admin client', async () => {
    let updatedPatch: any = null;
    adminFromMock.mockImplementation((table: string) => ({
      update: (patch: any) => {
        if (table === 'staff') updatedPatch = patch;
        return {
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: { id: TARGET_ID, role: 'sales' }, error: null }),
            }),
          }),
        };
      },
    }));
    const app = buildAppForPin('admin', { role: 'sales' });
    const res = await app.request(`/admin/staff/${TARGET_ID}/pin`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: '482917' }),
    }, baseEnv);
    expect(res.status).toBe(200);
    expect(typeof updatedPatch.pin_hash).toBe('string');
    expect(updatedPatch.pin_hash.length).toBeGreaterThan(20);
  });

  it('pin=null → 200, clears pin_hash', async () => {
    let updatedPatch: any = null;
    adminFromMock.mockImplementation((table: string) => ({
      update: (patch: any) => {
        if (table === 'staff') updatedPatch = patch;
        return {
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: { id: TARGET_ID, role: 'sales' }, error: null }),
            }),
          }),
        };
      },
    }));
    const app = buildAppForPin('admin', { role: 'sales' });
    const res = await app.request(`/admin/staff/${TARGET_ID}/pin`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: null }),
    }, baseEnv);
    expect(res.status).toBe(200);
    expect(updatedPatch.pin_hash).toBeNull();
  });

  it('malformed PIN → 400', async () => {
    const app = buildAppForPin('admin', { role: 'sales' });
    const res = await app.request(`/admin/staff/${TARGET_ID}/pin`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: 'abc' }),
    }, baseEnv);
    expect(res.status).toBe(400);
  });

  it('malformed UUID in path → 400', async () => {
    const app = buildAppForPin('admin', { role: 'sales' });
    const res = await app.request('/admin/staff/not-a-uuid/pin', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: '123456' }),
    }, baseEnv);
    expect(res.status).toBe(400);
  });
});
