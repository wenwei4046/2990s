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

describe('POST /admin/staff — role-based admin-set credential (WS2 2026-05-31)', () => {
  it('sales role → createUser (not invite), staff row gets a bcrypt pin_hash, returns 201', async () => {
    const newUserId = '11111111-1111-1111-1111-111111111111';
    createUserMock.mockResolvedValue({ data: { user: { id: newUserId } }, error: null });
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
        email: 'aisha@2990s.my', initials: 'AW', color: '#E86B3A', pin: '482917',
      }),
    }, baseEnv);

    expect(res.status).toBe(201);
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(inviteByEmailMock).not.toHaveBeenCalled();
    expect(createUserMock.mock.calls[0]![0].email).toBe('aisha@2990s.my');
    // Sales log in by PIN — the admin-set PIN is bcrypt-hashed onto the row.
    expect(typeof insertedRow.pin_hash).toBe('string');
    expect(insertedRow.pin_hash.length).toBeGreaterThan(20);
    expect(insertedRow.email).toBe('aisha@2990s.my');
  });

  it('non-sales role (coordinator) → createUser with the admin-set password, pin_hash NULL', async () => {
    createUserMock.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
    let insertedRow: any = null;
    adminFromMock.mockImplementation((table: string) => ({
      insert: (row: any) => {
        if (table === 'staff') insertedRow = row;
        return { select: () => ({ maybeSingle: async () => ({ data: { ...row, id: 'u-1' }, error: null }) }) };
      },
    }));
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'ML', name: 'Mei Lin', role: 'coordinator',
        email: 'ml@2990s.my', initials: 'ML', color: '#2F5D4F', password: 'sup3rsecret',
      }),
    }, baseEnv);
    expect(res.status).toBe(201);
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(inviteByEmailMock).not.toHaveBeenCalled();
    expect(createUserMock.mock.calls[0]![0].password).toBe('sup3rsecret');
    expect(insertedRow.pin_hash).toBeNull();
  });

  it('sales role without a PIN → 400 (pin_required_for_sales)', async () => {
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'AW', name: 'Aisha', role: 'sales',
        email: 'a@b.co', initials: 'AW', color: '#E86B3A',
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('pin_required_for_sales');
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('non-sales role without a password → 400 (password_required_for_non_sales)', async () => {
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'ML', name: 'Mei Lin', role: 'coordinator',
        email: 'ml@b.co', initials: 'ML', color: '#2F5D4F',
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('password_required_for_non_sales');
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('rejects without email (400 — email required for all roles)', async () => {
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'AW', name: 'Aisha', role: 'sales',
        initials: 'AW', color: '#E86B3A', pin: '482917',
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('email');
  });

  it('rolls back auth user when staff insert fails', async () => {
    createUserMock.mockResolvedValue({ data: { user: { id: 'u-rb' } }, error: null });
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
        email: 'a@b.co', initials: 'AW', color: '#E86B3A', pin: '482917',
      }),
    }, baseEnv);
    expect(res.status).toBe(422);
    expect(deleteUserMock).toHaveBeenCalledWith('u-rb');
  });

  it('rolls back auth user when staff insert throws an exception (not just error)', async () => {
    createUserMock.mockResolvedValue({ data: { user: { id: 'u-throw' } }, error: null });
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
        email: 'a@b.co', initials: 'AW', color: '#E86B3A', pin: '482917',
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
