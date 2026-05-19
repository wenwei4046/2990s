import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';
import { hashPin } from '../lib/bcrypt';

vi.mock('../middleware/auth', () => ({
  supabaseAuth: async (_c: any, next: any) => { await next(); },
}));

const createUserMock = vi.fn();
const generateLinkMock = vi.fn();
const adminFromMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { admin: { createUser: createUserMock, generateLink: generateLinkMock } },
    from: adminFromMock,
  }),
}));

import { pos, __resetRateLimiter } from './pos';

const baseEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGINS: '*',
  R2_BUCKET_NAME: 't', R2_ENDPOINT: 'r2',
  R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's',
  SLIPS: {} as any,
} as unknown as Env;

function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/pos', pos);
  return app;
}

beforeEach(() => {
  generateLinkMock.mockReset();
  adminFromMock.mockReset();
  __resetRateLimiter();
});

// Chainable mock — each builder method returns the same object so the route's
// conditional `.eq('showroom_id')` works whether or not it's called.
function chainable(rows: any[], error: any = null) {
  const obj: any = {};
  obj.select = () => obj;
  obj.eq = () => obj;
  obj.not = () => obj;
  obj.order = async () => ({ data: rows, error });
  return obj;
}

describe('GET /pos/sales-staff', () => {
  it('returns active sales staff, no PII fields', async () => {
    adminFromMock.mockImplementation(() => chainable([
      { id: 'u1', staff_code: 'AW', name: 'Aisha', initials: 'AW', color: '#E86B3A' },
      { id: 'u2', staff_code: 'JM', name: 'Jaime',  initials: 'JM', color: '#A6471E' },
    ]));
    const app = buildApp();
    const res = await app.request('/pos/sales-staff?showroomId=kl', {}, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({ id: 'u1', staffCode: 'AW', name: 'Aisha', initials: 'AW', color: '#E86B3A' });
    expect(body[0]).not.toHaveProperty('email');
    expect(body[0]).not.toHaveProperty('pin_hash');
    expect(body[0]).not.toHaveProperty('phone');
  });

  it('returns 200 [] when no staff', async () => {
    adminFromMock.mockImplementation(() => chainable([]));
    const app = buildApp();
    const res = await app.request('/pos/sales-staff', {}, baseEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

const STAFF_ID = '11111111-1111-1111-1111-111111111111';

async function mockStaffLookup(opts: {
  pinHash: string | null;
  role?: string;
  active?: boolean;
  email?: string;
} | null) {
  adminFromMock.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: opts ? {
            id: STAFF_ID, role: opts.role ?? 'sales', active: opts.active ?? true,
            pin_hash: opts.pinHash, email: opts.email ?? 'aw+pos@2990s.local',
          } : null,
          error: null,
        }),
      }),
    }),
  }));
}

describe('POST /pos/pin-login', () => {
  it('valid PIN → 200 { tokenHash, email }', async () => {
    const hash = await hashPin('482917');
    await mockStaffLookup({ pinHash: hash });
    generateLinkMock.mockResolvedValue({
      data: { properties: { hashed_token: 'tok-abc' } },
      error: null,
    });
    const app = buildApp();
    const res = await app.request('/pos/pin-login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staffId: STAFF_ID, pin: '482917' }),
    }, baseEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tokenHash: 'tok-abc', email: 'aw+pos@2990s.local' });
  });

  it('wrong PIN → 401 invalid_pin with remainingAttempts', async () => {
    const hash = await hashPin('482917');
    await mockStaffLookup({ pinHash: hash });
    const app = buildApp();
    const res = await app.request('/pos/pin-login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staffId: STAFF_ID, pin: '000000' }),
    }, baseEnv);
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toBe('invalid_pin');
    expect(body.remainingAttempts).toBe(4);
  });

  it('5 wrong PINs → 6th call 429 too_many_attempts', async () => {
    const hash = await hashPin('482917');
    await mockStaffLookup({ pinHash: hash });
    const app = buildApp();
    for (let i = 0; i < 5; i++) {
      const r = await app.request('/pos/pin-login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ staffId: STAFF_ID, pin: '000000' }),
      }, baseEnv);
      expect(r.status).toBe(401);
    }
    const final = await app.request('/pos/pin-login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staffId: STAFF_ID, pin: '482917' }),
    }, baseEnv);
    expect(final.status).toBe(429);
    const body = await final.json() as any;
    expect(body.error).toBe('too_many_attempts');
    expect(typeof body.retryAfter).toBe('number');
  });

  it('inactive staff → 401 staff_not_loginnable', async () => {
    const hash = await hashPin('482917');
    await mockStaffLookup({ pinHash: hash, active: false });
    const app = buildApp();
    const res = await app.request('/pos/pin-login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staffId: STAFF_ID, pin: '482917' }),
    }, baseEnv);
    expect(res.status).toBe(401);
    expect((await res.json() as any).error).toBe('staff_not_loginnable');
  });

  it('non-sales role → 401 staff_not_loginnable', async () => {
    const hash = await hashPin('482917');
    await mockStaffLookup({ pinHash: hash, role: 'coordinator' });
    const app = buildApp();
    const res = await app.request('/pos/pin-login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staffId: STAFF_ID, pin: '482917' }),
    }, baseEnv);
    expect(res.status).toBe(401);
    expect((await res.json() as any).error).toBe('staff_not_loginnable');
  });

  it('pin_hash null → 401 staff_not_loginnable', async () => {
    await mockStaffLookup({ pinHash: null });
    const app = buildApp();
    const res = await app.request('/pos/pin-login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staffId: STAFF_ID, pin: '482917' }),
    }, baseEnv);
    expect(res.status).toBe(401);
    expect((await res.json() as any).error).toBe('staff_not_loginnable');
  });

  it('malformed body → 400', async () => {
    const app = buildApp();
    const res = await app.request('/pos/pin-login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staffId: 'not-uuid', pin: '12' }),
    }, baseEnv);
    expect(res.status).toBe(400);
  });
});
