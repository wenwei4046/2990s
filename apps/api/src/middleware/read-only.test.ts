import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';
import { readOnlyGuard, READ_ONLY_MESSAGE } from './read-only';

// Minimal app: the guard, then a catch-all that answers 200 for any method +
// path. So a request the guard lets through resolves to 200, and one it blocks
// is the guard's own 403.
function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', readOnlyGuard);
  app.all('*', (c) => c.json({ ok: true }, 200));
  return app;
}

const envOn = { READ_ONLY_MODE: 'true' } as unknown as Env;
const envOff = { READ_ONLY_MODE: 'false' } as unknown as Env;
const envUnset = {} as unknown as Env;

describe('readOnlyGuard — flag not "true" (inert)', () => {
  it('lets every method through when READ_ONLY_MODE === "false"', async () => {
    const app = buildApp();
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await app.request('/mfg-sales-orders', { method }, envOff);
      expect(res.status).toBe(200);
    }
  });

  it('lets writes through when READ_ONLY_MODE is unset', async () => {
    const app = buildApp();
    const res = await app.request('/mfg-sales-orders', { method: 'POST' }, envUnset);
    expect(res.status).toBe(200);
  });
});

describe('readOnlyGuard — flag "true" (frozen)', () => {
  it('allows reads: GET / HEAD / OPTIONS', async () => {
    const app = buildApp();
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const res = await app.request('/mfg-sales-orders', { method }, envOn);
      expect(res.status).toBe(200);
    }
  });

  it('rejects POST / PUT / PATCH / DELETE with 403 read_only + message', async () => {
    const app = buildApp();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await app.request('/mfg-sales-orders', { method }, envOn);
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe('read_only');
      expect(body.message).toBe(READ_ONLY_MESSAGE);
    }
  });

  it('allows the login/session endpoints so staff can still sign in + view', async () => {
    const app = buildApp();
    for (const path of ['/pos/pin-login', '/pos/backend-sso', '/pos/verify-pin']) {
      const res = await app.request(path, { method: 'POST' }, envOn);
      expect(res.status).toBe(200);
    }
  });

  it('still blocks PATCH /pos/my-pin (credential edit, not a login step)', async () => {
    const app = buildApp();
    const res = await app.request('/pos/my-pin', { method: 'PATCH' }, envOn);
    expect(res.status).toBe(403);
  });

  it('allowlist is path-exact — a write to a different /pos route is blocked', async () => {
    const app = buildApp();
    const res = await app.request('/pos/pin-login-not-really', { method: 'POST' }, envOn);
    expect(res.status).toBe(403);
  });
});
