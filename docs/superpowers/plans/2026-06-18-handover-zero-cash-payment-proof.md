# Handover RM0 + Cash payments don't require approval/slip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the POS handover Confirm-payment step, require an approval code + payment slip only for a payment that is non-zero AND non-cash — so a free RM0 order can check out and cash needs no proof.

**Architecture:** One shared predicate `paymentProofRequired(method, amount)` drives client validation, the UI required-markers, and the error messages. The split-payment payload stops force-asserting a slip, and the server's `payments[]` path makes the slip optional for cash legs. The single-payment / legacy server path already accepts zero deposit + null slip + null approval, so it is untouched.

**Tech Stack:** TypeScript strict, React (POS), Hono/Zod (API), Vitest.

## Global Constraints

- **Rule:** `paymentProofRequired(method, amount) = amount > 0 && method !== 'cash'`. Approval code + slip required ⟺ this is true. Applies to the primary payment AND each split leg.
- **≥50% deposit floor + full-payment ceiling are UNCHANGED** — a paid order still needs ≥50% collected; this mainly unblocks RM0 free orders.
- **Honest-pricing / money:** no amount math changes; only which proofs are required.
- **Server scope:** only the split-payment (`payments[]`) path changes. The single-payment legacy `depositCenti` path already accepts zero deposit / null slip / null approval — do NOT touch it. `approval_code` is already optional server-side.
- **POS test script is watch-mode** — always run POS tests via `pnpm --filter @2990s/pos exec vitest run <file>`, never `pnpm --filter @2990s/pos test`.
- **Out of scope:** the ≥50% floor, `paymentRecorded` gating, other methods' rules, the legacy server path.

**Pre-flight:** `node_modules` already installed in this worktree.

---

### Task 1: Shared predicate + client validation + tests

**Files:**
- Modify: `apps/pos/src/lib/handover-helpers.ts`
- Test: `apps/pos/src/lib/handover-helpers.test.ts`

**Interfaces:**
- Produces: `export const paymentProofRequired = (method: string, amount: number): boolean` — true iff `amount > 0 && method !== 'cash'`. Consumed by Tasks 2 (UI) and used internally by `validateConfirmPayment` / `extraPaymentComplete` / `confirmPaymentBlockers`.

- [ ] **Step 1: Write the failing tests**

Add `paymentProofRequired` to the import block at the top of `handover-helpers.test.ts` (it already imports `validateConfirmPayment`, `extraPaymentComplete`). Then append at the END of the file:

```ts
describe('paymentProofRequired', () => {
  it('false for a zero payment (any method)', () => {
    expect(paymentProofRequired('cash', 0)).toBe(false);
    expect(paymentProofRequired('transfer', 0)).toBe(false);
  });
  it('false for cash at any positive amount', () => {
    expect(paymentProofRequired('cash', 1000)).toBe(false);
  });
  it('true for a non-zero non-cash payment', () => {
    expect(paymentProofRequired('transfer', 1000)).toBe(true);
    expect(paymentProofRequired('merchant', 1)).toBe(true);
    expect(paymentProofRequired('installment', 500)).toBe(true);
  });
});

describe('validateConfirmPayment — RM0 + cash proof relaxation', () => {
  const recorded = { ...baseForm, paymentRecorded: true };
  const leg = (over: Partial<import('./handover-helpers').ExtraPayment>) => ({
    uid: 'x', method: 'cash' as const, amount: 500, approvalCode: '',
    merchantProvider: null, installmentMonths: null, slipUploadSessionId: null, ...over,
  });
  it('free RM0 order proceeds with no approval/slip', () => {
    expect(validateConfirmPayment({ ...recorded, paymentMethod: 'cash', amountPaid: 0 }, 0, 0, 0)).toBe(true);
    expect(validateConfirmPayment({ ...recorded, paymentMethod: 'transfer', amountPaid: 0 }, 0, 0, 0)).toBe(true);
  });
  it('cash payment proceeds with no approval/slip', () => {
    expect(validateConfirmPayment({ ...recorded, paymentMethod: 'cash', amountPaid: 1000 }, 1000, 0, 0)).toBe(true);
  });
  it('non-cash still requires approval + slip', () => {
    expect(validateConfirmPayment({ ...recorded, paymentMethod: 'transfer', amountPaid: 1000 }, 1000, 0, 0)).toBe(false);
    expect(validateConfirmPayment({ ...recorded, paymentMethod: 'transfer', amountPaid: 1000, approvalCode: 'A1' }, 1000, 0, 0)).toBe(false);
    expect(validateConfirmPayment({ ...recorded, paymentMethod: 'transfer', amountPaid: 1000, approvalCode: 'A1', slipUploadSessionId: 's1' }, 1000, 0, 0)).toBe(true);
  });
  it('split: a cash leg lacking proof passes; a non-cash leg lacking proof fails', () => {
    expect(validateConfirmPayment({ ...recorded, paymentMethod: 'cash', amountPaid: 500, extraPayments: [leg({})] }, 1000, 0, 0)).toBe(true);
    expect(validateConfirmPayment({ ...recorded, paymentMethod: 'cash', amountPaid: 500, extraPayments: [leg({ method: 'transfer' })] }, 1000, 0, 0)).toBe(false);
  });
  it('split primary leg must be > 0', () => {
    expect(validateConfirmPayment({ ...recorded, paymentMethod: 'cash', amountPaid: 0, extraPayments: [leg({ amount: 1000 })] }, 1000, 0, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @2990s/pos exec vitest run src/lib/handover-helpers.test.ts`
Expected: FAIL — `paymentProofRequired` not exported + the relaxation cases fail under the current strict gate.

- [ ] **Step 3: Implement**

In `handover-helpers.ts`, **replace** the `extraPaymentComplete` block (the JSDoc + the `export const extraPaymentComplete = …` chain ending in `&& p.slipUploadSessionId !== null;`) with:

```ts
/** Approval code + payment slip are required only for a payment that is BOTH
 *  non-zero AND non-cash (Loo 2026-06-18). Cash never needs proof; a zero payment
 *  (free RM0 order / nothing collected now) needs none either. Shared by the
 *  primary payment, each split row, and the ConfirmPaymentStep required-markers
 *  so the three can't drift. */
export const paymentProofRequired = (method: string, amount: number): boolean =>
  amount > 0 && method !== 'cash';

/** Per-row completeness — method picked, positive amount, the method-scoped
 *  sub-field (bank / term), and (only for a non-cash row) approval code + slip. */
export const extraPaymentComplete = (p: ExtraPayment): boolean =>
  Boolean(p.method)
  && p.amount > 0
  && (p.method !== 'merchant' || p.merchantProvider != null)
  && (p.method !== 'installment' || p.installmentMonths != null)
  && (!paymentProofRequired(p.method, p.amount)
      || (p.approvalCode.trim().length > 0 && p.slipUploadSessionId !== null));
```

In `validateConfirmPayment`, **replace** the body from `if (f.amountPaid <= 0) return false;` through `if (f.slipUploadSessionId === null) return false;  // slip / proof compulsory for ALL payment methods` with:

```ts
  if (f.amountPaid < 0) return false;                                        // allow exactly 0 (free order / nothing now)
  if ((f.extraPayments?.length ?? 0) > 0 && f.amountPaid <= 0) return false; // a split's primary leg must be a real payment
  if (collected < halfTotal || collected > total) return false;             // ≥50% floor unchanged → still gates paid orders
  if (!(f.extraPayments ?? []).every(extraPaymentComplete)) return false;
  if (!f.paymentRecorded) return false;
  // Approval code + slip only for a non-zero, non-cash payment (Loo 2026-06-18).
  if (paymentProofRequired(f.paymentMethod, f.amountPaid)) {
    if (f.approvalCode.trim().length === 0) return false;
    if (f.slipUploadSessionId === null) return false;
  }
```

In `confirmPaymentBlockers`, **replace** the `extras.forEach(…)` block and the two trailing `if (!f.approvalCode.trim())` / `if (f.slipUploadSessionId === null)` pushes with:

```ts
  extras.forEach((p, i) => {
    if (extraPaymentComplete(p)) return;
    const needsProof = paymentProofRequired(p.method, p.amount);
    const bits = ['pick method', 'amount'];
    if (needsProof) bits.push('approval code');
    let msg = `Payment ${i + 2}: ${bits.join(', ')}`;
    if (p.method === 'merchant') msg += ' (and merchant)';
    else if (p.method === 'installment') msg += ' (and term)';
    if (needsProof && p.slipUploadSessionId === null) msg += ' (and slip)';
    b.push(msg);
  });
  if (paymentProofRequired(f.paymentMethod, f.amountPaid)) {
    if (!f.approvalCode.trim()) b.push('Approval code required');
    if (f.slipUploadSessionId === null) b.push('Payment slip / proof required');
  }
```

(The `if (extras.length > 0 && f.amountPaid <= 0) b.push('First payment amount required');` line above stays as-is.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @2990s/pos exec vitest run src/lib/handover-helpers.test.ts`
Expected: PASS — new cases green, existing handover-helpers cases still green.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/lib/handover-helpers.ts apps/pos/src/lib/handover-helpers.test.ts
git commit -m "feat(pos): approval+slip required only for non-zero non-cash payments"
```

---

### Task 2: Dynamic required markers in ConfirmPaymentStep

**Files:**
- Modify: `apps/pos/src/components/handover/ConfirmPaymentStep.tsx`

**Interfaces:**
- Consumes: `paymentProofRequired` from `../../lib/handover-helpers` (Task 1).

- [ ] **Step 1: Add the import**

Change line 8:

```ts
import { collectedTotal, type HandoverForm, type ExtraPayment } from '../../lib/handover-helpers';
```

to:

```ts
import { collectedTotal, paymentProofRequired, type HandoverForm, type ExtraPayment } from '../../lib/handover-helpers';
```

- [ ] **Step 2: Primary "Approval code" label (≈L134)**

Replace `<Field label="Approval code *">` (the PRIMARY one, just before the `<input value={form.approvalCode}…`) with:

```tsx
      <Field label={`Approval code${paymentProofRequired(form.paymentMethod, form.amountPaid) ? ' *' : ''}`}>
```

- [ ] **Step 3: Primary slip required span (≈L276-278)**

Replace:

```tsx
      <h3 className="subTitle">
        Payment 1 slip / proof <span className={styles.required}>*</span>
      </h3>
```

with:

```tsx
      <h3 className="subTitle">
        Payment 1 slip / proof{paymentProofRequired(form.paymentMethod, form.amountPaid)
          ? <span className={styles.required}> *</span> : null}
      </h3>
```

- [ ] **Step 4: Split-row "Approval code" label (≈L190)**

Inside `extras.map((p, i) => (…))`, replace the extra row's `<Field label="Approval code *">` (the one before `<input value={p.approvalCode}…`) with:

```tsx
          <Field label={`Approval code${paymentProofRequired(p.method, p.amount) ? ' *' : ''}`}>
```

- [ ] **Step 5: Split-row slip label (≈L242)**

Replace `<Field label={`Payment ${i + 2} slip / proof *`}>` with:

```tsx
            <Field label={`Payment ${i + 2} slip / proof${paymentProofRequired(p.method, p.amount) ? ' *' : ''}`}>
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS, zero errors.

- [ ] **Step 7: Commit**

```bash
git add apps/pos/src/components/handover/ConfirmPaymentStep.tsx
git commit -m "feat(pos): handover required-markers reflect cash/RM0 proof rule"
```

---

### Task 3: Split-payment payload omits slip for cash legs

**Files:**
- Modify: `apps/pos/src/pages/Handover.tsx` (`submitHandoffToSo`, the `payments[]` builder)

**Interfaces:** none new.

- [ ] **Step 1: Primary split row — make uploadSessionId conditional (≈L403)**

Replace:

```ts
                  uploadSessionId: form.slipUploadSessionId!,
```

with:

```ts
                  // Cash legs may carry no slip (Loo 2026-06-18) — include only when present.
                  ...(form.slipUploadSessionId ? { uploadSessionId: form.slipUploadSessionId } : {}),
```

(Also delete/replace the now-stale comment just above it — the 3-line "Spec D4 … Non-null is airtight…" block at ≈L397-402 — with a one-liner: `// Spec D4 — each row's own slip; cash legs may have none (optional now).`)

- [ ] **Step 2: Extra split rows — make uploadSessionId conditional (≈L415)**

Replace:

```ts
                  uploadSessionId: p.slipUploadSessionId!,
```

with:

```ts
                  ...(p.slipUploadSessionId ? { uploadSessionId: p.slipUploadSessionId } : {}),
```

(Likewise trim the stale "Non-null is airtight…" comment just above to: `// Spec D4 — each extra's own slip; cash legs may have none (optional now).`)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS, zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/pages/Handover.tsx
git commit -m "feat(pos): split-payment payload omits slip session for cash legs"
```

---

### Task 4: Server accepts cash split legs without a slip

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts` (the `payments[]` block, ≈L2846-2908 + promote ≈L3112)

**Interfaces:** none new (server internal).

- [ ] **Step 1: Widen the `posPayments` type (≈L2846-2853)**

Change the declared row type's `uploadSessionId: string;` to:

```ts
    uploadSessionId?: string | null;
```

- [ ] **Step 2: Zod — slip optional, required only for non-cash (≈L2855-2862)**

Replace:

```ts
    const parsed = z.array(z.object({
      method:            z.enum(['merchant', 'transfer', 'cash', 'installment']),
      amountCenti:       z.number().int().positive(),
      approvalCode:      z.string().optional().nullable(),
      merchantProvider:  z.string().trim().min(1).optional().nullable(),
      installmentMonths: z.number().int().min(0).max(60).optional().nullable(),
      uploadSessionId:   z.string().min(1),        // spec D4 — one slip per payment
    })).min(1).max(10).safeParse(body.payments);
```

with:

```ts
    const parsed = z.array(z.object({
      method:            z.enum(['merchant', 'transfer', 'cash', 'installment']),
      amountCenti:       z.number().int().positive(),
      approvalCode:      z.string().optional().nullable(),
      merchantProvider:  z.string().trim().min(1).optional().nullable(),
      installmentMonths: z.number().int().min(0).max(60).optional().nullable(),
      // Cash needs no slip (Loo 2026-06-18); every other method still must carry one.
      uploadSessionId:   z.string().min(1).optional().nullable(),
    }).refine(
      (p) => p.method === 'cash' || (typeof p.uploadSessionId === 'string' && p.uploadSessionId.length > 0),
      { path: ['uploadSessionId'], message: 'Slip required for a non-cash payment.' },
    )).min(1).max(10).safeParse(body.payments);
```

- [ ] **Step 3: Slip resolution — null-aware, per row (≈L2878-2909)**

Replace the whole `let posPaymentSlipKeys: string[] | null = null; if (posPayments) { … }` block with:

```ts
  let posPaymentSlipKeys: (string | null)[] | null = null;
  if (posPayments) {
    // Cash rows carry no slip (Loo 2026-06-18); resolve only the rows that do.
    const sessioned = posPayments
      .map((p, i) => ({ i, sid: p.uploadSessionId }))
      .filter((x): x is { i: number; sid: string } => typeof x.sid === 'string' && x.sid.length > 0);
    const sessionIds = sessioned.map((x) => x.sid);
    if (new Set(sessionIds).size !== sessionIds.length) {
      await rollbackPwpClaims();
      return c.json({ error: 'slip_required', reason: 'Each payment needs its own slip.' }, 400);
    }
    posPaymentSlipKeys = posPayments.map(() => null);
    if (sessionIds.length > 0) {
      const { data: slipRows, error: slipRowsErr } = await sb
        .from('pending_slip_uploads')
        .select('upload_session_id, r2_key, status')
        .in('upload_session_id', sessionIds);
      if (slipRowsErr) {
        await rollbackPwpClaims();
        return c.json({ error: 'lookup_failed', reason: slipRowsErr.message }, 500);
      }
      const slipById = new Map((slipRows ?? []).map((r) => {
        const t = r as { upload_session_id: string; r2_key: string | null; status: string };
        return [t.upload_session_id, t] as const;
      }));
      for (const { i, sid } of sessioned) {
        const row = slipById.get(sid);
        if (!row || row.status !== 'uploaded' || !row.r2_key) {
          await rollbackPwpClaims();
          return c.json({
            error: 'slip_required',
            reason: `Payment ${i + 1} slip missing or not uploaded.`,
          }, 400);
        }
        posPaymentSlipKeys[i] = row.r2_key;
      }
    }
  }
```

(The booking line `slip_key: posPaymentSlipKeys![i]` at ≈L3089 needs NO change — the element type is now `string | null` and the `slip_key` column is nullable, so a cash leg books `null`.)

- [ ] **Step 4: Promote — guard against a missing session (≈L3112-3124)**

Wrap the promote UPDATE + its loud-log in a session guard. Replace:

```ts
      const { data: promoted, error: promoteErr } = await sb
        .from('pending_slip_uploads')
        .update({ status: 'promoted', promoted_at: new Date().toISOString() })
        .eq('upload_session_id', p.uploadSessionId)
        .select('upload_session_id');
      if (promoteErr || !promoted || promoted.length === 0) {
        // eslint-disable-next-line no-console
        console.error(
          `[so-create] slip promote FAILED for session ${p.uploadSessionId} on ${docNo}: `
          + (promoteErr?.message ?? 'no row matched (RLS uploader mismatch?)')
          + ' — slip will be reaped after TTL; replay window open until then.',
        );
      }
```

with:

```ts
      // Cash rows carry no slip session → nothing to promote (Loo 2026-06-18).
      if (p.uploadSessionId) {
        const { data: promoted, error: promoteErr } = await sb
          .from('pending_slip_uploads')
          .update({ status: 'promoted', promoted_at: new Date().toISOString() })
          .eq('upload_session_id', p.uploadSessionId)
          .select('upload_session_id');
        if (promoteErr || !promoted || promoted.length === 0) {
          // eslint-disable-next-line no-console
          console.error(
            `[so-create] slip promote FAILED for session ${p.uploadSessionId} on ${docNo}: `
            + (promoteErr?.message ?? 'no row matched (RLS uploader mismatch?)')
            + ' — slip will be reaped after TTL; replay window open until then.',
          );
        }
      }
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS, zero errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/mfg-sales-orders.ts
git commit -m "feat(api): split-payment path accepts cash legs without a slip"
```

---

### Task 5: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Workspace typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages.

- [ ] **Step 2: Handover unit tests**

Run: `pnpm --filter @2990s/pos exec vitest run src/lib/handover-helpers.test.ts`
Expected: PASS — the new `paymentProofRequired` + `validateConfirmPayment` relaxation cases and all pre-existing cases.

- [ ] **Step 3: Manual checklist (record in the PR)**

Reason through / spot-check (no HTTP harness for the route):
  1. Free RM0 order → Confirm payment reaches "Continue to signature" with no approval code and no slip; submit succeeds (legacy path, deposit 0, slip null).
  2. Single cash sale (amount > 0) → no approval code, no slip required; submit succeeds (legacy path).
  3. Single transfer/merchant/installment (amount > 0) → approval code + slip still required (unchanged).
  4. Split with a cash leg lacking a slip → no `invalid_payments` / `slip_required` 400; the cash row books `slip_key = null`. A non-cash leg lacking a slip is still rejected.

- [ ] **Step 4: Clean tree check**

Run: `git status`
Expected: clean (all changes committed in Tasks 1-4).

---

## Deployment (after implement + review)

Same branch `free-item-no-delivery-fee`, folded into **PR #685** (retitle to cover both the delivery-fee waiver and this payment-proof relaxation). Deploy from the worktree: **API Worker first** (`wrangler deploy` in `apps/api`), **then POS Pages** (build with prod `VITE_*`, verify bundle, `wrangler pages deploy apps/pos/dist --project-name=2990s-pos --branch=main`). Remind Loo to **hard-refresh the POS PWA**.
