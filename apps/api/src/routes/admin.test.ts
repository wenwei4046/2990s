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

describe('POST /admin/staff — sales role with PIN', () => {
  it('hashes the PIN, calls createUser, inserts staff with pin_hash, returns 201', async () => {
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
        initials: 'AW', color: '#E86B3A', pin: '482917',
      }),
    }, baseEnv);

    expect(res.status).toBe(201);
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(inviteByEmailMock).not.toHaveBeenCalled();
    const createUserArg = createUserMock.mock.calls[0][0];
    expect(createUserArg.email).toBe('aw+pos@2990s.local');
    expect(createUserArg.email_confirm).toBe(true);
    expect(typeof createUserArg.password).toBe('string');
    expect(insertedRow.pin_hash).toBeTypeOf('string');
    expect(insertedRow.pin_hash.length).toBeGreaterThan(20);
  });

  it('uses supplied email instead of synthesizing when present', async () => {
    createUserMock.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
    adminFromMock.mockImplementation(() => ({
      insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'u-1' }, error: null }) }) }),
    }));
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'AW', name: 'Aisha', role: 'sales',
        email: 'aisha@2990s.my', initials: 'AW', color: '#E86B3A', pin: '482917',
      }),
    }, baseEnv);
    expect(res.status).toBe(201);
    expect(createUserMock.mock.calls[0][0].email).toBe('aisha@2990s.my');
  });

  it('rejects sales role without PIN (422 pin_required_for_sales)', async () => {
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'AW', name: 'Aisha', role: 'sales',
        email: 'a@b.c', initials: 'AW', color: '#E86B3A',
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('pin');
  });

  it('non-sales role still uses inviteUserByEmail (unchanged path)', async () => {
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
        initials: 'AW', color: '#E86B3A', pin: '111111',
      }),
    }, baseEnv);
    expect(res.status).toBe(422);
    expect(deleteUserMock).toHaveBeenCalledWith('u-rb');
  });

  it('rejects non-sales role WITH pin (400 pin_forbidden_for_non_sales)', async () => {
    const app = buildApp('admin');
    const res = await app.request('/admin/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffCode: 'ML', name: 'Mei Lin', role: 'coordinator',
        email: 'ml@2990s.my', initials: 'ML', color: '#2F5D4F', pin: '111111',
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('pin_forbidden_for_non_sales');
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
        initials: 'AW', color: '#E86B3A', pin: '111111',
      }),
    }, baseEnv);
    expect(res.status).toBe(422);
    expect(deleteUserMock).toHaveBeenCalledWith('u-throw');
  });
});
