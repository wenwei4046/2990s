# Slip Workflow MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship end-to-end slip upload + verify workflow — POS handover uploads payment slip to R2 → Coordinator opens Backend OrderDrawer → views slip → clicks Verify or Flag.

**Architecture:** POS browser PUTs slip directly to R2 via presigned URL (no Worker proxy). API issues URLs and atomically promotes session row to order via `create_order_with_items()` RPC. Cron reaper Worker (10 min) clears abandoned uploads. Backend list view gets click-to-open OrderDrawer with LaneStepper + SlipSection.

**Tech Stack:** TypeScript strict, React 19 + Vite 6 + React Router 7 (POS + Backend), Hono on CF Workers (API), Drizzle + Supabase Postgres, Cloudflare R2, Vitest + @miniflare/r2 for tests, CSS Modules, Zustand + TanStack Query.

**Spec source:** `docs/superpowers/specs/2026-05-09-slip-workflow-mvp-design.md` (committed dc173ba).

**Total scope:** 28 files (23 new + 5 modify), 24 tasks across 7 phases. Estimated 5-7 days for an experienced executor.

**Red line gates:** Tasks 0.2, 0.3, 3.5 are STOP-points where the executor MUST get explicit "yes" from Loo before applying SQL. No exceptions.

---

## Phase 0 — Prerequisites (manual, blocking)

### Task 0.1: Create R2 bucket

**Files:** none (CF infrastructure)

- [ ] **Step 1: Confirm R2 bucket creation path with Loo**

Ask: "R2 bucket `2990s-slips` does not exist yet. Two options: (A) you create it via CF dashboard → R2; (B) I run `wrangler r2 bucket create 2990s-slips` (needs you to be logged into CF via wrangler). Which?"

- [ ] **Step 2: If option B, verify wrangler auth + create bucket**

Run: `cd apps/api && wrangler whoami`
Expected: shows logged-in account email. If "Not logged in", ask Loo to run `wrangler login` (it opens browser).

Then run: `wrangler r2 bucket create 2990s-slips`
Expected: `Created bucket '2990s-slips'.`

- [ ] **Step 3: Verify bucket exists**

Run: `wrangler r2 bucket list`
Expected: bucket `2990s-slips` listed.

- [ ] **Step 4: No commit needed**

Bucket creation is CF infrastructure, not code. Move to Task 0.2.

---

### Task 0.2: Apply M1 — `0008_slip_upload_rls.sql` (RED LINE GATE)

**Files:**
- Create: `packages/db/migrations/0008_slip_upload_rls.sql`

- [ ] **Step 1: Write the migration file**

Create `packages/db/migrations/0008_slip_upload_rls.sql` with:

```sql
-- 0008_slip_upload_rls.sql
-- Phase 4 step 1: RLS policies for pending_slip_uploads.
-- Sales can INSERT/SELECT only their own row; coordinator+ SELECT all.
-- UPDATE/DELETE intentionally not policed → service_role bypasses,
-- regular authenticated denied. Server-side state machine (confirm,
-- promote, reaper) all run via service_role.

CREATE POLICY pending_slip_insert_own
  ON pending_slip_uploads FOR INSERT TO authenticated
  WITH CHECK (staff_id = auth.uid());

CREATE POLICY pending_slip_select_own_or_coord
  ON pending_slip_uploads FOR SELECT TO authenticated
  USING (staff_id = auth.uid() OR is_coordinator_or_above());
```

- [ ] **Step 2: STOP and ask Loo for explicit yes**

Send message:
```
要 apply M1 (0008_slip_upload_rls.sql) 到 Supabase。

SQL 已写入 packages/db/migrations/0008_slip_upload_rls.sql：
[paste full SQL]

效果：
- pending_slip_uploads 上加 2 条 policy
- INSERT: authenticated staff 只能写 staff_id = auth.uid() 的行
- SELECT: authenticated staff 看自己的行 OR coordinator+ 看全部
- UPDATE / DELETE 没 policy → authenticated 全拒（server 用 service_role 走）

Apply 吗？回 "yes" 我才执行 mcp__supabase__apply_migration。
```

- [ ] **Step 3: Wait for "yes" then apply via MCP**

Only after explicit yes from Loo:
Use `mcp__supabase__apply_migration` with name `0008_slip_upload_rls` and the SQL from Step 1.

- [ ] **Step 4: Verify applied**

Use `mcp__supabase__list_migrations` to confirm 0008 in the list.
Use `mcp__supabase__get_advisors` type=security to confirm `rls_enabled_no_policy` for `pending_slip_uploads` is gone.

- [ ] **Step 5: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add packages/db/migrations/0008_slip_upload_rls.sql
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(db): RLS policies for pending_slip_uploads — Slip MVP"
```

---

### Task 0.3: Apply M2 — `0009_app_config_rls.sql` (RED LINE GATE)

**Files:**
- Create: `packages/db/migrations/0009_app_config_rls.sql`

- [ ] **Step 1: Write the migration file**

Create `packages/db/migrations/0009_app_config_rls.sql` with:

```sql
-- 0009_app_config_rls.sql
-- Phase 4 step 2: RLS for app_config (clears advisor warning).
-- All staff need to read pricing_version etc; only admin modifies.

CREATE POLICY app_config_select_staff
  ON app_config FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY app_config_modify_admin
  ON app_config FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
```

- [ ] **Step 2: STOP and ask Loo for explicit yes** (same protocol as 0.2 Step 2)

- [ ] **Step 3: Wait for "yes" then apply via MCP**

- [ ] **Step 4: Verify with `list_migrations` and `get_advisors`**

- [ ] **Step 5: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add packages/db/migrations/0009_app_config_rls.sql
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(db): RLS policies for app_config — Slip MVP"
```

---

## Phase 1 — Test infrastructure + shared schemas

### Task 1.1: Set up Vitest in apps/api with R2 mocking

**Files:**
- Modify: `apps/api/package.json` (add devDependencies + test script)
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/test/setup.ts`

- [ ] **Step 1: Install dev dependencies**

Run from repo root:
```bash
pnpm --filter @2990s/api add -D vitest @cloudflare/vitest-pool-workers @miniflare/r2 @types/node
```

Expected: pnpm installs packages, updates pnpm-lock.yaml.

- [ ] **Step 2: Add test script to apps/api/package.json**

Modify `apps/api/package.json` scripts section to add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

Full scripts block becomes:
```json
"scripts": {
  "dev": "wrangler dev",
  "deploy": "wrangler deploy",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: Create apps/api/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts'],
    pool: 'forks',
  },
});
```

- [ ] **Step 4: Create apps/api/test/setup.ts**

```typescript
import { afterEach, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});
```

- [ ] **Step 5: Smoke test — write a trivial passing test**

Create `apps/api/src/_smoke.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('vitest setup', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `pnpm --filter @2990s/api test`
Expected: 1 passed.

- [ ] **Step 6: Delete the smoke test**

```bash
rm apps/api/src/_smoke.test.ts
```

- [ ] **Step 7: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/package.json apps/api/vitest.config.ts apps/api/test/setup.ts pnpm-lock.yaml
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "chore(api): set up vitest + R2 mocking infra — Slip MVP"
```

---

### Task 1.2: Zod schemas for slip endpoints (TDD)

**Files:**
- Create: `packages/shared/src/schemas/slip.schema.ts`
- Create: `packages/shared/src/schemas/slip.schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/schemas/slip.schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  SlipInitRequestSchema,
  SlipConfirmRequestSchema,
  SlipVerifyRequestSchema,
  ALLOWED_SLIP_MIMES,
  MAX_SLIP_SIZE_BYTES,
} from './slip.schema';

describe('SlipInitRequestSchema', () => {
  const valid = {
    fileSize: 1024,
    contentType: 'image/jpeg' as const,
    contentHash: 'a'.repeat(64),
  };

  it('accepts a valid request', () => {
    expect(SlipInitRequestSchema.parse(valid)).toMatchObject(valid);
  });

  it('rejects fileSize > 5 MB', () => {
    expect(() => SlipInitRequestSchema.parse({ ...valid, fileSize: MAX_SLIP_SIZE_BYTES + 1 })).toThrow();
  });

  it('rejects fileSize <= 0', () => {
    expect(() => SlipInitRequestSchema.parse({ ...valid, fileSize: 0 })).toThrow();
  });

  it('rejects contentType not in whitelist', () => {
    expect(() => SlipInitRequestSchema.parse({ ...valid, contentType: 'text/plain' })).toThrow();
  });

  it('rejects contentHash not 64 hex chars', () => {
    expect(() => SlipInitRequestSchema.parse({ ...valid, contentHash: 'a'.repeat(63) })).toThrow();
    expect(() => SlipInitRequestSchema.parse({ ...valid, contentHash: 'g'.repeat(64) })).toThrow();
  });

  it('accepts optional orderDraftId', () => {
    expect(SlipInitRequestSchema.parse({ ...valid, orderDraftId: 'draft-abc' })).toMatchObject({ orderDraftId: 'draft-abc' });
  });

  it('lists 4 allowed MIMEs', () => {
    expect(ALLOWED_SLIP_MIMES).toEqual(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  });
});

describe('SlipConfirmRequestSchema', () => {
  it('accepts empty body', () => {
    expect(SlipConfirmRequestSchema.parse({})).toEqual({});
  });
});

describe('SlipVerifyRequestSchema', () => {
  it('accepts state=verified without reason', () => {
    expect(SlipVerifyRequestSchema.parse({ state: 'verified' })).toMatchObject({ state: 'verified' });
  });

  it('accepts state=flagged with reason', () => {
    expect(SlipVerifyRequestSchema.parse({ state: 'flagged', reason: 'Amount mismatch' }))
      .toMatchObject({ state: 'flagged', reason: 'Amount mismatch' });
  });

  it('rejects state=flagged without reason', () => {
    expect(() => SlipVerifyRequestSchema.parse({ state: 'flagged' })).toThrow();
  });

  it('rejects reason > 500 chars', () => {
    expect(() => SlipVerifyRequestSchema.parse({ state: 'flagged', reason: 'a'.repeat(501) })).toThrow();
  });

  it('rejects unknown state', () => {
    expect(() => SlipVerifyRequestSchema.parse({ state: 'whatever' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @2990s/shared test slip.schema`
Expected: FAIL — `Cannot find module './slip.schema'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/shared/src/schemas/slip.schema.ts`:

```typescript
import { z } from 'zod';

export const ALLOWED_SLIP_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const MAX_SLIP_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const HEX64 = /^[a-f0-9]{64}$/;

export const SlipInitRequestSchema = z.object({
  fileSize: z.number().int().positive().max(MAX_SLIP_SIZE_BYTES),
  contentType: z.enum(ALLOWED_SLIP_MIMES),
  contentHash: z.string().regex(HEX64, 'must be 64 lowercase hex chars (sha256)'),
  orderDraftId: z.string().min(1).max(64).optional(),
});

export const SlipInitResponseSchema = z.object({
  uploadSessionId: z.string().uuid(),
  putUrl: z.string().url(),
  r2Key: z.string(),
  expiresAt: z.string(),
});

export const SlipConfirmRequestSchema = z.object({}).strict();

export const SlipConfirmResponseSchema = z.object({
  status: z.literal('uploaded'),
  r2Key: z.string(),
});

export const SlipVerifyRequestSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('verified'), reason: z.string().max(500).optional() }),
  z.object({ state: z.literal('flagged'),  reason: z.string().min(1).max(500) }),
]);

export const SlipUrlResponseSchema = z.object({
  url: z.string().url(),
  contentType: z.string(),
  expiresAt: z.string(),
});

export type SlipInitRequest = z.infer<typeof SlipInitRequestSchema>;
export type SlipInitResponse = z.infer<typeof SlipInitResponseSchema>;
export type SlipConfirmResponse = z.infer<typeof SlipConfirmResponseSchema>;
export type SlipVerifyRequest = z.infer<typeof SlipVerifyRequestSchema>;
export type SlipUrlResponse = z.infer<typeof SlipUrlResponseSchema>;
```

- [ ] **Step 4: Re-export from packages/shared/src/index.ts**

Modify `packages/shared/src/index.ts` (read first to find existing re-exports), add:
```typescript
export * from './schemas/slip.schema';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @2990s/shared test slip.schema`
Expected: 12 passed.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @2990s/shared typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add packages/shared/src/schemas/slip.schema.ts packages/shared/src/schemas/slip.schema.test.ts packages/shared/src/index.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(shared): Zod schemas for slip endpoints — Slip MVP"
```

---

## Phase 2 — API foundations

### Task 2.1: R2 helper module (TDD)

**Files:**
- Create: `apps/api/src/lib/r2.ts`
- Create: `apps/api/src/lib/r2.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/src/lib/r2.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildSlipKey, extensionFromMime } from './r2';

describe('buildSlipKey', () => {
  it('produces YYYY/MM/uuid.ext path', () => {
    const key = buildSlipKey('11111111-1111-1111-1111-111111111111', 'image/jpeg', new Date('2026-05-09T03:00:00Z'));
    expect(key).toBe('slips/2026/05/11111111-1111-1111-1111-111111111111.jpg');
  });

  it('uses .png for image/png', () => {
    const key = buildSlipKey('22222222-2222-2222-2222-222222222222', 'image/png', new Date('2026-12-31T23:59:00Z'));
    expect(key).toBe('slips/2026/12/22222222-2222-2222-2222-222222222222.png');
  });

  it('uses .pdf for application/pdf', () => {
    const key = buildSlipKey('33333333-3333-3333-3333-333333333333', 'application/pdf', new Date('2026-01-01T00:00:00Z'));
    expect(key).toBe('slips/2026/01/33333333-3333-3333-3333-333333333333.pdf');
  });
});

describe('extensionFromMime', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['application/pdf', 'pdf'],
  ])('%s → .%s', (mime, ext) => {
    expect(extensionFromMime(mime)).toBe(ext);
  });

  it('throws for unknown mime', () => {
    expect(() => extensionFromMime('text/plain' as any)).toThrow();
  });
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `pnpm --filter @2990s/api test r2`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement r2.ts**

Create `apps/api/src/lib/r2.ts`:

```typescript
import type { R2Bucket } from '@cloudflare/workers-types';

export type SlipMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

const MIME_EXT: Record<SlipMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export function extensionFromMime(mime: SlipMime): string {
  const ext = MIME_EXT[mime];
  if (!ext) throw new Error(`unsupported mime: ${mime}`);
  return ext;
}

export function buildSlipKey(uploadSessionId: string, mime: SlipMime, now = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `slips/${yyyy}/${mm}/${uploadSessionId}.${extensionFromMime(mime)}`;
}

// Cloudflare R2 supports presigned URLs only via the S3-compatible API,
// not the native Workers binding. We use the Workers binding for HEAD/PUT/DELETE
// from the Worker itself, and presigned URLs (S3 SigV4) for browser direct upload.
//
// presignPut + presignGet use the AWS Signature V4 algorithm, since R2 implements S3.
// We avoid the AWS SDK (60+KB) and sign manually with Web Crypto.

export interface PresignArgs {
  bucket: string;
  region: string;             // R2 ignores region; use 'auto'
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;           // 'https://<account>.r2.cloudflarestorage.com'
  key: string;
  method: 'GET' | 'PUT';
  expiresInSeconds: number;
  contentType?: string;       // PUT only
}

export async function presign(args: PresignArgs): Promise<string> {
  const { bucket, accessKeyId, secretAccessKey, endpoint, key, method, expiresInSeconds, contentType } = args;
  const url = new URL(`${endpoint}/${bucket}/${encodeURI(key)}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresInSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const canonicalQuery = [...url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonicalHeaders = `host:${url.host}\n`;
  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const enc = new TextEncoder();
  const hash = async (data: string | Uint8Array) => {
    const buf = typeof data === 'string' ? enc.encode(data) : data;
    const out = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(out)).map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await hash(canonicalRequest),
  ].join('\n');

  const hmac = async (key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> => {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return crypto.subtle.sign('HMAC', cryptoKey, enc.encode(msg));
  };

  const kDate = await hmac(enc.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const sig = Array.from(new Uint8Array(await hmac(kSigning, stringToSign)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  url.searchParams.set('X-Amz-Signature', sig);
  return url.toString();
}

export async function r2Head(bucket: R2Bucket, key: string): Promise<{ size: number; etag: string } | null> {
  const obj = await bucket.head(key);
  if (!obj) return null;
  return { size: obj.size, etag: obj.etag };
}

export async function r2Delete(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}
```

- [ ] **Step 4: Run test → PASS**

Run: `pnpm --filter @2990s/api test r2`
Expected: 7 passed.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/lib/r2.ts apps/api/src/lib/r2.test.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(api): R2 helpers — buildSlipKey + S3 SigV4 presign — Slip MVP"
```

---

### Task 2.2: Slip business logic module

**Files:**
- Create: `apps/api/src/lib/slip.ts`
- Create: `apps/api/src/lib/slip.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/lib/slip.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { hashesMatch, isExpired, slipBindings } from './slip';

describe('hashesMatch', () => {
  it('case-insensitive equal returns true', () => {
    expect(hashesMatch('ABCDEF', 'abcdef')).toBe(true);
  });
  it('different returns false', () => {
    expect(hashesMatch('aaa', 'bbb')).toBe(false);
  });
});

describe('isExpired', () => {
  it('past timestamp is expired', () => {
    expect(isExpired(new Date(Date.now() - 1000).toISOString())).toBe(true);
  });
  it('future timestamp is not expired', () => {
    expect(isExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false);
  });
});

describe('slipBindings', () => {
  it('extracts SLIPS bucket binding', () => {
    const env = { SLIPS: { __isBucket: true } };
    const r = slipBindings(env as any);
    expect(r.bucket).toBe(env.SLIPS);
  });
  it('throws when SLIPS missing', () => {
    expect(() => slipBindings({} as any)).toThrow(/SLIPS/);
  });
});
```

- [ ] **Step 2: Run test → FAIL** (module missing)

Run: `pnpm --filter @2990s/api test slip.test`
Expected: FAIL.

- [ ] **Step 3: Implement slip.ts**

Create `apps/api/src/lib/slip.ts`:

```typescript
import type { R2Bucket } from '@cloudflare/workers-types';

export interface SlipEnv {
  SLIPS: R2Bucket;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ENDPOINT: string;
  R2_BUCKET_NAME: string;
}

export interface SlipBindings {
  bucket: R2Bucket;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucketName: string;
}

export function slipBindings(env: SlipEnv): SlipBindings {
  if (!env.SLIPS) throw new Error('R2 binding SLIPS not configured');
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_ENDPOINT || !env.R2_BUCKET_NAME) {
    throw new Error('R2 secrets (R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_ENDPOINT/R2_BUCKET_NAME) not configured');
  }
  return {
    bucket: env.SLIPS,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    endpoint: env.R2_ENDPOINT,
    bucketName: env.R2_BUCKET_NAME,
  };
}

export function hashesMatch(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function isExpired(isoTimestamp: string): boolean {
  return new Date(isoTimestamp).getTime() < Date.now();
}

export function expiresInOneHour(now = new Date()): string {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
}
```

- [ ] **Step 4: Run test → PASS**

Run: `pnpm --filter @2990s/api test slip.test`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/lib/slip.ts apps/api/src/lib/slip.test.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(api): slip business logic helpers — Slip MVP"
```

---

## Phase 3 — API endpoints

### Task 3.1: `POST /api/slips/init` route

**Files:**
- Create: `apps/api/src/routes/slips.ts`
- Create: `apps/api/src/routes/slips.test.ts`
- Modify: `apps/api/src/index.ts` (register route)

- [ ] **Step 1: Write failing integration test**

Create `apps/api/src/routes/slips.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { slipRoutes } from './slips';

function makeApp(supabaseMock: any, env: any = {}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('staffId', '11111111-1111-1111-1111-111111111111');
    c.set('supabase', supabaseMock);
    await next();
  });
  app.route('/api/slips', slipRoutes);
  return app;
}

const baseEnv = {
  SLIPS: { put: vi.fn(), head: vi.fn(), delete: vi.fn() },
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_ENDPOINT: 'https://test.r2.cloudflarestorage.com',
  R2_BUCKET_NAME: '2990s-slips',
};

describe('POST /api/slips/init', () => {
  let supabase: any;

  beforeEach(() => {
    supabase = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          r2_key: 'slips/2026/05/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg',
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
        error: null,
      }),
    };
  });

  it('returns presigned PUT URL + sessionId', async () => {
    const app = makeApp(supabase);
    const res = await app.request('/api/slips/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileSize: 1024,
        contentType: 'image/jpeg',
        contentHash: 'a'.repeat(64),
      }),
    }, baseEnv);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadSessionId).toBeTruthy();
    expect(body.putUrl).toMatch(/X-Amz-Signature/);
    expect(body.r2Key).toMatch(/^slips\/\d{4}\/\d{2}\/.+\.jpg$/);
    expect(supabase.insert).toHaveBeenCalledWith(expect.objectContaining({
      staff_id: '11111111-1111-1111-1111-111111111111',
      content_hash: 'a'.repeat(64),
      content_size: 1024,
      content_type: 'image/jpeg',
      status: 'pending',
    }));
  });

  it('rejects fileSize > 5 MB with 400', async () => {
    const app = makeApp(supabase);
    const res = await app.request('/api/slips/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileSize: 6 * 1024 * 1024,
        contentType: 'image/jpeg',
        contentHash: 'a'.repeat(64),
      }),
    }, baseEnv);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects invalid mime with 400', async () => {
    const app = makeApp(supabase);
    const res = await app.request('/api/slips/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileSize: 100,
        contentType: 'text/plain',
        contentHash: 'a'.repeat(64),
      }),
    }, baseEnv);

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test → FAIL** (route module missing)

Run: `pnpm --filter @2990s/api test slips.test`
Expected: FAIL.

- [ ] **Step 3: Implement slips.ts route module (init endpoint only)**

Create `apps/api/src/routes/slips.ts`:

```typescript
import { Hono } from 'hono';
import { SlipInitRequestSchema, type SlipInitResponse, type SlipConfirmResponse } from '@2990s/shared';
import { buildSlipKey, presign } from '../lib/r2';
import { slipBindings, expiresInOneHour } from '../lib/slip';
import type { Env } from '../types';

type Variables = { staffId: string; supabase: any };

export const slipRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

slipRoutes.post('/init', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = SlipInitRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }

  const staffId = c.get('staffId');
  const supabase = c.get('supabase');
  const bindings = slipBindings(c.env);

  const sessionId = crypto.randomUUID();
  const r2Key = buildSlipKey(sessionId, parsed.data.contentType);
  const expiresAt = expiresInOneHour();

  const { data, error } = await supabase
    .from('pending_slip_uploads')
    .insert({
      id: sessionId,
      upload_session_id: sessionId,
      staff_id: staffId,
      showroom_id: c.get('showroomId') ?? null,
      r2_key: r2Key,
      content_type: parsed.data.contentType,
      content_hash: parsed.data.contentHash,
      content_size: parsed.data.fileSize,
      status: 'pending',
      order_draft_id: parsed.data.orderDraftId ?? null,
      expires_at: expiresAt,
    })
    .select('id, r2_key, expires_at')
    .single();

  if (error) {
    return c.json({ error: 'db_insert_failed', detail: error.message }, 500);
  }

  const putUrl = await presign({
    bucket: bindings.bucketName,
    region: 'auto',
    accessKeyId: bindings.accessKeyId,
    secretAccessKey: bindings.secretAccessKey,
    endpoint: bindings.endpoint,
    key: r2Key,
    method: 'PUT',
    expiresInSeconds: 5 * 60,
    contentType: parsed.data.contentType,
  });

  return c.json<SlipInitResponse>({
    uploadSessionId: sessionId,
    putUrl,
    r2Key,
    expiresAt,
  });
});
```

- [ ] **Step 4: Create types.ts placeholder if missing**

Check if `apps/api/src/types.ts` exists. If not, create with:
```typescript
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ALLOWED_ORIGINS: string;
  SLIPS: import('@cloudflare/workers-types').R2Bucket;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ENDPOINT: string;
  R2_BUCKET_NAME: string;
}
```

- [ ] **Step 5: Run test → PASS**

Run: `pnpm --filter @2990s/api test slips.test`
Expected: 3 passed.

- [ ] **Step 6: Register route in index.ts**

Read `apps/api/src/index.ts`, find route registration section (likely `app.route('/orders', orders)`), add:
```typescript
import { slipRoutes } from './routes/slips';
// ...
app.route('/api/slips', slipRoutes);
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/routes/slips.ts apps/api/src/routes/slips.test.ts apps/api/src/index.ts apps/api/src/types.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(api): POST /api/slips/init endpoint — Slip MVP"
```

---

### Task 3.2: `POST /api/slips/:session/confirm` endpoint

**Files:**
- Modify: `apps/api/src/routes/slips.ts` (append confirm handler)
- Modify: `apps/api/src/routes/slips.test.ts` (append confirm tests)

- [ ] **Step 1: Add failing tests for confirm**

Append to `apps/api/src/routes/slips.test.ts`:

```typescript
describe('POST /api/slips/:session/confirm', () => {
  let supabase: any;
  const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  beforeEach(() => {
    supabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: sessionId,
          staff_id: '11111111-1111-1111-1111-111111111111',
          r2_key: 'slips/2026/05/' + sessionId + '.jpg',
          content_hash: 'a'.repeat(64),
          content_size: 1024,
          status: 'pending',
        },
        error: null,
      }),
      update: vi.fn().mockReturnThis(),
    };
  });

  it('confirms when R2 has matching size + etag', async () => {
    const env = {
      ...baseEnv,
      SLIPS: {
        head: vi.fn().mockResolvedValue({ size: 1024, etag: 'a'.repeat(64) }),
        delete: vi.fn(),
      },
    };
    const app = makeApp(supabase, env);
    const res = await app.request(`/api/slips/${sessionId}/confirm`, {
      method: 'POST',
    }, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'uploaded' });
    expect(supabase.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'uploaded' }));
  });

  it('returns 404 when R2 has no object', async () => {
    const env = { ...baseEnv, SLIPS: { head: vi.fn().mockResolvedValue(null), delete: vi.fn() } };
    const app = makeApp(supabase, env);
    const res = await app.request(`/api/slips/${sessionId}/confirm`, { method: 'POST' }, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'file_not_in_r2' });
  });

  it('returns 400 hash_mismatch when sizes differ', async () => {
    const env = { ...baseEnv, SLIPS: { head: vi.fn().mockResolvedValue({ size: 999, etag: 'x' }), delete: vi.fn() } };
    const app = makeApp(supabase, env);
    const res = await app.request(`/api/slips/${sessionId}/confirm`, { method: 'POST' }, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'hash_mismatch' });
    expect(supabase.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('returns 403 when caller is not session owner', async () => {
    supabase.single.mockResolvedValue({
      data: { ...({ id: sessionId, staff_id: 'other-staff', status: 'pending', r2_key: 'k', content_hash: 'a'.repeat(64), content_size: 1024 }) },
      error: null,
    });
    const app = makeApp(supabase, baseEnv);
    const res = await app.request(`/api/slips/${sessionId}/confirm`, { method: 'POST' }, baseEnv);
    expect(res.status).toBe(403);
  });

  it('returns 409 when status is not pending', async () => {
    supabase.single.mockResolvedValue({
      data: { id: sessionId, staff_id: '11111111-1111-1111-1111-111111111111', status: 'uploaded', r2_key: 'k', content_hash: 'a'.repeat(64), content_size: 1024 },
      error: null,
    });
    const app = makeApp(supabase, baseEnv);
    const res = await app.request(`/api/slips/${sessionId}/confirm`, { method: 'POST' }, baseEnv);
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm --filter @2990s/api test slips.test`
Expected: confirm tests fail (route not implemented).

- [ ] **Step 3: Add confirm handler to slips.ts**

Append to `apps/api/src/routes/slips.ts`:

```typescript
import { hashesMatch } from '../lib/slip';
import { r2Head } from '../lib/r2';

slipRoutes.post('/:session/confirm', async (c) => {
  const sessionId = c.req.param('session');
  const staffId = c.get('staffId');
  const supabase = c.get('supabase');
  const bindings = slipBindings(c.env);

  const { data: row, error: fetchErr } = await supabase
    .from('pending_slip_uploads')
    .select('id, staff_id, r2_key, content_hash, content_size, status')
    .eq('id', sessionId)
    .single();

  if (fetchErr || !row) {
    return c.json({ error: 'session_not_found' }, 404);
  }
  if (row.staff_id !== staffId) {
    return c.json({ error: 'not_session_owner' }, 403);
  }
  if (row.status !== 'pending') {
    return c.json({ error: 'invalid_state', currentStatus: row.status }, 409);
  }

  const head = await r2Head(bindings.bucket, row.r2_key);
  if (!head) {
    return c.json({ error: 'file_not_in_r2' }, 404);
  }

  // R2 etag for unencrypted PUT == md5 hex (NOT sha256). We compare size only,
  // and hash is verified by client choosing what to upload (server stored hash for audit).
  // Strict check: size must match init-time content_size.
  if (head.size !== row.content_size) {
    await supabase.from('pending_slip_uploads')
      .update({ status: 'failed', error_msg: 'hash_mismatch (size differ)' })
      .eq('id', sessionId);
    // Queue R2 cleanup
    await bindings.bucket.delete(row.r2_key).catch(() => {});
    return c.json({ error: 'hash_mismatch', expected: row.content_size, actual: head.size }, 400);
  }

  await supabase.from('pending_slip_uploads')
    .update({ status: 'uploaded' })
    .eq('id', sessionId);

  return c.json<SlipConfirmResponse>({ status: 'uploaded', r2Key: row.r2_key });
});
```

- [ ] **Step 4: Run → PASS**

Run: `pnpm --filter @2990s/api test slips.test`
Expected: 8 passed (3 init + 5 confirm).

- [ ] **Step 5: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/routes/slips.ts apps/api/src/routes/slips.test.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(api): POST /api/slips/:session/confirm endpoint — Slip MVP"
```

---

### Task 3.3: `GET /api/orders/:id/slip-url` endpoint

**Files:**
- Modify: `apps/api/src/routes/orders.ts` (append slip-url handler)
- Create: `apps/api/src/routes/orders-slip.test.ts`

- [ ] **Step 1: Read existing orders.ts to understand patterns**

Run: `Read apps/api/src/routes/orders.ts` — find role check helpers, supabase client access pattern.

- [ ] **Step 2: Write failing test**

Create `apps/api/src/routes/orders-slip.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ordersRoutes } from './orders';

const baseEnv = {
  SLIPS: { head: vi.fn() },
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_ENDPOINT: 'https://test.r2.cloudflarestorage.com',
  R2_BUCKET_NAME: '2990s-slips',
};

function makeApp(supabaseMock: any, role = 'coordinator') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('staffId', '22222222-2222-2222-2222-222222222222');
    c.set('staffRole', role);
    c.set('supabase', supabaseMock);
    await next();
  });
  app.route('/api/orders', ordersRoutes);
  return app;
}

describe('GET /api/orders/:id/slip-url', () => {
  let supabase: any;

  beforeEach(() => {
    supabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { slip_key: 'slips/2026/05/abc.jpg' },
        error: null,
      }),
    };
  });

  it('returns presigned GET URL when slip_key present', async () => {
    const app = makeApp(supabase, 'coordinator');
    const res = await app.request('/api/orders/SO-2050/slip-url', { method: 'GET' }, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toMatch(/X-Amz-Signature/);
    expect(body.contentType).toBe('image/jpeg');
  });

  it('403 for sales role', async () => {
    const app = makeApp(supabase, 'sales');
    const res = await app.request('/api/orders/SO-2050/slip-url', { method: 'GET' }, baseEnv);
    expect(res.status).toBe(403);
  });

  it('400 no_slip_attached when slip_key NULL', async () => {
    supabase.single.mockResolvedValue({ data: { slip_key: null }, error: null });
    const app = makeApp(supabase, 'coordinator');
    const res = await app.request('/api/orders/SO-2050/slip-url', { method: 'GET' }, baseEnv);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'no_slip_attached' });
  });

  it('404 when order missing', async () => {
    supabase.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    const app = makeApp(supabase, 'coordinator');
    const res = await app.request('/api/orders/SO-9999/slip-url', { method: 'GET' }, baseEnv);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run → FAIL**

Run: `pnpm --filter @2990s/api test orders-slip`
Expected: FAIL.

- [ ] **Step 4: Add handler to orders.ts**

Append to `apps/api/src/routes/orders.ts`:

```typescript
import { presign, extensionFromMime, type SlipMime } from '../lib/r2';
import { slipBindings } from '../lib/slip';
import type { SlipUrlResponse } from '@2990s/shared';

const COORDINATOR_ROLES = ['coordinator', 'finance', 'admin'] as const;

function mimeFromKey(key: string): SlipMime {
  const ext = key.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'pdf': return 'application/pdf';
    default: throw new Error(`unknown extension on slip key: ${key}`);
  }
}

ordersRoutes.get('/:id/slip-url', async (c) => {
  const role = c.get('staffRole');
  if (!COORDINATOR_ROLES.includes(role as any)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const orderId = c.req.param('id');
  const supabase = c.get('supabase');
  const bindings = slipBindings(c.env);

  const { data, error } = await supabase
    .from('orders')
    .select('slip_key')
    .eq('id', orderId)
    .single();

  if (error || !data) {
    return c.json({ error: 'order_not_found' }, 404);
  }
  if (!data.slip_key) {
    return c.json({ error: 'no_slip_attached' }, 400);
  }

  const contentType = mimeFromKey(data.slip_key);
  const url = await presign({
    bucket: bindings.bucketName,
    region: 'auto',
    accessKeyId: bindings.accessKeyId,
    secretAccessKey: bindings.secretAccessKey,
    endpoint: bindings.endpoint,
    key: data.slip_key,
    method: 'GET',
    expiresInSeconds: 5 * 60,
  });

  return c.json<SlipUrlResponse>({
    url,
    contentType,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
});
```

- [ ] **Step 5: Run → PASS**

Run: `pnpm --filter @2990s/api test orders-slip`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/routes/orders.ts apps/api/src/routes/orders-slip.test.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(api): GET /api/orders/:id/slip-url endpoint — Slip MVP"
```

---

### Task 3.4: `PATCH /api/orders/:id/slip` endpoint

**Files:**
- Modify: `apps/api/src/routes/orders.ts`
- Modify: `apps/api/src/routes/orders-slip.test.ts`

- [ ] **Step 1: Append PATCH tests**

Append to `apps/api/src/routes/orders-slip.test.ts`:

```typescript
describe('PATCH /api/orders/:id/slip', () => {
  let supabase: any;

  beforeEach(() => {
    supabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'SO-2050', slip_state: 'pending' },
        error: null,
      }),
      update: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
  });

  it('verifies a pending slip', async () => {
    const app = makeApp(supabase, 'coordinator');
    const res = await app.request('/api/orders/SO-2050/slip', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'verified' }),
    }, baseEnv);

    expect(res.status).toBe(200);
    expect(supabase.update).toHaveBeenCalledWith(expect.objectContaining({
      slip_state: 'verified',
      slip_verified_by: '22222222-2222-2222-2222-222222222222',
    }));
    expect(supabase.insert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'verified',
    }));
  });

  it('flags with reason', async () => {
    const app = makeApp(supabase, 'coordinator');
    const res = await app.request('/api/orders/SO-2050/slip', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'flagged', reason: 'Amount mismatch' }),
    }, baseEnv);

    expect(res.status).toBe(200);
    expect(supabase.update).toHaveBeenCalledWith(expect.objectContaining({
      slip_state: 'flagged',
      slip_flag_reason: 'Amount mismatch',
    }));
  });

  it('400 reason_required when flagged without reason', async () => {
    const app = makeApp(supabase, 'coordinator');
    const res = await app.request('/api/orders/SO-2050/slip', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'flagged' }),
    }, baseEnv);
    expect(res.status).toBe(400);
  });

  it('400 invalid_state when slip already verified', async () => {
    supabase.single.mockResolvedValue({ data: { id: 'SO-2050', slip_state: 'verified' }, error: null });
    const app = makeApp(supabase, 'coordinator');
    const res = await app.request('/api/orders/SO-2050/slip', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'verified' }),
    }, baseEnv);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_state' });
  });

  it('403 for sales role', async () => {
    const app = makeApp(supabase, 'sales');
    const res = await app.request('/api/orders/SO-2050/slip', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'verified' }),
    }, baseEnv);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Add PATCH handler**

Append to `apps/api/src/routes/orders.ts`:

```typescript
import { SlipVerifyRequestSchema } from '@2990s/shared';

ordersRoutes.patch('/:id/slip', async (c) => {
  const role = c.get('staffRole');
  if (!COORDINATOR_ROLES.includes(role as any)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const orderId = c.req.param('id');
  const staffId = c.get('staffId');
  const supabase = c.get('supabase');

  const body = await c.req.json().catch(() => ({}));
  const parsed = SlipVerifyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'reason_required', issues: parsed.error.issues }, 400);
  }

  const { data: row, error: fetchErr } = await supabase
    .from('orders')
    .select('id, slip_state')
    .eq('id', orderId)
    .single();

  if (fetchErr || !row) {
    return c.json({ error: 'order_not_found' }, 404);
  }
  if (row.slip_state !== 'pending') {
    return c.json({ error: 'invalid_state', currentSlipState: row.slip_state }, 400);
  }

  const now = new Date().toISOString();
  const verifyFields = parsed.data.state === 'verified'
    ? { slip_state: 'verified', slip_verified_by: staffId, slip_verified_at: now, slip_flag_reason: null }
    : { slip_state: 'flagged', slip_verified_by: staffId, slip_verified_at: now, slip_flag_reason: parsed.data.reason };

  const { error: updateErr } = await supabase
    .from('orders')
    .update(verifyFields)
    .eq('id', orderId);

  if (updateErr) {
    return c.json({ error: 'db_update_failed', detail: updateErr.message }, 500);
  }

  await supabase.from('order_slip_events').insert({
    order_id: orderId,
    event: parsed.data.state,
    actor_id: staffId,
    meta: parsed.data.state === 'flagged' ? { reason: parsed.data.reason } : {},
  });

  return c.json({
    orderId,
    slipState: parsed.data.state,
    slipVerifiedBy: staffId,
    slipVerifiedAt: now,
  });
});
```

- [ ] **Step 4: Run → PASS**

Run: `pnpm --filter @2990s/api test orders-slip`
Expected: 9 passed (4 GET + 5 PATCH).

- [ ] **Step 5: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/routes/orders.ts apps/api/src/routes/orders-slip.test.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(api): PATCH /api/orders/:id/slip endpoint — Slip MVP"
```

---

### Task 3.5: Apply M3 — `0010_promote_slip_in_create_order.sql` (RED LINE GATE)

**Files:**
- Create: `packages/db/migrations/0010_promote_slip_in_create_order.sql`

- [ ] **Step 1: Write the migration file**

Create `packages/db/migrations/0010_promote_slip_in_create_order.sql` — full SQL from spec §6.3 (copy verbatim).

- [ ] **Step 2: STOP and ask Loo for explicit yes**

Send message:
```
要 apply M3 (0010_promote_slip_in_create_order.sql) 到 Supabase。

这是 CREATE OR REPLACE 0006 的 create_order_with_items() RPC，加 3 段新逻辑：
1. 校验 uploadSessionId（如果有 — lock + owner check + status check）
2. INSERT orders 时多写 slip_key + slip_state 字段
3. UPDATE pending_slip_uploads.status='promoted' + INSERT order_slip_events('uploaded')

整个事务里做。SECURITY INVOKER 不变。
SQL 已写入 packages/db/migrations/0010_promote_slip_in_create_order.sql
[paste full SQL]

Apply 吗？回 "yes" 我才执行。
```

- [ ] **Step 3: Wait for "yes" then apply via MCP**

Use `mcp__supabase__apply_migration`.

- [ ] **Step 4: Verify**

Use `mcp__supabase__execute_sql` to test:
```sql
SELECT pg_get_functiondef('public.create_order_with_items(jsonb)'::regprocedure);
```
Expected: returned function definition contains `pending_slip_uploads` references.

- [ ] **Step 5: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add packages/db/migrations/0010_promote_slip_in_create_order.sql
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(db): create_order_with_items promotes slip in same tx — Slip MVP"
```

---

### Task 3.6: Modify `POST /api/orders` to accept `uploadSessionId`

**Files:**
- Modify: `apps/api/src/routes/orders.ts`
- Modify: `apps/api/src/routes/orders-slip.test.ts` (add POST /orders+slip test)

- [ ] **Step 1: Read existing POST /orders implementation**

Run: `Read apps/api/src/routes/orders.ts` — find POST handler, understand current Zod schema for the body.

- [ ] **Step 2: Add Zod field for uploadSessionId**

Find the existing order POST body schema (likely in `packages/shared/src/schemas/order.schema.ts` per CLAUDE.md). Modify it to include:
```typescript
uploadSessionId: z.string().uuid().optional(),
```

- [ ] **Step 3: Pass field through to RPC call**

In `apps/api/src/routes/orders.ts`, the existing POST handler calls `create_order_with_items()` RPC. Modify the payload object passed to `supabase.rpc('create_order_with_items', { p: payload })` to include `uploadSessionId` from the validated request body.

Specifically — find the line that constructs the `p` argument for the RPC, append:
```typescript
p.uploadSessionId = parsed.data.uploadSessionId ?? null;
```

- [ ] **Step 4: Map RPC errors to HTTP status**

Wrap the rpc call to translate Postgres error codes:
```typescript
const { data: orderId, error } = await supabase.rpc('create_order_with_items', { p });

if (error) {
  // Map RPC RAISE EXCEPTION codes to HTTP
  const msg = error.message ?? '';
  if (msg.includes('slip_required_for_transfer')) return c.json({ error: 'slip_required_for_transfer' }, 400);
  if (msg.includes('slip_not_ready'))            return c.json({ error: 'slip_not_ready' }, 409);
  if (msg.includes('slip_session_not_found'))    return c.json({ error: 'slip_session_not_found' }, 404);
  if (msg.includes('not_session_owner'))         return c.json({ error: 'not_session_owner' }, 403);
  // Promoted-already case: pending_slip_uploads UNIQUE on promoted_to_order_id violation,
  // surfaces as Postgres 23505 unique_violation
  if (error.code === '23505' && msg.includes('promoted_to_order_id')) {
    return c.json({ error: 'slip_already_used' }, 409);
  }
  return c.json({ error: 'order_creation_failed', detail: msg }, 500);
}
```

- [ ] **Step 5: Add integration test** (mock Supabase RPC)

Append to `apps/api/src/routes/orders-slip.test.ts`:

```typescript
describe('POST /api/orders with uploadSessionId', () => {
  it('forwards uploadSessionId to RPC', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: 'SO-2050', error: null }),
    };
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('staffId', '11111111-1111-1111-1111-111111111111');
      c.set('staffRole', 'sales');
      c.set('supabase', supabase);
      await next();
    });
    app.route('/api/orders', ordersRoutes);

    const res = await app.request('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cart: { lines: [] },
        customer: { name: 'Test' },
        paymentMethod: 'transfer',
        uploadSessionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        // ... whatever existing required fields are
      }),
    }, baseEnv);

    // Status check + RPC payload assertion
    expect(supabase.rpc).toHaveBeenCalledWith('create_order_with_items',
      expect.objectContaining({
        p: expect.objectContaining({ uploadSessionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
      }));
  });

  it('maps RPC slip_required_for_transfer to 400', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'slip_required_for_transfer', code: '23514' } }),
    };
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('staffId', '11111111-1111-1111-1111-111111111111');
      c.set('staffRole', 'sales');
      c.set('supabase', supabase);
      await next();
    });
    app.route('/api/orders', ordersRoutes);

    const res = await app.request('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cart: { lines: [] },
        customer: { name: 'Test' },
        paymentMethod: 'transfer',
      }),
    }, baseEnv);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'slip_required_for_transfer' });
  });
});
```

- [ ] **Step 6: Run → PASS**

Run: `pnpm --filter @2990s/api test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/routes/orders.ts apps/api/src/routes/orders-slip.test.ts packages/shared/src/schemas/order.schema.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(api): POST /orders accepts uploadSessionId + RPC error mapping — Slip MVP"
```

---

## Phase 4 — Cron reaper

### Task 4.1: Reaper logic with concurrency tests

**Files:**
- Create: `apps/api/src/lib/reaper.ts`
- Create: `apps/api/src/lib/reaper.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/lib/reaper.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reapOnce } from './reaper';

const baseEnv = {
  SLIPS: { delete: vi.fn().mockResolvedValue(undefined) },
};

describe('reapOnce', () => {
  let supabase: any;

  beforeEach(() => {
    supabase = {
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    baseEnv.SLIPS.delete = vi.fn().mockResolvedValue(undefined);
  });

  it('returns zero counts when no orphans found', async () => {
    const result = await reapOnce(supabase, baseEnv as any, 'worker-1');
    expect(result).toMatchObject({ claimed: 0, deleted: 0, errors: 0, remaining: 0 });
  });

  it('claims rows then deletes R2 + updates status', async () => {
    supabase.rpc = vi.fn()
      // First call: lease_orphans returns 2 rows
      .mockResolvedValueOnce({
        data: [
          { id: 'a', r2_key: 'slips/2026/05/a.jpg' },
          { id: 'b', r2_key: 'slips/2026/05/b.png' },
        ],
        error: null,
      })
      // Second call: count of remaining orphans
      .mockResolvedValueOnce({ data: 0, error: null });

    supabase.from = vi.fn().mockReturnThis();
    supabase.update = vi.fn().mockReturnThis();
    supabase.eq = vi.fn().mockResolvedValue({ data: null, error: null });

    const result = await reapOnce(supabase, baseEnv as any, 'worker-1');
    expect(result).toMatchObject({ claimed: 2, deleted: 2, errors: 0 });
    expect(baseEnv.SLIPS.delete).toHaveBeenCalledTimes(2);
  });

  it('counts errors when R2 delete fails', async () => {
    supabase.rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [{ id: 'a', r2_key: 'slips/2026/05/a.jpg' }],
        error: null,
      })
      .mockResolvedValueOnce({ data: 0, error: null });
    supabase.from = vi.fn().mockReturnThis();
    supabase.update = vi.fn().mockReturnThis();
    supabase.eq = vi.fn().mockResolvedValue({ data: null, error: null });

    baseEnv.SLIPS.delete = vi.fn().mockRejectedValue(new Error('R2 down'));

    const result = await reapOnce(supabase, baseEnv as any, 'worker-1');
    expect(result.errors).toBe(1);
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement reaper.ts**

Create `apps/api/src/lib/reaper.ts`:

```typescript
import type { SlipEnv } from './slip';

export interface ReapResult {
  claimed: number;
  deleted: number;
  errors: number;
  remaining: number;
}

export async function reapOnce(supabase: any, env: SlipEnv, workerId: string): Promise<ReapResult> {
  // Postgres-side claim function (defined inline as DO block via rpc('lease_orphans', ...))
  // For now, call a thin RPC. We register the SQL function in a separate task if needed.
  const { data: claimed, error: claimErr } = await supabase.rpc('lease_orphan_slips', {
    p_worker_id: workerId,
    p_limit: 100,
  });

  if (claimErr) {
    return { claimed: 0, deleted: 0, errors: 1, remaining: 0 };
  }

  const rows = (claimed ?? []) as { id: string; r2_key: string }[];
  let deleted = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      await env.SLIPS.delete(row.r2_key);
      await supabase
        .from('pending_slip_uploads')
        .update({ status: 'failed', error_msg: 'reaper: expired' })
        .eq('id', row.id);
      deleted++;
    } catch {
      errors++;
    }
  }

  const { data: remaining } = await supabase.rpc('count_orphan_slips');
  return { claimed: rows.length, deleted, errors, remaining: remaining ?? 0 };
}
```

- [ ] **Step 4: Add SQL function via new migration**

This needs a Postgres function `lease_orphan_slips()` that does the SKIP LOCKED claim atomically. Create `packages/db/migrations/0011_reaper_lease_function.sql`:

```sql
-- 0011_reaper_lease_function.sql
-- Phase 4 step 4: orphan reaper claim function. SECURITY DEFINER because
-- it must UPDATE pending_slip_uploads which authenticated cannot. Worker
-- calls via service_role — DEFINER doesn't expand attack surface for
-- service_role calls but ensures the function works in any execution context.

CREATE OR REPLACE FUNCTION public.lease_orphan_slips(p_worker_id text, p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid, r2_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  UPDATE pending_slip_uploads psu
     SET claimed_by = p_worker_id,
         lease_expires_at = now() + INTERVAL '5 minutes'
   WHERE psu.id IN (
     SELECT psu2.id
       FROM pending_slip_uploads psu2
      WHERE psu2.status IN ('pending','uploaded')
        AND psu2.expires_at < now()
        AND (psu2.claimed_by IS NULL OR psu2.lease_expires_at < now())
      ORDER BY psu2.expires_at
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
   )
   RETURNING psu.id, psu.r2_key;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lease_orphan_slips(text, integer) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.count_orphan_slips()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COUNT(*)::integer
    FROM pending_slip_uploads
   WHERE status IN ('pending','uploaded')
     AND expires_at < now();
$$;

REVOKE EXECUTE ON FUNCTION public.count_orphan_slips() FROM anon, authenticated;
```

- [ ] **Step 5: STOP — ask Loo for explicit yes to apply 0011**

Send message:
```
要 apply 0011_reaper_lease_function.sql 到 Supabase。

新增 2 个 SECURITY DEFINER functions：
- lease_orphan_slips(worker_id, limit) → 原子 claim 过期 row
- count_orphan_slips() → 监控用

EXECUTE 已 REVOKE FROM anon/authenticated（只 service_role 能调）。
SQL 已写入 packages/db/migrations/0011_reaper_lease_function.sql
[paste SQL]

Apply 吗？回 "yes" 我才执行。
```

- [ ] **Step 6: Apply via MCP after yes**

- [ ] **Step 7: Run reaper test → PASS**

Run: `pnpm --filter @2990s/api test reaper`
Expected: 3 passed.

- [ ] **Step 8: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/lib/reaper.ts apps/api/src/lib/reaper.test.ts packages/db/migrations/0011_reaper_lease_function.sql
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(api+db): orphan slip reaper + lease functions — Slip MVP"
```

---

### Task 4.2: Wire scheduled handler in apps/api/src/index.ts

**Files:**
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Read current index.ts to understand export structure**

Run: `Read apps/api/src/index.ts`.

- [ ] **Step 2: Add scheduled() export alongside default fetch handler**

Append (or replace `export default app` with):
```typescript
import { reapOnce } from './lib/reaper';
import { createClient } from '@supabase/supabase-js';

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const workerId = `cron-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    ctx.waitUntil((async () => {
      try {
        const result = await reapOnce(supabase, env, workerId);
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          event: 'reaper_run',
          ...result,
        }));
      } catch (err) {
        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          event: 'reaper_error',
          message: err instanceof Error ? err.message : String(err),
        }));
      }
    })());
  },
};
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`

- [ ] **Step 4: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/src/index.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(api): wire scheduled() handler for reaper cron — Slip MVP"
```

---

### Task 4.3: Update wrangler.toml for R2 binding + cron + secrets reminder

**Files:**
- Modify: `apps/api/wrangler.toml`

- [ ] **Step 1: Read current wrangler.toml**

- [ ] **Step 2: Uncomment + configure R2 binding and cron triggers**

Replace the commented sections with active config. Final wrangler.toml should include:

```toml
name = "2990s-api"
main = "src/index.ts"
compatibility_date = "2026-05-08"
compatibility_flags = ["nodejs_compat"]

[vars]
SUPABASE_URL = "https://dolvxrchzbnqvahocwsu.supabase.co"
ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:5174,http://localhost:5175"
R2_BUCKET_NAME = "2990s-slips"
R2_ENDPOINT = "https://<TBD-account-id>.r2.cloudflarestorage.com"

[[r2_buckets]]
binding = "SLIPS"
bucket_name = "2990s-slips"

[triggers]
crons = ["*/10 * * * *"]
```

- [ ] **Step 3: Note required secrets in plan output (don't commit secrets)**

After commit, Loo must run:
```bash
cd apps/api
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

R2 access keys come from CF dashboard → R2 → Manage R2 API Tokens → Create API Token (give read+write to bucket `2990s-slips`).

R2_ENDPOINT — find account ID at CF dashboard → top-right account dropdown.

- [ ] **Step 4: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/api/wrangler.toml
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "chore(api): enable R2 binding + cron trigger in wrangler.toml — Slip MVP"
```

- [ ] **Step 5: Block on Loo confirming secrets are set**

Send message: "wrangler.toml 配置好了。你需要做：1) 在 CF dashboard 找 account ID 并告诉我（替换 wrangler.toml 里 `<TBD-account-id>`），2) 创建 R2 API token（CF dashboard → R2 → Manage R2 API Tokens），3) 跑 4 个 wrangler secret put 命令（见上）。完成后告诉我，我接着写 POS UX。"

---

## Phase 5 — POS upload UX

### Task 5.1: POS slip client orchestration

**Files:**
- Create: `apps/pos/src/lib/slip.ts`
- Create: `apps/pos/src/lib/slip.test.ts` (optional — POS uses Vitest if set up; skip if no infra)

- [ ] **Step 1: Check POS test setup**

Run: `cat apps/pos/package.json | grep -E "vitest|test"`. If no Vitest, skip TDD for POS — write code directly + cover via manual test.

- [ ] **Step 2: Write slip.ts**

Create `apps/pos/src/lib/slip.ts`:

```typescript
import type { SlipInitRequest, SlipInitResponse, SlipConfirmResponse } from '@2990s/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL;

export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function initSlipUpload(file: File, jwt: string): Promise<SlipInitResponse> {
  const hash = await sha256Hex(file);
  const body: SlipInitRequest = {
    fileSize: file.size,
    contentType: file.type as SlipInitRequest['contentType'],
    contentHash: hash,
  };
  const res = await fetch(`${API_BASE}/api/slips/init`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${jwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`init failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function putToR2(putUrl: string, file: File): Promise<void> {
  const res = await fetch(putUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  });
  if (!res.ok) throw new Error(`R2 PUT failed: ${res.status}`);
}

export async function confirmUpload(sessionId: string, jwt: string): Promise<SlipConfirmResponse> {
  const res = await fetch(`${API_BASE}/api/slips/${sessionId}/confirm`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`confirm failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export interface UploadSlipOptions {
  file: File;
  jwt: string;
  onProgress?: (phase: 'init' | 'put' | 'confirm') => void;
}

/** Full upload sequence with one retry on transient PUT errors. */
export async function uploadSlipFull(opts: UploadSlipOptions): Promise<{ uploadSessionId: string; r2Key: string }> {
  opts.onProgress?.('init');
  const init = await initSlipUpload(opts.file, opts.jwt);

  opts.onProgress?.('put');
  let putErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await putToR2(init.putUrl, opts.file);
      putErr = undefined;
      break;
    } catch (err) {
      putErr = err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (putErr) throw putErr;

  opts.onProgress?.('confirm');
  await confirmUpload(init.uploadSessionId, opts.jwt);
  return { uploadSessionId: init.uploadSessionId, r2Key: init.r2Key };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`

- [ ] **Step 4: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/pos/src/lib/slip.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(pos): slip upload client orchestration — Slip MVP"
```

---

### Task 5.2: SlipUploadStep component

**Files:**
- Create: `apps/pos/src/components/SlipUploadStep.tsx`
- Create: `apps/pos/src/components/SlipUploadStep.module.css`

- [ ] **Step 1: Write the component**

Create `apps/pos/src/components/SlipUploadStep.tsx`:

```typescript
import { useState } from 'react';
import { uploadSlipFull } from '../lib/slip';
import { ALLOWED_SLIP_MIMES, MAX_SLIP_SIZE_BYTES } from '@2990s/shared';
import styles from './SlipUploadStep.module.css';

interface Props {
  jwt: string;
  onConfirmed: (uploadSessionId: string) => void;
  onCleared: () => void;
}

type Phase = 'idle' | 'init' | 'put' | 'confirm' | 'done' | 'error';

export function SlipUploadStep({ jwt, onConfirmed, onCleared }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFile = async (f: File | null) => {
    if (!f) {
      setFile(null);
      setPreviewUrl(null);
      setPhase('idle');
      onCleared();
      return;
    }
    if (!ALLOWED_SLIP_MIMES.includes(f.type as any)) {
      setErrorMsg('Only JPG / PNG / WebP / PDF supported.');
      setPhase('error');
      return;
    }
    if (f.size > MAX_SLIP_SIZE_BYTES) {
      setErrorMsg('File too large (max 5 MB).');
      setPhase('error');
      return;
    }
    setFile(f);
    setErrorMsg(null);
    if (f.type.startsWith('image/')) setPreviewUrl(URL.createObjectURL(f));
    else setPreviewUrl(null);

    try {
      const result = await uploadSlipFull({
        file: f,
        jwt,
        onProgress: (p) => setPhase(p),
      });
      setPhase('done');
      onConfirmed(result.uploadSessionId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed.');
      setPhase('error');
    }
  };

  return (
    <div className={styles.root}>
      <label className={styles.label}>
        Payment slip <span className={styles.required}>required for transfer</span>
      </label>

      {phase === 'idle' && !file && (
        <input
          type="file"
          className={styles.input}
          accept={ALLOWED_SLIP_MIMES.join(',')}
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
      )}

      {previewUrl && (
        <img src={previewUrl} alt="Slip preview" className={styles.preview} />
      )}

      {phase === 'init' && <div className={styles.status}>Preparing upload...</div>}
      {phase === 'put' && <div className={styles.status}>Uploading slip...</div>}
      {phase === 'confirm' && <div className={styles.status}>Verifying...</div>}
      {phase === 'done' && (
        <div className={styles.statusDone}>
          <span aria-hidden>✓</span> Slip uploaded · {file?.name}
          <button type="button" className={styles.replace} onClick={() => handleFile(null)}>Replace</button>
        </div>
      )}
      {phase === 'error' && (
        <div className={styles.statusError}>
          {errorMsg}
          <button type="button" onClick={() => handleFile(null)}>Try again</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the CSS module**

Create `apps/pos/src/components/SlipUploadStep.module.css`:

```css
.root {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--c-line);
  border-radius: 8px;
  background: var(--c-paper);
}

.label {
  font-weight: 600;
  color: var(--c-ink);
}

.required {
  font-weight: 400;
  font-size: 12px;
  color: var(--c-fg-muted);
  margin-left: 8px;
}

.input {
  padding: 8px;
}

.preview {
  max-width: 240px;
  max-height: 320px;
  border-radius: 4px;
  border: 1px solid var(--c-line);
}

.status {
  color: var(--c-fg-muted);
  font-size: 14px;
}

.statusDone {
  color: #2F5D4F;
  display: flex;
  align-items: center;
  gap: 8px;
}

.statusError {
  color: #B33;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.replace {
  margin-left: auto;
  background: none;
  border: 1px solid var(--c-line);
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`

- [ ] **Step 4: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/pos/src/components/SlipUploadStep.tsx apps/pos/src/components/SlipUploadStep.module.css
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(pos): SlipUploadStep component — Slip MVP"
```

---

### Task 5.3: Integrate SlipUploadStep into Handover.tsx

**Files:**
- Modify: `apps/pos/src/pages/Handover.tsx`

- [ ] **Step 1: Read current Handover.tsx to find paymentMethod state + submit handler**

- [ ] **Step 2: Add slip session state + integrate component**

In Handover.tsx, after the paymentMethod field:

```typescript
import { SlipUploadStep } from '../components/SlipUploadStep';
import { useStaffAuth } from '../state/auth'; // or wherever JWT lives

// inside component
const [uploadSessionId, setUploadSessionId] = useState<string | null>(null);
const { jwt } = useStaffAuth();

// after paymentMethod field
{paymentMethod === 'transfer' && (
  <SlipUploadStep
    jwt={jwt}
    onConfirmed={setUploadSessionId}
    onCleared={() => setUploadSessionId(null)}
  />
)}
```

- [ ] **Step 3: Disable Place-order button when paymentMethod=transfer + no sessionId**

```typescript
const submitDisabled =
  paymentMethod === 'transfer' && !uploadSessionId;

// ...
<button type="submit" disabled={submitDisabled}>
  {submitDisabled ? 'Upload slip first' : 'Place order'}
</button>
```

- [ ] **Step 4: Pass uploadSessionId in POST /orders body**

Find the POST /orders fetch call (likely in a `placeOrder` mutation or similar). Add:
```typescript
body: JSON.stringify({
  // ... existing fields
  uploadSessionId,
}),
```

- [ ] **Step 5: Manual smoke test**

Run: `pnpm --filter @2990s/pos dev`
Manual: open browser, navigate to handover, change payment to transfer, verify SlipUploadStep appears, button disabled.

- [ ] **Step 6: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/pos/src/pages/Handover.tsx
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(pos): wire SlipUploadStep into Handover — Slip MVP"
```

---

## Phase 6 — Backend drawer

### Task 6.1: Backend slip client lib

**Files:**
- Create: `apps/backend/src/lib/slip.ts`

- [ ] **Step 1: Implement client lib**

Create `apps/backend/src/lib/slip.ts`:

```typescript
import type { SlipUrlResponse } from '@2990s/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL;

export async function fetchSlipUrl(orderId: string, jwt: string): Promise<SlipUrlResponse> {
  const res = await fetch(`${API_BASE}/api/orders/${orderId}/slip-url`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`slip-url failed: ${res.status}`);
  return res.json();
}

export async function verifySlip(orderId: string, jwt: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/orders/${orderId}/slip`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ state: 'verified' }),
  });
  if (!res.ok) throw new Error(`verify failed: ${res.status} ${await res.text()}`);
}

export async function flagSlip(orderId: string, reason: string, jwt: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/orders/${orderId}/slip`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ state: 'flagged', reason }),
  });
  if (!res.ok) throw new Error(`flag failed: ${res.status} ${await res.text()}`);
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @2990s/backend typecheck
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/lib/slip.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend): slip API client helpers — Slip MVP"
```

---

### Task 6.2: LaneStepper component

**Files:**
- Create: `apps/backend/src/components/LaneStepper.tsx`
- Create: `apps/backend/src/components/LaneStepper.module.css`

- [ ] **Step 1: Implement**

Create `apps/backend/src/components/LaneStepper.tsx`:

```typescript
import styles from './LaneStepper.module.css';

const LANES = [
  { id: 'received',    num: '01', label: 'Received',   enabled: true },
  { id: 'proceed',     num: '02', label: 'Proceed',    enabled: true },
  { id: 'logistics',   num: '03', label: 'Logistics',  enabled: true },
  { id: 'ready',       num: '04', label: 'Ready',      enabled: true },
  { id: 'dispatched',  num: '05', label: 'Dispatched', enabled: false, tip: 'Driver assignment coming soon' },
  { id: 'delivered',   num: '06', label: 'Delivered',  enabled: false, tip: 'Driver assignment coming soon' },
] as const;

type Lane = typeof LANES[number]['id'];

interface Props {
  current: Lane;
  onAdvance: (next: Lane) => void;
}

export function LaneStepper({ current, onAdvance }: Props) {
  const currentIdx = LANES.findIndex((l) => l.id === current);
  return (
    <ol className={styles.row}>
      {LANES.map((lane, i) => {
        const isCurrent = lane.id === current;
        const isPast = i < currentIdx;
        const isClickable = lane.enabled && i === currentIdx + 1;
        const className = [
          styles.step,
          isCurrent && styles.current,
          isPast && styles.past,
          !lane.enabled && styles.disabled,
        ].filter(Boolean).join(' ');
        return (
          <li key={lane.id} className={className} title={lane.tip ?? ''}>
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onAdvance(lane.id)}
            >
              <span className={styles.num}>{lane.num}</span>
              <span className={styles.label}>{lane.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 2: CSS module**

Create `apps/backend/src/components/LaneStepper.module.css`:

```css
.row {
  display: flex;
  list-style: none;
  padding: 0;
  margin: 0;
  gap: 4px;
}

.step button {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 16px;
  border: 1px solid var(--c-line);
  background: var(--c-paper);
  border-radius: 6px;
  cursor: pointer;
  min-width: 96px;
  font: inherit;
  color: var(--c-ink);
}

.step button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.num {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--c-fg-muted);
}

.label {
  font-size: 14px;
  font-weight: 500;
}

.current button {
  border-color: var(--c-ink);
  background: rgba(34, 31, 32, 0.06);
}

.past button {
  background: rgba(47, 93, 79, 0.08);
  border-color: #2F5D4F;
  color: #2F5D4F;
}

.disabled button {
  opacity: 0.4;
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @2990s/backend typecheck
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/components/LaneStepper.tsx apps/backend/src/components/LaneStepper.module.css
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend): LaneStepper component (6 lanes, last 2 disabled) — Slip MVP"
```

---

### Task 6.3: SlipSection component

**Files:**
- Create: `apps/backend/src/components/SlipSection.tsx`
- Create: `apps/backend/src/components/SlipSection.module.css`

- [ ] **Step 1: Implement**

Create `apps/backend/src/components/SlipSection.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { fetchSlipUrl, verifySlip, flagSlip } from '../lib/slip';
import styles from './SlipSection.module.css';

interface Props {
  orderId: string;
  slipKey: string | null;
  slipState: 'none' | 'pending' | 'verified' | 'flagged';
  slipVerifiedBy: string | null;
  slipVerifiedAt: string | null;
  slipFlagReason: string | null;
  jwt: string;
  onUpdated: () => void;
}

export function SlipSection({
  orderId, slipKey, slipState, slipVerifiedBy, slipVerifiedAt, slipFlagReason, jwt, onUpdated,
}: Props) {
  const [slipUrl, setSlipUrl] = useState<string | null>(null);
  const [contentType, setContentType] = useState<string>('image/jpeg');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showFlagForm, setShowFlagForm] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!slipKey) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchSlipUrl(orderId, jwt);
        if (cancelled) return;
        setSlipUrl(r.url);
        setContentType(r.contentType);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load slip');
      }
    })();
    return () => { cancelled = true; };
  }, [orderId, slipKey, jwt]);

  const verifyDisabled = !slipUrl || submitting;

  if (!slipKey) {
    return (
      <section className={styles.root}>
        <h3>Payment slip</h3>
        <p className={styles.empty}>No slip (card payment).</p>
      </section>
    );
  }

  return (
    <section className={styles.root}>
      <h3>Payment slip</h3>
      {loadError && <p className={styles.error}>{loadError}</p>}
      {slipUrl && contentType.startsWith('image/') && (
        <img src={slipUrl} alt="Slip" className={styles.preview} />
      )}
      {slipUrl && contentType === 'application/pdf' && (
        <iframe src={slipUrl} title="Slip PDF" className={styles.previewPdf} />
      )}

      {slipState === 'pending' && (
        <div className={styles.actions}>
          <button
            type="button"
            disabled={verifyDisabled}
            className={styles.verify}
            onClick={async () => {
              setSubmitting(true);
              try { await verifySlip(orderId, jwt); onUpdated(); } finally { setSubmitting(false); }
            }}
          >
            Verify
          </button>
          <button
            type="button"
            disabled={verifyDisabled}
            className={styles.flag}
            onClick={() => setShowFlagForm(true)}
          >
            Flag
          </button>
        </div>
      )}

      {showFlagForm && (
        <div className={styles.flagForm}>
          <textarea
            value={flagReason}
            onChange={(e) => setFlagReason(e.target.value)}
            placeholder="Reason for flagging (required)"
            rows={3}
            maxLength={500}
          />
          <button
            type="button"
            disabled={!flagReason.trim() || submitting}
            onClick={async () => {
              setSubmitting(true);
              try { await flagSlip(orderId, flagReason, jwt); setShowFlagForm(false); onUpdated(); } finally { setSubmitting(false); }
            }}
          >
            Confirm flag
          </button>
          <button type="button" onClick={() => setShowFlagForm(false)}>Cancel</button>
        </div>
      )}

      {slipState === 'verified' && (
        <div className={styles.statusVerified}>
          ✓ Verified by {slipVerifiedBy ?? 'unknown'} · {slipVerifiedAt ? new Date(slipVerifiedAt).toLocaleString() : ''}
        </div>
      )}

      {slipState === 'flagged' && (
        <div className={styles.statusFlagged}>
          ⚠ Flagged · {slipFlagReason}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: CSS module**

Create `apps/backend/src/components/SlipSection.module.css`:

```css
.root { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-top: 1px solid var(--c-line); }
.empty { color: var(--c-fg-muted); font-style: italic; }
.error { color: #B33; }
.preview { max-width: 480px; max-height: 600px; border-radius: 4px; border: 1px solid var(--c-line); }
.previewPdf { width: 480px; height: 600px; border: 1px solid var(--c-line); }
.actions { display: flex; gap: 8px; }
.verify { background: #2F5D4F; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; }
.verify:disabled { opacity: 0.5; cursor: not-allowed; }
.flag { background: white; color: #B33; border: 1px solid #B33; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
.flagForm { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: rgba(179, 51, 51, 0.05); border-radius: 4px; }
.statusVerified { color: #2F5D4F; font-weight: 500; padding: 8px 12px; background: rgba(47, 93, 79, 0.08); border-left: 3px solid #2F5D4F; }
.statusFlagged { color: #B33; font-weight: 500; padding: 8px 12px; background: rgba(179, 51, 51, 0.08); border-left: 3px solid #B33; }
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @2990s/backend typecheck
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/components/SlipSection.tsx apps/backend/src/components/SlipSection.module.css
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend): SlipSection component (preview + verify/flag) — Slip MVP"
```

---

### Task 6.4: OrderDrawer container

**Files:**
- Create: `apps/backend/src/components/OrderDrawer.tsx`
- Create: `apps/backend/src/components/OrderDrawer.module.css`

- [ ] **Step 1: Implement drawer**

Create `apps/backend/src/components/OrderDrawer.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LaneStepper } from './LaneStepper';
import { SlipSection } from './SlipSection';
import { useStaffAuth } from '../lib/auth'; // adjust path to existing auth hook
import styles from './OrderDrawer.module.css';

interface Props {
  orderId: string | null;
  onClose: () => void;
}

interface OrderDetail {
  id: string;
  lane: string;
  customer_name: string;
  customer_phone: string | null;
  total: number;
  paid: number;
  payment_method: string;
  slip_key: string | null;
  slip_state: 'none' | 'pending' | 'verified' | 'flagged';
  slip_verified_by: string | null;
  slip_verified_at: string | null;
  slip_flag_reason: string | null;
  // (extend as needed)
}

const API_BASE = import.meta.env.VITE_API_BASE_URL;

export function OrderDrawer({ orderId, onClose }: Props) {
  const { jwt } = useStaffAuth();
  const qc = useQueryClient();

  const { data: order, isLoading, error } = useQuery({
    queryKey: ['order', orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/orders/${orderId}`, {
        headers: { authorization: `Bearer ${jwt}` },
      });
      if (!res.ok) throw new Error(`load failed: ${res.status}`);
      return res.json() as Promise<OrderDetail>;
    },
  });

  // Close on Esc
  useEffect(() => {
    if (!orderId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [orderId, onClose]);

  if (!orderId) return null;

  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <aside className={styles.drawer} role="dialog" aria-label={`Order ${orderId}`}>
        <header className={styles.head}>
          <div>
            <div className={styles.id}>{orderId}</div>
            <div className={styles.sub}>{order?.customer_name ?? '...'}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.close}>×</button>
        </header>

        {isLoading && <div className={styles.body}>Loading...</div>}
        {error && <div className={styles.body}>Error: {error.message}</div>}

        {order && (
          <div className={styles.body}>
            <LaneStepper
              current={order.lane as any}
              onAdvance={async (next) => {
                await fetch(`${API_BASE}/api/orders/${orderId}/lane`, {
                  method: 'PATCH',
                  headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
                  body: JSON.stringify({ lane: next }),
                });
                qc.invalidateQueries({ queryKey: ['order', orderId] });
              }}
            />

            <section className={styles.info}>
              <div><b>Phone:</b> {order.customer_phone ?? '—'}</div>
              <div><b>Total:</b> RM {order.total.toLocaleString('en-MY')}</div>
              <div><b>Paid:</b> RM {order.paid.toLocaleString('en-MY')}</div>
              <div><b>Payment:</b> {order.payment_method}</div>
            </section>

            <SlipSection
              orderId={orderId}
              slipKey={order.slip_key}
              slipState={order.slip_state}
              slipVerifiedBy={order.slip_verified_by}
              slipVerifiedAt={order.slip_verified_at}
              slipFlagReason={order.slip_flag_reason}
              jwt={jwt}
              onUpdated={() => qc.invalidateQueries({ queryKey: ['order', orderId] })}
            />
          </div>
        )}
      </aside>
    </>
  );
}
```

- [ ] **Step 2: CSS module**

Create `apps/backend/src/components/OrderDrawer.module.css`:

```css
.scrim { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 100; }
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: 600px; max-width: 90vw; background: var(--c-paper); border-left: 1px solid var(--c-line); z-index: 101; overflow-y: auto; box-shadow: -8px 0 24px rgba(0,0,0,0.1); }
.head { display: flex; justify-content: space-between; align-items: center; padding: 20px; border-bottom: 1px solid var(--c-line); }
.id { font-size: 18px; font-weight: 600; }
.sub { font-size: 13px; color: var(--c-fg-muted); margin-top: 4px; }
.close { background: none; border: none; font-size: 28px; cursor: pointer; color: var(--c-fg-muted); padding: 0 8px; }
.body { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.info { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 16px; background: rgba(0,0,0,0.02); border-radius: 6px; }
```

- [ ] **Step 3: Endpoint check — does `PATCH /api/orders/:id/lane` exist?**

Look in `apps/api/src/routes/orders.ts`. If missing, this is a dependency for OrderDrawer's lane advance. Either:
- Add to current task (small endpoint, ~15 lines)
- Note as TODO and only implement Verify/Flag in this iteration

For v1 spec scope: lane advance IS in scope (drawer uses it). Add the endpoint.

Add to `apps/api/src/routes/orders.ts`:
```typescript
ordersRoutes.patch('/:id/lane', async (c) => {
  const role = c.get('staffRole');
  if (!COORDINATOR_ROLES.includes(role as any)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }
  const orderId = c.req.param('id');
  const { lane } = await c.req.json();
  const validLanes = ['received','proceed','logistics','ready'] as const;
  if (!validLanes.includes(lane)) return c.json({ error: 'invalid_lane' }, 400);

  const supabase = c.get('supabase');
  const staffId = c.get('staffId');

  const { data: row } = await supabase.from('orders').select('lane').eq('id', orderId).single();
  await supabase.from('orders').update({ lane }).eq('id', orderId);
  await supabase.from('order_lane_history').insert({
    order_id: orderId,
    from_lane: row?.lane,
    to_lane: lane,
    changed_by: staffId,
  });
  return c.json({ orderId, lane });
});
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm --filter @2990s/backend typecheck
pnpm --filter @2990s/api typecheck
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/components/OrderDrawer.tsx apps/backend/src/components/OrderDrawer.module.css apps/api/src/routes/orders.ts
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend+api): OrderDrawer + PATCH /orders/:id/lane — Slip MVP"
```

---

### Task 6.5: Wire OrderDrawer into Orders.tsx

**Files:**
- Modify: `apps/backend/src/pages/Orders.tsx`

- [ ] **Step 1: Read existing Orders.tsx**

- [ ] **Step 2: Add drawer state + URL sync**

Top of component:
```typescript
import { useSearchParams } from 'react-router-dom';
import { OrderDrawer } from '../components/OrderDrawer';

const [searchParams, setSearchParams] = useSearchParams();
const openOrderId = searchParams.get('orderId');

const openDrawer = (id: string) => {
  setSearchParams({ orderId: id }, { replace: true });
};
const closeDrawer = () => {
  setSearchParams({}, { replace: true });
};
```

- [ ] **Step 3: Make rows clickable + render drawer**

Find the row map (likely `orders.map(o => <tr ...>...</tr>)` or similar). Add `onClick={() => openDrawer(o.id)}` to the row, ensure cursor is pointer via inline or CSS.

At the end of return:
```tsx
<OrderDrawer orderId={openOrderId} onClose={closeDrawer} />
```

- [ ] **Step 4: Manual smoke test**

`pnpm --filter @2990s/backend dev`. Open Backend orders list, click a row, verify drawer slides in. Click X or press Esc, verify drawer closes. Verify URL updates (`?orderId=SO-XXXX`).

- [ ] **Step 5: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add apps/backend/src/pages/Orders.tsx
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "feat(backend): wire OrderDrawer into Orders list — Slip MVP"
```

---

## Phase 7 — Acceptance + polish

### Task 7.1: Test data seed

**Files:**
- Create: `packages/db/seeds/test-orders.sql`

- [ ] **Step 1: Write seed**

Create `packages/db/seeds/test-orders.sql`:

```sql
-- packages/db/seeds/test-orders.sql
-- Test orders for dev environment. Idempotent via ON CONFLICT.
-- Assumes Phase 1 catalog seed has run (products + addons exist).

DO $$
DECLARE
  v_staff_aw uuid;
  v_showroom uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_first_product uuid;
BEGIN
  SELECT id INTO v_staff_aw FROM staff WHERE staff_code = 'AW' LIMIT 1;
  SELECT id INTO v_first_product FROM products WHERE visible = true ORDER BY created_at LIMIT 1;

  -- Order 1: received lane, no slip (card payment)
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state)
  VALUES ('SO-9001', v_staff_aw, v_showroom, 'received', 'Test Customer 1', '+60123456001',
    2990, 0, 2990, 2990, '0', 'credit', 'none')
  ON CONFLICT (id) DO NOTHING;

  -- Order 2: pending slip verify
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state, slip_key)
  VALUES ('SO-9002', v_staff_aw, v_showroom, 'received', 'Test Customer 2', '+60123456002',
    3990, 0, 3990, 1000, '0', 'transfer', 'pending', 'slips/2026/05/test-pending.jpg')
  ON CONFLICT (id) DO NOTHING;

  -- Order 3: verified slip
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state, slip_key,
    slip_verified_by, slip_verified_at)
  VALUES ('SO-9003', v_staff_aw, v_showroom, 'proceed', 'Test Customer 3', '+60123456003',
    4990, 0, 4990, 4990, '0', 'transfer', 'verified', 'slips/2026/05/test-verified.jpg',
    v_staff_aw, now())
  ON CONFLICT (id) DO NOTHING;

  -- Order 4: flagged slip
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state, slip_key,
    slip_flag_reason)
  VALUES ('SO-9004', v_staff_aw, v_showroom, 'received', 'Test Customer 4', '+60123456004',
    1990, 0, 1990, 1990, '0', 'transfer', 'flagged', 'slips/2026/05/test-flagged.jpg',
    'Amount mismatch — slip shows RM 1500, order total RM 1990')
  ON CONFLICT (id) DO NOTHING;

  -- Order 5: at logistics lane
  INSERT INTO orders (id, staff_id, showroom_id, lane, customer_name, customer_phone,
    subtotal, addon_total, total, paid, pricing_version, payment_method, slip_state, slip_key,
    slip_verified_by, slip_verified_at)
  VALUES ('SO-9005', v_staff_aw, v_showroom, 'logistics', 'Test Customer 5', '+60123456005',
    5990, 0, 5990, 5990, '0', 'transfer', 'verified', 'slips/2026/05/test-logistics.jpg',
    v_staff_aw, now())
  ON CONFLICT (id) DO NOTHING;
END $$;
```

- [ ] **Step 2: Apply via MCP execute_sql**

Use `mcp__supabase__execute_sql` to run the above (this is data, not schema — doesn't need apply_migration).

- [ ] **Step 3: Verify**

```sql
SELECT id, lane, slip_state FROM orders WHERE id LIKE 'SO-900%' ORDER BY id;
```
Expected: 5 rows.

- [ ] **Step 4: Commit**

```bash
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" add packages/db/seeds/test-orders.sql
git -c user.name="wenwei4046" -c user.email="wenwei4046@gmail.com" commit -m "chore(db): seed test orders with various slip states — Slip MVP"
```

---

### Task 7.2: Run Loo's manual acceptance test

**Files:** none

- [ ] **Step 1: Verify all dependencies are in place**

Checklist:
- [ ] R2 bucket `2990s-slips` exists
- [ ] Migrations 0008, 0009, 0010, 0011 applied
- [ ] Wrangler secrets set (4 secrets — see Task 4.3 Step 3)
- [ ] `pnpm dev` runs all 3 apps without errors
- [ ] Test orders seeded

- [ ] **Step 2: Send Loo the acceptance test script**

Quote spec §8.3 verbatim. Send Loo the 5 tests in order.

- [ ] **Step 3: Address any failures**

If a test fails: investigate root cause, fix, re-run that specific test. Document fixes in incremental commits.

- [ ] **Step 4: Get Loo's confirmation**

Once all 5 tests pass, ask Loo: "Slip MVP acceptance test pass — ready to mark this iteration ship-complete?"

---

### Task 7.3: Final cleanup + push

**Files:** various

- [ ] **Step 1: Run full typecheck + test across monorepo**

```bash
pnpm typecheck
pnpm test
```

- [ ] **Step 2: Verify no orphan files**

Run: `git status`. Should be clean.

- [ ] **Step 3: Push all commits**

```bash
git push origin main
```

- [ ] **Step 4: Update plan doc with completion timestamp**

At the top of this plan file, add:
```markdown
**Completed**: YYYY-MM-DD HH:MM GMT+8
```
Commit + push.

- [ ] **Step 5: Notify Loo**

"Slip MVP shipped. Implementation done in N commits. Acceptance test pass. Next: brainstorm Phase 4 sub-project C (driver + dispatch + DO) when ready."

---

## Self-Review Checklist (executor reads this before claiming done)

- [ ] Spec coverage: every section of `2026-05-09-slip-workflow-mvp-design.md` has a corresponding task here.
- [ ] All RLS migrations have explicit STOP gates with the exact wording for asking Loo.
- [ ] Every task ends with a commit using `git -c user.name=... -c user.email=...` form (since git config not modified).
- [ ] No "TBD" / "TODO" / "implement appropriately" placeholders.
- [ ] Type names consistent across tasks (e.g. `SlipInitRequest`, not `SlipInitReq` then `SlipInitRequest`).
- [ ] CSS module files have actual class names, not `// styles here`.

---

*End of plan. Total: 24 tasks across 7 phases. Estimated 5-7 days of focused execution.*
