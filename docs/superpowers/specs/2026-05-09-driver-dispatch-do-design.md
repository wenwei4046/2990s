# Driver + Dispatch + DO Design Spec (Phase 4 sub-project C)

| | |
|---|---|
| **Date** | 2026-05-09 |
| **Author** | Claude (with Loo) — brainstormed via `superpowers:brainstorming` |
| **Branch** | `main` |
| **Phase** | Phase 4 sub-project C (continues after Slip MVP, dc173ba) |
| **Status** | Design approved, awaiting `writing-plans` skill |
| **Estimated work** | 4-5 days for full implementation + acceptance test |

---

## 1. Goal & Scope

### 1.1 What we're building

Continues Phase 4 by enabling lanes 5+6 (dispatched, delivered) with the operational fields needed to actually run a dispatch:

1. **Driver picker** at lane=ready — coordinator picks one of N active drivers, sets confirmed delivery date + optional confirmation note
2. **Lane gates** server-side — `ready → dispatched` requires driver_id + confirmed_delivery_date; `* → delivered` requires do_key
3. **DO upload** at lane=dispatched — coordinator receives signed Delivery Order photo from driver via WhatsApp, uploads via Supabase JS direct → Supabase Storage `dos` bucket → PATCH `do_key` on order
4. **Step back** — coordinator can move any later lane to any earlier lane (no gates) without losing driver/DO state (audit trail)
5. **Lane stepper** un-blocks dispatched + delivered (currently disabled placeholder text from Slip MVP)

### 1.2 Out of scope (deferred)

- ❌ **Settings → Drivers CRUD** — placeholder drivers (DRV-01/02/03) OK for pilot start; real drivers entered via Supabase Studio till settings page built
- ❌ **Driver mobile app / driver self-upload** — coord uploads on driver's behalf
- ❌ **Multi-DO per order** — single `do_key` field; partial deliveries not modeled
- ❌ **DO signature drawing in-app** — file upload of signed paper DO only
- ❌ **Customer dispatch notification** (WhatsApp / SMS) — Z-API integration is Phase 5+
- ❌ **Storage orphan reaper** — pilot volume too low; revisit if costs surprise
- ❌ **Settings → Drivers page itself** — Placeholder remains; sub-project E will fill it
- ❌ **PO + suppliers** — sub-project D
- ❌ **Time component on confirmed_delivery_date** — `date` only, no time-of-day; existing `delivery_slot` text serves that

### 1.3 Why now (after Slip MVP)

- Drawer + lane stepper infrastructure exists from Slip MVP — major reuse
- Schema mostly in place (driver_id, dispatchedAt, deliveredAt, doSigned, confirmedWith, deliveryDate all already exist) — only 2 new columns needed
- Unblocks the 6-lane visual completeness Loo saw in prototype
- Acceptance test for Slip MVP is blocked on R2 setup; this sub-project sidesteps R2 (uses Supabase Storage) and can ship + verify in isolation

---

## 2. Architecture

### 2.1 Layer diagram

```
┌──────────────────────────────────────────────────────────────┐
│  Backend (apps/backend)                                      │
│  ─ OrderDrawer.tsx   passes order fields to dispatch sections │
│  ─ DriverPickerSection.tsx (NEW) — lane=ready                 │
│      ─ useDrivers() lists active drivers                      │
│      ─ Cards UI + confirmed_date input + confirmation note    │
│      ─ Debounced PATCH /orders/:id/dispatch-prep              │
│  ─ DispatchSection.tsx (NEW) — lane=dispatched | delivered    │
│      ─ Info grid + DO upload (file picker)                    │
│      ─ Supabase JS direct upload to bucket 'dos'              │
│      ─ PATCH /orders/:id/do { doKey }                         │
│      ─ Supabase JS createSignedUrl for read display           │
│  ─ LaneStepper.tsx (MODIFY) — enable lanes 5+6                │
│      ─ Gate-aware tooltip (driver missing → "Pick driver first")│
└──────────────────────────────────────────────────────────────┘
                            │            │
                ┌───────────┘            └────────────┐
                ▼                                     ▼
┌─────────────────────────────────┐  ┌────────────────────────┐
│  Supabase Storage: 'dos' bucket │  │  Supabase Postgres     │
│  ─ dos/{YYYY}/{MM}/{order}-{ts}.{ext}│  │  ─ orders + 2 new cols │
│  ─ 5MB cap, 4 MIME whitelist    │  │  ─ drivers (existing)  │
│  ─ RLS: coord+ R/W, admin DELETE│  │  ─ order_slip_events   │
└─────────────────────────────────┘  └────────────────────────┘
                                              │
                                              ▼
┌──────────────────────────────────────────────────────────────┐
│  API (apps/api on CF Workers)                                │
│  ─ orders.ts (MODIFY)                                        │
│      ─ PATCH /orders/:id/lane: add gates (dispatched/delivered) │
│      ─ PATCH /orders/:id/dispatch-prep (NEW)                 │
│      ─ PATCH /orders/:id/do (NEW)                            │
│      ─ /lane: un-block dispatched + delivered targets        │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Storage backend split (intentional)

| File type | Backend | Bucket | Why |
|---|---|---|---|
| Slip (POS upload) | R2 | `2990s-slips` | Customer-facing path; R2 free egress; hash verify required |
| **DO** (Coord upload) | **Supabase Storage** | `dos` | Coord-facing; no R2 setup needed; Supabase RLS native; ships in isolation from R2 work |

This is a deliberate divergence so Driver+Dispatch+DO can ship + acceptance-test without waiting on the R2 bucket creation that's currently blocking Slip MVP acceptance. Long-term we may consolidate; for now operational simplicity wins.

### 2.3 Key design decisions

- **Lazy-attach for DO** (vs slip's pre-upload + promote): order always exists before DO upload, so no atomicity guarantee needed. Simpler 1-endpoint flow.
- **Direct Supabase JS upload** (vs API-mediated): coord is trusted, RLS protects bucket, fewer endpoints to write/test.
- **Server-side lane gates**: prevent client bypass; client may also disable buttons for UX, but server is source of truth.
- **Step back never clears state**: lane is a workflow label; driver_id, do_key, dispatched_at, delivered_at retained as audit trail.

---

## 3. Components

14 files: 8 new + 6 modify (1 of the new files is the test). See Appendix A for the full layout.

### 3.1 `packages/db/migrations/` (2 new — needs per-migration confirmation)

| File | State | Purpose |
|---|---|---|
| `0012_dispatch_columns.sql` | NEW | `ALTER TABLE orders ADD COLUMN confirmed_delivery_date date, ADD COLUMN do_key text` |
| `0013_storage_bucket_dos.sql` | NEW | Create private `dos` bucket (5MB, image/pdf MIME); 4 RLS policies on storage.objects (SELECT/INSERT/UPDATE coord+, DELETE admin) |

### 3.2 `packages/db/src/schema.ts` (1 modify)

Add `confirmedDeliveryDate: date('confirmed_delivery_date')` and `doKey: text('do_key')` to `orders` Drizzle table mirror.

### 3.3 `apps/api/`

| File | State | Purpose |
|---|---|---|
| `src/routes/orders.ts` | MODIFY | (a) Lane PATCH: remove dispatched/delivered block, add gates. (b) NEW PATCH `/orders/:id/dispatch-prep` { driverId, confirmedDeliveryDate, confirmedWith }. (c) NEW PATCH `/orders/:id/do` { doKey }. |

### 3.4 `apps/backend/`

| File | State | Purpose |
|---|---|---|
| `src/lib/queries.ts` | MODIFY | Extend `OrderDetail` with new dispatch fields + `useDrivers()` hook. |
| `src/lib/dispatch.ts` | NEW | Supabase JS upload helpers + dispatch-prep + do PATCH wrappers + signed-URL fetch. |
| `src/components/DriverPickerSection.tsx` (+ `.module.css`) | NEW | Cards-based picker, date input, note input, override warning. Renders only when lane=ready. |
| `src/components/DispatchSection.tsx` (+ `.module.css`) | NEW | Info grid + DO upload section. Renders when lane=dispatched OR delivered (read-only at delivered). |
| `src/components/OrderDrawer.tsx` | MODIFY | Conditionally render DriverPickerSection (lane=ready) and DispatchSection (lane=dispatched|delivered). |
| `src/components/LaneStepper.tsx` | MODIFY | Remove `enabled: false` on dispatched + delivered. Add gate-aware tooltip support. |

### 3.5 Tests

| File | State | Coverage |
|---|---|---|
| `apps/api/src/lib/dispatch.test.ts` | NEW | DO key path validation regex (4 valid MIMEs, reject `../`, reject wrong prefix); lane-gate logic matrix. |

Skip integration tests for orders.ts new endpoints — same auth-bundling reason as Slip MVP. Manual covers.

### 3.6 Test data

`packages/db/seeds/test-orders.sql` MODIFY — append SO-9006 (dispatched with driver) and SO-9007 (delivered with DO).

---

## 4. Data Flow

### 4.1 State machine (this iteration completes the flow)

```
received ─→ proceed ─→ logistics ─→ ready ─────────→ dispatched ──────→ delivered
                                       │ gate:           │ gate:
                                       │ driver_id +     │ do_key
                                       │ confirmed_date  │
                                       │
                                       │ (any → earlier: step-back, no gate)
```

### 4.2 Flow A · Driver assignment (lane=ready)

| # | Actor | Action |
|---|---|---|
| 1 | Coord | Opens drawer for order at lane=ready → DriverPickerSection renders |
| 2 | Backend | `useDrivers()` fetches active drivers list (Supabase JS) |
| 3 | Coord | Picks driver card, sets confirmed delivery date, types note |
| 4 | Backend | Debounced (500ms) `PATCH /orders/:id/dispatch-prep` { driverId, confirmedDeliveryDate, confirmedWith } |
| 5 | API | UPDATE orders SET driver_id, confirmed_delivery_date, confirmed_with |
| 6 | Backend | Override warning shows if confirmedDeliveryDate ≠ customer's `delivery_date` (UI only) |
| 7 | Coord | Clicks lane stepper → `dispatched` |
| 8 | Backend → API | `PATCH /orders/:id/lane` { lane: 'dispatched' } |
| 9 | API | Reads order; validates `driver_id` + `confirmed_delivery_date` non-null. If gate fails → 422 + `missing` array. If pass → UPDATE lane='dispatched', dispatched_at=now(); INSERT order_lane_history |
| 10 | Realtime | UPDATE pushed to all Backend tabs |

### 4.3 Flow B · DO upload (lane=dispatched)

| # | Actor | Action |
|---|---|---|
| 1 | Coord | Receives signed DO photo from driver via WhatsApp |
| 2 | Coord | At drawer (lane=dispatched), clicks Upload DO file picker |
| 3 | Backend | Validates MIME + size client-side; computes path: `dos/{YYYY}/{MM}/{orderId}-{ts}.{ext}` |
| 4 | Backend → Supabase Storage | `supabase.storage.from('dos').upload(path, file, { contentType, upsert: true })` |
| 5 | Backend → API | On success, `PATCH /orders/:id/do` { doKey: path } |
| 6 | API | Storage HEAD via service-role to verify file exists; UPDATE orders.do_key; INSERT order_slip_events('do_uploaded', actor_id, meta: {do_key, replaces}) |
| 7 | Backend | Drawer refreshes; shows "Uploaded {filename} {ts} [Replace]" |
| 8 | Coord | Clicks lane stepper → `delivered` |
| 9 | Backend → API | `PATCH /orders/:id/lane` { lane: 'delivered' } |
| 10 | API | Validates `do_key` non-null; UPDATE lane='delivered', delivered_at=now(), do_signed=true |

### 4.4 Flow C · Step back (any earlier lane)

| # | Actor | Action |
|---|---|---|
| 1 | Coord | Clicks earlier lane in stepper |
| 2 | API | `PATCH /lane` with target index < current index → no gate validation |
| 3 | API | UPDATE lane only; driver_id, do_key, dispatched_at, delivered_at retained |
| 4 | Backend | Stepper updates; dispatched/delivered sections may hide based on new lane |

### 4.5 Edge cases

| Scenario | Handling |
|---|---|
| Coord picks driver, no confirmed date, clicks dispatched | 422 `lane_gate_failed`, missing=['confirmed_delivery_date']; toast |
| Coord uploads DO twice (Replace) | Storage upserts at new path with new ts; PATCH overwrites do_key; old file becomes orphan; order_slip_events records 2 do_uploaded rows |
| Storage upload succeeds, PATCH fails | Storage has orphan file. NOT auto-cleaned this iteration; document in spec for Phase 5 |
| 2 coords editing same order race | Last-write-wins; Realtime broadcasts to other tab |
| Driver deactivated after assignment | order.driver_id retained; useDrivers (active=true filter) doesn't show in picker; DispatchSection shows driver name from a separate join (if useful) or just ID |
| 0 active drivers | DriverPickerSection empty state: "No active drivers — add one in Settings → Drivers" (matches prototype text) |
| Step back from delivered → dispatched | Allowed; do_signed/delivered_at retained (audit) |
| Coord picks confirmed date in past | 400 `confirmed_date_in_past`. Future iteration may add override flag for back-dating real-world cases. |

---

## 5. API Contracts

### 5.1 `PATCH /api/orders/:id/lane` (MODIFY)

**Auth**: coordinator+

**Changes**: remove dispatched/delivered block; add gates; auto-stamp dispatched_at / delivered_at.

**Request**: `{ lane: 'received'|'proceed'|'logistics'|'ready'|'dispatched'|'delivered'|'cancelled' }`

**Success 200**:
```ts
{
  orderId: string,
  lane: string,
  fromLane: string,
  dispatchedAt?: string,  // set when target=dispatched (and previously NULL)
  deliveredAt?: string,   // set when target=delivered (and previously NULL)
  doSigned?: boolean,     // set true when target=delivered
}
```

**New errors**:
- `422 lane_gate_failed` body: `{ error, missing: string[] }`

### 5.2 `PATCH /api/orders/:id/dispatch-prep` (NEW)

**Auth**: coordinator+

**Request**:
```ts
{
  driverId: string | null,
  confirmedDeliveryDate: string | null,  // ISO date 'YYYY-MM-DD'
  confirmedWith?: string,                 // max 200 chars
}
```

**Validation**:
- driverId if non-null: must exist + active=true
- confirmedDeliveryDate if non-null: valid ISO date, not in past

**Success 200**:
```ts
{ orderId, driverId, confirmedDeliveryDate, confirmedWith }
```

DB: single UPDATE on orders. No audit row (lane PATCH is the lifecycle audit trigger).

**Errors**: 404 order_not_found / 404 driver_not_found_or_inactive / 400 confirmed_date_in_past / 400 confirmed_with_too_long / 403 not_authorized_role.

### 5.3 `PATCH /api/orders/:id/do` (NEW)

**Auth**: coordinator+

**Request**: `{ doKey: string }`

**Validation**:
- doKey matches `^dos/\d{4}/\d{2}/.+\.(jpg|jpeg|png|webp|pdf)$`
- Storage HEAD (service role) — file must exist (prevents bypass)

**Success 200**: `{ orderId, doKey, uploadedAt }`

DB: UPDATE orders.do_key + INSERT order_slip_events('do_uploaded', actor, meta:{do_key, replaces}).

**Errors**: 404 order_not_found / 400 invalid_do_key_format / 404 do_file_not_in_storage / 403 not_authorized_role.

### 5.4 Storage signed URL (Supabase JS, no API)

```ts
const { data } = await supabase.storage.from('dos').createSignedUrl(order.doKey, 60 * 5);
```

Bucket RLS enforces coordinator+ access — sales/anon get denied.

### 5.5 Auth matrix

| Endpoint | Sales | Lead | Coordinator | Finance | Admin |
|---|---|---|---|---|---|
| PATCH /orders/:id/lane | ❌ | ❌ | ✅ | ✅ | ✅ |
| PATCH /orders/:id/dispatch-prep | ❌ | ❌ | ✅ | ✅ | ✅ |
| PATCH /orders/:id/do | ❌ | ❌ | ✅ | ✅ | ✅ |

---

## 6. Schema + Storage Migrations (touches red line — needs per-migration yes)

### 6.1 M1 · `0012_dispatch_columns.sql`

```sql
ALTER TABLE orders
  ADD COLUMN confirmed_delivery_date date,
  ADD COLUMN do_key text;
```

Both nullable. No backfill needed.

### 6.2 M2 · `0013_storage_bucket_dos.sql`

```sql
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

### 6.3 Apply order

M1 → M2 (M1 can come first; they're independent).

### 6.4 Append-only

Both NEW files. Schema mirror in `db/src/schema.ts` updated as a code change (separate from migration apply).

---

## 7. Error Handling

### 7.1 Coordinator UI errors

| Trigger | UX | Server | Logged |
|---|---|---|---|
| Lane gate fails | Toast: "Set driver + confirmed date first" | 422 lane_gate_failed | API INFO |
| DO upload too large | Supabase Storage rejects (5MB cap) | client-side feedback | not logged |
| Bad MIME | Storage rejects per bucket policy | client-side | not logged |
| Network drop mid-upload | Supabase JS throws; show retry button | n/a | Sentry breadcrumb (Phase 5) |
| PATCH /do with non-existent doKey | 404 do_file_not_in_storage | API WARN (potential bypass attempt) |
| Two coords editing same order | Last-write-wins; Realtime broadcasts | n/a | not logged |
| Coord picks past confirmed date | 400 confirmed_date_in_past | client validation pre-empts | not logged |

### 7.2 Audit

- Lane changes → `order_lane_history` (existing in 0006)
- DO upload → `order_slip_events('do_uploaded', actor, meta:{do_key, replaces})` (reuse)
- Driver/date changes → no audit row (UI-stage edits, not lifecycle)

---

## 8. Testing Plan

### 8.1 Auto tests

| Layer | File | Coverage |
|---|---|---|
| Unit | `apps/api/src/lib/dispatch.test.ts` | DO key regex (valid MIMEs, reject path traversal, reject wrong prefix); lane-gate matrix |

Skip integration tests for new orders.ts endpoints — auth-bundling pattern same as Slip MVP. Manual covers.

### 8.2 Manual acceptance tests

5 tests as detailed in design Section 6 of brainstorming:
1. Happy path: receive → delivered (full lane progression with driver, confirmed date, DO upload)
2. Lane gate rejection (no driver, no date, no DO each gated)
3. Step back (any lane → earlier; state retained)
4. Empty drivers state (deactivate all → empty state shown)
5. DO replace (Replace button → upserts to new path, PATCH overwrites)

### 8.3 Test data

Append to `packages/db/seeds/test-orders.sql`:
- SO-9006: lane=dispatched, driver assigned (DRV-01), confirmed_delivery_date=tomorrow, no DO yet
- SO-9007: lane=delivered, driver assigned, do_key=`dos/2026/05/test-delivered.jpg`, do_signed=true

---

## 9. Implementation Prerequisites

### 9.1 Per-migration confirmation protocol

Before applying M1 + M2, Claude:
1. Re-pastes full SQL
2. States exactly what's added
3. Waits for explicit "yes"

### 9.2 No external infra needed

Unlike Slip MVP, this sub-project does NOT require:
- ❌ R2 bucket creation
- ❌ R2 API tokens
- ❌ wrangler secret puts

Supabase Storage bucket creation is part of M2 SQL — no dashboard action required.

### 9.3 Drivers data quality

3 placeholder drivers exist (DRV-01/02/03 with phone "+60 00 000 0001" etc., null IC). Sufficient for acceptance test. Loo can replace with real driver names via Supabase Studio or in sub-project E (Settings page).

---

## 10. Decision Log

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| D1 | C scope | Full prototype port (driver picker + confirmed date + DO upload + step back + lane gates). Settings → Drivers CRUD deferred. | Matches prototype intent; Settings can be a separate sub-project |
| D2 | DO storage backend | Supabase Storage (not R2) | Avoids R2 setup blocker; ships in isolation |
| D3 | DO upload pattern | Lazy-attach via Supabase JS direct (not pre-upload + promote) | Order always exists; no atomicity guarantee needed; simplest path |
| D4 | dispatch-prep payload | Atomic 3-field PATCH (driver+date+note in one call) | UX is "one configuration step"; reduces race on partial state |
| D5 | Lane gate enforcement | Server-side primary; client UX hint secondary | Server is source of truth; client may show button states |
| D6 | Step back state | Retain driver_id, do_key, dispatched_at, delivered_at | Audit trail; lane is just workflow label |
| D7 | DELETE on `dos` bucket | Admin only | DO is audit material; coord uses Replace (upsert) |
| D8 | Storage orphan cleanup | Defer (no reaper this iteration) | Pilot volume too low to matter |
| D9 | Past confirmed date | Reject with 400 | Simpler v1; future may add override flag for back-dating |
| D10 | React component tests | None (matches Slip MVP) | Manual + future Playwright |

---

## Appendix A — Files reference

```
packages/db/migrations/
├─ 0012_dispatch_columns.sql                          NEW (needs yes)
└─ 0013_storage_bucket_dos.sql                        NEW (needs yes)

packages/db/src/schema.ts                             MODIFY

apps/api/
└─ src/routes/orders.ts                               MODIFY

apps/backend/
├─ src/lib/queries.ts                                 MODIFY (extend OrderDetail + useDrivers)
├─ src/lib/dispatch.ts                                NEW
├─ src/components/OrderDrawer.tsx                     MODIFY
├─ src/components/LaneStepper.tsx                     MODIFY
├─ src/components/DriverPickerSection.tsx             NEW
├─ src/components/DriverPickerSection.module.css      NEW
├─ src/components/DispatchSection.tsx                 NEW
└─ src/components/DispatchSection.module.css          NEW

Tests:
└─ apps/api/src/lib/dispatch.test.ts                  NEW

Seed update:
└─ packages/db/seeds/test-orders.sql                  MODIFY (append SO-9006/9007)
```

Total: **14 files** (8 NEW + 6 MODIFY); 1 test file.

## Appendix B — References

- Spec: `docs/superpowers/specs/2026-05-09-slip-workflow-mvp-design.md` (Slip MVP — drawer infrastructure built)
- Plan: `docs/superpowers/plans/2026-05-09-slip-workflow-mvp.md`
- Prototype: `prototype/backend-drawer.jsx` lines 392-593 (driver picker + dispatch + delivered sections)
- Schema: `packages/db/src/schema.ts` orders table (existing dispatch fields)
- Drivers: 3 placeholder rows in `drivers` table (DRV-01/02/03)

---

*End of design spec. Next: invoke `superpowers:writing-plans` skill.*
