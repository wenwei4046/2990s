# SO Amendment / Revision Workflow (post-PO) — Design

Date: 2026-07-03 · Owner: Wei Siang · Status: approved design, pre-implementation
Repo: wenwei4046/2990s · Apps: apps/backend + apps/api (+ packages/db migration). Does NOT touch apps/pos.

## Problem

Today a Sales Order (SO) is editable until a **DO or SI** exists (`has_children`) or its status reaches SHIPPED+. A **Purchase Order does NOT lock the SO** — after a PO is raised the SO stays freely editable and the system only *flags drift* (PR #634, "flag not auto-sync").

The business needs the opposite for spec changes after procurement has committed: once a PO is placed and sent to the supplier, a salesperson who wants to change the SO's spec must go through a **controlled, supplier-confirmed amendment** so the SO and the supplier's PO never silently diverge, and every prior version is preserved.

## Decisions (owner-confirmed)

1. **New PO-lock.** Once a non-cancelled PO exists for an SO, that SO's **spec lines lock** and can only change through the amendment flow. (SOs with no PO stay freely editable — current behaviour. This reverses PR #634's "flag not lock" *for the PO case only*; DO/SI locks and SHIPPED+ status locks are unchanged.)
2. **Same document number + revision counter.** The SO stays `SO-2607`, the PO stays `PO-xxxx`; each gains a `revision` counter, a "Revised" marker on the doc + PDF, and a Revisions history tab. **Never mint a new PO number** (a new number risks the supplier treating it as an additional order → double shipment).
3. **Waiting-window = old docs frozen.** During REQUESTED / SUPPLIER_PENDING the live SO and PO keep their old spec; the proposed new spec lives only in the amendment request. Books stay truthful; the old PO can't mis-ship the wrong thing.
4. **Two approval gates.** (a) Approve the **SO revision** (the spec change), then (b) approve the **PO** — the Revised PO is generated only after its own approval, then re-sent to the supplier.

## State machine

```
SO+PO placed (SO spec LOCKED)
   │  salesperson opens amendment
   ▼
REQUESTED ──────────► SUPPLIER_PENDING ──────► SO_APPROVED ──────► PO_APPROVED ──────► SENT
 (new spec staged,     (coordinator verifies    (gate ①: SO         (gate ②: revised    (revised PO
  old SO/PO frozen)      w/ supplier, records     revision made       PO generated)        re-sent to
                         confirmation ref/note)    official, old                            supplier)
                                                   version snapshot)
   │ any gate: reject
   ▼
REJECTED  (SO/PO unchanged, request archived)
```

- Exactly **one open amendment per SO** at a time.
- Reject at any gate leaves the live SO/PO untouched; the request is archived for audit.

## Data model (packages/db migration)

**`so_amendments`** (the 申请单 — drives the flow; the live SO/PO are untouched until APPROVED):
- `id`, `sales_order_id` (FK), `amendment_no` (human no., e.g. `SO-2607/A1`)
- `status` enum: `REQUESTED | SUPPLIER_PENDING | SO_APPROVED | PO_APPROVED | SENT | REJECTED`
- `requested_by` (staff), `reason` (text)
- `supplier_confirmed_by`, `supplier_confirmation_ref` (text), `supplier_confirmation_note`, `supplier_confirmation_attachment_key` (R2 — email/回执 screenshot, optional)
- `so_approved_by` / `so_approved_at`, `po_approved_by` / `po_approved_at`, `sent_at`
- timestamps + `updated_at`

**`so_amendment_lines`** — the proposed line-level diff:
- `id`, `amendment_id`, `sales_order_item_id` (nullable for an added line), `change_type` (`SPEC | QTY | ADD | REMOVE`)
- proposed fields: `new_item_code`, `new_variants` (jsonb), `new_qty`, `new_unit_price_sen` (nullable → server recompute), plus a snapshot of the OLD values for display/audit.

**Revision snapshots (immutable backups):**
- `so_revisions` (`sales_order_id`, `revision`, full header+lines JSON snapshot, `created_at`, `created_by`, `amendment_id`)
- `po_revisions` (`purchase_order_id`, `revision`, full snapshot, …)
- Add `revision INT DEFAULT 1` to `mfg_sales_orders` and `purchase_orders` headers.

## Server flow (apps/api)

New routes under `/mfg-sales-orders/:id/amendments` (+ PO approval action):
- `POST …/amendments` — salesperson creates a request (only if SO is PO-locked + no open amendment). Validates the proposed lines.
- `PATCH …/amendments/:aid/supplier-confirm` — coordinator records supplier confirmation → SUPPLIER_PENDING→(ready for SO approval).
- `PATCH …/amendments/:aid/approve-so` — gate ①. Atomically: snapshot current SO → `so_revisions`; apply the new spec to `mfg_sales_orders(_items)`; bump SO `revision`; **re-run the server-side honest-pricing recompute** (`computeMfgLinePrice`/`computeMfgLineCost`, `mfgPricingDriftExceeds`) exactly as `POST /mfg-sales-orders` does; status→SO_APPROVED.
- `PATCH …/amendments/:aid/approve-po` — gate ②. Snapshot current PO → `po_revisions`; re-derive the bound PO lines from the revised SO; bump PO `revision`; status→PO_APPROVED. Revised PO PDF now available.
- `PATCH …/amendments/:aid/send` — mark SENT; hand the revised PO PDF to the existing doc-email path to the supplier.
- `PATCH …/amendments/:aid/reject` — from any pre-APPROVED gate → REJECTED, no doc changes.

Each transition writes an **audit-log** row. All mutations idempotent + wrapped so a partial failure doesn't half-apply (mirror the existing GRN/SO transactional patterns).

## Frontend (apps/backend)

- `SalesOrderDetail.tsx`: extend the lock — `isLocked` also true when a non-cancelled PO exists (new `has_open_po` flag from the API). When PO-locked, the Edit button is replaced by **"Request amendment"**. Add a **Revisions** history tab (view any prior SO snapshot).
- New amendment drawer/page: pick line(s) → new spec (reuse the SO line editor + variant pickers) → submit; then the approval actions (supplier-confirm, approve-SO, approve-PO, send) gated by role.
- `PurchaseOrderDetail.tsx`: Revisions tab; "Revised" badge + revision no.; the approve-PO + send actions surface here for purchasing.
- Amendment status pill via the canonical `lib/status-pill.ts` map (add a `soAmendment` doc type).

## Permissions (RBAC)

- **Create request:** `sales`, `sales_executive` (+ above).
- **Supplier confirm + approve-PO + send:** `coordinator` / purchasing / `admin`+.
- **Approve-SO revision:** `coordinator` / `showroom_lead` / `admin`+ (sales lead sign-off).
- Super-admin bypass per the existing `requirePermission` short-circuit.

## Reuse (no new wheels)

drift-flag (PR #634) → repurposed as the "amendment in progress" indicator · PO snapshot model → revised PO is a new snapshot · doc-no minter → revision counter · doc-email → sends the Revised PO · audit log → every transition · role gating (`requirePermission`) · SO server-side recompute · variant-conversion carry-over write path.

## Edge cases

- **PO already (partly) GRN-received:** the amendment cannot reduce a line below its `received_qty`; already-GRN'd lines follow the existing GRN-gated PO-line rule (need a Purchase Return to undo received qty). Surface clearly in the request UI.
- **DO/SI already exists:** SO is already locked harder (shipped/invoiced) → amendment **not** allowed; handle via return/credit (out of scope).
- **Multiple POs from one SO:** approve-PO step operates per bound PO; if an SO's lines fan out to >1 PO, the revised lines re-derive against their own PO(s).
- **Reject after supplier already shipped:** out of scope for v1 (shouldn't happen — supplier ships against the *approved* revised PO only).
- **Concurrency:** one open amendment per SO (unique partial index on `sales_order_id where status not in ('SENT','REJECTED')`).

## Out of scope (v1)

Automated supplier portal / EDI (supplier confirmation is a manual coordinator step with a note/attachment); amending after DO/SI (returns path); cross-SO batch amendments.

## Testing

- Unit: state-machine transitions (each gate, reject from each state), one-open-amendment guard, GRN-received floor.
- Integration: request→confirm→approve-SO (SO revision + recompute + snapshot)→approve-PO (PO revision + snapshot)→send; verify old SO/PO frozen until APPROVED; verify snapshots immutable; verify honest-pricing recompute on the revised SO.
- Permissions: each action gated to the right roles.

## Open questions

None blocking. (Amendment human-number format `SO-2607/A1` assumed — adjust in implementation if the owner prefers another scheme.)
