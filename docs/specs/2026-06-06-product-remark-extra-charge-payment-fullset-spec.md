# Product-page remark + extra charge, payment full-set + per-payment slips — SPEC

> Date: 2026-06-06 · Decided with Loo (remote session) · Status: APPROVED design, pre-implementation
> Scope: POS + Backend + API + DB. Two features shipped together because they share the
> payment-ledger migration and the SO Maintenance surface.

---

## 0 · Why

1. Sales staff need to key a **per-product remark** (and optionally an **extra add-on amount in RM**)
   on each POS product page (mattress/bedframe detail, sofa configurator), so the remark lands on the
   SO line and shows up everywhere downstream — Backend SO detail, Detail Listing "Order Remarks"
   column, and the customer-signed SO PDF.
2. The POS order-drawer "Record payment" is a stub: no method select, no slip, **no server-side
   overpayment guard**. It must become the same full set as SO creation, synced with SO Maintenance.
3. Payments are per-row in `mfg_sales_order_payments` but slips are one-per-order and the Detail
   Listing only shows the most-recent approval code. Loo paid twice → saw one code. Every payment
   must carry **its own slip + approval code**, including handover split payments.

## 1 · Locked decisions (Loo, 2026-06-06)

| # | Decision |
|---|---|
| D1 | Extra add-on amount **folds into the product line price** (no separate SVC line). Server recompute must accept the *declared* extra — see §4.2. |
| D2 | The handover step-4 "Special instructions" textarea is **removed**. Order-level `note` column stays (backend-editable, history intact). |
| D3 | Line remark **prints on the customer SO PDF** (under the line description). |
| D4 | Slip upload is **compulsory for every payment row, POS and Backend** — including each split payment at handover ("if 2 payments for the deposit, it has 2 approval codes and 2 slips"). |
| D5 | The product-page remark/extra card is gated by an **on/off toggle in SO Maintenance** (default ON). |
| D6 | Server-side **overpayment guard**: Σ(ledger)+new amount ≤ SO total, else 400 `over_payment`. |
| D7 | Detail Listing "Approval Code" column shows **all codes joined + payment count** (e.g. `123123 + 456456 (2)`). Last Payment / Account Sheet stay most-recent. |

## 2 · Data model (migration `0158_payment_slip_per_row_and_so_settings.sql`)

```sql
-- per-payment slip (nullable: legacy rows fall back to the order-level slip)
ALTER TABLE mfg_sales_order_payments ADD COLUMN slip_key text;

-- tiny settings table for SO Maintenance feature toggles (Pattern B-lite)
CREATE TABLE so_settings (
  key        text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT true,
  label      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO so_settings (key, enabled, label)
VALUES ('pos_product_remark', true, 'Product page remark & extra charge');
```

- `mfg_sales_order_items.remark` already exists — no schema change for remarks.
- Apply via Supabase MCP (`apply_migration`); the GH workflow is known-broken (DATABASE_URL unset).
- ⚠️ Verify 0158 is still free at implementation time (0155 is already duplicated on disk).

## 3 · Feature A — product-page remark + extra charge

### 3.1 POS UI (`apps/pos/src/pages/Configurator.tsx`)

New `RailSection` card **"Remark & extra charge"**, rendered only when the `pos_product_remark`
setting is ON:

- **Mattress**: between the PWP card (~line 1770) and "About this …" (~1772) — Loo's circle.
- **Bedframe**: between the PWP card (~1886) and "Build" (~1888).
- **Sofa**: left rail below the Leg height row (~1283), visible in BOTH Quick Pick and Customize.

Fields: `Remark` textarea + `Extra add-on amount (RM)` optional non-negative integer (whole MYR,
retail convention — NOT centi). Brand voice: sentence case, calm copy, no emoji.

### 3.2 Cart snapshot (`apps/pos/src/state/cart.ts`)

Add to ALL THREE snapshot interfaces (`SizeConfigSnapshot`, `BedframeConfigSnapshot`,
`SofaConfigSnapshot`):

```ts
remark?: string;
extraAddonAmountRM?: number;   // whole MYR, ≥ 0
```

- `config.total` ALREADY INCLUDES the extra (added at Add-to-Cart time) so every existing total
  consumer (CartContents, OrderSummaryPane, CustomerOrderSheet, quote save) stays correct for free.
- `pwpOriginalTotal` and any PWP base math EXCLUDE the extra (PWP trigger/reward sets must not be
  polluted by an operator surcharge).
- Cart-line Edit reopens the configurator with remark + extra prefilled. Quote save/restore carries
  both (they live in the snapshot; no quote schema change).

### 3.3 Handover payload (`apps/pos/src/lib/pos-handover-so.ts`)

In `buildVariants()` per kind:

```ts
if (config.remark?.trim()) v.remark = config.remark.trim();
if (config.extraAddonAmountRM) v.extraAddonAmountRM = config.extraAddonAmountRM;
```

`cartLineToSoItem()` keeps `unitPriceCenti = config.total × 100` (extra already folded in).

### 3.4 Server (`apps/api/src/routes/mfg-sales-orders.ts` + `lib/mfg-pricing-recompute.ts`)

This is the critical piece — the POS-tablet drift gate (>0.5% reject) is server-authoritative and
MUST NOT be weakened:

1. `recomputeFromSnapshot()` learns the declared extra: expected selling =
   recomputed base + `variants.extraAddonAmountRM × 100`. The extra is a *declared, audited input*,
   not a silent total bump — tampering with the base price still drifts → 400.
2. PWP claim/reconcile paths (`pwpBaseSen`) use the base WITHOUT the extra.
3. When `so_settings.pos_product_remark` is OFF, a line carrying `extraAddonAmountRM` → 400
   `extra_amount_disabled` (explicit, never swallowed — CF-cap lesson).
4. `variants.remark` → `mfg_sales_order_items.remark` on insert. Sofa per-module split
   (`so-sofa-split.ts`): remark lands on the **lead module line only** (same rule as P3 breakdown
   columns); the extra folds into the build total and distributes proportionally (same rule as
   fabric-tier/leg folds).

### 3.5 Remark display completion (currently broken everywhere downstream)

| Surface | File | Change |
|---|---|---|
| SO detail read-only table | `apps/backend/src/pages/SalesOrderDetail.tsx` | render `remark` under the line description |
| Display fold | `packages/shared/src/so-line-display.ts` | add `remark?` to `RawSoDisplayLine` + `SoDisplayGroup` (lead line's remark survives the fold) |
| SO PDF | `apps/backend/src/lib/sales-order-pdf.ts` | add `remark` to `SoItem`, print under description (D3) |
| POS order drawer | `apps/pos/src/pages/OrderStatus.tsx` | show per-line remarks in the line list |
| Detail Listing "Order Remarks" | — | already reads `remark \|\| note` first-priority; works untouched |
| Backend SoLineCard | — | already editable; backend keys remark only, edits price directly (no amount column) ✓ |

### 3.6 Remove old box (D2)

- Delete the "Special instructions (optional)" textarea from `TargetDateStep.tsx`.
- Retire `HandoverForm.specialInstructions` (+ its sessionStorage persistence + tests).
- SO create no longer sends `note` from it. The `note` column, backend editing, POS drawer Notes
  display of EXISTING orders all stay.

### 3.7 SO Maintenance toggle (D5)

- API: `GET /so-settings` (list), `PATCH /so-settings/:key` (`{enabled}`, coordinator-or-above).
- Backend `SalesOrderMaintenance.tsx`: new "POS settings" section with the toggle.
- POS mirror `SalesOrderMaintenance.tsx`: same section.
- POS Configurator reads it via a `useSoSetting('pos_product_remark')` hook (TanStack, 30-min stale,
  default-ON fallback while in flight — matches `useSoDropdownValues` pattern).
- The API create-path gate (§3.4.3) reads the same row server-side.

## 4 · Feature B — payment full set, per-payment slips, guards

### 4.1 Schema recap

`mfg_sales_order_payments` += `slip_key` (§2). Legacy rows NULL → UI falls back to the order-level
slip (`mfg_sales_orders.slip_key`), which is exactly what Wei Siang's 2026-06-06 PaymentsTable Slip
column shows today — we EXTEND his column (per-row key first, order fallback), not duplicate it.

### 4.2 POS order drawer (`apps/pos/src/pages/OrderStatus.tsx` payment section)

Upgrade from {amount, approval code} to the FULL SET, same vocabulary as handover:

- Method select: 4 L1 codes from `usePaymentMethodLabels()` + cascades (`payment_merchant` /
  `online_type` / `installment_plan` from `useSoDropdownValues`) — all synced with SO Maintenance.
- Approval code (placeholder text per method, same as ConfirmPaymentStep).
- **Compulsory slip** per payment: reuse `SlipUploadStep` + `/slips/init→confirm` R2 flow.
- Client cap stays (amount ≤ total − paid) — but the server guard is the real gate.
- Payment history list replaces the single "PAID SO FAR" line: every ledger row (date · amount ·
  method · approval code · slip thumbnail) + count, from existing `GET /:docNo/payments`.

### 4.3 API `POST /mfg-sales-orders/:docNo/payments`

Extend `paymentCreateSchema` + handler:

- New fields: `merchantProvider?`, `installmentMonths?`, `onlineType?`, `uploadSessionId` —
  **required** (D4); resolve pending_slip_uploads → `slip_key`, promote the row (same promote dance
  as SO create, `mfg-sales-orders.ts:2248`).
- Method comes from the payload select, no longer inferred from the SO header.
- **Overpayment guard (D6)**: `SUM(amount_centi)+new > total_revenue_centi` → 400
  `{error:'over_payment', balanceCenti}`. Destructure the sum-query error honestly (CF lesson).
- Backend callers get the same slip requirement (D4: both compulsory).

### 4.4 Handover split payments — one slip EACH (D4)

- `ExtraPayment` (handover-helpers) += `slipUploadSessionId: string | null`; the PRIMARY payment's
  slip is the existing form-level `slipUploadSessionId` (re-labelled "Payment 1 slip").
- `ConfirmPaymentStep`: each split row gets its own `SlipUploadStep`; `validateConfirmPayment`
  requires a confirmed slip + approval code per row.
- SO create payload: each `payments[]` entry += `uploadSessionId`. Server resolves each session →
  per-row `slip_key`, promotes each pending row. `mfg_sales_orders.slip_key` keeps payment #1's slip
  (coordinator visibility/0143 + Wei Siang's column fallback stay meaningful).
- Single-payment path: the one slip doubles as that payment row's `slip_key`.

### 4.5 Backend PaymentsTable (`apps/backend/src/components/PaymentsTable.tsx`)

- Draft rows gain a slip-upload control, **required** before Save (D4).
- Slip column: per-row `slip_key` first, fallback to order slip for legacy rows.

### 4.6 Detail Listing columns (D7)

`SalesOrderDetailListing.tsx` + its server query: "Approval Code" aggregates ALL ledger codes
(`string_agg` order by paid_at) + count suffix when >1. "Last Payment" (MAX paid_at) and
"Account Sheet" (most-recent) unchanged.

## 5 · Out of scope

- POS retail `orders`/`payments` legacy tables (POS now creates SOs; legacy path untouched).
- DO/SI PDFs remark printing (SO only; DO/SI deliberately stay as-is per the display-fold spec).
- Per-payment slip backfill for historical rows (fallback covers display).

## 6 · Tests

- `packages/shared`: recompute accepts declared extra / rejects undeclared bump; PWP base excludes
  extra; display-fold carries remark.
- `apps/pos`: handover-helpers validate per-payment slip+code; specialInstructions removal.
- API route tests: over_payment 400, extra_amount_disabled 400, per-payment slip promote.
- Known-environmental: slips.test.ts 3 local SSL failures — don't chase.

## 7 · Deploy order

1. Migration 0158 via Supabase MCP (additive — safe before code).
2. API (wrangler) → Backend + POS (CF Pages via main).
3. Verify on live; remind PWA hard-refresh for POS tablets.
