import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';

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

describe('GET /pos/sales-staff', () => {
  it('returns active sales staff, no PII fields', async () => {
    adminFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            not: () => ({
              order: async () => ({
                data: [
                  { id: 'u1', staff_code: 'AW', name: 'Aisha', initials: 'AW', color: '#E86B3A', email: 'aw+pos@2990s.local', pin_hash: 'hash', role: 'sales', active: true, showroom_id: 'kl' },
                  { id: 'u2', staff_code: 'JM', name: 'Jaime',  initials: 'JM', color: '#A6471E', email: 'jm+pos@2990s.local', pin_hash: 'hash', role: 'sales', active: true, showroom_id: 'kl' },
                ],
                error: null,
              }),
            }),
          }),
        }),
      }),
    }));
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
    adminFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            not: () => ({ order: async () => ({ data: [], error: null }) }),
          }),
        }),
      }),
    }));
    const app = buildApp();
    const res = await app.request('/pos/sales-staff', {}, baseEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
