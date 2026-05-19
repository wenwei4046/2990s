# POS Account Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 6-digit PIN login for POS sales staff, exchanged on-device for a real Supabase session, and let an admin set/reset PINs from Backend → Settings → Staff.

**Architecture:** PIN bcrypt-hashed into existing `staff.pin_hash`. New `POST /pos/pin-login` verifies PIN, asks Supabase admin API to issue a magic-link OTP, and returns the token-hash to POS, which calls `supabase.auth.verifyOtp({ type: 'magiclink' })` to mint a session whose `auth.uid()` is the sales staff's. Lock screen replaces the email-password gate for the common path; `/login` stays for emergency admin access.

**Tech Stack:** Hono on Cloudflare Workers · Vite + React 19 + React Router 7 · TypeScript strict · Supabase Auth · Drizzle (no schema change) · vitest · `bcryptjs` (new dep, pure JS, CF Workers-compatible).

**Spec:** [`docs/superpowers/specs/2026-05-19-pos-account-management-design.md`](../specs/2026-05-19-pos-account-management-design.md)

---

## File map

### Created
- `apps/api/src/lib/bcrypt.ts` — thin wrapper around `bcryptjs` so cost factor is centralised and tests can fast-mock.
- `apps/api/src/lib/pin-rate-limit.ts` — in-memory `Map<staffId, { count, resetAt }>` with 5-fail/60s window.
- `apps/api/src/routes/pos.ts` — `POST /pos/pin-login` + `GET /pos/sales-staff` (both unauthenticated).
- `apps/api/src/routes/pos.test.ts` — vitest unit tests for the new routes.
- `apps/pos/src/pages/LockScreen.tsx` + `LockScreen.module.css` — avatar grid + PinPad host.
- `apps/pos/src/components/PinPad.tsx` + `PinPad.module.css` — 6-digit numeric keypad with shake-on-error and retry-after countdown.
- `apps/backend/src/components/PinDrawer.tsx` + `PinDrawer.module.css` — set/reset/clear PIN drawer.

### Modified
- `apps/api/package.json` — add `bcryptjs` + `@types/bcryptjs`.
- `apps/api/src/routes/admin.ts` — `POST /admin/staff` accepts `pin`, splits sales/non-sales auth-user creation paths; add `PATCH /admin/staff/:id/pin`.
- `apps/api/src/routes/admin.test.ts` — add coverage for PIN paths (file currently doesn't exist, create alongside changes).
- `apps/api/src/index.ts` — mount `/pos` route.
- `apps/backend/src/lib/admin-queries.ts` — extend `StaffUpsert` with `pin?: string`; new `useSetStaffPin`.
- `apps/backend/src/pages/Settings.tsx` — StaffDrawer conditional PIN block, banner copy, Set/Reset PIN button row, mount PinDrawer.
- `apps/pos/src/lib/auth.tsx` — add `pinLogin` to context.
- `apps/pos/src/lib/queries.ts` — add `useShowroomSalesStaff` (unauthenticated fetch).
- `apps/pos/src/components/AuthGate.tsx` — render `<LockScreen />` inline instead of redirecting to `/login`.
- `apps/pos/src/components/Topbar.tsx` — rename "Sign out" tooltip to "Switch user" (semantic clarity, same `signOut` call).

### Untouched
- `packages/db/src/schema.ts` — `staff.pinHash` already exists.
- RLS policies — unchanged.
- `/login` route + `Login.tsx` — kept for emergency admin path.

---

## Task 1: Install `bcryptjs` and create wrapper

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/lib/bcrypt.ts`
- Create: `apps/api/src/lib/bcrypt.test.ts`

- [ ] **Step 1: Write failing test**

`apps/api/src/lib/bcrypt.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin } from './bcrypt';

describe('bcrypt wrapper', () => {
  it('hashes a 6-digit PIN to a non-empty string distinct from the plaintext', async () => {
    const hash = await hashPin('482917');
    expect(hash).toBeTypeOf('string');
    expect(hash.length).toBeGreaterThan(20);
    expect(hash).not.toBe('482917');
  });

  it('verifyPin returns true for the matching PIN', async () => {
    const hash = await hashPin('482917');
    await expect(verifyPin('482917', hash)).resolves.toBe(true);
  });

  it('verifyPin returns false for a wrong PIN', async () => {
    const hash = await hashPin('482917');
    await expect(verifyPin('123456', hash)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @2990s/api test bcrypt.test.ts`
Expected: FAIL with `Cannot find module './bcrypt'`.

- [ ] **Step 3: Install bcryptjs**

Run from repo root:
```bash
pnpm --filter @2990s/api add bcryptjs
pnpm --filter @2990s/api add -D @types/bcryptjs
```
Expected: `apps/api/package.json` gets `"bcryptjs": "^2.x"` under `dependencies` and `"@types/bcryptjs": "^2.x"` under `devDependencies`. `pnpm-lock.yaml` updated.

- [ ] **Step 4: Implement wrapper**

`apps/api/src/lib/bcrypt.ts`:
```ts
import bcrypt from 'bcryptjs';

const COST_FACTOR = 10;

export const hashPin = (pin: string): Promise<string> =>
  bcrypt.hash(pin, COST_FACTOR);

export const verifyPin = (pin: string, hash: string): Promise<boolean> =>
  bcrypt.compare(pin, hash);
```

- [ ] **Step 5: Run test, verify it passes**

Run: `pnpm --filter @2990s/api test bcrypt.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/lib/bcrypt.ts apps/api/src/lib/bcrypt.test.ts pnpm-lock.yaml
git commit -m "feat(api): bcrypt PIN hash + verify wrapper"
```

---

## Task 2: PIN rate limiter

**Files:**
- Create: `apps/api/src/lib/pin-rate-limit.ts`
- Create: `apps/api/src/lib/pin-rate-limit.test.ts`

- [ ] **Step 1: Write failing test**

`apps/api/src/lib/pin-rate-limit.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinRateLimiter } from './pin-rate-limit';

const STAFF_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STAFF_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('createPinRateLimiter', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-05-19T00:00:00Z')); });

  it('starts with 5 attempts remaining', () => {
    const rl = createPinRateLimiter();
    expect(rl.check(STAFF_A)).toEqual({ allowed: true, remainingAttempts: 5 });
  });

  it('decrements remainingAttempts on each recordFailure', () => {
    const rl = createPinRateLimiter();
    rl.recordFailure(STAFF_A);
    expect(rl.check(STAFF_A)).toEqual({ allowed: true, remainingAttempts: 4 });
    rl.recordFailure(STAFF_A);
    expect(rl.check(STAFF_A)).toEqual({ allowed: true, remainingAttempts: 3 });
  });

  it('blocks after 5 failures and reports retryAfter seconds', () => {
    const rl = createPinRateLimiter();
    for (let i = 0; i < 5; i++) rl.recordFailure(STAFF_A);
    const result = rl.check(STAFF_A);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(60);
  });

  it('resets after 60s window', () => {
    const rl = createPinRateLimiter();
    for (let i = 0; i < 5; i++) rl.recordFailure(STAFF_A);
    expect(rl.check(STAFF_A).allowed).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(rl.check(STAFF_A)).toEqual({ allowed: true, remainingAttempts: 5 });
  });

  it('tracks failures per staffId independently', () => {
    const rl = createPinRateLimiter();
    for (let i = 0; i < 5; i++) rl.recordFailure(STAFF_A);
    expect(rl.check(STAFF_A).allowed).toBe(false);
    expect(rl.check(STAFF_B).allowed).toBe(true);
  });

  it('reset(staffId) clears failures for that staff', () => {
    const rl = createPinRateLimiter();
    rl.recordFailure(STAFF_A);
    rl.recordFailure(STAFF_A);
    rl.reset(STAFF_A);
    expect(rl.check(STAFF_A)).toEqual({ allowed: true, remainingAttempts: 5 });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @2990s/api test pin-rate-limit.test.ts`
Expected: FAIL with `Cannot find module './pin-rate-limit'`.

- [ ] **Step 3: Implement rate limiter**

`apps/api/src/lib/pin-rate-limit.ts`:
```ts
const MAX_FAILURES = 5;
const WINDOW_MS = 60_000;

interface State { count: number; resetAt: number }

export interface PinRateLimiter {
  check(staffId: string): { allowed: true; remainingAttempts: number } | { allowed: false; retryAfter: number };
  recordFailure(staffId: string): void;
  reset(staffId: string): void;
}

export const createPinRateLimiter = (): PinRateLimiter => {
  const states = new Map<string, State>();

  const purgeExpired = (now: number, staffId: string) => {
    const s = states.get(staffId);
    if (s && s.resetAt <= now) states.delete(staffId);
  };

  return {
    check(staffId) {
      const now = Date.now();
      purgeExpired(now, staffId);
      const s = states.get(staffId);
      if (!s) return { allowed: true, remainingAttempts: MAX_FAILURES };
      if (s.count >= MAX_FAILURES) {
        return { allowed: false, retryAfter: Math.ceil((s.resetAt - now) / 1000) };
      }
      return { allowed: true, remainingAttempts: MAX_FAILURES - s.count };
    },
    recordFailure(staffId) {
      const now = Date.now();
      purgeExpired(now, staffId);
      const s = states.get(staffId) ?? { count: 0, resetAt: now + WINDOW_MS };
      s.count += 1;
      // Lock-window starts at first failure; subsequent failures don't extend it.
      states.set(staffId, s);
    },
    reset(staffId) {
      states.delete(staffId);
    },
  };
};

// Singleton for the live Worker. Tests use `createPinRateLimiter()` directly.
export const pinRateLimiter = createPinRateLimiter();
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @2990s/api test pin-rate-limit.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/pin-rate-limit.ts apps/api/src/lib/pin-rate-limit.test.ts
git commit -m "feat(api): in-memory PIN rate limiter (5/min/staffId)"
```

---

## Task 3: `POST /admin/staff` — sales path with PIN

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Create: `apps/api/src/routes/admin.test.ts`

This task widens the existing endpoint so `role==='sales'` requests use `admin.createUser` (with synthesized or supplied email + random password) and persist `pin_hash`. Non-sales requests keep the existing `inviteUserByEmail` path.

- [ ] **Step 1: Write failing test (file does not exist yet — create it)**

`apps/api/src/routes/admin.test.ts`:
```ts
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
      eq: () => ({
        maybeSingle: async () => {
          if (table === 'staff') return { data: callerRole ? { role: callerRole, active: true } : null, error: null };
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
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @2990s/api test admin.test.ts`
Expected: FAIL — the sales-PIN path doesn't exist yet (zod schema rejects `pin`, or `inviteUserByEmail` gets called for sales).

- [ ] **Step 3: Update zod schema and split sales / non-sales paths**

Replace the existing handler in `apps/api/src/routes/admin.ts`. The full new file:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';
import { hashPin } from '../lib/bcrypt';

export const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

admin.use('*', supabaseAuth);

const STAFF_ROLES = ['sales', 'showroom_lead', 'coordinator', 'finance', 'admin'] as const;

const CreateStaffBodySchema = z.object({
  staffCode:  z.string().trim().min(1).max(8),
  name:       z.string().trim().min(1).max(80),
  role:       z.enum(STAFF_ROLES),
  email:      z.string().trim().toLowerCase().email().optional(),
  initials:   z.string().trim().min(1).max(4),
  color:      z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be 6-digit hex like #FF7733'),
  showroomId: z.string().uuid().nullable().optional(),
  phone:      z.string().trim().min(1).nullable().optional(),
  pin:        z.string().regex(/^\d{6}$/, 'pin must be 6 digits').optional(),
}).refine(
  (v) => v.role !== 'sales' || v.pin !== undefined,
  { message: 'pin_required_for_sales', path: ['pin'] },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadStaffRole(c: any): Promise<string | null> {
  const supabase = c.get('supabase');
  const userId = c.get('user').id;
  const { data, error } = await supabase
    .from('staff')
    .select('role, active')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data || !data.active) return null;
  return data.role;
}

admin.post('/staff', async (c) => {
  const callerRole = await loadStaffRole(c);
  if (callerRole !== 'admin') {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const parsed = CreateStaffBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;

  // staff_code uniqueness pre-flight (cheap, friendlier than the unique-constraint
  // violation that would surface at INSERT time).
  const userScoped = c.get('supabase');
  const { data: codeClash } = await userScoped
    .from('staff')
    .select('id')
    .eq('staff_code', input.staffCode)
    .maybeSingle();
  if (codeClash) {
    return c.json({ error: 'staff_code_taken', staffCode: input.staffCode }, 409);
  }

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Sales path: createUser (no magic link) + bcrypt(pin) → pin_hash.
  // Non-sales path: inviteUserByEmail (magic link to backend portal).
  const isSales = input.role === 'sales';
  const email = input.email ?? `${input.staffCode.toLowerCase()}+pos@2990s.local`;

  let userId: string;
  if (isSales) {
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { staff_code: input.staffCode, name: input.name, role: input.role },
    });
    if (createErr || !created?.user) {
      return c.json({ error: 'auth_user_create_failed', detail: createErr?.message }, 422);
    }
    userId = created.user.id;
  } else {
    const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
      email,
      { data: { staff_code: input.staffCode, name: input.name, role: input.role } },
    );
    if (inviteErr || !invited?.user) {
      return c.json({ error: 'invite_failed', detail: inviteErr?.message ?? 'no user returned' }, 422);
    }
    userId = invited.user.id;
  }

  const pinHash = isSales && input.pin ? await hashPin(input.pin) : null;

  const { data: newStaff, error: insertErr } = await adminClient
    .from('staff')
    .insert({
      id:           userId,
      staff_code:   input.staffCode,
      name:         input.name,
      role:         input.role,
      showroom_id:  input.showroomId ?? null,
      email,
      phone:        input.phone ?? null,
      initials:     input.initials,
      color:        input.color,
      active:       true,
      pin_hash:     pinHash,
    })
    .select('id, staff_code, name, role, showroom_id, email, phone, initials, color, active')
    .maybeSingle();

  if (insertErr || !newStaff) {
    const { error: delErr } = await adminClient.auth.admin.deleteUser(userId);
    if (delErr) {
      console.error('[admin/staff] rollback failed', { userId, delErr });
      return c.json({
        error:        'staff_insert_failed_rollback_failed',
        userId,
        insertError:  insertErr?.message,
        rollbackError: delErr.message,
      }, 500);
    }
    return c.json({ error: 'staff_insert_failed', detail: insertErr?.message }, 422);
  }

  return c.json({ staff: newStaff }, 201);
});
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @2990s/api test admin.test.ts`
Expected: PASS — all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): POST /admin/staff splits sales (PIN+createUser) vs non-sales (invite)"
```

---

## Task 4: `PATCH /admin/staff/:id/pin`

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/routes/admin.test.ts`

- [ ] **Step 1: Add failing test**

Append to `apps/api/src/routes/admin.test.ts`:

```ts
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

  it('non-sales target → 422 not_a_sales_staff', async () => {
    const app = buildAppForPin('admin', { role: 'coordinator' });
    const res = await app.request(`/admin/staff/${TARGET_ID}/pin`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: '123456' }),
    }, baseEnv);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('not_a_sales_staff');
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
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @2990s/api test admin.test.ts`
Expected: FAIL — route not implemented (404 instead of 200/422/etc).

- [ ] **Step 3: Implement PATCH handler**

Append to `apps/api/src/routes/admin.ts` (after the existing `admin.post('/staff', …)` handler, before the trailing closing — no closing brace exists, it's `export const admin = …` then handlers; append directly at the file end):

```ts
const PatchPinBodySchema = z.object({
  pin: z.union([z.string().regex(/^\d{6}$/), z.null()]),
});

admin.patch('/staff/:id/pin', async (c) => {
  const callerRole = await loadStaffRole(c);
  if (callerRole !== 'admin') {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const id = c.req.param('id');
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return c.json({ error: 'invalid_request' }, 400);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = PatchPinBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }

  const userScoped = c.get('supabase');
  const { data: target } = await userScoped
    .from('staff')
    .select('role')
    .eq('id', id)
    .maybeSingle();
  if (!target) return c.json({ error: 'staff_not_found' }, 404);
  if (target.role !== 'sales') return c.json({ error: 'not_a_sales_staff' }, 422);

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const pinHash = parsed.data.pin === null ? null : await hashPin(parsed.data.pin);

  const { data: updated, error: updateErr } = await adminClient
    .from('staff')
    .update({ pin_hash: pinHash })
    .eq('id', id)
    .select('id, staff_code, name, role, showroom_id, email, phone, initials, color, active')
    .maybeSingle();

  if (updateErr || !updated) {
    return c.json({ error: 'staff_update_failed', detail: updateErr?.message }, 500);
  }
  return c.json({ staff: updated }, 200);
});
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @2990s/api test admin.test.ts`
Expected: PASS — all PATCH cases plus prior POST cases still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): PATCH /admin/staff/:id/pin (set/reset/clear)"
```

---

## Task 5: `GET /pos/sales-staff`

**Files:**
- Create: `apps/api/src/routes/pos.ts`
- Create: `apps/api/src/routes/pos.test.ts`

- [ ] **Step 1: Write failing test**

`apps/api/src/routes/pos.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @2990s/api test pos.test.ts`
Expected: FAIL with `Cannot find module './pos'`.

- [ ] **Step 3: Implement route**

`apps/api/src/routes/pos.ts`:
```ts
import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import type { Env, Variables } from '../env';
import { pinRateLimiter, createPinRateLimiter } from '../lib/pin-rate-limit';

export const pos = new Hono<{ Bindings: Env; Variables: Variables }>();

// Test hook — lets unit tests start each case with a fresh limiter even though
// the module-level singleton is shared across requests in production.
let activeLimiter = pinRateLimiter;
export const __resetRateLimiter = (): void => {
  activeLimiter = createPinRateLimiter();
};

pos.get('/sales-staff', async (c) => {
  const showroomId = c.req.query('showroomId') ?? null;

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Service-role select bypasses RLS — safe because we hand-pick the columns.
  let query = adminClient
    .from('staff')
    .select('id, staff_code, name, initials, color, role, active, showroom_id, pin_hash')
    .eq('role', 'sales')
    .eq('active', true)
    .not('pin_hash', 'is', null);

  if (showroomId) {
    query = query.eq('showroom_id', showroomId);
  }
  // @ts-expect-error chained .order() on the conditional query (Supabase fluent type)
  const { data, error } = await query.order('staff_code');
  if (error) {
    return c.json({ error: 'fetch_failed', detail: error.message }, 500);
  }

  // Whitelist outgoing fields.
  return c.json(
    (data ?? []).map((r: any) => ({
      id: r.id,
      staffCode: r.staff_code,
      name: r.name,
      initials: r.initials,
      color: r.color,
    })),
    200,
  );
});
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @2990s/api test pos.test.ts`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/pos.ts apps/api/src/routes/pos.test.ts
git commit -m "feat(api): GET /pos/sales-staff (public list, no PII)"
```

---

## Task 6: `POST /pos/pin-login`

**Files:**
- Modify: `apps/api/src/routes/pos.ts`
- Modify: `apps/api/src/routes/pos.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `apps/api/src/routes/pos.test.ts`:

```ts
import { hashPin } from '../lib/bcrypt';

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
    const body = await res.json();
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
    const body = await final.json();
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
    expect((await res.json()).error).toBe('staff_not_loginnable');
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
    expect((await res.json()).error).toBe('staff_not_loginnable');
  });

  it('pin_hash null → 401 staff_not_loginnable', async () => {
    await mockStaffLookup({ pinHash: null });
    const app = buildApp();
    const res = await app.request('/pos/pin-login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staffId: STAFF_ID, pin: '482917' }),
    }, baseEnv);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('staff_not_loginnable');
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @2990s/api test pos.test.ts`
Expected: FAIL — the `/pin-login` route isn't implemented (404).

- [ ] **Step 3: Implement POST /pin-login**

Append to `apps/api/src/routes/pos.ts` (after the GET handler):

```ts
import { z } from 'zod';
import { verifyPin } from '../lib/bcrypt';

const PinLoginBodySchema = z.object({
  staffId: z.string().uuid(),
  pin:     z.string().regex(/^\d{6}$/),
});

pos.post('/pin-login', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const parsed = PinLoginBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }
  const { staffId, pin } = parsed.data;

  const limit = activeLimiter.check(staffId);
  if (!limit.allowed) {
    return c.json({ error: 'too_many_attempts', retryAfter: limit.retryAfter }, 429);
  }

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: staff, error: lookupErr } = await adminClient
    .from('staff')
    .select('id, role, active, pin_hash, email')
    .eq('id', staffId)
    .maybeSingle();
  if (lookupErr) {
    return c.json({ error: 'fetch_failed', detail: lookupErr.message }, 500);
  }

  // Single error code covers: not_found, inactive, wrong role, no PIN set.
  // Avoids leaking PIN-set status to a probing caller.
  const loginnable = staff && staff.active && staff.role === 'sales' && staff.pin_hash;
  if (!loginnable) {
    return c.json({ error: 'staff_not_loginnable' }, 401);
  }

  const ok = await verifyPin(pin, staff.pin_hash as string);
  if (!ok) {
    activeLimiter.recordFailure(staffId);
    const after = activeLimiter.check(staffId);
    return c.json({
      error: 'invalid_pin',
      remainingAttempts: after.allowed ? after.remainingAttempts : 0,
    }, 401);
  }

  // Success — issue a magic-link OTP for the sales user.
  activeLimiter.reset(staffId);
  const { data: link, error: linkErr } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email: staff.email as string,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    return c.json({ error: 'session_issue_failed', detail: linkErr?.message }, 500);
  }
  return c.json({ tokenHash: link.properties.hashed_token, email: staff.email }, 200);
});
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @2990s/api test pos.test.ts`
Expected: PASS (all 9 cases: 2 GET + 7 POST).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/pos.ts apps/api/src/routes/pos.test.ts
git commit -m "feat(api): POST /pos/pin-login (PIN → magic-link OTP)"
```

---

## Task 7: Mount `/pos` in the Hono app

**Files:**
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Add import + route mount**

In `apps/api/src/index.ts`, after the other route imports (around line 15) add:

```ts
import { pos } from './routes/pos';
```

After the existing `app.route('/delivery-fees', deliveryFees);` line (around line 42) add:

```ts
app.route('/pos', pos);
```

- [ ] **Step 2: Sanity check with the full API test suite**

Run: `pnpm --filter @2990s/api test`
Expected: All existing + new tests PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): mount /pos route"
```

---

## Task 8: `StaffUpsert` accepts `pin?: string`

**Files:**
- Modify: `apps/backend/src/lib/admin-queries.ts`

- [ ] **Step 1: Extend the type and forwarding**

In `apps/backend/src/lib/admin-queries.ts`, replace the `StaffUpsert` interface (around line 113):

```ts
export interface StaffUpsert {
  staffCode:  string;
  name:       string;
  role:       StaffRoleValue;
  email:      string | null;
  initials:   string;
  color:      string;
  showroomId: string | null;
  phone:      string | null;
  pin?:       string;   // required at API level when role==='sales'
}
```

The existing `useCreateStaff` already does `body: JSON.stringify(input)`, which now serialises `pin` when present. No change to the mutation body — but trim out `email: null` keys when posting:

Replace the `body:` line in the `fetch` call (around line 140) with:

```ts
body: JSON.stringify({
  ...input,
  email: input.email ?? undefined,  // omit so server can synthesize
}),
```

- [ ] **Step 2: Sanity check**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/lib/admin-queries.ts
git commit -m "feat(backend): StaffUpsert.pin + email optional"
```

---

## Task 9: `useSetStaffPin` mutation

**Files:**
- Modify: `apps/backend/src/lib/admin-queries.ts`

- [ ] **Step 1: Add the hook**

Append after `useCreateStaff` (around line 177) in `apps/backend/src/lib/admin-queries.ts`:

```ts
export const useSetStaffPin = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, pin }: { id: string; pin: string | null }) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const token = await getToken();
      const res = await fetch(`${API_URL}/admin/staff/${id}/pin`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        throw new Error(`setStaffPin failed (${res.status}): ${text}`);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff'] });
    },
  });
};
```

- [ ] **Step 2: Sanity check**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/lib/admin-queries.ts
git commit -m "feat(backend): useSetStaffPin mutation"
```

---

## Task 10: StaffDrawer — conditional PIN block + optional email

**Files:**
- Modify: `apps/backend/src/pages/Settings.tsx`

- [ ] **Step 1: Update the StaffDrawer**

In `apps/backend/src/pages/Settings.tsx`, replace the `StaffDrawer` component (lines 719-893) with the version below. Key changes:
- Two new state slots: `pin`, `confirmPin`.
- Email field marked "optional for sales".
- New conditional PIN block when `role === 'sales'`.
- Save button: validates PIN match + format before calling `useCreateStaff`.
- Button label: "Create POS user" for sales, "Send invite" for other roles.

```tsx
const StaffDrawer = ({
  showrooms,
  onClose,
}: {
  showrooms: ShowroomRow[];
  onClose: () => void;
}) => {
  const [staffCode, setStaffCode] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRoleValue>('sales');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [initials, setInitials] = useState('');
  const [color, setColor] = useState<string>(STAFF_AVATAR_COLORS[0] ?? '#E86B3A');
  const [showroomId, setShowroomId] = useState<string>('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createStaff = useCreateStaff();
  const saving = createStaff.isPending;

  const isSales = role === 'sales';

  const onSave = async () => {
    setError(null);
    if (!staffCode.trim() || !name.trim() || !initials.trim()) {
      setError('Code, name and initials are required.');
      return;
    }
    if (!isSales && !email.trim()) {
      setError('Email is required for non-sales roles.');
      return;
    }
    if (isSales) {
      if (!/^\d{6}$/.test(pin)) {
        setError('PIN must be 6 digits.');
        return;
      }
      if (pin !== confirmPin) {
        setError("PINs don't match.");
        return;
      }
    }
    try {
      await createStaff.mutateAsync({
        staffCode:  staffCode.trim().toUpperCase(),
        name:       name.trim(),
        role,
        email:      email.trim().toLowerCase() || null,
        initials:   initials.trim().toUpperCase(),
        color,
        showroomId: showroomId || null,
        phone:      phone.trim() || null,
        pin:        isSales ? pin : undefined,
      });
      onClose();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <header className={styles.drawerHead}>
          <div>
            <div className="t-eyebrow">New staff</div>
            <h3 className={styles.drawerTitle}>Add a staff member</h3>
            <div className={styles.drawerSub}>
              {isSales
                ? 'Sales people sign in to POS with a 6-digit PIN. Email is optional — leave blank to auto-generate one.'
                : "They'll get a magic-link invite at the email you enter, set their own password, and can sign in once active."}
            </div>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={1.75} />
          </button>
        </header>

        <div className={styles.drawerBody}>
          {error && <div className={styles.errorBanner}>{error}</div>}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Staff code</span>
            <input
              className={styles.input}
              value={staffCode}
              onChange={(e) => setStaffCode(e.target.value)}
              placeholder="e.g. AW"
              maxLength={8}
            />
            <span className={styles.fieldHint}>Short uppercase identifier shown in topbar avatars and history.</span>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Full name</span>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Aisha Wong"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Role</span>
            <select
              className={styles.input}
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRoleValue)}
            >
              {STAFF_ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <span className={styles.fieldHint}>Sales sign in to POS via PIN; everyone else uses the backend portal.</span>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Email{isSales ? <span className={styles.muted}> (optional)</span> : null}
            </span>
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={isSales ? 'leave blank to auto-generate' : 'name@2990s.my'}
            />
            <span className={styles.fieldHint}>
              {isSales
                ? 'Sales users don\'t receive email. Leave blank and we\'ll synthesize one.'
                : 'Magic-link invite is sent here.'}
            </span>
          </label>

          {isSales && (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>PIN (6 digits)</span>
                <input
                  className={styles.input}
                  type="password"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••••"
                  autoComplete="new-password"
                />
                <span className={styles.fieldHint}>You can change this later. Sales staff can't change their own PIN.</span>
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Confirm PIN</span>
                <input
                  className={styles.input}
                  type="password"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••••"
                  autoComplete="new-password"
                />
              </label>
            </>
          )}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Showroom</span>
            <select
              className={styles.input}
              value={showroomId}
              onChange={(e) => setShowroomId(e.target.value)}
            >
              <option value="">All showrooms (oversees every location)</option>
              {showrooms.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Initials</span>
            <input
              className={styles.input}
              value={initials}
              onChange={(e) => setInitials(e.target.value)}
              placeholder="e.g. AW"
              maxLength={4}
            />
            <span className={styles.fieldHint}>Shown in topbar avatar circle. 1–4 characters.</span>
          </label>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Avatar color</span>
            <div className={styles.swatchRow}>
              {STAFF_AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={c === color ? `${styles.swatch} ${styles.swatchOn}` : styles.swatch}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  aria-pressed={c === color}
                />
              ))}
            </div>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Phone (optional)</span>
            <input
              className={styles.input}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+60 12 345 6789"
            />
          </label>
        </div>

        <footer className={styles.drawerFoot}>
          <div className={styles.grow} />
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => void onSave()} disabled={saving}>
            <Save size={16} strokeWidth={1.75} />
            {saving ? (isSales ? 'Creating…' : 'Inviting…') : (isSales ? 'Create POS user' : 'Send invite')}
          </Button>
        </footer>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Sanity check**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: PASS.

- [ ] **Step 3: Manual smoke (deferred to Task 11 E2E)**

This step is intentionally lightweight: the next task wires the row-level "Set/Reset PIN" button + PinDrawer that supports manual end-to-end testing.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/pages/Settings.tsx
git commit -m "feat(backend): StaffDrawer adds conditional PIN block, optional email for sales"
```

---

## Task 11: PinDrawer + "Set / Reset PIN" row action

**Files:**
- Create: `apps/backend/src/components/PinDrawer.tsx`
- Create: `apps/backend/src/components/PinDrawer.module.css`
- Modify: `apps/backend/src/pages/Settings.tsx`

- [ ] **Step 1: Create the PinDrawer component**

`apps/backend/src/components/PinDrawer.tsx`:
```tsx
import { useState } from 'react';
import { Save, Trash2, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useSetStaffPin, type StaffRow } from '../lib/admin-queries';
import styles from './PinDrawer.module.css';

interface Props {
  staff: StaffRow;
  onClose: () => void;
}

export const PinDrawer = ({ staff, onClose }: Props) => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutation = useSetStaffPin();

  const onSave = async () => {
    setError(null);
    if (!/^\d{6}$/.test(pin)) {
      setError('PIN must be 6 digits.');
      return;
    }
    if (pin !== confirmPin) {
      setError("PINs don't match.");
      return;
    }
    try {
      await mutation.mutateAsync({ id: staff.id, pin });
      onClose();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  const onClear = async () => {
    setError(null);
    try {
      await mutation.mutateAsync({ id: staff.id, pin: null });
      onClose();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <div>
            <div className="t-eyebrow">Reset PIN</div>
            <h3 className={styles.title}>{staff.name}</h3>
            <div className={styles.sub}>
              They'll use this new 6-digit PIN to sign in to POS. Their current session (if any) keeps working until they sign out.
            </div>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={1.75} />
          </button>
        </header>

        <div className={styles.body}>
          {error && <div className={styles.errorBanner}>{error}</div>}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>New PIN</span>
            <input
              className={styles.input}
              type="password"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
              autoComplete="new-password"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Confirm PIN</span>
            <input
              className={styles.input}
              type="password"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
              autoComplete="new-password"
            />
          </label>

          <div className={styles.clearBlock}>
            {confirmingClear ? (
              <div className={styles.clearConfirm}>
                <span>
                  Clear {staff.staffCode}'s PIN? They won't be able to sign in to POS until you set a new one.
                </span>
                <Button variant="ghost" onClick={() => setConfirmingClear(false)} disabled={mutation.isPending}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => void onClear()} disabled={mutation.isPending}>
                  Yes, clear PIN
                </Button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.clearBtn}
                onClick={() => setConfirmingClear(true)}
                disabled={mutation.isPending}
              >
                <Trash2 size={14} strokeWidth={1.75} />
                Clear PIN (revoke POS access)
              </button>
            )}
          </div>
        </div>

        <footer className={styles.foot}>
          <div className={styles.grow} />
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => void onSave()} disabled={mutation.isPending}>
            <Save size={16} strokeWidth={1.75} />
            {mutation.isPending ? 'Saving…' : 'Save PIN'}
          </Button>
        </footer>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Create the CSS module**

`apps/backend/src/components/PinDrawer.module.css`:
```css
.scrim {
  position: fixed; inset: 0; background: rgba(0,0,0,.32); z-index: 50;
  display: flex; justify-content: flex-end;
}
.drawer {
  width: min(420px, 100vw); background: var(--c-paper); display: flex;
  flex-direction: column; height: 100vh; box-shadow: -8px 0 32px rgba(0,0,0,.12);
}
.head {
  padding: var(--space-4); display: flex; align-items: flex-start; gap: var(--space-3);
  border-bottom: 1px solid var(--c-border-soft);
}
.title { margin: 4px 0 6px; font: var(--t-h3); color: var(--c-ink); }
.sub { color: var(--c-ink-muted); font: var(--t-body-sm); }
.iconBtn { background: none; border: none; cursor: pointer; padding: 4px; }
.body { padding: var(--space-4); flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-3); }
.foot { padding: var(--space-3) var(--space-4); border-top: 1px solid var(--c-border-soft); display: flex; align-items: center; gap: var(--space-2); }
.grow { flex: 1; }
.field { display: flex; flex-direction: column; gap: 6px; }
.fieldLabel { font: var(--t-eyebrow); color: var(--c-ink); }
.input {
  font: var(--t-body); padding: 10px 12px; border: 1px solid var(--c-border);
  border-radius: 8px; background: white;
}
.input:focus { outline: 2px solid var(--c-accent); outline-offset: 1px; }
.errorBanner {
  background: var(--c-danger-soft); color: var(--c-danger-strong); padding: 10px 12px;
  border-radius: 8px; font: var(--t-body-sm);
}
.clearBlock { margin-top: var(--space-2); }
.clearBtn {
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px;
  background: none; border: 1px solid var(--c-border); border-radius: 8px;
  color: var(--c-danger-strong); cursor: pointer; font: var(--t-body-sm);
}
.clearBtn:hover { background: var(--c-danger-soft); }
.clearConfirm {
  display: flex; flex-direction: column; gap: var(--space-2);
  background: var(--c-danger-soft); padding: var(--space-3); border-radius: 8px;
  font: var(--t-body-sm); color: var(--c-danger-strong);
}
```

- [ ] **Step 3: Wire it into Settings.tsx**

In `apps/backend/src/pages/Settings.tsx`:

a. Add at the top of the file with the other imports:
```tsx
import { PinDrawer } from '../components/PinDrawer';
```

b. Update the StaffTab component (lines 630-717). Replace it with:

```tsx
type PinDrawerState = { open: false } | { open: true; staff: StaffRow };

const StaffTab = ({ canEdit }: { canEdit: boolean }) => {
  const staffList = useStaff();
  const showrooms = useShowrooms();
  const updateActive = useUpdateStaffActive();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pinDrawer, setPinDrawer] = useState<PinDrawerState>({ open: false });

  const showroomName = (id: string | null) =>
    id ? showrooms.data?.find((s) => s.id === id)?.name ?? '—' : 'All showrooms';

  return (
    <>
      <div className={styles.readOnlyBanner}>
        <strong>Heads up.</strong> Sales people sign in to POS with their 6-digit PIN — use the Set / Reset PIN button on each row. Other roles get a magic-link invite emailed when you create them.
      </div>

      <div className={styles.actionsRow} style={{ marginBottom: 'var(--space-3)' }}>
        {canEdit && (
          <Button variant="primary" size="md" onClick={() => setDrawerOpen(true)}>
            <Plus size={16} strokeWidth={1.75} />
            New staff
          </Button>
        )}
      </div>

      <div className={styles.tableCard}>
        {staffList.isLoading ? (
          <div className={styles.empty}>Loading staff…</div>
        ) : (staffList.data?.length ?? 0) === 0 ? (
          <div className={styles.empty}>No staff.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Role</th>
                <th>Showroom</th>
                <th>Email</th>
                <th>Status</th>
                {canEdit && <th aria-label="actions" />}
              </tr>
            </thead>
            <tbody>
              {staffList.data!.map((s: StaffRow) => (
                <tr key={s.id}>
                  <td><code className={styles.code}>{s.staffCode}</code></td>
                  <td>{s.name}</td>
                  <td><span className={styles.rolePill}>{s.role.replace('_', ' ')}</span></td>
                  <td>{showroomName(s.showroomId)}</td>
                  <td>{s.email ? s.email : <span className={styles.muted}>—</span>}</td>
                  <td>
                    {s.active ? (
                      <span className={styles.statusActive}><CheckCircle2 size={14} strokeWidth={1.75} /> Active</span>
                    ) : (
                      <span className={styles.statusInactive}><Circle size={14} strokeWidth={1.75} /> Inactive</span>
                    )}
                  </td>
                  {canEdit && (
                    <td style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      {s.role === 'sales' && (
                        <button
                          type="button"
                          className={styles.editBtn}
                          onClick={() => setPinDrawer({ open: true, staff: s })}
                          aria-label={`Set or reset PIN for ${s.staffCode}`}
                        >
                          Set / Reset PIN
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.editBtn}
                        disabled={updateActive.isPending}
                        onClick={() =>
                          updateActive.mutate({ id: s.id, active: !s.active })
                        }
                        aria-label={s.active ? `Deactivate ${s.staffCode}` : `Activate ${s.staffCode}`}
                      >
                        {s.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {drawerOpen && (
        <StaffDrawer
          showrooms={showrooms.data ?? []}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {pinDrawer.open && (
        <PinDrawer
          staff={pinDrawer.staff}
          onClose={() => setPinDrawer({ open: false })}
        />
      )}
    </>
  );
};
```

- [ ] **Step 4: Sanity check**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/components/PinDrawer.tsx apps/backend/src/components/PinDrawer.module.css apps/backend/src/pages/Settings.tsx
git commit -m "feat(backend): PinDrawer + Set/Reset PIN row action; banner copy update"
```

---

## Task 12: POS `pinLogin` on auth context

**Files:**
- Modify: `apps/pos/src/lib/auth.tsx`

- [ ] **Step 1: Extend the AuthState contract + provider**

Replace the entire contents of `apps/pos/src/lib/auth.tsx` with:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export interface PinLoginResult {
  error: string | null;
  remainingAttempts?: number;
  retryAfter?: number;
}

interface AuthState {
  loading: boolean;
  user: User | null;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  pinLogin: (staffId: string, pin: string) => Promise<PinLoginResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? error.message : null };
  };

  const pinLogin = async (staffId: string, pin: string): Promise<PinLoginResult> => {
    if (!API_URL) return { error: 'VITE_API_URL is not set' };
    const res = await fetch(`${API_URL}/pos/pin-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staffId, pin }),
    });
    const body = await res.json().catch(() => ({})) as {
      error?: string; remainingAttempts?: number; retryAfter?: number;
      tokenHash?: string; email?: string;
    };
    if (!res.ok) {
      return {
        error: body.error ?? `pin_login_failed_${res.status}`,
        remainingAttempts: body.remainingAttempts,
        retryAfter: body.retryAfter,
      };
    }
    if (!body.tokenHash || !body.email) {
      return { error: 'session_issue_failed' };
    }
    const { error: otpErr } = await supabase.auth.verifyOtp({
      email: body.email,
      token: body.tokenHash,
      type: 'magiclink',
    });
    return { error: otpErr?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ loading, user: session?.user ?? null, session, signIn, pinLogin, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};
```

- [ ] **Step 2: Sanity check**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/lib/auth.tsx
git commit -m "feat(pos): pinLogin on auth context (PIN → /pos/pin-login → verifyOtp)"
```

---

## Task 13: `useShowroomSalesStaff` query

**Files:**
- Modify: `apps/pos/src/lib/queries.ts`

- [ ] **Step 1: Add the query**

Append to `apps/pos/src/lib/queries.ts`:

```ts
const SHOWROOM_ID = import.meta.env.VITE_POS_SHOWROOM_ID as string | undefined;

export interface SalesStaffRow {
  id: string;
  staffCode: string;
  name: string;
  initials: string;
  color: string;
}

const SALES_STAFF_CACHE_KEY = 'pos:sales-staff-cache';

export const useShowroomSalesStaff = () =>
  useQuery({
    queryKey: ['pos', 'sales-staff', SHOWROOM_ID ?? 'all'],
    queryFn: async (): Promise<SalesStaffRow[]> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const qs = SHOWROOM_ID ? `?showroomId=${encodeURIComponent(SHOWROOM_ID)}` : '';
      const res = await fetch(`${API_URL}/pos/sales-staff${qs}`);
      if (!res.ok) throw new Error(`GET /pos/sales-staff failed (${res.status})`);
      const rows = (await res.json()) as SalesStaffRow[];
      try { localStorage.setItem(SALES_STAFF_CACHE_KEY, JSON.stringify(rows)); } catch { /* quota */ }
      return rows;
    },
    staleTime: 5 * 60_000,
    placeholderData: () => {
      try {
        const cached = localStorage.getItem(SALES_STAFF_CACHE_KEY);
        if (cached) return JSON.parse(cached) as SalesStaffRow[];
      } catch { /* parse */ }
      return undefined;
    },
  });
```

Note: this assumes `apps/pos/src/lib/queries.ts` already exports `API_URL` (or imports it). If `API_URL` isn't already at the top of the file, also add at the imports section:

```ts
const API_URL = import.meta.env.VITE_API_URL as string | undefined;
```

(only if not already present — check before duplicating).

- [ ] **Step 2: Sanity check**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/lib/queries.ts
git commit -m "feat(pos): useShowroomSalesStaff (pre-session list, localStorage cache)"
```

---

## Task 14: PinPad component

**Files:**
- Create: `apps/pos/src/components/PinPad.tsx`
- Create: `apps/pos/src/components/PinPad.module.css`

- [ ] **Step 1: Create the component**

`apps/pos/src/components/PinPad.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Delete } from 'lucide-react';
import styles from './PinPad.module.css';

interface Props {
  onComplete: (pin: string) => void | Promise<void>;
  onCancel: () => void;
  errorMessage: string | null;
  busy: boolean;
}

const KEYS: Array<string | 'back' | null> = [
  '1', '2', '3',
  '4', '5', '6',
  '7', '8', '9',
  null, '0', 'back',
];

export const PinPad = ({ onComplete, onCancel, errorMessage, busy }: Props) => {
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (errorMessage) {
      setShake(true);
      setPin('');
      const t = setTimeout(() => setShake(false), 400);
      return () => clearTimeout(t);
    }
  }, [errorMessage]);

  useEffect(() => {
    if (pin.length === 6 && !busy) {
      void onComplete(pin);
    }
  }, [pin, busy, onComplete]);

  const press = (key: string | 'back') => {
    if (busy) return;
    if (key === 'back') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length >= 6) return;
    setPin((p) => p + key);
  };

  return (
    <div className={styles.pad}>
      <div className={`${styles.dots} ${shake ? styles.shake : ''}`} aria-live="polite">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={`${styles.dot} ${pin.length > i ? styles.dotOn : ''}`}
            aria-hidden="true"
          />
        ))}
      </div>

      {errorMessage && <div className={styles.error} role="alert">{errorMessage}</div>}

      <div className={styles.grid}>
        {KEYS.map((key, idx) => {
          if (key === null) return <div key={idx} aria-hidden="true" />;
          if (key === 'back') {
            return (
              <button
                key={idx}
                type="button"
                className={styles.key}
                onClick={() => press('back')}
                aria-label="Delete last digit"
                disabled={busy}
              >
                <Delete size={20} strokeWidth={1.75} />
              </button>
            );
          }
          return (
            <button
              key={idx}
              type="button"
              className={styles.key}
              onClick={() => press(key)}
              disabled={busy}
            >
              {key}
            </button>
          );
        })}
      </div>

      <button type="button" className={styles.cancel} onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </div>
  );
};
```

- [ ] **Step 2: Create the CSS module**

`apps/pos/src/components/PinPad.module.css`:
```css
.pad {
  display: flex; flex-direction: column; align-items: center; gap: var(--space-4);
  padding: var(--space-5); background: var(--c-paper); border-radius: 16px;
  box-shadow: 0 12px 40px rgba(0,0,0,.18);
  max-width: 360px; width: 100%;
}
.dots { display: flex; gap: 12px; }
.dot {
  width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--c-border);
  background: transparent; transition: background 120ms;
}
.dotOn { background: var(--c-accent); border-color: var(--c-accent); }
.shake { animation: shake .4s; }
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-8px); }
  40%, 80% { transform: translateX(8px); }
}
.error {
  color: var(--c-danger-strong); font: var(--t-body-sm);
  text-align: center; min-height: 1.4em;
}
.grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: var(--space-2); width: 100%;
}
.key {
  min-height: 64px; font-size: 24px; font-weight: 500;
  background: var(--c-paper); border: 1px solid var(--c-border);
  border-radius: 12px; cursor: pointer; color: var(--c-ink);
}
.key:active { background: var(--c-paper-strong); }
.key:disabled { opacity: .5; cursor: not-allowed; }
.cancel {
  background: none; border: none; color: var(--c-ink-muted);
  font: var(--t-body-sm); cursor: pointer; padding: 8px 16px;
}
.cancel:hover { color: var(--c-ink); }
```

- [ ] **Step 3: Sanity check**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/components/PinPad.tsx apps/pos/src/components/PinPad.module.css
git commit -m "feat(pos): PinPad component (6 dots + numeric keypad, shake on error)"
```

---

## Task 15: LockScreen page

**Files:**
- Create: `apps/pos/src/pages/LockScreen.tsx`
- Create: `apps/pos/src/pages/LockScreen.module.css`

- [ ] **Step 1: Create LockScreen**

`apps/pos/src/pages/LockScreen.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useShowroomSalesStaff, type SalesStaffRow } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { PinPad } from '../components/PinPad';
import styles from './LockScreen.module.css';

export const LockScreen = () => {
  const staff = useShowroomSalesStaff();
  const { pinLogin } = useAuth();
  const [selected, setSelected] = useState<SalesStaffRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  useEffect(() => {
    if (retryAfter === null) return;
    if (retryAfter <= 0) { setRetryAfter(null); setErrorMessage(null); return; }
    const t = setTimeout(() => setRetryAfter((s) => (s == null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [retryAfter]);

  const handlePin = async (pin: string) => {
    if (!selected || busy) return;
    setBusy(true);
    const result = await pinLogin(selected.id, pin);
    setBusy(false);
    if (!result.error) {
      setErrorMessage(null);
      return; // session updates → LockGate unmounts this component
    }
    if (result.error === 'too_many_attempts') {
      const after = result.retryAfter ?? 60;
      setRetryAfter(after);
      setErrorMessage(`Too many attempts — try again in ${after}s`);
      return;
    }
    if (result.error === 'invalid_pin') {
      const remaining = result.remainingAttempts ?? 0;
      setErrorMessage(remaining > 0
        ? `Invalid PIN — ${remaining} attempt${remaining === 1 ? '' : 's'} left`
        : 'Invalid PIN');
      return;
    }
    setErrorMessage(result.error);
  };

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className="t-eyebrow">2990's · POS</div>
        <h1 className={styles.title}>Showroom KL</h1>
        <p className={`t-body fg-muted ${styles.lede}`}>
          {selected ? `Hi ${selected.name}, enter your PIN.` : 'Tap your name to sign in.'}
        </p>
      </header>

      {!selected ? (
        <section className={styles.grid}>
          {staff.isLoading && <div className={styles.empty}>Loading staff…</div>}
          {staff.error && (
            <div className={styles.empty}>
              Failed to load staff. <button type="button" onClick={() => void staff.refetch()}>Retry</button>
            </div>
          )}
          {staff.data && staff.data.length === 0 && (
            <div className={styles.empty}>
              No POS users yet — ask Loo to add staff in Backend → Settings → Staff.
            </div>
          )}
          {staff.data?.map((s) => (
            <button
              key={s.id}
              type="button"
              className={styles.tile}
              onClick={() => { setSelected(s); setErrorMessage(null); }}
            >
              <span className={styles.avatar} style={{ background: s.color }}>{s.initials}</span>
              <span className={styles.tileName}>{s.name}</span>
              <span className={styles.tileCode}>{s.staffCode}</span>
            </button>
          ))}
        </section>
      ) : (
        <section className={styles.padSection}>
          <PinPad
            onComplete={handlePin}
            onCancel={() => { setSelected(null); setErrorMessage(null); setRetryAfter(null); }}
            errorMessage={retryAfter !== null ? `Try again in ${retryAfter}s` : errorMessage}
            busy={busy || (retryAfter !== null && retryAfter > 0)}
          />
        </section>
      )}

      <footer className={styles.footer}>
        <Link to="/login" className={styles.emergencyLink}>
          Sign in with email instead
        </Link>
      </footer>
    </main>
  );
};
```

- [ ] **Step 2: Create the CSS module**

`apps/pos/src/pages/LockScreen.module.css`:
```css
.shell {
  min-height: 100vh; padding: var(--space-5);
  display: flex; flex-direction: column; align-items: center;
  background: var(--c-canvas);
}
.header { text-align: center; margin-bottom: var(--space-5); }
.title { margin: 6px 0 4px; font: var(--t-h1); color: var(--c-ink); }
.lede { max-width: 480px; }
.grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-3); width: 100%; max-width: 800px;
}
.empty {
  grid-column: 1 / -1; padding: var(--space-5);
  text-align: center; color: var(--c-ink-muted);
}
.tile {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: var(--space-4); background: var(--c-paper);
  border: 1px solid var(--c-border-soft); border-radius: 16px;
  cursor: pointer; min-height: 160px;
}
.tile:hover { border-color: var(--c-accent); }
.avatar {
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: white; font: var(--t-h3); font-weight: 600;
}
.tileName { font: var(--t-body); color: var(--c-ink); }
.tileCode { font: var(--t-eyebrow); color: var(--c-ink-muted); }
.padSection { display: flex; justify-content: center; width: 100%; max-width: 400px; }
.footer { margin-top: var(--space-5); }
.emergencyLink {
  color: var(--c-ink-muted); font: var(--t-body-sm); text-decoration: underline;
}
```

- [ ] **Step 3: Sanity check**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/pages/LockScreen.tsx apps/pos/src/pages/LockScreen.module.css
git commit -m "feat(pos): LockScreen — avatar grid + PinPad host"
```

---

## Task 16: AuthGate renders LockScreen inline

**Files:**
- Modify: `apps/pos/src/components/AuthGate.tsx`

- [ ] **Step 1: Replace AuthGate**

Replace the entire contents of `apps/pos/src/components/AuthGate.tsx` with:

```tsx
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { LockScreen } from '../pages/LockScreen';

// LockScreen handles the common path (PIN). The /login route stays available
// as an emergency email/password gate for admin access.
export const AuthGate = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (!user) return <LockScreen />;
  return <>{children}</>;
};
```

- [ ] **Step 2: Sanity check**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/components/AuthGate.tsx
git commit -m "feat(pos): AuthGate renders LockScreen inline (no /login redirect)"
```

---

## Task 17: Topbar "Switch user" label

**Files:**
- Modify: `apps/pos/src/components/Topbar.tsx`

- [ ] **Step 1: Update the sign-out button aria-label + tooltip**

In `apps/pos/src/components/Topbar.tsx`, replace the sign-out button block (lines 109-116):

```tsx
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => void signOut()}
          aria-label="Switch user"
          title="Switch user"
        >
          <LogOut size={18} strokeWidth={1.75} />
        </button>
```

- [ ] **Step 2: Sanity check**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/components/Topbar.tsx
git commit -m "feat(pos): Topbar log-out button labelled Switch user"
```

---

## Task 18: End-to-end manual verification

**Files:** none modified — this is a verification gate.

- [ ] **Step 1: Run the full API test suite**

Run: `pnpm --filter @2990s/api test`
Expected: All tests PASS (existing + new admin + new pos).

- [ ] **Step 2: Run the typecheck across the monorepo**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Boot the dev stack against a Supabase preview/dev project**

Run in separate terminals:
```bash
pnpm --filter @2990s/api dev
pnpm --filter @2990s/backend dev
pnpm --filter @2990s/pos dev
```

Make sure `apps/pos/.env.local` has:
```
VITE_API_URL=http://127.0.0.1:8787
VITE_POS_SHOWROOM_ID=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
```

- [ ] **Step 4: Backend flow — create a sales user with a PIN**

1. Sign in to Backend as Loo (admin role).
2. Navigate to Settings → Staff → "New staff".
3. Fill code=`TEST`, name=`Test User`, role=`sales`, leave email blank, initials=`TS`, pick a colour, pick Showroom KL, PIN=`482917`, confirm PIN=`482917`.
4. Click "Create POS user".
5. Verify: new row appears in the table with email like `test+pos@2990s.local`, status Active.

- [ ] **Step 5: POS flow — PIN login**

1. Open POS (already signed out, or click Switch user).
2. Verify LockScreen lists the new "Test User" avatar.
3. Tap the avatar → PinPad appears.
4. Enter `482917` digit by digit.
5. Verify: app navigates into the catalog; topbar avatar shows `TS`.

- [ ] **Step 6: Error paths**

1. Switch user → tap Test User → enter `000000`. Verify "Invalid PIN — 4 attempts left".
2. Repeat 4 more times. On the 5th wrong entry the message should say "Invalid PIN" (no attempts left). On the 6th it should say "Too many attempts — try again in 60s" with a live countdown.
3. Wait the countdown out (or restart Worker for tests). Try the correct PIN — verify it works.

- [ ] **Step 7: Reset PIN flow**

1. In Backend, open Staff → Test User row → "Set / Reset PIN".
2. Set PIN to `123456` → Save.
3. Switch user on POS → tap Test User → enter `123456` — verify login.
4. Open the PinDrawer again → "Clear PIN (revoke POS access)" → confirm.
5. Reload LockScreen — Test User avatar should disappear (no PIN → not loginnable → filtered out by `GET /pos/sales-staff`).

- [ ] **Step 8: Clean up test user**

In Backend, Deactivate the Test User row. (Don't fully delete — DB-level cleanup is out of scope.)

- [ ] **Step 9: Commit a release marker**

Only commit if any docs/CHANGELOG need touching. Otherwise skip.

---

## Self-review notes

- **Spec coverage:** all 10 sections of the spec have at least one task. §1 (problem) and §2 (constraints) are framing — not tasks. §3 architecture → Tasks 1-7 (API), 8-11 (Backend UI), 12-17 (POS UI). §4 API contract → Tasks 3-6. §5 UI → Tasks 8-11 (Backend), 12-17 (POS). §6 error handling → covered in test cases (3-6). §7 testing → Tasks 1, 2, 3, 4, 5, 6, plus Task 18 manual QA. §8 migration / rollout → Task 18 verification. §9 open questions → none. §10 phased outline → matches the task grouping.
- **Placeholder scan:** No `TBD`, `TODO (implementation)`, or "implement appropriate error handling" left.
- **Type consistency:** `pinLogin(staffId, pin)` signature stable across Tasks 12 + 15. `useSetStaffPin` body `{ id, pin }` stable across Tasks 9 + 11. `SalesStaffRow` defined in Task 13, consumed in Task 15. `__resetRateLimiter` test hook defined in Task 5, used in Task 6 test setup (`beforeEach`).
- **YAGNI carve-outs:** explicit in spec §1: no audit log, no auto-lock, no DB view for `hasPin` indicator, no KV-based rate limiting, no force-revoke session on PIN change. All deferred.
