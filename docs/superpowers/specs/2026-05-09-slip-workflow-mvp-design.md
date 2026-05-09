# Slip Workflow MVP — Design Spec

| | |
|---|---|
| **Date** | 2026-05-09 |
| **Author** | Claude (with Loo) — brainstormed via `superpowers:brainstorming` skill |
| **Branch** | `main` |
| **Phase** | Subset of plan §9 Phase 4 |
| **Status** | Design approved, awaiting `writing-plans` skill to produce implementation plan |
| **Estimated work** | ~5–7 days for full implementation + acceptance test |

---

## 1. Goal & Scope

### 1.1 What we're building

End-to-end slip upload + verify workflow for transfer payments:

1. **POS** — when sales picks `paymentMethod = transfer`, a slip upload step appears in the handover form. Sales picks the customer's bank receipt file, browser uploads to R2 directly (presigned PUT), confirms, then submits the order with the slip session attached.
2. **API** — issues presigned R2 URLs, validates uploads (hash + size), atomically promotes slip session to a real order in the `create_order_with_items()` RPC.
3. **Backend** — coordinator opens an order drawer (newly built), views the slip image/PDF, clicks **Verify** or **Flag**.
4. **Cron Worker** — every 10 minutes, reaps `pending_slip_uploads` rows whose `expires_at` has passed, deletes the orphan R2 objects.

### 1.2 Out of scope (deferred to later iterations)

This iteration deliberately excludes:

- ❌ **Driver assignment** — driver picker UI in drawer; lane → `dispatched` transition gate. Phase 4 sub-project C.
- ❌ **DO upload** — driver-uploaded delivery order signature. Phase 4 sub-project C.
- ❌ **Payment recording** — `payments` table audit trail (deposits, balance, topups, refunds). Phase 4+.
- ❌ **PO + suppliers** — TODOS T1 + Phase 4 sub-project D.
- ❌ **Slip re-upload after flag** — flagged slips are handled offline (sales WhatsApp coordinator + finance) for v1.
- ❌ **6-lane drag board** — main orders view stays as list; `Orders.tsx` gets click-to-open-drawer. Drag is a polish iteration.
- ❌ **Optimistic locking on concurrent verify** — last-write-wins for v1 (Realtime auto-refresh smooths the UX).
- ❌ **React component tests** — covered by manual + future Playwright e2e. Pilot validates UX.
- ❌ **Sentry / observability infra** — `console.error` + `wrangler tail` for v1; Phase 5 hardens this.

### 1.3 Why this subset first

Phase 4 in plan §9 was scoped as "slip + dispatch + delivery". Investigation revealed it actually contains 5 independent subsystems:

| # | Sub-project | Status |
|---|---|---|
| A | OrderDrawer + 6-lane board | not started (Phase 3 also unfinished) |
| B | Slip upload pipeline | not started |
| C | Driver + dispatch + DO | not started |
| D | Suppliers + PO | not started + TODOS T1 blocker |
| E | Slip orphan reaper | not started |

The drawer is foundational — every Phase 4 sub-feature needs UI that lives in it. So this iteration merges A (drawer minimum) + B (slip pipeline) + E (reaper) into one coherent shippable unit. C and D follow in subsequent iterations.

---

## 2. Architecture

### 2.1 Layer diagram

```
┌──────────────────────────────────────────────────────────────┐
│  POS (apps/pos)                                              │
│  ─ Handover.tsx   inserts <SlipUploadStep> when transfer    │
│  ─ POST /api/slips/init       → presigned PUT URL           │
│  ─ PUT bytes directly to R2  (browser → R2, no Worker)      │
│  ─ POST /api/slips/{session}/confirm                        │
│  ─ POST /orders (with uploadSessionId)                      │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  API (apps/api on Cloudflare Workers)                        │
│  ─ routes/slips.ts (NEW)         init / confirm / sign-get  │
│  ─ routes/orders.ts (MODIFY)     POST extension + PATCH     │
│  ─ lib/r2.ts (NEW)               presign + head + delete    │
│  ─ lib/slip.ts (NEW)             business logic             │
│  ─ lib/reaper.ts (NEW)           cron handler               │
│  ─ index.ts (MODIFY)             scheduled() export         │
└──────────────────────────────────────────────────────────────┘
                            │            │
                ┌───────────┘            └────────────┐
                ▼                                     ▼
┌─────────────────────────────────┐  ┌────────────────────────┐
│  R2 bucket: 2990s-slips         │  │  Supabase Postgres     │
│  ─ slips/{YYYY}/{MM}/{uuid}.{ext}│  │  ─ pending_slip_uploads│
│  ─ Reaper DELETEs orphans       │  │  ─ orders.slipKey      │
└─────────────────────────────────┘  │  ─ order_slip_events   │
                                     │  ─ app_config          │
                                     └────────────────────────┘
                                              │
                                              ▼ Realtime
┌──────────────────────────────────────────────────────────────┐
│  Backend (apps/backend)                                      │
│  ─ Orders.tsx (MODIFY)        click row → open drawer        │
│  ─ OrderDrawer.tsx (NEW)      lane stepper + slip section    │
│  ─ SlipSection.tsx (NEW)      image/PDF preview + verify     │
│  ─ LaneStepper.tsx (NEW)      6 lanes, last 2 disabled       │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Key design points

- **Browser → R2 direct**: avoids CF Worker CPU cost + sidesteps the 100MB request body limit.
- **Three-state lifecycle**: `pending` → `uploaded` → `promoted`. Schema's 4th state `failed` is reaper-controlled.
- **Atomic promotion**: the `create_order_with_items()` RPC promotes the slip session in the same transaction as creating orders + order_items rows. POST /orders fail = full rollback = session stays `uploaded` for retry.
- **Reaper concurrency**: `SELECT FOR UPDATE SKIP LOCKED` + `claimed_by` lease prevents two reaper instances racing on the same row.
- **Realtime already wired** (migration 0007 published `orders` to `supabase_realtime`). Verify → other Backend tabs auto-refresh.

---

## 3. Components

28 files total: 23 new + 5 modified (5 of the new files are test files).

### 3.1 `packages/shared/`

| File | State | Purpose |
|---|---|---|
| `src/schemas/slip.schema.ts` | NEW | Zod schemas: `SlipInitRequest`, `SlipInitResponse`, `SlipConfirmRequest`, `SlipVerifyRequest`. Shared between POS and API for type safety. |

### 3.2 `packages/db/migrations/`

| File | State | Purpose | Touches red line |
|---|---|---|---|
| `0008_slip_upload_rls.sql` | NEW | RLS policies for `pending_slip_uploads`. | ⚠️ Yes (#4) |
| `0009_app_config_rls.sql` | NEW | RLS policies for `app_config` (clears advisor warning). | ⚠️ Yes (#4) |
| `0010_promote_slip_in_create_order.sql` | NEW | `CREATE OR REPLACE` upgrades 0006's RPC to handle slip session promotion. | Not RLS, but security-relevant |

> Each of these requires explicit per-migration confirmation from Loo at apply time. See §9.

### 3.3 `apps/api/`

| File | State | Purpose |
|---|---|---|
| `wrangler.toml` | MODIFY | Uncomment `[[r2_buckets]]` block + `[triggers] crons = ["*/10 * * * *"]`. |
| `src/routes/slips.ts` | NEW | `POST /api/slips/init`, `POST /api/slips/:session/confirm`. |
| `src/routes/orders.ts` | MODIFY | POST accepts `uploadSessionId`; new `PATCH /api/orders/:id/slip`; new `GET /api/orders/:id/slip-url`. |
| `src/lib/r2.ts` | NEW | R2 helpers: `presignPut`, `presignGet`, `headObject`, `deleteObject`. |
| `src/lib/slip.ts` | NEW | Server-side business logic: `initSlipSession`, `confirmSlipSession`, `verifySlip`, `flagSlip`. |
| `src/lib/reaper.ts` | NEW | Cron handler: claim leases, R2 deletes, status updates. |
| `src/index.ts` | MODIFY | Register `slips` route; add `scheduled` export so CF Cron can trigger reaper. |

### 3.4 `apps/pos/`

| File | State | Purpose |
|---|---|---|
| `src/pages/Handover.tsx` | MODIFY | Conditionally insert `<SlipUploadStep>` when `paymentMethod === 'transfer'`. Disable Place-order button until session confirmed. |
| `src/components/SlipUploadStep.tsx` (+ `.module.css`) | NEW | File picker (5MB cap, 4 MIME types), local preview, upload progress, success ✓ state. |
| `src/lib/slip.ts` | NEW | Client orchestration: file → SHA-256 hash → init → PUT → confirm. Handles retry (3 attempts, 2s backoff). |

### 3.5 `apps/backend/`

| File | State | Purpose |
|---|---|---|
| `src/pages/Orders.tsx` | MODIFY | Existing list rows get onClick → open drawer; URL syncs `?orderId=SO-XXXX` so refresh keeps drawer open. |
| `src/components/OrderDrawer.tsx` (+ `.module.css`) | NEW | Right-side slide-in. Closes on Esc / click-outside / X. Loads order detail by id. Hosts LaneStepper + SlipSection + customer info. |
| `src/components/LaneStepper.tsx` (+ `.module.css`) | NEW | 6-lane horizontal stepper. Lanes 1–4 clickable; 5–6 disabled with tooltip "Driver assignment coming soon". |
| `src/components/SlipSection.tsx` (+ `.module.css`) | NEW | Slip preview (`<img>` for image, `<iframe>` for PDF), cross-check info rows, Verify/Flag buttons, verified/flagged status hints. |
| `src/lib/slip.ts` | NEW | Client API helpers: `fetchSlipUrl`, `verifySlip`, `flagSlip`. |

### 3.6 Tests

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/slip.schema.test.ts` | Zod schema valid/invalid cases. |
| `apps/api/src/lib/r2.test.ts` | Presign URL format + TTL. |
| `apps/api/src/lib/reaper.test.ts` | Concurrency (SKIP LOCKED), batch limit, error path. |
| `apps/api/src/routes/slips.test.ts` | init → confirm → POST /orders integration; error paths. |
| `apps/api/src/routes/orders-slip.test.ts` | PATCH verify/flag integration; auth roles. |

R2 mocked via `@miniflare/r2`. Postgres tests use Supabase `create_branch` (isolated throwaway DB).

---

## 4. Data Flow

### 4.1 State machine for `pending_slip_uploads`

```
                    ┌──────────────┐
                    │  pending     │  POS got PUT URL, file not yet sent
                    │  (TTL 1h)    │
                    └──────┬───────┘
                           │ POS PUT succeeds + confirms
                           │ Server HEAD R2 — hash + size match
                           ▼
                    ┌──────────────┐
                    │  uploaded    │  File in R2, not yet attached to order
                    │  (TTL 1h)    │
                    └──────┬───────┘
                           │ POS POST /orders with sessionId
                           │ Server promotes inside RPC transaction
                           ▼
                    ┌──────────────┐
                    │  promoted    │  ✓ Attached to SO-XXXX, retained
                    └──────────────┘

  Any pending/uploaded row past expires_at without promotion
                           │
                           ▼ Reaper claims
                    ┌──────────────┐
                    │  failed      │  R2 file deleted, DB row kept 1 week for audit
                    └──────────────┘
```

### 4.2 Happy path (POS upload → POST /orders)

| # | Actor | Action |
|---|---|---|
| 1 | Sales (POS) | Picks `paymentMethod = transfer`; selects slip file; browser computes SHA-256. |
| 2 | POS → API | `POST /api/slips/init` with file metadata → server INSERTs `pending_slip_uploads` (status=pending, expires_at=now+1h) → returns `uploadSessionId` + presigned PUT URL. |
| 3 | POS → R2 | Browser PUTs bytes to R2 directly. |
| 4 | POS → API | `POST /api/slips/:session/confirm` → server HEADs R2 → checks etag/size against init-time hash + size → UPDATE status=uploaded. |
| 5 | Sales | Sees ✓; clicks Place order. |
| 6 | POS → API | `POST /api/orders` with cart + customer + `uploadSessionId` → server-side pricing recompute → calls `create_order_with_items()` RPC. |
| 7 | RPC (in tx) | INSERT orders / order_items + UPDATE pending_slip_uploads.status='promoted' + UPDATE orders.slipKey + INSERT order_slip_events('uploaded') → returns SO-XXXX. |
| 8 | Realtime | `orders` INSERT event → Backend coordinator's open tab gets toast. |

### 4.3 Coordinator verify path

| # | Actor | Action |
|---|---|---|
| 1 | Coordinator | Clicks SO-XXXX row in Backend list → drawer slides in. |
| 2 | Backend → API | Existing `GET /api/orders/:id` → finds non-null `slipKey` → calls `GET /api/orders/:id/slip-url` → returns presigned R2 GET (5 min TTL). |
| 3 | Browser | `<img src={presignedGet}>` (or `<iframe>` for PDF) loads from R2 directly. |
| 4 | Coordinator | Visually compares slip's amount/name/ref against order details → decides Verify or Flag. |
| 5 | Backend → API | `PATCH /api/orders/:id/slip` {state, reason?} → DB UPDATE orders.slip_state + INSERT order_slip_events → Realtime notifies all Backend tabs. |

### 4.4 Reaper (every 10 min)

```
SELECT id, r2_key
  FROM pending_slip_uploads
 WHERE status IN ('pending','uploaded')
   AND expires_at < now()
   AND (claimed_by IS NULL OR lease_expires_at < now())
   FOR UPDATE SKIP LOCKED
 LIMIT 100;

For each row:
  1. UPDATE claimed_by = workerId, lease_expires_at = now() + 5 min
  2. r2.deleteObject(r2_key)
  3. UPDATE status = 'failed', error_msg = 'reaper: expired'
```

### 4.5 Edge cases

| Scenario | Handling |
|---|---|
| Customer abandons mid-upload | Row stays `pending`, no R2 object. Reaper clears row after TTL. |
| Customer uploaded but didn't submit | Row stays `uploaded`, R2 has file. Reaper deletes both. |
| Hash mismatch on confirm | Confirm returns 400 `hash_mismatch`; row → status=failed; R2 file queued for delete. |
| POST /orders with already-promoted session | 409 `slip_already_used`. |
| POST /orders with failed session | 410 `slip_expired`; POS must restart `init`. |
| Network retry on init | `upload_session_id` is idempotency key — re-INSERT detected by unique constraint. |
| Sales changes paymentMethod transfer → card after upload | SlipUploadStep hides; the abandoned row reaped after TTL. |
| Two coordinators open same order | Last-write-wins; Realtime broadcasts so the loser's drawer auto-refreshes. |
| R2 outage | Init/confirm return 503; POST /orders unaffected (`slipKey` is nullable). |

---

## 5. API Contracts

All endpoints use existing `apps/api/src/middleware/auth.ts` for JWT validation. Role checks via existing helpers (`is_coordinator_or_above()` etc).

### 5.1 `POST /api/slips/init`

**Auth**: any authenticated staff
**Request**:
```ts
{
  fileSize: number,        // bytes; reject if > 5_242_880 (5 MB)
  contentType: string,     // 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'
  contentHash: string,     // SHA-256 hex (64 chars), lowercased
  orderDraftId?: string,   // optional client cart UUID, audit only
}
```
**Success 200**:
```ts
{
  uploadSessionId: string, // server-generated UUIDv4
  putUrl: string,          // presigned R2 PUT URL, 5 min TTL
  r2Key: string,           // 'slips/{YYYY}/{MM}/{uploadSessionId}.{ext}'
  expiresAt: string,       // ISO 8601 — when reaper will claim (init + 1h)
}
```
**Errors**:
- `400 invalid_content_type`
- `400 file_too_large`
- `400 invalid_hash` (not 64-char hex)
- `401 unauthenticated`
- `503 storage_unavailable`

### 5.2 `POST /api/slips/:session/confirm`

**Auth**: staff who created the session (server-side check via JWT vs `staff_id`)
**Request**: `{}` (empty)
**Success 200**:
```ts
{ status: 'uploaded', r2Key: string }
```
**Errors**:
- `404 session_not_found`
- `409 invalid_state` (not currently `pending`)
- `400 hash_mismatch` (server HEAD differs from init-time hash/size; row → failed; queued for R2 delete)
- `404 file_not_in_r2`
- `403 not_session_owner`

### 5.3 `GET /api/orders/:id/slip-url`

**Auth**: coordinator / finance / admin only
**Request**: empty
**Success 200**:
```ts
{
  url: string,           // presigned R2 GET, 5 min TTL
  contentType: string,   // determines <img> vs <iframe> on Backend
  expiresAt: string,
}
```
**Errors**:
- `404 order_not_found`
- `400 no_slip_attached` (orders.slipKey IS NULL)
- `403 not_authorized_role`
- `503 storage_unavailable`

### 5.4 `PATCH /api/orders/:id/slip`

**Auth**: coordinator / finance / admin
**Request**:
```ts
{
  state: 'verified' | 'flagged',
  reason?: string,        // required when flagged, max 500 chars
}
```
**Success 200**:
```ts
{
  orderId: string,
  slipState: 'verified' | 'flagged',
  slipVerifiedBy: string,  // staff name from JOIN
  slipVerifiedAt: string,
}
```
DB writes (in transaction): UPDATE orders.slip_state + slip_verified_by + slip_verified_at + slip_flag_reason; INSERT order_slip_events {event: 'verified'|'flagged', actor_id, meta: {reason}}.
**Errors**:
- `404 order_not_found`
- `400 invalid_state` (current slipState not `pending`)
- `400 reason_required`
- `403 not_authorized_role`

### 5.5 `POST /api/orders` (modified)

Existing endpoint gains:
```ts
{
  // ...existing fields...
  uploadSessionId?: string, // required when paymentMethod === 'transfer'
}
```
New validation:
- `paymentMethod = 'transfer'` + missing sessionId → `400 slip_required_for_transfer`
- session.status ≠ 'uploaded' → `409 slip_not_ready`
- session already promoted → `409 slip_already_used`
- session.staff_id ≠ JWT staff_id → `403 not_session_owner`

RPC change is in §6 M3.

### 5.6 Auth matrix

| Endpoint | Sales | Lead | Coordinator | Finance | Admin |
|---|---|---|---|---|---|
| POST /api/slips/init | ✅ | ✅ | ✅ | ✅ | ✅ |
| POST /api/slips/:s/confirm (own session only) | ✅ | ✅ | ✅ | ✅ | ✅ |
| GET /api/orders/:id/slip-url | ❌ | ❌ | ✅ | ✅ | ✅ |
| PATCH /api/orders/:id/slip | ❌ | ❌ | ✅ | ✅ | ✅ |
| POST /api/orders (with uploadSessionId) | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 6. Schema Changes (touches red line #4)

**No new columns / no enum changes** — schema in 0000 already includes all required tables and fields. This section adds 3 migrations: 2 RLS policy migrations + 1 RPC `CREATE OR REPLACE`.

### 6.1 M1 — `0008_slip_upload_rls.sql`

**Behavior**:

| Role | Permission |
|---|---|
| anon | denied (no policy) |
| authenticated staff | INSERT own row only; SELECT own row OR coordinator+ sees all |
| service_role | UPDATE / DELETE (server-only via API) |

```sql
-- 0008_slip_upload_rls.sql
CREATE POLICY pending_slip_insert_own
  ON pending_slip_uploads FOR INSERT TO authenticated
  WITH CHECK (staff_id = auth.uid());

CREATE POLICY pending_slip_select_own_or_coord
  ON pending_slip_uploads FOR SELECT TO authenticated
  USING (staff_id = auth.uid() OR is_coordinator_or_above());

-- Deliberately no UPDATE/DELETE policy — denied for authenticated.
-- service_role bypasses RLS so confirm/promote/reaper work as needed.
```

### 6.2 M2 — `0009_app_config_rls.sql`

Clears the existing `rls_enabled_no_policy` advisor warning for `app_config`.

| Role | Permission |
|---|---|
| anon | denied |
| authenticated staff | SELECT all keys (need to read `pricing_version`) |
| admin only | INSERT / UPDATE / DELETE |

```sql
-- 0009_app_config_rls.sql
CREATE POLICY app_config_select_staff
  ON app_config FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY app_config_modify_admin
  ON app_config FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
```

### 6.3 M3 — `0010_promote_slip_in_create_order.sql`

`CREATE OR REPLACE` of the RPC defined in 0006. Adds 3 new logic blocks:
1. Validate `uploadSessionId` if present (lock row, check owner + status).
2. INSERT orders with `slip_key` and `slip_state` derived from session (or NULL/none).
3. Promote session to `promoted` + INSERT `order_slip_events` audit row.

```sql
-- 0010_promote_slip_in_create_order.sql
CREATE OR REPLACE FUNCTION public.create_order_with_items(p jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_order_id        text;
  v_staff_id        uuid := auth.uid();
  v_showroom_id     uuid;
  v_pricing_version text;
  v_session_id      uuid;
  v_session_row     pending_slip_uploads%ROWTYPE;
BEGIN
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT showroom_id INTO v_showroom_id
  FROM staff WHERE id = v_staff_id AND active = TRUE;
  IF v_showroom_id IS NULL THEN
    v_showroom_id := (p->>'showroomId')::uuid;
    IF v_showroom_id IS NULL THEN
      SELECT id INTO v_showroom_id FROM showrooms ORDER BY id LIMIT 1;
    END IF;
  END IF;

  v_pricing_version := COALESCE(app_config_get('pricing_version'), '0');
  v_order_id := next_order_id();

  -- Slip session validation (NEW in 0010) ────────────
  v_session_id := NULLIF(p->>'uploadSessionId', '')::uuid;
  IF v_session_id IS NOT NULL THEN
    SELECT * INTO v_session_row FROM pending_slip_uploads
    WHERE id = v_session_id FOR UPDATE;

    IF v_session_row.id IS NULL THEN
      RAISE EXCEPTION 'slip_session_not_found' USING errcode = 'P0002';
    END IF;
    IF v_session_row.staff_id <> v_staff_id THEN
      RAISE EXCEPTION 'not_session_owner' USING errcode = '42501';
    END IF;
    IF v_session_row.status <> 'uploaded' THEN
      RAISE EXCEPTION 'slip_not_ready' USING errcode = '22023';
    END IF;
  ELSIF (p->>'paymentMethod') = 'transfer' THEN
    RAISE EXCEPTION 'slip_required_for_transfer' USING errcode = '23514';
  END IF;

  -- INSERT orders (existing fields + slip_key + slip_state) ────────
  INSERT INTO orders (
    id, staff_id, showroom_id, lane,
    customer_name, customer_phone, customer_email,
    customer_address, customer_postcode, customer_city, customer_state,
    subtotal, addon_total, total, paid,
    pricing_version,
    payment_method, approval_code,
    notes,
    slip_key, slip_state
  ) VALUES (
    v_order_id, v_staff_id, v_showroom_id, 'received',
    p->>'customerName',
    NULLIF(p->>'customerPhone', ''),
    NULLIF(p->>'customerEmail', ''),
    NULLIF(p->>'customerAddress', ''),
    NULLIF(p->>'customerPostcode', ''),
    NULLIF(p->>'customerCity', ''),
    NULLIF(p->>'customerState', ''),
    (p->>'subtotal')::int,
    COALESCE((p->>'addonTotal')::int, 0),
    (p->>'total')::int,
    COALESCE((p->>'paid')::int, 0),
    v_pricing_version,
    (p->>'paymentMethod')::payment_method,
    NULLIF(p->>'approvalCode', ''),
    NULLIF(p->>'notes', ''),
    v_session_row.r2_key,
    CASE WHEN v_session_row.id IS NOT NULL
         THEN 'pending'::slip_state
         ELSE 'none'::slip_state END
  );

  INSERT INTO order_items (order_id, kind, product_id, qty, unit_price, line_total, config)
  SELECT
    v_order_id, 'product'::order_item_kind,
    (li->>'productId')::uuid, (li->>'qty')::int,
    (li->>'unitPrice')::int, (li->>'lineTotal')::int,
    li->'config'
  FROM jsonb_array_elements(p->'lines') li;

  -- Promote slip session (NEW) ────────────────────
  IF v_session_id IS NOT NULL THEN
    UPDATE pending_slip_uploads
       SET status = 'promoted',
           promoted_at = now(),
           promoted_to_order_id = v_order_id
     WHERE id = v_session_id;

    INSERT INTO order_slip_events (order_id, event, actor_id, meta)
    VALUES (v_order_id, 'uploaded', v_staff_id,
            jsonb_build_object('session_id', v_session_id));
  END IF;

  RETURN v_order_id;
END;
$$;
```

### 6.4 Apply order

```
M1 (0008) → required first; without it pending_slip_uploads is unwritable.
M2 (0009) → independent; any time.
M3 (0010) → last; relies on M1 being live.
```

### 6.5 Append-only guarantees

- All 3 migrations are NEW files; 0000–0007 history untouched.
- M3 uses `CREATE OR REPLACE` (Postgres semantic override of 0006's RPC body), not file modification.
- `db/schema.ts` does not need updates (no column or enum changes).

---

## 7. Error Handling

### 7.1 POS upload errors

| Trigger | POS user sees | Server action | Logged |
|---|---|---|---|
| File > 5MB | "File too large (over 5MB), please compress" | 400 `file_too_large` | not logged (client error) |
| MIME not whitelisted | "Only JPG / PNG / WebP / PDF supported" | 400 `invalid_content_type` | not logged |
| Init then > 5 min before PUT | "Upload timeout, please reselect file" | row stays `pending`, reaped after 1h | reaper logs |
| PUT to R2 network drop | "Network interrupted, retrying..." (3 attempts, 2s backoff) | session unaffected | Sentry breadcrumb (client) |
| Hash mismatch on confirm | "File verification failed, please reselect" | 400 `hash_mismatch` + UPDATE row failed + queue R2 delete | API WARN (session_id, expected/actual hash) |
| File not in R2 on confirm | "Upload incomplete, please reselect" | 404 `file_not_in_r2`, row stays pending | API WARN |
| Sales changes payment to card after confirm | SlipUploadStep auto-hides, session abandoned | row stays `uploaded`, reaper clears at TTL | reaper logs |

### 7.2 POST /orders errors

| Trigger | POS user sees | Server action | Logged |
|---|---|---|---|
| transfer without sessionId | "Please upload payment slip" (Place-order disabled, shouldn't reach server) | 400 `slip_required_for_transfer` | API INFO |
| Session not `uploaded` | "Slip not ready, check upload status" | 409 `slip_not_ready` | API WARN |
| Session already promoted | "Slip already used, please re-upload" | 409 `slip_already_used` | API ERROR |
| Session not owned by caller | "You can't use someone else's slip" | 403 `not_session_owner` | API ERROR + Sentry alert |
| Pricing drift > 0.5% | PricingDriftModal (existing) | 409 + diff payload | existing log |
| RPC failure (rollback) | "Order creation failed, please retry" | 500 + redacted internal error | API ERROR + Sentry |

**Invariant**: POST /orders failure leaves session unchanged. POS may safely re-send with the same sessionId — `FOR UPDATE` lock + status check prevents double promotion.

### 7.3 Backend coordinator errors

| Trigger | Coordinator sees | Server action | Logged |
|---|---|---|---|
| Slip URL request fails | "Slip failed to load [↻]" | 503 `storage_unavailable` or 500 | API WARN |
| `order.slipKey` is NULL (card payment) | "No slip (card payment)", verify/flag hidden | 400 `no_slip_attached` | not logged (normal) |
| Verify on stale state | Toast: "Slip already verified by Mei Lin"; drawer auto-refreshes | 400 `invalid_state` | API INFO |
| Flag without reason | Button disabled until reason filled (UI gate) | 400 `reason_required` (backstop) | not logged |
| Sales hits PATCH directly | Button hidden; if hit, 403 | 403 `not_authorized_role` | API WARN (potential token leak) |
| Realtime disconnect | Toast: "Realtime disconnected [↻]" (existing) | n/a | Backend INFO |

### 7.4 Reaper errors

| Trigger | Effect | Reaper action | Logged |
|---|---|---|---|
| Normal expired row | User long forgot the upload | DELETE R2 + UPDATE status='failed' | INFO (per batch summary) |
| R2 DELETE fails (CF outage) | File stays in R2, row stays claimed | No status update; lease will expire in 5 min, retry | ERROR + Sentry |
| Two workers race same row | Doesn't happen — `FOR UPDATE SKIP LOCKED` | Second worker sees zero rows | not logged |
| Lease expires + R2 already deleted | Status not yet failed; next reaper retries; idempotent (404 = success) | UPDATE status='failed' | INFO |
| > 100 rows in one batch | `LIMIT 100` cap; next 10-min tick continues | continues next tick | INFO (with remaining count) |

### 7.5 System-level failures

| Scenario | Impact | Response |
|---|---|---|
| R2 global outage | POS uploads fail + Backend slip view fails | POS: "Storage unavailable, retry later or contact admin". Backend: "Slip cannot load right now"; **Verify button disabled** (no verify without seeing slip). |
| Supabase global outage | API fully down | Not slip-specific; entire portal affected. |
| CF Cron stalled | Orphan rows accumulate; storage cost grows | Daily monitoring query: `WHERE status IN ('pending','uploaded') AND expires_at < now() - INTERVAL '2 hours'`. Alert if > 50. |
| `pending_slip_uploads` table bloat (long-retained promoted rows) | Table grows | Phase 5+ adds 30-day archive flag. Pilot data volume small enough to defer. |

### 7.6 Observability (v1)

- API: `console.error` + `wrangler tail`. Sentry deferred to Phase 5.
- Reaper: per-batch structured JSON log: `{ts, claimed: N, deleted: M, errors: K, remaining: R}`.
- Backend: existing toast system; Realtime disconnection already handled.

---

## 8. Testing Plan

### 8.1 Automated tests (Claude writes)

| Layer | File | Coverage |
|---|---|---|
| Unit (Zod) | `packages/shared/src/schemas/slip.schema.test.ts` | MIME whitelist, size cap, hash length, reason length |
| Unit (R2) | `apps/api/src/lib/r2.test.ts` | URL format, TTL applied, key naming `slips/YYYY/MM/{uuid}.{ext}` |
| Unit (Reaper) | `apps/api/src/lib/reaper.test.ts` | Concurrency (SKIP LOCKED), R2 delete failure, batch limit |
| Integration (Slip flow) | `apps/api/src/routes/slips.test.ts` | init → confirm → POST /orders state transitions; hash mismatch / file not in R2 / replay paths |
| Integration (Verify flow) | `apps/api/src/routes/orders-slip.test.ts` | PATCH verify/flag/invalid_state/unauthorized paths |

R2 mocked via `@miniflare/r2`. Postgres uses Supabase `create_branch` (isolated branch DB).

> ⚠️ Branch creation hits red line — Loo confirms separately at integration-test time.

### 8.2 Not auto-tested (intentional)

- ❌ React component rendering (POS SlipUploadStep, Backend OrderDrawer/SlipSection/LaneStepper) — covered by manual.
- ❌ Playwright e2e — Phase 5.
- ❌ Client-side hash compute — Web Crypto API, browser-native.
- ❌ Realtime push — already validated in Phase 2.

### 8.3 Loo's manual acceptance test

This is the definition of done.

#### Setup
1. R2 bucket `2990s-slips` created (CF dashboard or `wrangler r2 bucket create`).
2. 3 migrations (M1, M2, M3) applied to production Supabase.
3. `pnpm dev` running all three apps locally.
4. Two browsers: Chrome at `pos.dev` logged in as sales (e.g. AW); Edge incognito at `admin.dev` logged in as coordinator (Mei Lin).

#### Test 1 · Happy path
1. POS: drag SOF-101 to cart → checkout.
2. POS: fill customer details.
3. POS: pick `paymentMethod = Transfer`.
4. ✅ **Verify: Slip upload step appears.**
5. POS: pick a fake DuitNow screenshot.
6. ✅ **Verify: progress shown; ~3s later turns green ✓.**
7. POS: click Place order.
8. ✅ **Verify: redirect to OrderConfirmed showing SO-XXXX.**
9. Backend: other browser shows toast "New order SO-XXXX arrived".
10. Backend: click SO-XXXX row → drawer slides in.
11. ✅ **Verify: Slip section shows the screenshot.**
12. ✅ **Verify: Lane stepper shows 6 lanes; first 4 clickable, last 2 greyed.**
13. Backend: click **Verify**.
14. ✅ **Verify: Slip section turns green "Verified by Mei Lin · {time}".**
15. Backend: open a 3rd tab on same order → shows verified automatically (Realtime test).

#### Test 2 · Flag path
16. Repeat Test 1 steps 1–12 with another order.
17. Backend: click **Flag**.
18. ✅ **Verify: reason input appears (required); enter "Slip amount mismatch".**
19. Backend: confirm.
20. ✅ **Verify: Slip section turns red "Flagged · Slip amount mismatch".**

#### Test 3 · Card payment (no slip needed)
21. POS: new order, `paymentMethod = Credit / Debit`.
22. ✅ **Verify: no slip upload step.**
23. POS: place order.
24. Backend: open drawer.
25. ✅ **Verify: Slip section says "No slip (card payment)"; verify/flag hidden.**

#### Test 4 · Reaper (optional — needs 1h+10min OR manual trigger)
26. POS: init session, get PUT URL, but **do not PUT the file**.
27. SQL: `SELECT id, status, expires_at FROM pending_slip_uploads`.
28. ✅ **Verify: row with status='pending'.**
29. Manual reaper trigger (`wrangler dev --test-scheduled`).
30. ✅ **Verify: status flips to 'failed', error_msg='reaper: expired'.**

#### Test 5 · Replay attack
31. Run Test 1 fully, capture sessionId.
32. Use curl/Postman to POST /orders again with same sessionId.
33. ✅ **Verify: API returns 409 `slip_already_used`.**

### 8.4 Edge cases (Claude verifies during dev, not in Loo's checklist)

- 6MB upload (init rejects)
- Hash mismatch (manually flip a byte before confirm)
- POS tab close → reaper cleanup (Test 4 extension)
- Pre-verify, sales changes paymentMethod transfer → card

### 8.5 Test data seed

`db/seeds/test-orders.sql` (dev environment):
- 3 seed orders in different lanes
- 1 with slip pending verify
- 1 with slip verified
- 1 with slip flagged
- 1 card payment (slip_state='none')

---

## 9. Implementation Prerequisites

### 9.1 R2 bucket setup (one-time)

Either:
- **Option A** (Loo via CF dashboard): create bucket `2990s-slips` in CF Dashboard → R2.
- **Option B** (Claude via wrangler): if Loo authorizes, run `wrangler r2 bucket create 2990s-slips` (requires CF account login).

After creation, no further work — `wrangler.toml` references the bucket by name and CF Workers will bind automatically on next deploy.

### 9.2 Per-migration confirmation protocol (red line #4)

Before applying each migration, Claude will:

1. Re-paste the full SQL of that migration.
2. State exactly what permissions change.
3. Wait for explicit "yes" from Loo.

Migrations are applied **one at a time, not as a batch**. The order is M1 → M2 → M3.

### 9.3 Test-branch confirmation

Integration tests require Supabase `create_branch`. Branches are isolated throwaway databases (no impact on main). Claude will ask once before first branch creation, then reuse the branch for all integration test runs.

### 9.4 Wrangler secret updates

If R2 access keys are needed (depends on Worker binding type), Claude will note exactly which `wrangler secret put` commands Loo needs to run. Claude will NOT run them itself (they involve secrets).

---

## 10. Decision Log

Choices made during 2026-05-09 brainstorming session:

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| D1 | Phase 4 first sub-project | A: OrderDrawer + 6-lane board (foundational) | All other sub-features need drawer to host UI |
| D2 | Drawer scope v1 | B: Lane mgmt + Slip verify only | Driver/DO are separable iterations |
| D3 | Orders main view | A: keep list, click row → drawer | Kanban drag is polish |
| D4 | Slip pipeline scope | A: full E2E (POS upload + R2 + drawer verify) | Without POS upload, drawer is hollow |
| D5 | Slip architecture | A1: pre-upload + promote (schema-aligned) | Schema designed for this; reaper protects orphans |
| D6 | POS upload UX | Inline in handover form | One screen, less to forget |
| D7 | Verify auto-advances lane | No, manual | Verify ≠ ready for finance |
| D8 | Lane visibility | All 6 shown, 2 disabled with tooltip | Visual completeness signals roadmap |
| D9 | Cron reaper Worker | Same `apps/api` Worker | One less deploy unit |
| D10 | Slip file types | jpg / png / webp / pdf | Covers phone screenshot + bank PDF |
| D11 | Slip size cap | 5 MB | Phone screenshot 1–2MB, give margin |
| D12 | Re-upload after flag | Deferred | YAGNI for v1 |
| D13 | Reaper frequency | 10 min | Schema default |
| D14 | Pending TTL | 1h | Schema default |
| D15 | Concurrency strategy | Last-write-wins + Realtime auto-refresh | Simpler; pilot data volume low |
| D16 | `app_config` RLS in this wave | Yes (M2) | Clears advisor warning while in the area |
| D17 | Sales sees other sales' uploads | No | Privacy + minimum surface |
| D18 | UPDATE/DELETE on slip uploads | service_role only | Server controls state machine |
| D19 | Hash algorithm | SHA-256 | Industry standard, browser-native |
| D20 | PUT URL TTL | 5 min | Tolerates network jitter on 4G |
| D21 | Sales views own slip post-upload | No | Local browser preview during upload is enough |
| D22 | Hash mismatch log level | WARN | Possibly client bug, not always attack |
| D23 | R2 down → Verify behavior | Disable button | No verify without visual check |
| D24 | Reaper monitoring threshold | > 50 orphans/day | Pilot is < 20 orders/day |
| D25 | React component tests | None | Manual + future Playwright |

---

## Appendix A — Files reference

Total: 28 files (23 new + 5 modify; 5 of the new files are tests).

```
packages/shared/
└─ src/schemas/slip.schema.ts                          NEW

packages/db/migrations/
├─ 0008_slip_upload_rls.sql                            NEW (RLS — needs Loo yes)
├─ 0009_app_config_rls.sql                             NEW (RLS — needs Loo yes)
└─ 0010_promote_slip_in_create_order.sql               NEW (RPC — needs Loo yes)

apps/api/
├─ wrangler.toml                                       MODIFY
├─ src/index.ts                                        MODIFY (scheduled export)
├─ src/routes/slips.ts                                 NEW
├─ src/routes/orders.ts                                MODIFY
├─ src/lib/r2.ts                                       NEW
├─ src/lib/slip.ts                                     NEW
└─ src/lib/reaper.ts                                   NEW

apps/pos/
├─ src/pages/Handover.tsx                              MODIFY
├─ src/components/SlipUploadStep.tsx                   NEW
├─ src/components/SlipUploadStep.module.css            NEW
└─ src/lib/slip.ts                                     NEW

apps/backend/
├─ src/pages/Orders.tsx                                MODIFY
├─ src/components/OrderDrawer.tsx                      NEW
├─ src/components/OrderDrawer.module.css               NEW
├─ src/components/SlipSection.tsx                      NEW
├─ src/components/SlipSection.module.css               NEW
├─ src/components/LaneStepper.tsx                      NEW
├─ src/components/LaneStepper.module.css               NEW
└─ src/lib/slip.ts                                     NEW

Tests:
├─ packages/shared/src/schemas/slip.schema.test.ts     NEW
├─ apps/api/src/lib/r2.test.ts                         NEW
├─ apps/api/src/lib/reaper.test.ts                     NEW
├─ apps/api/src/routes/slips.test.ts                   NEW
└─ apps/api/src/routes/orders-slip.test.ts             NEW
```

## Appendix B — References

- `2990S-PORTAL-PLAN.md` §9 Phase 4
- `db/src/schema.ts` lines 51–86, 327–397, 514–563 (slip + order + reaper schema)
- `prototype/backend-drawer.jsx` lines 311–390 (slip section UX)
- `prototype/backend-drawer.jsx` lines 392–430 (driver picker — deferred)
- `apps/api/wrangler.toml` (R2 bindings + cron triggers, currently commented)
- `TODOS.md` T1 (suppliers — Phase 4 sub-project D, deferred)

---

*End of design spec. Next step: invoke `superpowers:writing-plans` skill to translate this into a step-by-step implementation plan.*
