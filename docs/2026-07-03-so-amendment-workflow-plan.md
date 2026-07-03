# SO Amendment / Revision Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a salesperson change a processing-locked SO through a supplier-confirmed, two-gate amendment that revises both the SO and its PO in place (same number + revision counter), keeping every prior version as an immutable snapshot.

**Architecture:** A new `so_amendments` request drives a state machine (REQUESTED → SUPPLIER_PENDING → SO_APPROVED → PO_APPROVED → SENT / REJECTED). The live SO/PO are frozen until approval; on Approve-SO the SO is re-derived + honest-pricing-recomputed and its old version snapshotted; on Approve-PO the bound PO re-derives + snapshots, then the Revised PO is emailed. The existing processing-date lock changes from hard-409 to "route the edit into an amendment request." Reuses drift-flag, PO-snapshot, doc-email, `mfg_so_audit_log`, RBAC, and the shared pricing recompute.

**Tech Stack:** Hono on CF Workers (apps/api), Drizzle + Supabase Postgres (packages/db), React 19 + TanStack Query (apps/backend), vitest. Spec: `docs/2026-07-03-so-amendment-revision-workflow-design.md`.

**Cross-cutting rules (2990):** Drizzle schema is source of truth → generate migration → **apply the prod migration BEFORE deploying schema-dependent code** (migrate-before-deploy). Shared working tree with Loo → stage per file, isolated branch, `--no-verify`. Backend (apps/api + apps/backend logic) is the priority; **UI needs a mockup approved before coding** (mockups for the edit-page banner, SO/PO approval banners, and Amendments queue already shown + owner-approved 2026-07-03). Verify with `pnpm --filter @2990s/api --filter @2990s/backend typecheck` (CI uses `tsc -b`).

---

## File Structure

- `packages/db/src/schema.ts` — add `soAmendmentStatus` enum, `soAmendments`, `soAmendmentLines`, `soRevisions`, `poRevisions` tables; add `revision` to `mfgSalesOrders` + `purchaseOrders`. (source of truth)
- `packages/db/migrations/0210_so_amendments.sql` — generated migration.
- `packages/shared/src/so-amendment.ts` — **pure** state-machine + guard logic (allowed transitions, one-open-amendment key, GRN-received floor check). Unit-tested.
- `packages/shared/src/so-amendment.test.ts` — vitest for the pure logic.
- `apps/api/src/routes/so-amendments.ts` — new Hono router: create + supplier-confirm + approve-so + approve-po + send + reject + list/detail.
- `apps/api/src/lib/so-revision.ts` — apply-revision helpers: snapshot SO/PO, re-derive lines, bump revision, call the shared recompute.
- `apps/api/src/routes/mfg-sales-orders.ts` — change `soProcessingLocked` call sites on line/header edit endpoints to route into an amendment draft instead of 409; stamp `has_open_amendment` + gate on detail.
- `apps/api/src/index.ts` — mount `/so-amendments`.
- `apps/backend/src/lib/so-amendment-queries.ts` — TanStack hooks (list/detail/create/transition mutations).
- `apps/backend/src/pages/Amendments.tsx` — the inbox queue (new nav route).
- `apps/backend/src/pages/SalesOrderDetail.tsx` — unified-edit Save→"Submit amendment request"; amendment banner (supplier-confirm + Approve SO); Revisions tab.
- `apps/backend/src/pages/PurchaseOrderDetail.tsx` — "Revision ready" banner (Approve PO + Send); Revisions tab; "Revised · rev N" badge.
- `apps/backend/src/lib/status-pill.ts` — add `soAmendment` doc type.

---

## Phase 0 — Schema + migration

### Task 0: Amendment tables + revision columns

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/migrations/0210_so_amendments.sql`

- [ ] **Step 1: Add to `schema.ts`** (near the other SO children, after `mfgSoAuditLog` ~line 1735). Key on `so_doc_no` (text → `mfgSalesOrders.docNo`) to match every other SO child.

```ts
export const soAmendmentStatus = pgEnum('so_amendment_status', [
  'REQUESTED', 'SUPPLIER_PENDING', 'SO_APPROVED', 'PO_APPROVED', 'SENT', 'REJECTED',
]);

export const soAmendments = pgTable('so_amendments', {
  id:            uuid('id').primaryKey().defaultRandom(),
  soDocNo:       text('so_doc_no').notNull().references(() => mfgSalesOrders.docNo, { onDelete: 'cascade' }),
  amendmentNo:   text('amendment_no').notNull(),                 // e.g. SO-2607/A1
  status:        soAmendmentStatus('status').notNull().default('REQUESTED'),
  reason:        text('reason'),
  requestedBy:   uuid('requested_by').references(() => staff.id),
  supplierConfirmedBy:  uuid('supplier_confirmed_by').references(() => staff.id),
  supplierConfirmationRef:  text('supplier_confirmation_ref'),
  supplierConfirmationNote: text('supplier_confirmation_note'),
  supplierConfirmationAttachmentKey: text('supplier_confirmation_attachment_key'),
  soApprovedBy:  uuid('so_approved_by').references(() => staff.id),
  soApprovedAt:  timestamp('so_approved_at', { withTimezone: true }),
  poApprovedBy:  uuid('po_approved_by').references(() => staff.id),
  poApprovedAt:  timestamp('po_approved_at', { withTimezone: true }),
  sentAt:        timestamp('sent_at', { withTimezone: true }),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // one OPEN amendment per SO (not SENT/REJECTED)
  oneOpen: uniqueIndex('uq_so_amendment_open').on(t.soDocNo)
             .where(sql`status NOT IN ('SENT','REJECTED')`),
  bySo: index('idx_so_amendment_so').on(t.soDocNo),
}));

export const soAmendmentLines = pgTable('so_amendment_lines', {
  id:            uuid('id').primaryKey().defaultRandom(),
  amendmentId:   uuid('amendment_id').notNull().references(() => soAmendments.id, { onDelete: 'cascade' }),
  salesOrderItemId: uuid('sales_order_item_id'),                 // null = added line
  changeType:    text('change_type').notNull(),                 // SPEC | QTY | ADD | REMOVE
  newItemCode:   text('new_item_code'),
  newVariants:   jsonb('new_variants'),
  newQty:        integer('new_qty'),
  newUnitPriceSen: integer('new_unit_price_sen'),
  oldSnapshot:   jsonb('old_snapshot'),                         // old values for display/audit
});

export const soRevisions = pgTable('so_revisions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  soDocNo:     text('so_doc_no').notNull(),
  revision:    integer('revision').notNull(),
  snapshot:    jsonb('snapshot').notNull(),                     // full header+lines
  amendmentId: uuid('amendment_id'),
  createdBy:   uuid('created_by'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: uniqueIndex('uq_so_revision').on(t.soDocNo, t.revision) }));

export const poRevisions = pgTable('po_revisions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  poId:        uuid('po_id').notNull(),
  revision:    integer('revision').notNull(),
  snapshot:    jsonb('snapshot').notNull(),
  amendmentId: uuid('amendment_id'),
  createdBy:   uuid('created_by'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: uniqueIndex('uq_po_revision').on(t.poId, t.revision) }));
```

Also add to the existing `mfgSalesOrders` and `purchaseOrders` table defs:
```ts
  revision: integer('revision').notNull().default(1),
```

- [ ] **Step 2: Generate the migration**

Run: `cd /c/Users/User/Desktop/2990s && pnpm db:generate`
Expected: new `packages/db/migrations/0210_*.sql` creating the enum, 4 tables, 2 `ALTER TABLE … ADD COLUMN revision`. Rename it `0210_so_amendments.sql`.

- [ ] **Step 3: Review the SQL** — confirm the partial unique index `uq_so_amendment_open` carries the `WHERE status NOT IN ('SENT','REJECTED')` clause (Drizzle sometimes drops partial predicates — add it by hand if missing).

- [ ] **Step 4: Typecheck** — `pnpm --filter @2990s/db typecheck` → Done.

- [ ] **Step 5: Commit**
```bash
git add packages/db/src/schema.ts packages/db/migrations/0210_so_amendments.sql
git commit -m "feat(db): so_amendments + revision snapshots schema + migration 0210"
```

- [ ] **Step 6: Apply to PROD before any dependent deploy** — via the Management API (ref `dolvxrchzbnqvahocwsu`), per `reference_supabase_migration_apply_management_api`. Verify the 4 tables + 2 columns exist with `select` afterward.

---

## Phase 1 — Pure state-machine + guards (TDD)

### Task 1: `so-amendment.ts` transitions + guards

**Files:**
- Create: `packages/shared/src/so-amendment.ts`
- Test: `packages/shared/src/so-amendment.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { nextStatus, canTransition, receivedFloorViolation, type AmendStatus } from './so-amendment';

describe('so-amendment state machine', () => {
  it('allows the happy path in order', () => {
    expect(canTransition('REQUESTED', 'supplier-confirm')).toBe(true);
    expect(canTransition('SUPPLIER_PENDING', 'approve-so')).toBe(true);
    expect(canTransition('SO_APPROVED', 'approve-po')).toBe(true);
    expect(canTransition('PO_APPROVED', 'send')).toBe(true);
  });
  it('blocks out-of-order transitions', () => {
    expect(canTransition('REQUESTED', 'approve-po')).toBe(false);
    expect(canTransition('SENT', 'reject')).toBe(false);
  });
  it('allows reject from any pre-approved gate', () => {
    for (const s of ['REQUESTED','SUPPLIER_PENDING','SO_APPROVED','PO_APPROVED'] as AmendStatus[])
      expect(canTransition(s, 'reject')).toBe(true);
  });
  it('nextStatus maps each action', () => {
    expect(nextStatus('REQUESTED','supplier-confirm')).toBe('SUPPLIER_PENDING');
    expect(nextStatus('SUPPLIER_PENDING','approve-so')).toBe('SO_APPROVED');
  });
  it('flags a line dropping below received qty', () => {
    expect(receivedFloorViolation({ newQty: 1 }, { receivedQty: 3 })).toBe(true);
    expect(receivedFloorViolation({ newQty: 5 }, { receivedQty: 3 })).toBe(false);
    expect(receivedFloorViolation({ newQty: null }, { receivedQty: 3 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm --filter @2990s/shared test so-amendment` → module not found.

- [ ] **Step 3: Implement**

```ts
export type AmendStatus = 'REQUESTED'|'SUPPLIER_PENDING'|'SO_APPROVED'|'PO_APPROVED'|'SENT'|'REJECTED';
export type AmendAction = 'supplier-confirm'|'approve-so'|'approve-po'|'send'|'reject';

const FLOW: Record<AmendAction, { from: AmendStatus[]; to: AmendStatus }> = {
  'supplier-confirm': { from: ['REQUESTED'], to: 'SUPPLIER_PENDING' },
  'approve-so':       { from: ['SUPPLIER_PENDING','REQUESTED'], to: 'SO_APPROVED' }, // no-PO light path may skip supplier-confirm
  'approve-po':       { from: ['SO_APPROVED'], to: 'PO_APPROVED' },
  'send':             { from: ['PO_APPROVED'], to: 'SENT' },
  'reject':           { from: ['REQUESTED','SUPPLIER_PENDING','SO_APPROVED','PO_APPROVED'], to: 'REJECTED' },
};

export const canTransition = (s: AmendStatus, a: AmendAction): boolean => FLOW[a].from.includes(s);
export const nextStatus = (s: AmendStatus, a: AmendAction): AmendStatus | null =>
  canTransition(s, a) ? FLOW[a].to : null;

export const receivedFloorViolation = (
  line: { newQty: number | null }, po: { receivedQty: number },
): boolean => line.newQty != null && line.newQty < (po.receivedQty ?? 0);
```

- [ ] **Step 4: Run → PASS.** Export from `packages/shared/src/index.ts`.

- [ ] **Step 5: Commit** — `git commit -m "feat(shared): SO amendment state machine + guards"`.

---

## Phase 2 — Amendment create + supplier-confirm routes

### Task 2: `so-amendments.ts` create + list/detail + supplier-confirm

**Files:**
- Create: `apps/api/src/routes/so-amendments.ts`
- Modify: `apps/api/src/index.ts` (mount `app.route('/so-amendments', soAmendments)`)

- [ ] **Step 1: Router skeleton** — mirror the structure of `apps/api/src/routes/grns.ts` (Hono + `supabaseAuth` middleware + `requirePermission`). Implement:
  - `GET /so-amendments` — list open + recent (join SO doc_no, status, requester). Stamp nothing heavy; 500-row cap.
  - `GET /so-amendments/:id` — detail with `so_amendment_lines` + the SO header + bound PO summary.
  - `POST /mfg-sales-orders/:docNo/amendments` — guard: SO is processing-locked (reuse `soProcessingLocked`), not DO/SI/SHIPPED-hard-locked, and no open amendment (the partial unique index is the backstop; also pre-check). Mint `amendment_no` = `${docNo}/A${n}`. Insert `so_amendments` + `so_amendment_lines` from the submitted diff. Write a `mfg_so_audit_log` row.
  - `PATCH /so-amendments/:id/supplier-confirm` — body { ref, note, attachmentKey? }; guard `canTransition(status,'supplier-confirm')`; set fields + status via `nextStatus`; audit.

- [ ] **Step 2: Manual verify** (no route-test harness in this repo — follow the existing convention of exercising via the app). Deploy to a branch preview or hit locally with `pnpm --filter @2990s/api dev`; create an amendment on a locked test SO; confirm the row + audit.

- [ ] **Step 3: Typecheck** — `pnpm --filter @2990s/api typecheck` → Done.

- [ ] **Step 4: Commit** — `git commit -m "feat(api): SO amendment create + supplier-confirm routes"`.

---

## Phase 3 — Approve-SO (revise + recompute + snapshot)

### Task 3: `so-revision.ts` + `approve-so` route

**Files:**
- Create: `apps/api/src/lib/so-revision.ts`
- Modify: `apps/api/src/routes/so-amendments.ts`

- [ ] **Step 1: `snapshotSo(sb, docNo)`** — read the full SO header + items, insert a `so_revisions` row at the SO's CURRENT `revision`. Return the new revision number (current + 1) to stamp on the SO after applying.

- [ ] **Step 2: `applySoAmendment(sb, amendmentId, userId)`** —
  1. Load amendment + lines + SO.
  2. `snapshotSo` the current SO.
  3. Apply each `so_amendment_lines` diff to `mfg_sales_order_items` (SPEC/QTY/ADD/REMOVE), using the SAME write path as `POST /mfg-sales-orders` line writes (carry all variant cols — see `variant_conversion_carryover`).
  4. **Re-run the honest-pricing recompute** exactly as `POST /mfg-sales-orders`: `computeMfgLinePrice`/`computeMfgLineCost` per line + `computeSoDeliveryFee` + reject on `mfgPricingDriftExceeds` > 0.5%.
  5. Bump `mfg_sales_orders.revision = revision + 1`, `updated_at`.
  6. Audit row.

- [ ] **Step 3: Route `PATCH /so-amendments/:id/approve-so`** — `requirePermission` (coordinator/showroom_lead/admin+); guard `canTransition`; call `applySoAmendment`; set status via `nextStatus`; stamp `so_approved_by/at`. Transactional/best-effort-consistent per the GRN pattern.

- [ ] **Step 4: Typecheck + manual verify** — approve a test amendment; confirm SO lines changed, `revision` bumped, a `so_revisions` snapshot of the OLD version exists, prices recomputed.

- [ ] **Step 5: Commit** — `git commit -m "feat(api): approve-SO applies revision + recompute + snapshot"`.

---

## Phase 4 — Approve-PO + Send

### Task 4: PO revision + send routes

**Files:**
- Modify: `apps/api/src/lib/so-revision.ts` (add `snapshotPo` + `reviseBoundPo`), `apps/api/src/routes/so-amendments.ts`

- [ ] **Step 1: `snapshotPo` + `reviseBoundPo(sb, amendmentId, userId)`** — find the bound PO(s) for the SO's lines (`purchase_order_items.so_item_id` → PO). For each: snapshot to `po_revisions`; re-derive the PO lines from the now-revised SO lines (reuse the existing SO→PO derivation used by "Create PO from SO"); bump `purchase_orders.revision`. If the SO has NO bound PO → no-op (the light branch ends at SO_APPROVED).

- [ ] **Step 2: Route `PATCH /so-amendments/:id/approve-po`** — `requirePermission` (coordinator/purchasing/admin+); guard; call `reviseBoundPo`; status → PO_APPROVED; stamp `po_approved_by/at`; audit. Enforce the GRN-received floor (`receivedFloorViolation`) → 409 with the offending line.

- [ ] **Step 3: Route `PATCH /so-amendments/:id/send`** — status → SENT; generate the revised PO PDF (existing PO PDF path) and hand to the existing doc-email path to the supplier; stamp `sent_at`; audit.

- [ ] **Step 4: Route `PATCH /so-amendments/:id/reject`** — status → REJECTED; NO doc changes; audit.

- [ ] **Step 5: Typecheck + manual verify** full happy path end-to-end on a test SO. **Commit.**

---

## Phase 5 — Processing-lock behaviour change

### Task 5: Route locked SO edits into an amendment draft

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts` (the header PATCH + line add/edit/delete handlers, ~the `soProcessingLocked` call sites)

- [ ] **Step 1:** At each `soProcessingLocked` gate on the SO EDIT endpoints: instead of returning `409 so_locked_processing`, when the SO is processing-locked (and NOT DO/SI/SHIPPED-hard-locked), return a structured response `{ needs_amendment: true }` (or route to the amendment create) so the client submits the change as an amendment rather than a direct commit. **Keep the hard 409 for DO/SI + SHIPPED.** Keep the current 409 for any client that doesn't understand the new flow (back-compat).

- [ ] **Step 2:** Stamp `has_open_amendment` + `amendment_gate` on the SO detail endpoint (query `so_amendments` open row) so the frontend renders the right banner.

- [ ] **Step 3: Typecheck + manual verify** — a locked-SO edit now yields the amendment path, not a dead 409. **Commit.**

---

## Phase 6 — Frontend (mockups already approved 2026-07-03)

> Backend-priority note: these are the FE-facing tasks. The three mockups (unified-edit submit, SO/PO approval banners, Amendments queue) are owner-approved. Hand to the FE person or implement in `apps/backend` (never `apps/pos`). Each task ends with `tsc -b` + `vite build` (with `ALLOW_LOCAL_API_URL=1` locally).

### Task 6: Query hooks + status pill

- [ ] `apps/backend/src/lib/so-amendment-queries.ts` — `useAmendments`, `useAmendmentDetail`, `useCreateAmendment`, and per-transition mutations (each invalidates `['amendments']` + `['so-detail']`/`['po-detail']`). Mirror `flow-queries.ts`.
- [ ] `apps/backend/src/lib/status-pill.ts` — add `soAmendment` doc type map (REQUESTED=info, SUPPLIER_PENDING=pending, SO_APPROVED/PO_APPROVED=progress, SENT=success, REJECTED=danger). **Commit.**

### Task 7: SO Detail — unified edit + amendment banner + Revisions tab

- [ ] Save handler: when the SO is processing-locked (detail flag), the primary Save becomes **"Submit amendment request"** → `useCreateAmendment` with the edited line diff; a banner explains the order is locked (already PO'd).
- [ ] Amendment-pending banner hosting **Record supplier confirmation** + **Approve SO revision** (role-gated), with a before/after diff link.
- [ ] **Revisions** tab reading `so_revisions`. **Commit.**

### Task 8: PO Detail — revision-ready banner + Revisions tab

- [ ] "Revision ready" banner (shown when the amendment is at SO_APPROVED) hosting **Approve PO** + **Send** (role-gated) with a Revised-PO preview; "Revised · rev N" badge. **Revisions** tab reading `po_revisions`. **Commit.**

### Task 9: Amendments queue page + nav

- [ ] `apps/backend/src/pages/Amendments.tsx` — DataGrid inbox (SO no., requester, current gate/status pill, age), row-click routes to the SO or PO detail per gate. Add the nav item with a pending-count badge. **Commit.**

---

## Deploy

- [ ] Apply migration 0210 to PROD (done in Phase 0 Step 6) BEFORE merging schema-dependent code.
- [ ] Merge the isolated branch to `main` (auto-deploys API + Pages). Watch `gh run watch`; confirm API/Backend deploy green + `/health` 200.
- [ ] Smoke-test the full path on a locked test SO in prod; verify snapshots + audit; verify DO/SI/SHIPPED SOs still hard-lock.
- [ ] Update `docs/2026-07-03-so-amendment-revision-workflow-design.md` status → shipped.

---

## Self-review notes

- Spec coverage: trigger reuse (Phase 5), unified edit (Task 7), same-number+rev (Phase 0 revision cols + Phases 3/4), frozen window (create stages diff, no live write until approve — Phases 2–4), two gates on own pages (Tasks 7/8), no-PO light branch (approve-so terminal when no bound PO — Task 4 Step 1), snapshots (Phases 3/4), permissions (route `requirePermission` + FE gating), edge cases (received floor Task 4 Step 2; one-open index Task 0). All mapped.
- No placeholders: state-machine + guard code is complete; route tasks reference exact sibling patterns (grns.ts, mfg-sales-orders.ts create recompute, Create-PO-from-SO derivation) rather than re-printing boilerplate.
- Type consistency: `AmendStatus`/`AmendAction` used consistently; `so_doc_no` keying matches every SO child table.
