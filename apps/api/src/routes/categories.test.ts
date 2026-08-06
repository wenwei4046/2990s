import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';

/* The 2990s-public R2 bucket is not provisioned, so PUBLIC_ASSETS is typed
   optional and absent at runtime. These tests pin both halves: the routes
   answer 503 when it is unbound, and still work unchanged once it is bound. */

const state = vi.hoisted(() => ({
  role: 'admin' as string | null,
  heroKey: null as string | null,
}));

// Chainable PostgREST stub. `select(...).eq(...).maybeSingle()` resolves to a
// row; `update(...).eq(...)` is awaited directly, hence the `then`.
vi.mock('../middleware/auth', () => ({
  supabaseAuth: async (c: any, next: any) => {
    c.set('user', { id: 'staff-1' });
    c.set('supabase', {
      from: (table: string) => {
        const obj: any = {};
        obj.select = () => obj;
        obj.update = () => obj;
        obj.eq = () => obj;
        obj.maybeSingle = async () =>
          table === 'staff'
            ? { data: state.role === null ? null : { role: state.role } }
            : { data: { hero_image_key: state.heroKey } };
        obj.then = (resolve: any) => resolve({ data: null, error: null });
        return obj;
      },
    });
    await next();
  },
}));

import { categoriesApi } from './categories';

const putMock = vi.fn();
const deleteMock = vi.fn();

const baseEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
} as unknown as Env;

/** Production today: the [[r2_buckets]] block is commented out. */
const unboundEnv = baseEnv;
const boundEnv = { ...baseEnv, PUBLIC_ASSETS: { put: putMock, delete: deleteMock } } as unknown as Env;

function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/admin/categories', categoriesApi);
  return app;
}

const png = { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array(8) };

beforeEach(() => {
  putMock.mockReset();
  deleteMock.mockReset();
  state.role = 'admin';
  state.heroKey = null;
});

describe('POST /admin/categories/:id/hero-image', () => {
  it('answers 503 public_assets_unbound when the R2 binding is missing', async () => {
    const res = await buildApp().request('/admin/categories/c1/hero-image', png, unboundEnv);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe('public_assets_unbound');
    // The uploader renders `error` verbatim, and `reason` says how to fix it.
    expect(body.reason).toMatch(/2990s-public/);
  });

  it('does not write the hero key when storage is unreachable', async () => {
    await buildApp().request('/admin/categories/c1/hero-image', png, unboundEnv);
    expect(putMock).not.toHaveBeenCalled();
  });

  it('rejects a non-admin before revealing whether the bucket is bound', async () => {
    state.role = 'sales';
    const res = await buildApp().request('/admin/categories/c1/hero-image', png, unboundEnv);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('uploads and records the key once the bucket is bound', async () => {
    const res = await buildApp().request('/admin/categories/c1/hero-image', png, boundEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, key: 'category-heroes/c1.png' });
    expect(putMock).toHaveBeenCalledOnce();
  });

  it('still rejects an unsupported content type when bound', async () => {
    const res = await buildApp().request(
      '/admin/categories/c1/hero-image',
      { method: 'POST', headers: { 'content-type': 'image/gif' }, body: new Uint8Array(8) },
      boundEnv,
    );
    expect(res.status).toBe(400);
    expect(putMock).not.toHaveBeenCalled();
  });

  it('still rejects a body over 4MB when bound', async () => {
    const res = await buildApp().request(
      '/admin/categories/c1/hero-image',
      { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array(4 * 1024 * 1024 + 1) },
      boundEnv,
    );
    expect(res.status).toBe(413);
    expect(putMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /admin/categories/:id/hero-image', () => {
  const del = { method: 'DELETE' };

  it('answers 503 rather than clearing the column with storage unreachable', async () => {
    state.heroKey = 'category-heroes/c1.png';
    const res = await buildApp().request('/admin/categories/c1/hero-image', del, unboundEnv);
    expect(res.status).toBe(503);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'public_assets_unbound' });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('answers 503 even when there is no key to remove, so the two routes agree', async () => {
    state.heroKey = null;
    const res = await buildApp().request('/admin/categories/c1/hero-image', del, unboundEnv);
    expect(res.status).toBe(503);
  });

  it('deletes the object and clears the column once bound', async () => {
    state.heroKey = 'category-heroes/c1.png';
    const res = await buildApp().request('/admin/categories/c1/hero-image', del, boundEnv);
    expect(res.status).toBe(200);
    expect(deleteMock).toHaveBeenCalledWith('category-heroes/c1.png');
  });

  it('skips the R2 call when the category has no hero image', async () => {
    state.heroKey = null;
    const res = await buildApp().request('/admin/categories/c1/hero-image', del, boundEnv);
    expect(res.status).toBe(200);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
