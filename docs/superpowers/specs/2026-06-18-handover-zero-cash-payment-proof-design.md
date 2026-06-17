# Handover: RM0 and Cash payments don't require approval code or slip

**Date:** 2026-06-18
**Author:** Claude (with Loo)
**Status:** Approved — ready for implementation plan
**Relates to:** Free Item Campaign (a free RM0 order surfaced this); ships on the same
branch/PR as the delivery-fee fix (`free-item-no-delivery-fee` / PR #685).

---

## Problem

On the POS handover **Confirm payment** step, the approval code and a payment
slip/proof are **required for every payment, every method**. Two cases where that
is wrong:

1. A **free (RM0) order** (a Free Item Campaign giveaway) has nothing to pay — yet
   "Continue to signature" stays disabled because the step demands `amountPaid > 0`,
   an approval code, and a slip. The order can't be completed at all.
2. A **cash** payment has no bank slip and often no reference number — forcing an
   approval code + slip proof is friction.

## Rule (Loo 2026-06-18)

**Approval code and payment slip are required only for a payment that is both
non-zero AND non-cash.**

- `amountPaid === 0` (free order / nothing collected now) → no approval, no slip; the step can proceed.
- **Cash** (any amount) → approval code AND slip both optional.
- Transfer / merchant / installment with amount > 0 → approval + slip required (unchanged).
- Applies to the **primary** payment AND **each split (extra)** payment leg.

The **≥50% deposit floor is unchanged.** A *paid* order still needs ≥50% collected,
so in practice this unblocks RM0 free orders (floor = 0) and drops proof for cash;
a paid non-cash order behaves exactly as before.

Encode the rule once as a shared predicate so the four surfaces can't drift:

```ts
// handover-helpers.ts
export const paymentProofRequired = (method: PaymentMethod | '', amount: number): boolean =>
  amount > 0 && method !== 'cash';
```

## Why the server is mostly unaffected

The POS sends `payments[]` **only when there is a split** (`extraPayments.length > 0`).
A single payment — including every free order and every single cash sale — goes through
the **legacy `depositCenti` path**, which already accepts a zero deposit, a null
`slip_key`, and a null `approval_code` (`mfg-sales-orders.ts` ~3027/3035/3040). So the
server only needs a change for the **split-payment path with a cash leg**, where the
`payments[]` Zod currently forces `uploadSessionId` (a slip) on every row.

## Design — four surfaces

### 1. Client validation — `apps/pos/src/lib/handover-helpers.ts` (pure, tested → TDD)

- Add the exported `paymentProofRequired` predicate.
- `validateConfirmPayment`:
  - allow `amountPaid === 0` (change the `amountPaid <= 0` reject to `< 0`);
  - keep the "split primary must be > 0" rule explicitly: reject when
    `extraPayments.length > 0 && amountPaid <= 0` (previously subsumed by the `<= 0` reject);
  - gate approval + slip behind `paymentProofRequired(paymentMethod, amountPaid)`.
- `extraPaymentComplete`: require approval + slip only when
  `paymentProofRequired(p.method, p.amount)` (method/amount sub-field checks unchanged).
- `confirmPaymentBlockers`: mirror the same gate so error messages match.

### 2. Client UI — `apps/pos/src/components/handover/ConfirmPaymentStep.tsx`

The `*` required markers become dynamic via `paymentProofRequired`:
- primary "Approval code" label (≈L134) and "Payment 1 slip / proof" required span (≈L277);
- each split row's "Approval code" (≈L190) and "Payment N slip / proof" (≈L242) using the row's own `method`/`amount`.

### 3. Client payload — `apps/pos/src/pages/Handover.tsx` `submitHandoffToSo`

In the split-payment builder, stop force-asserting the slip — include
`uploadSessionId` only when present (a cash leg may have none):
- primary row (≈L403): `...(form.slipUploadSessionId ? { uploadSessionId: form.slipUploadSessionId } : {})`
- extra rows (≈L415): `...(p.slipUploadSessionId ? { uploadSessionId: p.slipUploadSessionId } : {})`

(The single-payment top-level `uploadSessionId`/`approvalCode` are already conditional spreads — unchanged.)

### 4. Server — `apps/api/src/routes/mfg-sales-orders.ts` (split path only)

- `payments[]` Zod: make `uploadSessionId` optional, then per-row refine that a
  **non-cash** row must carry one:
  `.refine(p => p.method === 'cash' || (typeof p.uploadSessionId === 'string' && p.uploadSessionId.length > 0), { path: ['uploadSessionId'] })`.
  (`approvalCode` is already `.optional().nullable()`.)
- Slip resolution (≈L2878-2908): make `posPaymentSlipKeys` a `(string|null)[]`
  aligned to `posPayments`; resolve r2_keys only for rows that carry a session
  (uniqueness check + "uploaded" status check over those); cash-no-session rows → `null`.
- Booking (≈L3089): `slip_key: posPaymentSlipKeys![i]` already indexes per row → a cash leg books `slip_key: null`.
- Promote (≈L3112): guard `if (p.uploadSessionId) { …promote… }` so a cash leg with no session doesn't fire a false "promote failed" log.

## Out of scope (unchanged)

- The ≥50% deposit floor and full-payment ceiling.
- The single-payment / legacy `depositCenti` server path (already lax).
- `paymentRecorded` gating (the UI already records RM0 as "Payment recorded · RM 0").
- `approval_code` server columns (already optional).
- Other payment methods' rules (transfer/merchant/installment still need approval + slip).

## Testing & verification

- **Unit (`apps/pos/src/lib/handover-helpers.test.ts`, TDD):** `paymentProofRequired`
  truth table; `validateConfirmPayment` — RM0 free order passes with no approval/slip;
  cash (amount > 0) passes with no approval/slip; transfer still requires both; split
  with a cash leg lacking proof passes, a non-cash leg lacking proof fails; split
  primary must be > 0.
- `pnpm --filter @2990s/pos exec vitest run src/lib/handover-helpers.test.ts` (POS test
  script is watch-mode — always use `exec vitest run`).
- Full workspace `pnpm typecheck`.
- Server (no HTTP harness) → review-verified.
- **Manual on live:** free RM0 order → reaches signature, no approval/slip; single cash
  sale → no approval/slip required; transfer → still required; (edge) split with a cash
  leg → no 400.

## Branch / deploy

Same branch as the delivery-fee fix (`free-item-no-delivery-fee`), folded into **PR #685**
(retitled to cover both). Deploy from the worktree: **API Worker first, then POS Pages**;
hard-refresh the POS PWA after.
