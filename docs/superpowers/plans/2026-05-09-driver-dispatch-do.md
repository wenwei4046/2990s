# Driver + Dispatch + DO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable lanes 5+6 (dispatched, delivered) by adding driver picker + confirmed delivery date + DO file upload to OrderDrawer, with server-side lane gates that prevent advancing without required fields.

**Architecture:** Two new `orders` columns (`confirmed_delivery_date`, `do_key`). Coordinator picks driver via cards UI at lane=ready; PATCH `/dispatch-prep` writes 3 fields atomically. DO file uploads via Supabase JS direct to Supabase Storage `dos` bucket (avoids R2 setup); PATCH `/do` verifies file exists then attaches `do_key`. Lane PATCH gains gate validation. Step-back never clears state (audit trail).

**Tech Stack:** TypeScript strict, React 19 + Vite 6 + React Router 7 (Backend), Hono on CF Workers (API), Drizzle + Supabase Postgres + Supabase Storage, Vitest, CSS Modules, TanStack Query.

**Spec source:** `docs/superpowers/specs/2026-05-09-driver-dispatch-do-design.md` (committed 13c8ddb).

**Total scope:** 14 files (8 new + 6 modify), 13 tasks across 4 phases. Estimated 4-5 days for an experienced executor.

**Red line gates:** Tasks 0.1, 0.2 are STOP-points where the executor MUST get explicit "yes" from Loo before applying SQL. No exceptions. (M1 is ALTER TABLE schema change; M2 creates Storage RLS policies — both touch red line #4.)

**No external infra needed:** Unlike Slip MVP, this sub-project does not require R2 bucket creation or wrangler secrets. Supabase Storage bucket created via M2 SQL.

---

## Phase 0 — Migrations (RED LINE GATES)

### Task 0.1: Apply M1 — `0012_dispatch_columns.sql` (RED LINE GATE)

**Files:**
- Create: `packages/db/migrations/0012_dispatch_columns.sql`

- [ ] **Step 1: Write the migration file**

Create `packages/db/migrations/0012_dispatch_columns.sql`:

```sql
-- 0012_dispatch_columns.sql
-- Phase 4 sub-project C: dispatch columns on orders.
-- Both nullable — set by coordinator after order creation.

ALTER TABLE orders
  ADD COLUMN confirmed_delivery_date date,
  ADD COLUMN do_key text;
```

- [ ] **Step 2: STOP and ask Loo for explicit yes**

Send:
```
要 apply M1 (0012_dispatch_columns.sql) 到 Supabase。

SQL 已写入 packages/db/migrations/0012_dispatch_columns.sql：
ALTER TABLE orders
  ADD COLUMN confirmed_delivery_date date,
  ADD COLUMN do_key text;

效果：
- orders 表加 2 个 nullable column
- confirmed_delivery_date: coordinator 跟客户确认后填入的实际送货日期
- do_key: Supabase Storage path of signed Delivery Order
- 现存 orders 不受影响（nullable，不需要 backfill）

Apply 吗？回 "yes" 我才执行 mcp__supabase__apply_migration。
```

- [ ] **Step 3: After yes, apply via MCP**

Use `mcp__supabase__apply_migration` with name `0012_dispatch_columns` and the SQL.

- [ ] **Step 4: Verify the columns exist**

Use `mcp__supabase__execute_sql`:
```sql
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='orders'
   AND column_name IN ('confirmed_delivery_date', 'do_key')
 ORDER BY column_name;
```
Expected: 2 rows (confirmed_delivery_date date YES, do_key text YES).

- [ ] **Step 5: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add packages/db/migrations/0012_dispatch_columns.sql
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(db): add confirmed_delivery_date + do_key columns to orders — Driver+Dispatch+DO"
```

---

### Task 0.2: Apply M2 — `0013_storage_bucket_dos.sql` (RED LINE GATE)

**Files:**
- Create: `packages/db/migrations/0013_storage_bucket_dos.sql`

- [ ] **Step 1: Write the migration file**

Create `packages/db/migrations/0013_storage_bucket_dos.sql`:

```sql
-- 0013_storage_bucket_dos.sql
-- Phase 4 sub-project C: private Supabase Storage bucket for signed DO files.
-- Coordinator+ uploads + reads via Supabase JS direct (no API mediation needed).
-- DELETE restricted to admin (audit material).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dos', 'dos', false, 5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "dos_select_coord"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'dos' AND public.is_coordinator_or_above());

CREATE POLICY "dos_insert_coord"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'dos' AND public.is_coordinator_or_above());

CREATE POLICY "dos_update_coord"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'dos' AND public.is_coordinator_or_above())
  WITH CHECK (bucket_id = 'dos' AND public.is_coordinator_or_above());

CREATE POLICY "dos_delete_admin"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'dos' AND public.is_admin());
```

- [ ] **Step 2: STOP and ask Loo for explicit yes**

Send:
```
要 apply M2 (0013_storage_bucket_dos.sql) 到 Supabase。

[paste full SQL]

效果：
- 创建 private storage bucket 'dos'（5MB cap, 4 MIME 白名单）
- storage.objects 加 4 条 RLS policy：
  - SELECT: coordinator+ (任何 dos bucket file)
  - INSERT: coordinator+ 上传
  - UPDATE: coordinator+ 替换 (upsert)
  - DELETE: admin only (DO 是 audit material)
- ON CONFLICT 让 bucket 创建 idempotent

Apply 吗？回 "yes" 我才执行。
```

- [ ] **Step 3: After yes, apply via MCP**

Use `mcp__supabase__apply_migration` with name `0013_storage_bucket_dos`.

- [ ] **Step 4: Verify bucket exists + policies attached**

```sql
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'dos';
```
Expected: 1 row.

```sql
SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'dos_%' ORDER BY policyname;
```
Expected: 4 rows (dos_delete_admin, dos_insert_coord, dos_select_coord, dos_update_coord).

- [ ] **Step 5: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add packages/db/migrations/0013_storage_bucket_dos.sql
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(db): create dos storage bucket + RLS policies — Driver+Dispatch+DO"
```

---

### Task 0.3: Update Drizzle schema mirror

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Read current orders table definition**

Run: `Read packages/db/src/schema.ts` and locate the `orders` pgTable definition.

- [ ] **Step 2: Add 2 new columns**

Find the existing `// Delivery` section (with `deliveryDate: date(...)`). After `deliveryNotes: text('delivery_notes'),` add:

```typescript
  // Phase 4-C dispatch additions (migration 0012):
  confirmedDeliveryDate: date('confirmed_delivery_date'),
```

Find the existing `// Dispatch` section (with `dispatchedAt`). After `doSigned: boolean('do_signed').notNull().default(false),` add:

```typescript
  doKey:         text('do_key'),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/db typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add packages/db/src/schema.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "chore(db): Drizzle schema mirror for confirmed_delivery_date + do_key — Driver+Dispatch+DO"
```

---

## Phase 1 — API endpoints

### Task 1.1: DO key validation helper + unit tests (TDD)

**Files:**
- Create: `apps/api/src/lib/dispatch.ts`
- Create: `apps/api/src/lib/dispatch.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/lib/dispatch.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isValidDoKey, isValidLaneTransition } from './dispatch';

describe('isValidDoKey', () => {
  it.each([
    ['dos/2026/05/SO-2050-1715251200000.jpg', true],
    ['dos/2026/12/SO-2099-9.jpeg', true],
    ['dos/2026/05/SO-2050.png', true],
    ['dos/2026/05/SO-2050.webp', true],
    ['dos/2026/05/SO-2050.pdf', true],
  ])('accepts valid path %s', (path, ok) => {
    expect(isValidDoKey(path)).toBe(ok);
  });

  it('rejects path traversal', () => {
    expect(isValidDoKey('dos/../auth/keys.json')).toBe(false);
    expect(isValidDoKey('dos/2026/05/../../etc/passwd')).toBe(false);
  });

  it('rejects wrong prefix', () => {
    expect(isValidDoKey('slips/2026/05/x.jpg')).toBe(false);
    expect(isValidDoKey('public/x.jpg')).toBe(false);
    expect(isValidDoKey('x.jpg')).toBe(false);
  });

  it('rejects unsupported extension', () => {
    expect(isValidDoKey('dos/2026/05/x.exe')).toBe(false);
    expect(isValidDoKey('dos/2026/05/x.tiff')).toBe(false);
    expect(isValidDoKey('dos/2026/05/x')).toBe(false);
  });

  it('rejects bad year/month format', () => {
    expect(isValidDoKey('dos/26/05/x.jpg')).toBe(false);
    expect(isValidDoKey('dos/2026/5/x.jpg')).toBe(false);
  });
});

describe('isValidLaneTransition', () => {
  // Forward / step-back matrix
  it.each([
    // [from, to, allowed]
    ['received', 'proceed', true],
    ['proceed', 'logistics', true],
    ['logistics', 'ready', true],
    ['ready', 'dispatched', true],   // gate enforced separately
    ['dispatched', 'delivered', true], // gate enforced separately
    // Step backward (always allowed)
    ['delivered', 'dispatched', true],
    ['delivered', 'received', true],
    ['ready', 'logistics', true],
    // Same lane (no-op = invalid)
    ['received', 'received', false],
    // Skipping lanes forward (not allowed)
    ['received', 'ready', false],
    ['proceed', 'dispatched', false],
    // Cancelled (terminal-ish; allowed from any non-cancelled)
    ['ready', 'cancelled', true],
    ['cancelled', 'received', true], // un-cancel is allowed
  ])('%s → %s = %s', (from, to, allowed) => {
    expect(isValidLaneTransition(from as any, to as any)).toBe(allowed);
  });
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `pnpm --filter @2990s/api test dispatch.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement dispatch.ts**

Create `apps/api/src/lib/dispatch.ts`:

```typescript
const DO_KEY_RE = /^dos\/\d{4}\/\d{2}\/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|pdf)$/;

export function isValidDoKey(key: string): boolean {
  // Reject path traversal explicitly (regex anchors handle most cases but be defensive)
  if (key.includes('..')) return false;
  return DO_KEY_RE.test(key);
}

export type Lane = 'received' | 'proceed' | 'logistics' | 'ready' | 'dispatched' | 'delivered' | 'cancelled';

const FORWARD_ORDER: Lane[] = ['received', 'proceed', 'logistics', 'ready', 'dispatched', 'delivered'];

/**
 * A transition is valid when:
 *   - from ≠ to
 *   - Forward = step exactly +1 in FORWARD_ORDER
 *   - Backward = any earlier lane in FORWARD_ORDER (step back / coord override)
 *   - to=cancelled allowed from any non-cancelled lane
 *   - from=cancelled allowed to any lane (un-cancel)
 *
 * Gate enforcement (driver_id, do_key) happens separately in route.
 */
export function isValidLaneTransition(from: Lane, to: Lane): boolean {
  if (from === to) return false;
  if (to === 'cancelled') return from !== 'cancelled';
  if (from === 'cancelled') return true;

  const fromIdx = FORWARD_ORDER.indexOf(from);
  const toIdx = FORWARD_ORDER.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return false;

  // Forward: only +1
  if (toIdx > fromIdx) return toIdx === fromIdx + 1;
  // Backward: any earlier
  return true;
}
```

- [ ] **Step 4: Run test → PASS**

Run: `pnpm --filter @2990s/api test dispatch.test`
Expected: all pass (~25 cases).

- [ ] **Step 5: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/lib/dispatch.ts apps/api/src/lib/dispatch.test.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(api): dispatch helpers — DO key validation + lane transition matrix — Driver+Dispatch+DO"
```

---

### Task 1.2: Modify lane PATCH — add gates, un-block dispatched/delivered

**Files:**
- Modify: `apps/api/src/routes/orders.ts`

- [ ] **Step 1: Read current `PATCH /:id/lane` handler**

Run: `Read apps/api/src/routes/orders.ts` — find the `orders.patch('/:id/lane', ...)` handler (currently blocks dispatched/delivered with 400).

- [ ] **Step 2: Replace lane handler with gate-aware version**

Replace the existing handler with:

```typescript
import { isValidDoKey, isValidLaneTransition, type Lane } from '../lib/dispatch';

orders.patch('/:id/lane', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !COORDINATOR_ROLES.has(role)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const orderId = c.req.param('id');
  const staffId = c.get('user').id;
  const supabase = c.get('supabase');

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const lane = body?.lane as Lane;
  if (typeof lane !== 'string' || !VALID_LANES.has(lane)) {
    return c.json({ error: 'invalid_lane' }, 400);
  }

  // Fetch order — need lane + dispatch fields for gate validation
  const { data: row, error: fetchErr } = await supabase
    .from('orders')
    .select('lane, driver_id, confirmed_delivery_date, do_key, dispatched_at, delivered_at')
    .eq('id', orderId)
    .maybeSingle();
  if (fetchErr) return c.json({ error: 'db_fetch_failed', detail: fetchErr.message }, 500);
  if (!row) return c.json({ error: 'order_not_found' }, 404);

  // Validate transition is allowed structurally
  if (!isValidLaneTransition(row.lane as Lane, lane)) {
    return c.json({ error: 'invalid_transition', from: row.lane, to: lane }, 400);
  }

  // Determine if forward (gate-relevant) vs backward (no gates)
  const FORWARD_ORDER = ['received', 'proceed', 'logistics', 'ready', 'dispatched', 'delivered'];
  const fromIdx = FORWARD_ORDER.indexOf(row.lane);
  const toIdx = FORWARD_ORDER.indexOf(lane);
  const isForward = toIdx > fromIdx;

  // Gate validation (only on forward transitions to dispatched/delivered)
  if (isForward && lane === 'dispatched') {
    const missing: string[] = [];
    if (!row.driver_id) missing.push('driver_id');
    if (!row.confirmed_delivery_date) missing.push('confirmed_delivery_date');
    if (missing.length > 0) {
      return c.json({ error: 'lane_gate_failed', missing }, 422);
    }
  }
  if (isForward && lane === 'delivered') {
    if (!row.do_key) {
      return c.json({ error: 'lane_gate_failed', missing: ['do_key'] }, 422);
    }
  }

  // Auto-stamp timestamps on first forward entry (idempotent for step-back/forward)
  const updateFields: any = { lane };
  let dispatchedAt: string | undefined;
  let deliveredAt: string | undefined;
  let doSignedSet: boolean | undefined;
  if (isForward && lane === 'dispatched' && !row.dispatched_at) {
    dispatchedAt = new Date().toISOString();
    updateFields.dispatched_at = dispatchedAt;
  }
  if (isForward && lane === 'delivered' && !row.delivered_at) {
    deliveredAt = new Date().toISOString();
    updateFields.delivered_at = deliveredAt;
    updateFields.do_signed = true;
    doSignedSet = true;
  }

  const { error: updateErr } = await supabase
    .from('orders')
    .update(updateFields)
    .eq('id', orderId);
  if (updateErr) return c.json({ error: 'db_update_failed', detail: updateErr.message }, 500);

  await supabase.from('order_lane_history').insert({
    order_id: orderId,
    from_lane: row.lane,
    to_lane: lane,
    changed_by: staffId,
  });

  return c.json({
    orderId,
    lane,
    fromLane: row.lane,
    ...(dispatchedAt ? { dispatchedAt } : {}),
    ...(deliveredAt ? { deliveredAt } : {}),
    ...(doSignedSet !== undefined ? { doSigned: doSignedSet } : {}),
  });
});
```

Note: keep the existing `VALID_LANES` Set declaration in the file. Remove the old `if (lane === 'dispatched' || lane === 'delivered')` block.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/routes/orders.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(api): lane PATCH gates for dispatched + delivered, auto-stamp timestamps — Driver+Dispatch+DO"
```

---

### Task 1.3: Add `PATCH /orders/:id/dispatch-prep`

**Files:**
- Modify: `apps/api/src/routes/orders.ts`

- [ ] **Step 1: Append handler to orders.ts**

Add after the lane PATCH handler:

```typescript
orders.patch('/:id/dispatch-prep', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !COORDINATOR_ROLES.has(role)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const orderId = c.req.param('id');
  const supabase = c.get('supabase');

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const driverId = body?.driverId === null ? null : (typeof body?.driverId === 'string' ? body.driverId : undefined);
  const confirmedDeliveryDate = body?.confirmedDeliveryDate === null
    ? null
    : (typeof body?.confirmedDeliveryDate === 'string' ? body.confirmedDeliveryDate : undefined);
  const confirmedWith = typeof body?.confirmedWith === 'string' ? body.confirmedWith : undefined;

  // Validate driverId if non-null: must exist + active
  if (driverId !== null && driverId !== undefined) {
    const { data: drv, error: drvErr } = await supabase
      .from('drivers')
      .select('id, active')
      .eq('id', driverId)
      .maybeSingle();
    if (drvErr) return c.json({ error: 'db_fetch_failed', detail: drvErr.message }, 500);
    if (!drv || !drv.active) return c.json({ error: 'driver_not_found_or_inactive' }, 404);
  }

  // Validate confirmedDeliveryDate if non-null: ISO date format + not in past
  if (confirmedDeliveryDate !== null && confirmedDeliveryDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(confirmedDeliveryDate)) {
      return c.json({ error: 'invalid_date_format' }, 400);
    }
    const today = new Date().toISOString().slice(0, 10);
    if (confirmedDeliveryDate < today) {
      return c.json({ error: 'confirmed_date_in_past' }, 400);
    }
  }

  // Validate confirmedWith length if provided
  if (confirmedWith !== undefined && confirmedWith.length > 200) {
    return c.json({ error: 'confirmed_with_too_long' }, 400);
  }

  // Build update object — only include keys explicitly provided (allow null to clear)
  const updateFields: Record<string, any> = {};
  if (driverId !== undefined) updateFields.driver_id = driverId;
  if (confirmedDeliveryDate !== undefined) updateFields.confirmed_delivery_date = confirmedDeliveryDate;
  if (confirmedWith !== undefined) updateFields.confirmed_with = confirmedWith;

  if (Object.keys(updateFields).length === 0) {
    return c.json({ error: 'empty_update' }, 400);
  }

  const { data: row, error: updateErr } = await supabase
    .from('orders')
    .update(updateFields)
    .eq('id', orderId)
    .select('id, driver_id, confirmed_delivery_date, confirmed_with')
    .maybeSingle();
  if (updateErr) return c.json({ error: 'db_update_failed', detail: updateErr.message }, 500);
  if (!row) return c.json({ error: 'order_not_found' }, 404);

  return c.json({
    orderId: row.id,
    driverId: row.driver_id,
    confirmedDeliveryDate: row.confirmed_delivery_date,
    confirmedWith: row.confirmed_with,
  });
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/routes/orders.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(api): PATCH /orders/:id/dispatch-prep endpoint — Driver+Dispatch+DO"
```

---

### Task 1.4: Add `PATCH /orders/:id/do` with Storage HEAD verification

**Files:**
- Modify: `apps/api/src/routes/orders.ts`

- [ ] **Step 1: Append handler to orders.ts**

Add after dispatch-prep:

```typescript
orders.patch('/:id/do', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !COORDINATOR_ROLES.has(role)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const orderId = c.req.param('id');
  const staffId = c.get('user').id;
  const supabase = c.get('supabase');

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const doKey = body?.doKey;
  if (typeof doKey !== 'string' || !isValidDoKey(doKey)) {
    return c.json({ error: 'invalid_do_key_format' }, 400);
  }

  // Verify file exists in storage. Service-role client needed (auth-scoped client
  // works via RLS but we want a definitive check independent of caller's policies).
  // The existing supabase client in context is auth-scoped; use it — RLS allows
  // coordinator+ to SELECT 'dos' bucket so this works. (If sales somehow hit this,
  // role check above blocks earlier.)
  const { data: signedUrl, error: signErr } = await supabase.storage
    .from('dos')
    .createSignedUrl(doKey, 1); // 1-second TTL just to verify existence
  if (signErr || !signedUrl) {
    return c.json({ error: 'do_file_not_in_storage', detail: signErr?.message }, 404);
  }

  // Read previous do_key for audit
  const { data: prevRow } = await supabase
    .from('orders')
    .select('do_key')
    .eq('id', orderId)
    .maybeSingle();
  const previousKey = prevRow?.do_key ?? null;

  const uploadedAt = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('orders')
    .update({ do_key: doKey })
    .eq('id', orderId);
  if (updateErr) return c.json({ error: 'db_update_failed', detail: updateErr.message }, 500);

  await supabase.from('order_slip_events').insert({
    order_id: orderId,
    event: 'do_uploaded',
    actor_id: staffId,
    meta: { do_key: doKey, replaces: previousKey },
  });

  return c.json({ orderId, doKey, uploadedAt });
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: no errors.

- [ ] **Step 3: Run all api tests to ensure existing pass**

Run: `pnpm --filter @2990s/api test`
Expected: all pass (existing 29 + new dispatch unit tests).

- [ ] **Step 4: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/routes/orders.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(api): PATCH /orders/:id/do endpoint with Storage HEAD verify — Driver+Dispatch+DO"
```

---

## Phase 2 — Backend lib + queries

### Task 2.1: Extend OrderDetail + add useDrivers hook

**Files:**
- Modify: `apps/backend/src/lib/queries.ts`

- [ ] **Step 1: Read current queries.ts to find OrderDetail + select clause**

Run: `Read apps/backend/src/lib/queries.ts` (lines around `OrderDetail` interface + `useOrderDetail` query).

- [ ] **Step 2: Extend OrderDetail interface**

Find `export interface OrderDetail {` and add to the interface body (alphabetized OK):

```typescript
  driverId: string | null;
  confirmedDeliveryDate: string | null;  // ISO date 'YYYY-MM-DD' or null
  confirmedWith: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  doSigned: boolean;
  doKey: string | null;
  deliveryDate: string | null;  // existing customer's expected — needed for override warning
```

- [ ] **Step 3: Extend select clause + mapping**

Find the `useOrderDetail` query function. In the `.select(...)` argument, append columns:
```
'driver_id, confirmed_delivery_date, confirmed_with, dispatched_at, delivered_at, do_signed, do_key, delivery_date'
```

In the return mapping, add:
```typescript
        driverId: r.driver_id,
        confirmedDeliveryDate: r.confirmed_delivery_date,
        confirmedWith: r.confirmed_with,
        dispatchedAt: r.dispatched_at,
        deliveredAt: r.delivered_at,
        doSigned: r.do_signed,
        doKey: r.do_key,
        deliveryDate: r.delivery_date,
```

- [ ] **Step 4: Add useDrivers hook**

Append to queries.ts (near useOrderDetail):

```typescript
export interface DriverRow {
  id: string;
  driverCode: string;
  name: string;
  phone: string;
  icNumber: string | null;
  vehicle: string | null;
  active: boolean;
}

export const useDrivers = () =>
  useQuery({
    queryKey: ['drivers'],
    queryFn: async (): Promise<DriverRow[]> => {
      const { data, error } = await supabase
        .from('drivers')
        .select('id, driver_code, name, phone, ic_number, vehicle, active')
        .order('driver_code');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        driverCode: r.driver_code,
        name: r.name,
        phone: r.phone,
        icNumber: r.ic_number,
        vehicle: r.vehicle,
        active: r.active,
      }));
    },
    staleTime: 60_000,
  });
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/lib/queries.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend): extend OrderDetail with dispatch fields + useDrivers hook — Driver+Dispatch+DO"
```

---

### Task 2.2: Create dispatch.ts client lib

**Files:**
- Create: `apps/backend/src/lib/dispatch.ts`

- [ ] **Step 1: Implement dispatch.ts**

Create:

```typescript
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  return token;
}

/** Build storage path: dos/YYYY/MM/{orderId}-{ts}.{ext} */
export function buildDoPath(orderId: string, contentType: string, now = new Date()): string {
  const ext = ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
  } as const)[contentType as 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'];
  if (!ext) throw new Error(`unsupported MIME: ${contentType}`);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `dos/${yyyy}/${mm}/${orderId}-${now.getTime()}.${ext}`;
}

export async function uploadDoFile(orderId: string, file: File): Promise<string> {
  const path = buildDoPath(orderId, file.type);
  const { error } = await supabase.storage.from('dos').upload(path, file, {
    contentType: file.type,
    upsert: true,
  });
  if (error) throw error;
  return path;
}

export async function getDoSignedUrl(doKey: string, ttlSeconds = 60 * 5): Promise<string> {
  const { data, error } = await supabase.storage.from('dos').createSignedUrl(doKey, ttlSeconds);
  if (error || !data) throw error ?? new Error('signed url failed');
  return data.signedUrl;
}

export async function patchDispatchPrep(orderId: string, payload: {
  driverId?: string | null;
  confirmedDeliveryDate?: string | null;
  confirmedWith?: string;
}): Promise<void> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const token = await getToken();
  const res = await fetch(`${API_URL}/orders/${encodeURIComponent(orderId)}/dispatch-prep`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`dispatch-prep failed (${res.status}): ${text}`);
  }
}

export async function patchOrderDo(orderId: string, doKey: string): Promise<void> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const token = await getToken();
  const res = await fetch(`${API_URL}/orders/${encodeURIComponent(orderId)}/do`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ doKey }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`do PATCH failed (${res.status}): ${text}`);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/lib/dispatch.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend): dispatch client lib — Supabase Storage upload + dispatch-prep/do PATCH helpers — Driver+Dispatch+DO"
```

---

## Phase 3 — Backend components

### Task 3.1: DriverPickerSection component

**Files:**
- Create: `apps/backend/src/components/DriverPickerSection.tsx`
- Create: `apps/backend/src/components/DriverPickerSection.module.css`

- [ ] **Step 1: Implement DriverPickerSection.tsx**

Create:

```typescript
import { useEffect, useRef, useState } from 'react';
import { useDrivers } from '../lib/queries';
import { patchDispatchPrep } from '../lib/dispatch';
import styles from './DriverPickerSection.module.css';

interface Props {
  orderId: string;
  driverId: string | null;
  confirmedDeliveryDate: string | null;
  confirmedWith: string | null;
  customerExpectedDate: string | null;
  onSaved: () => void;
}

export function DriverPickerSection({
  orderId, driverId, confirmedDeliveryDate, confirmedWith, customerExpectedDate, onSaved,
}: Props) {
  const drivers = useDrivers();
  const activeDrivers = (drivers.data ?? []).filter((d) => d.active);

  const [localDriverId, setLocalDriverId] = useState(driverId);
  const [localDate, setLocalDate] = useState(confirmedDeliveryDate ?? '');
  const [localNote, setLocalNote] = useState(confirmedWith ?? '');
  const [error, setError] = useState<string | null>(null);

  // Sync from props if external Realtime updates arrive
  useEffect(() => {
    setLocalDriverId(driverId);
    setLocalDate(confirmedDeliveryDate ?? '');
    setLocalNote(confirmedWith ?? '');
  }, [driverId, confirmedDeliveryDate, confirmedWith]);

  // Debounced save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerSave = (payload: { driverId?: string | null; confirmedDeliveryDate?: string | null; confirmedWith?: string }) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setError(null);
      try {
        await patchDispatchPrep(orderId, payload);
        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
    }, 500);
  };

  const handleDriverPick = (id: string) => {
    setLocalDriverId(id);
    triggerSave({ driverId: id });
  };

  const handleDateChange = (v: string) => {
    setLocalDate(v);
    triggerSave({ confirmedDeliveryDate: v || null });
  };

  const handleNoteChange = (v: string) => {
    setLocalNote(v);
    triggerSave({ confirmedWith: v });
  };

  const overrideWarning = customerExpectedDate && localDate && customerExpectedDate !== localDate;

  return (
    <section className={styles.root}>
      <h3 className={styles.heading}>Assign driver to dispatch</h3>

      {drivers.isLoading && <p className={styles.muted}>Loading drivers…</p>}

      {!drivers.isLoading && activeDrivers.length === 0 && (
        <div className={styles.empty}>
          No active drivers — add one in Settings → Drivers (or via Supabase Studio for now).
        </div>
      )}

      {activeDrivers.length > 0 && (
        <div className={styles.cards}>
          {activeDrivers.map((d) => (
            <label
              key={d.id}
              className={`${styles.card} ${localDriverId === d.id ? styles.selected : ''}`}
            >
              <input
                type="radio"
                name={`driver-${orderId}`}
                checked={localDriverId === d.id}
                onChange={() => handleDriverPick(d.id)}
              />
              <div className={styles.cardMain}>
                <div className={styles.cardName}>{d.name}</div>
                <div className={styles.cardMeta}>
                  {d.phone}
                  {d.icNumber ? ` · IC ${d.icNumber}` : ''}
                </div>
                {d.vehicle && <div className={styles.cardVehicle}>{d.vehicle}</div>}
              </div>
            </label>
          ))}
        </div>
      )}

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>Confirmed delivery date *</span>
          <input
            type="date"
            value={localDate}
            onChange={(e) => handleDateChange(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Confirmation note</span>
          <input
            type="text"
            value={localNote}
            onChange={(e) => handleNoteChange(e.target.value)}
            placeholder="e.g. Phoned 2pm window"
            maxLength={200}
          />
        </label>
      </div>

      {overrideWarning && (
        <div className={styles.override}>
          ⓘ This will override the customer's expected date <b>{customerExpectedDate}</b> → <b>{localDate}</b>.
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
```

- [ ] **Step 2: Create CSS module**

Create `apps/backend/src/components/DriverPickerSection.module.css`:

```css
.root {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-top: 1px solid var(--c-line);
}
.heading {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--c-ink);
}
.muted { color: var(--fg-muted); margin: 0; }
.error { color: #B33; margin: 0; }
.empty {
  padding: 16px;
  background: rgba(179, 51, 51, 0.05);
  border: 1px dashed var(--c-line);
  border-radius: 6px;
  font-size: 13px;
  color: var(--fg-muted);
}
.cards {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}
.card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  cursor: pointer;
  background: var(--c-cream);
}
.card input[type="radio"] {
  margin: 0;
}
.card.selected {
  border-color: #2F5D4F;
  background: rgba(47, 93, 79, 0.06);
}
.cardMain { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.cardName { font-weight: 600; font-size: 14px; color: var(--c-ink); }
.cardMeta { font-size: 12px; color: var(--fg-muted); }
.cardVehicle { font-size: 12px; color: var(--c-ink); }
.fields {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 12px;
}
.field { display: flex; flex-direction: column; gap: 4px; }
.label { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: var(--fg-muted); text-transform: uppercase; }
.field input {
  font: inherit;
  padding: 8px;
  border: 1px solid var(--c-line);
  border-radius: 4px;
}
.override {
  padding: 8px 12px;
  background: rgba(255, 165, 0, 0.08);
  border-left: 3px solid #B87800;
  font-size: 13px;
  color: var(--c-ink);
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/components/DriverPickerSection.tsx apps/backend/src/components/DriverPickerSection.module.css
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend): DriverPickerSection (cards UI + debounced PATCH dispatch-prep) — Driver+Dispatch+DO"
```

---

### Task 3.2: DispatchSection component

**Files:**
- Create: `apps/backend/src/components/DispatchSection.tsx`
- Create: `apps/backend/src/components/DispatchSection.module.css`

- [ ] **Step 1: Implement DispatchSection.tsx**

Create:

```typescript
import { useEffect, useState } from 'react';
import { fmtTime } from '@2990s/shared';
import { uploadDoFile, patchOrderDo, getDoSignedUrl } from '../lib/dispatch';
import { useDrivers } from '../lib/queries';
import styles from './DispatchSection.module.css';

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 5 * 1024 * 1024;

interface Props {
  orderId: string;
  lane: 'dispatched' | 'delivered';
  driverId: string | null;
  confirmedWith: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  doKey: string | null;
  onUpdated: () => void;
}

export function DispatchSection({
  orderId, lane, driverId, confirmedWith, dispatchedAt, deliveredAt, doKey, onUpdated,
}: Props) {
  const drivers = useDrivers();
  const driver = drivers.data?.find((d) => d.id === driverId) ?? null;

  const [doUrl, setDoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Fetch signed URL for display whenever doKey changes
  useEffect(() => {
    if (!doKey) {
      setDoUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const url = await getDoSignedUrl(doKey);
        if (!cancelled) setDoUrl(url);
      } catch (err) {
        if (!cancelled) setUploadError(err instanceof Error ? err.message : 'Failed to load DO');
      }
    })();
    return () => { cancelled = true; };
  }, [doKey]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setUploadError(null);
    if (!ALLOWED_MIMES.includes(file.type)) {
      setUploadError('Only JPG / PNG / WebP / PDF supported.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setUploadError('File too large (max 5 MB).');
      return;
    }
    setUploading(true);
    try {
      const path = await uploadDoFile(orderId, file);
      await patchOrderDo(orderId, path);
      onUpdated();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className={styles.root}>
      <h3 className={styles.heading}>
        {lane === 'dispatched' ? 'Dispatch & DO sign-off' : 'Delivered'}
      </h3>

      <div className={styles.info}>
        <div><b>Driver</b><span>{driver ? `${driver.name} · ${driver.vehicle ?? driver.phone}` : (driverId ?? '—')}</span></div>
        <div><b>Customer slot</b><span>{confirmedWith ?? '—'}</span></div>
        {dispatchedAt && (
          <div><b>Dispatched at</b><span>{fmtTime(dispatchedAt)}</span></div>
        )}
        {deliveredAt && (
          <div><b>Delivered at</b><span>{fmtTime(deliveredAt)}</span></div>
        )}
      </div>

      {/* DO upload area — interactive at lane=dispatched, read-only at delivered */}
      {lane === 'dispatched' && (
        <div className={styles.doBlock}>
          <h4 className={styles.subheading}>Delivery Order (DO)</h4>
          {!doKey && (
            <label className={styles.dropZone}>
              <input
                type="file"
                accept={ALLOWED_MIMES.join(',')}
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                style={{ display: 'none' }}
                disabled={uploading}
              />
              <div className={styles.dropContent}>
                {uploading ? 'Uploading…' : 'Click to upload signed DO (image or PDF)'}
              </div>
            </label>
          )}
          {doKey && (
            <div className={styles.uploaded}>
              <div className={styles.uploadedHead}>
                <span className={styles.uploadedName}>✓ DO uploaded</span>
                <button
                  type="button"
                  className={styles.replace}
                  disabled={uploading}
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = ALLOWED_MIMES.join(',');
                    input.onchange = (e) => handleFile((e.target as HTMLInputElement).files?.[0] ?? null);
                    input.click();
                  }}
                >
                  Replace
                </button>
              </div>
              {doUrl && doKey.endsWith('.pdf') ? (
                <iframe src={doUrl} title="DO" className={styles.preview} />
              ) : doUrl ? (
                <img src={doUrl} alt="DO" className={styles.preview} />
              ) : (
                <div className={styles.muted}>Loading preview…</div>
              )}
            </div>
          )}
          {uploadError && <p className={styles.error}>{uploadError}</p>}
        </div>
      )}

      {/* Delivered terminal display — DO file link only */}
      {lane === 'delivered' && doKey && doUrl && (
        <div className={styles.uploaded}>
          <div className={styles.uploadedHead}>
            <span className={styles.uploadedName}>DO file</span>
            <a className={styles.replace} href={doUrl} target="_blank" rel="noreferrer">Open in new tab</a>
          </div>
          {doKey.endsWith('.pdf') ? (
            <iframe src={doUrl} title="DO" className={styles.preview} />
          ) : (
            <img src={doUrl} alt="DO" className={styles.preview} />
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Create CSS module**

Create `apps/backend/src/components/DispatchSection.module.css`:

```css
.root { display: flex; flex-direction: column; gap: 16px; padding: 16px; border-top: 1px solid var(--c-line); }
.heading { margin: 0; font-size: 16px; font-weight: 600; color: var(--c-ink); }
.subheading { margin: 0; font-size: 14px; font-weight: 600; color: var(--c-ink); }
.info {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 24px;
  padding: 12px;
  background: rgba(0,0,0,0.02);
  border-radius: 6px;
  font-size: 14px;
}
.info > div { display: flex; flex-direction: column; gap: 2px; }
.info b {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--fg-muted);
  text-transform: uppercase;
}
.doBlock { display: flex; flex-direction: column; gap: 8px; }
.dropZone {
  display: block;
  padding: 24px;
  border: 2px dashed var(--c-line);
  border-radius: 6px;
  text-align: center;
  cursor: pointer;
  background: var(--c-cream);
}
.dropZone:hover { border-color: var(--c-ink); }
.dropContent { color: var(--fg-muted); font-size: 14px; }
.uploaded { display: flex; flex-direction: column; gap: 8px; }
.uploadedHead { display: flex; justify-content: space-between; align-items: center; }
.uploadedName { font-weight: 500; color: #2F5D4F; }
.replace {
  background: white;
  border: 1px solid var(--c-line);
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  color: var(--c-ink);
  text-decoration: none;
}
.preview {
  max-width: 100%;
  max-height: 480px;
  border-radius: 4px;
  border: 1px solid var(--c-line);
}
.muted { color: var(--fg-muted); font-style: italic; }
.error { color: #B33; }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/components/DispatchSection.tsx apps/backend/src/components/DispatchSection.module.css
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend): DispatchSection (info + DO upload + delivered terminal) — Driver+Dispatch+DO"
```

---

### Task 3.3: Modify OrderDrawer to render new sections

**Files:**
- Modify: `apps/backend/src/components/OrderDrawer.tsx`

- [ ] **Step 1: Read current OrderDrawer.tsx**

Find where SlipSection is rendered.

- [ ] **Step 2: Add imports + conditional renders**

At the top with other imports:
```typescript
import { DriverPickerSection } from './DriverPickerSection';
import { DispatchSection } from './DispatchSection';
```

Inside the `{order && (...)}` block, AFTER the existing `<SlipSection ... />` but before the closing `</div>`, add:

```tsx
            {order.lane === 'ready' && (
              <DriverPickerSection
                orderId={orderId}
                driverId={order.driverId}
                confirmedDeliveryDate={order.confirmedDeliveryDate}
                confirmedWith={order.confirmedWith}
                customerExpectedDate={order.deliveryDate}
                onSaved={refresh}
              />
            )}

            {(order.lane === 'dispatched' || order.lane === 'delivered') && (
              <DispatchSection
                orderId={orderId}
                lane={order.lane as 'dispatched' | 'delivered'}
                driverId={order.driverId}
                confirmedWith={order.confirmedWith}
                dispatchedAt={order.dispatchedAt}
                deliveredAt={order.deliveredAt}
                doKey={order.doKey}
                onUpdated={refresh}
              />
            )}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/components/OrderDrawer.tsx
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend): OrderDrawer renders DriverPicker + Dispatch sections by lane — Driver+Dispatch+DO"
```

---

### Task 3.4: Modify LaneStepper to enable lanes 5+6

**Files:**
- Modify: `apps/backend/src/components/LaneStepper.tsx`

- [ ] **Step 1: Read current LANES const**

- [ ] **Step 2: Update LANES — set enabled: true for dispatched + delivered**

Replace the LANES const with:

```typescript
const LANES = [
  { id: 'received',    num: '01', label: 'Received',   enabled: true },
  { id: 'proceed',     num: '02', label: 'Proceed',    enabled: true },
  { id: 'logistics',   num: '03', label: 'Logistics',  enabled: true },
  { id: 'ready',       num: '04', label: 'Ready',      enabled: true },
  { id: 'dispatched',  num: '05', label: 'Dispatched', enabled: true },
  { id: 'delivered',   num: '06', label: 'Delivered',  enabled: true },
] as const;
```

Also remove the `tip` field from the union type (no longer disabled). The `'tip' in lane ? lane.tip : ''` check in the JSX will harmlessly resolve to `''` for all lanes now.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/components/LaneStepper.tsx
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend): LaneStepper enables dispatched + delivered — Driver+Dispatch+DO"
```

---

## Phase 4 — Acceptance + cleanup

### Task 4.1: Append SO-9006 + SO-9007 to test seed

**Files:**
- Modify: `packages/db/seeds/test-orders.sql`

- [ ] **Step 1: Append 2 new orders**

At the end of the existing DO block in `packages/db/seeds/test-orders.sql` (BEFORE the `END $$;`), add:

```sql
  -- Order 6: dispatched, driver assigned, no DO yet (test the gate to delivered)
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state,
    driver_id, confirmed_delivery_date, confirmed_with, dispatched_at)
  VALUES ('SO-9006', v_staff_s01, v_showroom, 'dispatched', 'Test Customer 6 (dispatched)', '+60123456006',
    7990, 0, 7990, 7990, '0', 'transfer', 'verified',
    (SELECT id FROM drivers WHERE driver_code = 'DRV-01'),
    CURRENT_DATE + INTERVAL '1 day', 'Phoned 2pm window', now() - INTERVAL '2 hours')
  ON CONFLICT (id) DO NOTHING;

  -- Order 7: delivered with DO
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state,
    driver_id, confirmed_delivery_date, confirmed_with,
    dispatched_at, delivered_at, do_signed, do_key)
  VALUES ('SO-9007', v_staff_s01, v_showroom, 'delivered', 'Test Customer 7 (delivered)', '+60123456007',
    8990, 0, 8990, 8990, '0', 'transfer', 'verified',
    (SELECT id FROM drivers WHERE driver_code = 'DRV-02'),
    CURRENT_DATE - INTERVAL '1 day', 'WhatsApp confirmed',
    now() - INTERVAL '1 day', now() - INTERVAL '12 hours', true,
    'dos/2026/05/test-delivered.jpg')
  ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Apply via MCP execute_sql**

Use `mcp__supabase__execute_sql` to run only the 2 new INSERT blocks (wrap in DO $$ DECLARE ... block similar to the existing seed; or apply the entire updated file).

Cleanest: copy the full updated DO $$ block from the file and run via execute_sql.

- [ ] **Step 3: Verify**

```sql
SELECT id, lane, slip_state, driver_id IS NOT NULL AS has_driver, do_key IS NOT NULL AS has_do
  FROM orders
 WHERE id IN ('SO-9006', 'SO-9007')
 ORDER BY id;
```
Expected: SO-9006 (dispatched, has_driver=true, has_do=false), SO-9007 (delivered, has_driver=true, has_do=true).

- [ ] **Step 4: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add packages/db/seeds/test-orders.sql
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "chore(db): seed SO-9006 (dispatched) + SO-9007 (delivered with DO) — Driver+Dispatch+DO"
```

---

### Task 4.2: Run Loo's manual acceptance test

**Files:** none (testing)

- [ ] **Step 1: Verify all dependencies**

Checklist:
- [ ] Migrations 0012 + 0013 applied (verify with mcp__supabase__list_migrations)
- [ ] Storage bucket `dos` exists + 4 RLS policies
- [ ] Test orders SO-9006 + SO-9007 seeded
- [ ] Backend typecheck passes
- [ ] API typecheck passes
- [ ] `pnpm dev` starts all 3 apps without error

- [ ] **Step 2: Send Loo the 5 acceptance tests**

Quote spec §8.2 verbatim. Run them in order. Note: tests 1, 4, 5 require DO upload — verify Supabase Storage UI shows file path under `dos/` bucket.

- [ ] **Step 3: Address any failures**

If test fails: investigate root cause, fix, commit fix, re-run that test.

- [ ] **Step 4: Loo confirms ship-ready**

After all 5 tests pass: "Driver+Dispatch+DO acceptance test pass — ready to ship?"

---

### Task 4.3: Final cleanup + push

**Files:** various

- [ ] **Step 1: Full monorepo typecheck + test**

```bash
pnpm typecheck
pnpm test
```

Both should pass.

- [ ] **Step 2: Verify clean tree**

```bash
git status
```

Should be clean (no untracked except `.mcp.json` which is pre-existing).

- [ ] **Step 3: Push all commits**

```bash
git push origin main
```

- [ ] **Step 4: Notify Loo**

"Driver+Dispatch+DO shipped. N commits. Acceptance tests pass. 6-lane workflow now end-to-end functional. Next: brainstorm Phase 4 sub-project D (Suppliers + PO) when ready, OR sub-project E (Backend stub pages), OR something else."

---

## Self-Review Checklist (executor reads before claiming done)

- [ ] Spec coverage: every section/decision in `2026-05-09-driver-dispatch-do-design.md` has a corresponding task here.
- [ ] Both RLS migrations have explicit STOP gates with the exact wording for asking Loo.
- [ ] Every task ends with a commit using `git -c user.name=... -c user.email=...` (git config not modified).
- [ ] No "TBD" / "TODO" / "implement appropriately" placeholders.
- [ ] Type names consistent: `confirmedDeliveryDate`, `doKey`, `dispatchedAt`, `deliveredAt`, `doSigned` — same in OrderDetail interface, API contracts, and component props.
- [ ] CSS module files have actual class names, not `// styles here` placeholders.

---

*End of plan. Total: 13 tasks across 4 phases. Estimated 4-5 days of focused execution.*
