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
const SHOWROOM_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

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
        showroomId: SHOWROOM_ID,
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

  it('password role (coordinator) → createUser with password + bcrypt My-orders pin_hash (2026-06-18)', async () => {
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
        email: 'ml@2990s.my', initials: 'ML', color: '#2F5D4F',
        password: 'sup3rsecret', pin: '654321',
      }),
    }, baseEnv);
    expect(res.status).toBe(201);
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(inviteByEmailMock).not.toHaveBeenCalled();
    expect(createUserMock.mock.calls[0]![0].password).toBe('sup3rsecret');
    // Password roles now carry a "My orders" passcode → bcrypt pin_hash on the row.
    expect(typeof insertedRow.pin_hash).toBe('string');
    expect(insertedRow.pin_hash.length).toBeGreaterThan(20);
  });

  it('sales_executive (passcode role) with a PIN, no staffCode/initials → 201, auto-coded', async () => {
    createUserMock.mockResolvedValue({ data: { user: { id: 'u-se' } }, error: null });
    let insertedRow: any = null;
    adminFromMock.mockImplementation((table: string) => ({
      insert: (row: any) => {
        if (table === 'staff') insertedRow = row;
        return { select: () => ({ maybeSingle: async () => ({ data: { ...row, id: 'u-se' }, error: null }) }) };
      },
    }));
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Kah Wai', role: 'sales_executive',
        email: 'kw@2990s.my', color: '#2F5D4F', pin: '482917',
        showroomId: SHOWROOM_ID,
      }),
    }, baseEnv);
    expect(res.status).toBe(201);
    // Passcode role → bcrypt pin_hash; auto staff_code + initials filled in.
    expect(typeof insertedRow.pin_hash).toBe('string');
    expect(insertedRow.staff_code).toBe('2990S-001');
    expect(insertedRow.initials).toBe('KW');
  });

  it('passcode role without a PIN → 400 (pin_required_for_passcode_role)', async () => {
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
    expect(JSON.stringify(await res.json())).toContain('pin_required_for_passcode_role');
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('password role without a password → 400 (password_required_for_password_role)', async () => {
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'ML', name: 'Mei Lin', role: 'coordinator',
        email: 'ml@b.co', initials: 'ML', color: '#2F5D4F', pin: '654321',
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('password_required_for_password_role');
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('password role without a My-orders passcode → 400 (pin_required_for_password_role)', async () => {
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'ML', name: 'Mei Lin', role: 'coordinator',
        email: 'ml@b.co', initials: 'ML', color: '#2F5D4F', password: 'sup3rsecret',
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('pin_required_for_password_role');
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
        showroomId: SHOWROOM_ID,
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
        showroomId: SHOWROOM_ID,
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

  it('password-login target (coordinator) → 200, sets My-orders pin_hash (block lifted 2026-06-18)', async () => {
    let updatedPatch: any = null;
    adminFromMock.mockImplementation((table: string) => ({
      update: (patch: any) => {
        if (table === 'staff') updatedPatch = patch;
        return {
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: { id: TARGET_ID, role: 'coordinator' }, error: null }),
            }),
          }),
        };
      },
    }));
    const app = buildAppForPin('admin', { role: 'coordinator' });
    const res = await app.request(`/admin/staff/${TARGET_ID}/pin`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: '654321' }),
    }, baseEnv);
    expect(res.status).toBe(200);
    expect(typeof updatedPatch.pin_hash).toBe('string');
    expect(updatedPatch.pin_hash.length).toBeGreaterThan(20);
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

/* BUG-2026-06-03 — a POS-selling role (sales/showroom_lead/sales_executive/
   outlet_manager) onboarded with a NULL showroom can't take payment
   (staff_showroom_missing) or place an order (RLS). Guard it at the source. */
describe('staff showroom guard (create + patch)', () => {
  const TARGET_ID = '33333333-3333-3333-3333-333333333333';

  it('create sales without showroomId → 400 showroom_required_for_pos_role, no auth user created', async () => {
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'NB', name: 'No Booth', role: 'sales',
        email: 'nb@2990s.my', initials: 'NB', color: '#E86B3A', pin: '482917',
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('showroom_required_for_pos_role');
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('create sales_executive without showroomId → 400 (set is broader than just sales)', async () => {
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'SE', name: 'Sales Exec', role: 'sales_executive',
        email: 'se@2990s.my', initials: 'SE', color: '#2F5D4F', password: 'sup3rsecret',
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('showroom_required_for_pos_role');
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('create sales_director without showroomId → 400 (Loo 2026-06-03: gate it too)', async () => {
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'SD', name: 'Sales Dir', role: 'sales_director',
        email: 'sd@2990s.my', initials: 'SD', color: '#2F5D4F', password: 'sup3rsecret',
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('showroom_required_for_pos_role');
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('create coordinator without showroomId → 201 (elevated roles may oversee all)', async () => {
    createUserMock.mockResolvedValue({ data: { user: { id: 'u-co' } }, error: null });
    adminFromMock.mockImplementation((table: string) => ({
      insert: (row: any) => ({
        select: () => ({ maybeSingle: async () => ({ data: { ...row, id: 'u-co' }, error: null }) }),
      }),
    }));
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'CO', name: 'Coord', role: 'coordinator',
        email: 'co@2990s.my', initials: 'CO', color: '#2F5D4F',
        password: 'sup3rsecret', pin: '654321',
      }),
    }, baseEnv);
    expect(res.status).toBe(201);
  });

  // Differentiating builder: caller role for ADMIN_USER_ID, target row for TARGET_ID.
  function buildAppForGuard(callerRole: string, target: { role: string; showroom_id: string | null }) {
    const userScopedFrom = (table: string) => ({
      select: () => ({
        eq: (col: string, val: string) => ({
          maybeSingle: async () => {
            if (table === 'staff' && col === 'id' && val === ADMIN_USER_ID) {
              return { data: { role: callerRole, active: true }, error: null };
            }
            if (table === 'staff' && col === 'id' && val === TARGET_ID) {
              return { data: target, error: null };
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

  function mockUpdateOk() {
    adminFromMock.mockImplementation((table: string) => ({
      update: (patch: any) => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => ({ data: { id: TARGET_ID, ...patch }, error: null }),
          }),
        }),
      }),
    }));
  }

  it('patch: clearing a sales rep\'s showroom to null → 400', async () => {
    const app = buildAppForGuard('admin', { role: 'sales', showroom_id: SHOWROOM_ID });
    const res = await app.request(`/admin/staff/${TARGET_ID}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ showroomId: null }),
    }, baseEnv);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toBe('showroom_required_for_pos_role');
  });

  it('patch: promoting a NULL-showroom coordinator into sales without a showroom → 400', async () => {
    const app = buildAppForGuard('admin', { role: 'coordinator', showroom_id: null });
    const res = await app.request(`/admin/staff/${TARGET_ID}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'sales' }),
    }, baseEnv);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toBe('showroom_required_for_pos_role');
  });

  it('patch: promoting into sales WITH a showroom in the same request → 200', async () => {
    mockUpdateOk();
    const app = buildAppForGuard('admin', { role: 'coordinator', showroom_id: null });
    const res = await app.request(`/admin/staff/${TARGET_ID}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'sales', showroomId: SHOWROOM_ID }),
    }, baseEnv);
    expect(res.status).toBe(200);
  });

  it('patch: editing only the name of a sales rep does not trip the guard → 200', async () => {
    mockUpdateOk();
    const app = buildAppForGuard('admin', { role: 'sales', showroom_id: SHOWROOM_ID });
    const res = await app.request(`/admin/staff/${TARGET_ID}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    }, baseEnv);
    expect(res.status).toBe(200);
  });
});
