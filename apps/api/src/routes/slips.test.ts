import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { slipRoutes } from './slips';
import type { Env, Variables } from '../env';

const baseEnv = {
  SLIPS: { put: vi.fn(), head: vi.fn(), delete: vi.fn() },
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_ENDPOINT: 'https://test.r2.cloudflarestorage.com',
  R2_BUCKET_NAME: '2990s-slips',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  ALLOWED_ORIGINS: '*',
} as unknown as Env;

const STAFF_ID = '11111111-1111-1111-1111-111111111111';

function makeApp(supabaseMock: any, env: Env = baseEnv) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  // Strip the auth middleware by intercepting before slipRoutes mounts.
  // We can't easily replace middleware on an existing Hono router, so we
  // mount fresh handlers that mirror slipRoutes' logic. Instead we bypass
  // by setting context keys + skipping auth via a wrapper app.
  app.use('*', async (c, next) => {
    c.set('user', { id: STAFF_ID } as any);
    c.set('supabase', supabaseMock);
    // Skip slipRoutes's own auth middleware by going directly to the route
    // handler functions. To do this we re-define them inline. But for test
    // simplicity we use a shim: re-implement supabaseAuth as a no-op in tests.
    await next();
  });
  // Sub-route mount — slipRoutes.use('*', supabaseAuth) will run BEFORE our
  // handlers. To bypass, we pass a request that already includes a fake
  // Authorization header AND we mock the supabase auth check via the
  // outer middleware setting `user` already. Simpler: define a test-only
  // route module. For now, we test the handler logic indirectly by relying
  // on the outer middleware's `user` set short-circuiting the auth.
  app.route('/slips', slipRoutes);
  return app;
}

describe('POST /slips/init', () => {
  let supabase: any;

  beforeEach(() => {
    supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'staff') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { showroom_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', active: true },
              error: null,
            }),
          };
        }
        if (table === 'pending_slip_uploads') {
          return {
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            update: vi.fn().mockReturnThis(),
          };
        }
        return {};
      }),
    };
  });

  it('rejects when fileSize > 5 MB', async () => {
    const app = makeApp(supabase);
    const res = await app.request('/slips/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify({
        fileSize: 6 * 1024 * 1024,
        contentType: 'image/jpeg',
        contentHash: 'a'.repeat(64),
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('invalid_request');
  });

  it('rejects invalid mime', async () => {
    const app = makeApp(supabase);
    const res = await app.request('/slips/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify({
        fileSize: 100,
        contentType: 'text/plain',
        contentHash: 'a'.repeat(64),
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
  });

  it('rejects invalid hash length', async () => {
    const app = makeApp(supabase);
    const res = await app.request('/slips/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify({
        fileSize: 100,
        contentType: 'image/jpeg',
        contentHash: 'a'.repeat(63),
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
  });
});

describe('POST /slips/:session/confirm', () => {
  const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  let supabase: any;
  let updateMock: any;

  function buildPendingSlipUploadsBuilder(rowState: { data: any; error: any }) {
    updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(rowState),
      update: updateMock,
    };
  }

  beforeEach(() => {
    const goodRow = {
      id: sessionId,
      staff_id: STAFF_ID,
      r2_key: 'slips/2026/05/' + sessionId + '.jpg',
      content_hash: 'a'.repeat(64),
      content_size: 1024,
      status: 'pending',
    };
    supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'pending_slip_uploads') {
          return buildPendingSlipUploadsBuilder({ data: goodRow, error: null });
        }
        return {};
      }),
    };
  });

  it('confirms when R2 size matches', async () => {
    const env = { ...baseEnv, SLIPS: { head: vi.fn().mockResolvedValue({ size: 1024, etag: 'e' }), delete: vi.fn() } } as unknown as Env;
    const app = makeApp(supabase, env);
    const res = await app.request(`/slips/${sessionId}/confirm`, {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('uploaded');
  });

  it('returns 404 when R2 has no object', async () => {
    const env = { ...baseEnv, SLIPS: { head: vi.fn().mockResolvedValue(null), delete: vi.fn() } } as unknown as Env;
    const app = makeApp(supabase, env);
    const res = await app.request(`/slips/${sessionId}/confirm`, {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
    }, env);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toBe('file_not_in_r2');
  });

  it('returns 400 hash_mismatch when sizes differ + marks failed + delete R2', async () => {
    const r2Delete = vi.fn().mockResolvedValue(undefined);
    const env = { ...baseEnv, SLIPS: { head: vi.fn().mockResolvedValue({ size: 9999, etag: 'e' }), delete: r2Delete } } as unknown as Env;
    const app = makeApp(supabase, env);
    const res = await app.request(`/slips/${sessionId}/confirm`, {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
    }, env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('hash_mismatch');
    expect(r2Delete).toHaveBeenCalledWith('slips/2026/05/' + sessionId + '.jpg');
  });

  it('returns 403 when caller is not session owner', async () => {
    const goodRow = {
      id: sessionId,
      staff_id: 'other-staff-id',
      r2_key: 'slips/2026/05/x.jpg',
      content_hash: 'a'.repeat(64),
      content_size: 1024,
      status: 'pending',
    };
    supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'pending_slip_uploads') {
        return buildPendingSlipUploadsBuilder({ data: goodRow, error: null });
      }
      return {};
    });
    const app = makeApp(supabase, baseEnv);
    const res = await app.request(`/slips/${sessionId}/confirm`, {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
    }, baseEnv);
    expect(res.status).toBe(403);
  });

  it('returns 409 when status is not pending', async () => {
    const row = {
      id: sessionId,
      staff_id: STAFF_ID,
      r2_key: 'slips/2026/05/x.jpg',
      content_hash: 'a'.repeat(64),
      content_size: 1024,
      status: 'uploaded',
    };
    supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'pending_slip_uploads') {
        return buildPendingSlipUploadsBuilder({ data: row, error: null });
      }
      return {};
    });
    const app = makeApp(supabase, baseEnv);
    const res = await app.request(`/slips/${sessionId}/confirm`, {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
    }, baseEnv);
    expect(res.status).toBe(409);
  });
});
