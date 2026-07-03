# SO Amendment / Revision Workflow (post-lock) — Design

Date: 2026-07-03 · Owner: Wei Siang · Status: approved design, pre-implementation
Repo: wenwei4046/2990s · Apps: apps/backend + apps/api (+ packages/db migration). Does NOT touch apps/pos.

## Problem

Once an SO's **Processing Date passes**, the SO is hard-locked today — `soProcessingLocked` (Owner 2026-06-12, apps/api/src/routes/mfg-sales-orders.ts) rejects every header edit, line add/edit/delete, and price override with `409 so_locked_processing`. The rationale in the code: *"locked orders are what we PO to the supplier."*

But real life needs changes after that: a salesperson wants to swap a fabric/spec on an order that's already been PO'd to the supplier. Today they're simply blocked. We want a **controlled, supplier-confirmed amendment** so the SO and the supplier's PO can change together, every prior version is preserved, and the books stay truthful in between.

## Decisions (owner-confirmed)

1. **Reuse the existing processing-date lock as the trigger — no new lock.** Instead of a separate "PO-exists" lock, we change what `soProcessingLocked` *does*: rather than hard-rejecting edits, a processing-locked SO stays editable, but **Save routes into an Amendment Request instead of committing directly.** `DO/SI exists` (`so_has_downstream`) and `SHIPPED+` status remain **hard locks** (those orders are truly done — no amendment).
2. **Unified Edit page.** The salesperson edits on the **same SO Detail Edit page** they always use. Before the lock, Save commits directly (today's behaviour). After the lock, a banner explains the order is locked (already PO'd) and the primary button becomes **"Submit amendment request"** — same edit UI, different post-submit path.
3. **Same document number + revision counter.** SO stays `SO-2607`, PO stays `PO-xxxx`; each gains a `revision` counter, a "Revised" marker on the doc + PDF, and a Revisions history tab. **Never mint a new PO number** (a new number risks the supplier treating it as an additional order → double shipment).
4. **Waiting-window = old docs frozen.** During REQUESTED / SUPPLIER_PENDING the live SO and PO keep their old spec; the proposed new spec lives only in the amendment request. Books stay truthful; the old PO can't mis-ship.
5. **Two approval gates, each on its own document's page.** (a) **Approve SO revision** on the **SO Detail page**; then (b) **Approve PO** on the **PO Detail page** — the Revised PO is generated only after its own approval, then re-sent to the supplier.
6. **Branch by PO existence.** Processing-locked **with a PO** (the normal case) → full flow (supplier confirm → approve SO → approve PO → resend). Processing-locked **without a PO yet** → light flow: internal Approve SO revision only; skip the supplier/PO steps.

## State machine

```
SO Processing Date passed  →  SO Edit page still open, Save = "Submit amendment request"
   │  salesperson edits spec + submits
   ▼
REQUESTED ─────────► SUPPLIER_PENDING ─────► SO_APPROVED ─────► PO_APPROVED ─────► SENT
 (new spec staged,    (coordinator records    (gate ①: SO        (gate ②: revised   (revised PO
  old SO/PO frozen)     supplier confirm:       revision applied,   PO generated       re-sent via
                        ref/note/attachment)    old snapshot)       from approved SO)   doc-email)
   │ any gate: reject                                    │
   ▼                                     no PO yet ──────┘ (light: stop after SO_APPROVED,
REJECTED (SO/PO unchanged, archived)                        no supplier/PO steps)
```

- Exactly **one open amendment per SO** at a time.
- Reject at any gate leaves the live SO/PO untouched; the request is archived for audit.

## UI touchpoints (where each action lives)

Everything hangs off the **existing detail pages** + one new inbox — no new system, no double data entry.

- **Amendments queue** (new left-nav item, numeric badge) — the inbox: coordinators/purchasing see pending requests and click through to the right document.
- **SO Detail page** — (1) the unified Edit page whose Save becomes "Submit amendment request" when processing-locked; (2) an amber "Amendment pending" banner hosting **Record supplier confirmation** and **Approve SO revision** (gate ①), with a before/after diff link; (3) a **Revisions** history tab.
- **PO Detail page** — a green "Revision ready" banner (after gate ①) hosting **Approve PO** (gate ②) + **Send** (with a Revised-PO preview); a "Revised · rev N" badge; a **Revisions** history tab.

The salesperson only enters the new spec **once** (the SO edit). Both the SO revision and the revised PO **re-derive from that approved spec** — approvers review + click, they don't re-type.

## Data model (packages/db migration)

**`so_amendments`** — drives the flow; the live SO/PO are untouched until approved:
- `id`, `sales_order_id` (FK), `amendment_no` (human no., e.g. `SO-2607/A1`)
- `status` enum: `REQUESTED | SUPPLIER_PENDING | SO_APPROVED | PO_APPROVED | SENT | REJECTED`
- `requested_by` (staff), `reason` (text)
- `supplier_confirmed_by`, `supplier_confirmation_ref` (text), `supplier_confirmation_note`, `supplier_confirmation_attachment_key` (R2, optional)
- `so_approved_by`/`so_approved_at`, `po_approved_by`/`po_approved_at`, `sent_at`, timestamps, `updated_at`

**`so_amendment_lines`** — the proposed line-level diff:
- `id`, `amendment_id`, `sales_order_item_id` (nullable for an added line), `change_type` (`SPEC | QTY | ADD | REMOVE`)
- proposed: `new_item_code`, `new_variants` (jsonb), `new_qty`, `new_unit_price_sen` (nullable → server recompute) + a snapshot of the OLD values.

**Revision snapshots (immutable):** `so_revisions` (`sales_order_id`, `revision`, full header+lines JSON, `created_at`, `created_by`, `amendment_id`); `po_revisions` (same for PO). Add `revision INT DEFAULT 1` to `mfg_sales_orders` and `purchase_orders` headers.

## Server flow (apps/api)

- **Change `soProcessingLocked` behaviour:** the SO line/header edit endpoints, when processing-locked (and not DO/SI/SHIPPED-hard-locked), no longer 409 — instead the Save payload is accepted as an **amendment request draft** (routed to the amendments create path) rather than committed to the live SO. Hard locks still 409.
- New routes under `/mfg-sales-orders/:id/amendments`:
  - `POST …/amendments` — create request from the edited spec (guard: processing-locked, no open amendment). Validates proposed lines.
  - `PATCH …/amendments/:aid/supplier-confirm` — record supplier confirmation → SUPPLIER_PENDING.
  - `PATCH …/amendments/:aid/approve-so` — gate ①: snapshot current SO → `so_revisions`; apply new spec to `mfg_sales_orders(_items)`; bump SO `revision`; **re-run server-side honest-pricing recompute** (`computeMfgLinePrice`/`computeMfgLineCost` + `mfgPricingDriftExceeds`, exactly like `POST /mfg-sales-orders`); status → SO_APPROVED. (If no PO exists → this is the terminal step.)
  - `PATCH …/amendments/:aid/approve-po` — gate ②: snapshot current PO → `po_revisions`; re-derive bound PO lines from the revised SO; bump PO `revision`; status → PO_APPROVED.
  - `PATCH …/amendments/:aid/send` — status → SENT; hand the revised PO PDF to the existing doc-email path.
  - `PATCH …/amendments/:aid/reject` — any pre-approved gate → REJECTED, no doc changes.
- Every transition writes an **audit-log** row. Mutations idempotent + transactional so a partial failure never half-applies (mirror the GRN/SO patterns).
- Detail endpoints stamp `has_open_amendment` + the current gate so the SO/PO pages render the right banner.

## Permissions (RBAC)

- **Create request:** `sales`, `sales_executive` (+ above) — via the unified Edit page when locked.
- **Supplier confirm + approve-PO + send:** `coordinator` / purchasing / `admin`+.
- **Approve-SO revision:** `coordinator` / `showroom_lead` / `admin`+.
- Super-admin bypass per the existing `requirePermission` short-circuit.

## Reuse (no new wheels)

Existing processing-date lock (repurposed) · drift-flag (PR #634) → "amendment in progress" indicator · PO snapshot model → revised PO snapshot · doc-no minter → revision counter · doc-email → sends Revised PO · audit log · role gating · SO server-side recompute · variant-conversion carry-over write path · canonical `lib/status-pill.ts` (add `soAmendment` doc type).

## Edge cases

- **PO already (partly) GRN-received:** the amendment cannot reduce a line below its `received_qty`; already-GRN'd lines follow the existing GRN-gated PO-line rule (a Purchase Return is needed to undo received qty). Surface in the request UI.
- **DO/SI already exists / SHIPPED+:** hard-locked → amendment not allowed (handle via return/credit — out of scope).
- **Processing-locked but no PO yet:** light branch — Approve SO revision only, no supplier/PO steps.
- **Multiple POs from one SO:** approve-PO operates per bound PO; revised lines re-derive against their own PO(s).
- **Concurrency:** one open amendment per SO (unique partial index on `sales_order_id where status not in ('SENT','REJECTED')`).

## Out of scope (v1)

Automated supplier portal/EDI (supplier confirmation is a manual step with note/attachment); amending after DO/SI (returns path); cross-SO batch amendments.

## Testing

- Unit: state-machine transitions (each gate, reject from each state), one-open-amendment guard, GRN-received floor, no-PO light branch.
- Integration: locked SO edit → Submit amendment request → supplier-confirm → approve-SO (SO revision + recompute + snapshot) → approve-PO (PO revision + snapshot) → send; verify old SO/PO frozen until approved; snapshots immutable; honest-pricing recompute on the revised SO.
- Permissions: each action gated to the right roles.

## Open questions

None blocking. (Amendment human-number format `SO-2607/A1` assumed — adjust in implementation if the owner prefers another scheme.)
