# POS Proceed-state edit + customer-change PWP recalc — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let POS sales edit Customer / Delivery Address / Payment on a Proceeded SO (whole Proceed lane) with a Save button — items stay locked behind the #589 un-proceed flow — and when a Save re-points the order to a different customer, strip its PWP promo back to normal price and clean up the vouchers.

**Architecture:** Relax the server's wholesale processing-date lock to a field-scoped one (only the two schedule-date columns freeze). Detect a customer change by re-resolving `customer_id` from name+phone (same RPC as create); on a real change, replicate the proven tbc-swap reward-revert machinery to reprice PWP reward lines to normal and delete/release the SO's vouchers. POS gates editability via a pure `getSoEditScope` helper and opts into the strip with a `recustomer` flag.

**Tech Stack:** Hono on CF Workers (api), Vite+React (pos), Supabase Postgres, vitest. Spec: `docs/specs/2026-06-13-pos-proceed-edit-spec.md`.

**Base:** worktree `feat/pos-proceed-status-edit` off `origin/main` @ c1310c4 (has #589 + #590).

---

## File structure

- **Create** `apps/pos/src/lib/so-edit-scope.ts` — pure edit-scope helper.
- **Create** `apps/pos/src/lib/so-edit-scope.test.ts` — its unit test.
- **Create** `apps/api/src/lib/pwp-customer-change.ts` — pure voucher classifier.
- **Create** `apps/api/src/lib/pwp-customer-change.test.ts` — its unit test.
- **Modify** `apps/pos/src/pages/OrderStatus.tsx` — UI gating across the Proceed lane; `recustomer` flag; `hasPwp` confirm; notice; error text.
- **Modify** `apps/api/src/routes/mfg-sales-orders.ts` — field-scoped processing lock; `/mine` `has_pwp`; customer re-resolve + `stripPwpForCustomerChange` in PATCH.

---

## Task 1: POS edit-scope helper (pure)

**Files:**
- Create: `apps/pos/src/lib/so-edit-scope.ts`
- Test: `apps/pos/src/lib/so-edit-scope.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/pos/src/lib/so-edit-scope.test.ts
import { describe, it, expect } from 'vitest';
import { getSoEditScope } from './so-edit-scope';

describe('getSoEditScope', () => {
  it('Order placed (CONFIRMED, not proceeded) → full edit', () => {
    const s = getSoEditScope({ status: 'CONFIRMED', proceededAt: null });
    expect(s).toEqual({ isDeliveredLane: false, editablePlaced: true, editableProceed: false, canEditDetails: true });
  });
  it('Proceed (CONFIRMED + proceeded) → details only, not placed', () => {
    const s = getSoEditScope({ status: 'CONFIRMED', proceededAt: '2026-06-13T00:00:00Z' });
    expect(s.editablePlaced).toBe(false);
    expect(s.editableProceed).toBe(true);
    expect(s.canEditDetails).toBe(true);
  });
  it.each(['IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED'])('%s → Proceed lane, details editable', (status) => {
    const s = getSoEditScope({ status, proceededAt: null });
    expect(s.editableProceed).toBe(true);
    expect(s.editablePlaced).toBe(false);
    expect(s.canEditDetails).toBe(true);
  });
  it.each(['DELIVERED', 'INVOICED', 'CLOSED'])('%s → delivered lane, nothing editable', (status) => {
    const s = getSoEditScope({ status, proceededAt: '2026-06-13T00:00:00Z' });
    expect(s.isDeliveredLane).toBe(true);
    expect(s.canEditDetails).toBe(false);
    expect(s.editablePlaced).toBe(false);
    expect(s.editableProceed).toBe(false);
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `pnpm --filter @2990s/pos test -- so-edit-scope`
Expected: FAIL — `Cannot find module './so-edit-scope'`.

- [ ] **Step 3: Implement**

```ts
// apps/pos/src/lib/so-edit-scope.ts
/* Which parts of an SO drawer are editable, by lane.
   - Order placed (CONFIRMED, !proceeded): items + dates + customer/address/payment.
   - Proceed lane (CONFIRMED+proceeded, IN_PRODUCTION, READY_TO_SHIP, SHIPPED):
     customer/address/payment only — items + dates locked (un-proceed to edit).
   - Delivered (DELIVERED/INVOICED/CLOSED): nothing (managed in backend).
   ON_HOLD/CANCELLED never reach the POS board (excluded server-side in /mine). */
export type SoEditScope = {
  isDeliveredLane: boolean;
  editablePlaced: boolean;
  editableProceed: boolean;
  canEditDetails: boolean;
};

export function getSoEditScope(input: { status: string; proceededAt: string | null }): SoEditScope {
  const isDeliveredLane = ['DELIVERED', 'INVOICED', 'CLOSED'].includes(input.status);
  const editablePlaced = input.status === 'CONFIRMED' && !input.proceededAt;
  const editableProceed = !isDeliveredLane && !editablePlaced;
  return {
    isDeliveredLane,
    editablePlaced,
    editableProceed,
    canEditDetails: editablePlaced || editableProceed,
  };
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `pnpm --filter @2990s/pos test -- so-edit-scope`
Expected: PASS (4 test blocks).

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/lib/so-edit-scope.ts apps/pos/src/lib/so-edit-scope.test.ts
git commit -m "feat(pos): pure getSoEditScope helper for Proceed-lane editability"
```

---

## Task 2: Wire edit-scope into the OrderStatus drawer

**Files:**
- Modify: `apps/pos/src/pages/OrderStatus.tsx`

No new unit test (component wiring); verified by typecheck + the Task 1 test + manual. Make these exact edits.

- [ ] **Step 1: Import the helper** (top imports, near the other `../lib` imports ~line 47)

```ts
import { getSoEditScope } from '../lib/so-edit-scope';
```

- [ ] **Step 2: Replace the single `editable` (line 1156)**

```ts
// was: const editable = order.status === 'CONFIRMED' && !order.proceededAt;
const { editablePlaced, canEditDetails } = getSoEditScope(order);
```

- [ ] **Step 3: Rename item/date/Move-to-Proceed gates `editable` → `editablePlaced`**

In the Items section, the pencil + `TbcLineEditor` render gates (lines ~1521, ~1533) use `editable` — change both to `editablePlaced`.
The footer checklist + `Save changes` + `Move to Proceed` block (lines ~1855) currently gate on `editable` — see Step 6.

- [ ] **Step 4: Customer + Address fields → `canEditDetails`**

In the Customer section (lines ~1568-1589) and the Address section's text/select fields (lines ~1604-1631): change each `disabled={!editable}` to `disabled={!canEditDetails}` (keep the extra `|| !edited.customerState` / `|| !edited.customerCity` on city/postcode).

- [ ] **Step 5: Date fields stay `editablePlaced`; Payment form → `canEditDetails`**

- Processing date + Delivery date inputs (lines ~1669-1690): `disabled={!editablePlaced}` (D4 — locked in Proceed).
- Payment record-payment block gate (line ~1733): `{editablePlaced && outstanding > 0 && (` → `{canEditDetails && outstanding > 0 && (`.

- [ ] **Step 6: Footer — split Save/Proceed vs un-proceed vs locked**

Replace the footer's `{editable && ( … )}` block (lines ~1855-1894) so `Save changes` shows on `canEditDetails && dirty`, while `Move to Proceed` + the checklist stay on `editablePlaced`:

```tsx
{(editablePlaced || canEditDetails) && (
  <>
    {editablePlaced && (
      <div className={styles.detailChecklist}>
        <ChecklistItem ok={customerInfoOk} label="Customer info" />
        <ChecklistItem ok={addressOk} label="Delivery address" />
        <ChecklistItem ok={dateOk} label="Delivery date" />
        <ChecklistItem ok={paidOk} label="≥ 50% paid" />
      </div>
    )}
    {saveMutation.error && (
      <p className={styles.detailFootError}>Save failed: {describeSoActionError(saveMutation.error)}</p>
    )}
    {proceedMutation.error && (
      <p className={styles.detailFootError}>Proceed failed: {describeSoActionError(proceedMutation.error)}</p>
    )}
    {saveMutation.data?.pwpStripped ? (
      <p className={styles.detailFootInfo}>
        Customer changed · PWP promo removed, {String(saveMutation.data.rewardsReset)} line(s) repriced to normal.
      </p>
    ) : null}
    <div className={styles.detailCta}>
      <button
        type="button"
        className={styles.detailSaveBtn}
        onClick={onSave}
        disabled={!dirty || saveMutation.isPending || proceedMutation.isPending}
      >
        <Save size={14} strokeWidth={1.75} />
        {saveMutation.isPending ? 'Saving…' : 'Save changes'}
      </button>
      {editablePlaced && (
        <button
          type="button"
          className={styles.detailProceedBtn}
          onClick={onProceed}
          disabled={!allOk || saveMutation.isPending || proceedMutation.isPending}
        >
          Move to Proceed
          <ArrowRight size={14} strokeWidth={1.75} />
        </button>
      )}
    </div>
  </>
)}
{/* un-proceed (unchanged) — only when NOT placed-editable and allowed */}
{!editablePlaced && canUnproceed && ( /* …existing Move to Order placed block… */ )}
{!editablePlaced && !canUnproceed && !canEditDetails && (
  <span className={styles.detailFootInfo}>
    {LANES[2]?.matches.includes(order.status) ? 'Delivered · managed in backend' : 'Locked · coordinator handling'}
  </span>
)}
```

> Note: `saveMutation.data` typing is added in Task 6 Step 3 (the mutation returns the PATCH JSON). Until then `saveMutation.data?.pwpStripped` is typed `unknown` — the `String(...)` cast keeps it compiling; Task 6 makes it precise.

- [ ] **Step 7: Verify the un-proceed block still references `canUnproceed`**

`canUnproceed` (line 1223) is unchanged. Confirm the only remaining `editable` identifier in the file is gone (all renamed to `editablePlaced`/`canEditDetails`).

Run: `pnpm --filter @2990s/pos exec tsc --noEmit`
Expected: no errors (re: `editable` undefined).

- [ ] **Step 8: Commit**

```bash
git add apps/pos/src/pages/OrderStatus.tsx
git commit -m "feat(pos): edit customer/address/payment across the Proceed lane (items+dates stay locked)"
```

---

## Task 3: API — field-scoped processing-date lock

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts`

- [ ] **Step 1: Add the locked-columns constant** (right after `SO_IDENTITY_LOCK_COLS`, ~line 167)

```ts
/* Owner 2026-06-12 + Loo 2026-06-13 — after the processing date passes the SO is
   what we PO to the supplier, so the PRODUCTION-SCHEDULE columns freeze. But
   customer / delivery-address / payment header fields don't feed the supplier PO
   and stay editable in the Proceed lane (POS "edit in Proceed"). Items have their
   own per-route processing lock, so only these two date columns belong here. */
const SO_PROCESSING_LOCK_COLS = new Set<string>([
  'internal_expected_dd', 'customer_delivery_date',
]);
```

- [ ] **Step 2: Make the PATCH guard field-scoped** (lines 3456-3458)

```ts
// was: if (soProcessingLocked(before …)) return c.json(SO_PROCESSING_LOCKED_RESPONSE, 409);
if (soProcessingLocked(before as unknown as { internal_expected_dd?: string | null; processing_date?: string | null } | null)) {
  const beforeRowProc = before as unknown as Record<string, unknown>;
  const changedSchedule = [...SO_PROCESSING_LOCK_COLS].filter(
    (col) => col in updates && norm(updates[col]) !== norm(beforeRowProc[col]),
  );
  if (changedSchedule.length > 0) return c.json(SO_PROCESSING_LOCKED_RESPONSE, 409);
}
```

> The item write routes (`POST/PATCH/DELETE /items`, `tbc-*`, override) keep their
> own `soProcessingLockBlocked` calls — items stay frozen post-proc-date. Don't touch them.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/api exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/mfg-sales-orders.ts
git commit -m "feat(api): field-scoped processing lock — only schedule dates freeze post-proc-date"
```

---

## Task 4: API — pure PWP voucher classifier

**Files:**
- Create: `apps/api/src/lib/pwp-customer-change.ts`
- Test: `apps/api/src/lib/pwp-customer-change.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/lib/pwp-customer-change.test.ts
import { describe, it, expect } from 'vitest';
import { classifyPwpVouchersForCustomerChange } from './pwp-customer-change';

const SO = 'SO-2606-004';
describe('classifyPwpVouchersForCustomerChange', () => {
  it('same-order promo (minted+redeemed here) → delete', () => {
    const r = classifyPwpVouchersForCustomerChange(
      [{ code: 'A', status: 'USED', source_doc_no: SO, redeemed_doc_no: SO }], SO);
    expect(r).toEqual({ deleteCodes: ['A'], releaseCodes: [] });
  });
  it('cross-order voucher redeemed here → release', () => {
    const r = classifyPwpVouchersForCustomerChange(
      [{ code: 'B', status: 'USED', source_doc_no: 'SO-2606-001', redeemed_doc_no: SO }], SO);
    expect(r).toEqual({ deleteCodes: [], releaseCodes: ['B'] });
  });
  it('minted here + still AVAILABLE (unused, old customer) → delete', () => {
    const r = classifyPwpVouchersForCustomerChange(
      [{ code: 'C', status: 'AVAILABLE', source_doc_no: SO, redeemed_doc_no: null }], SO);
    expect(r).toEqual({ deleteCodes: ['C'], releaseCodes: [] });
  });
  it('unrelated code (other SO) → untouched', () => {
    const r = classifyPwpVouchersForCustomerChange(
      [{ code: 'D', status: 'AVAILABLE', source_doc_no: 'SO-2606-009', redeemed_doc_no: null }], SO);
    expect(r).toEqual({ deleteCodes: [], releaseCodes: [] });
  });
  it('empty input → empty result', () => {
    expect(classifyPwpVouchersForCustomerChange([], SO)).toEqual({ deleteCodes: [], releaseCodes: [] });
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `pnpm --filter @2990s/api test -- pwp-customer-change`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/lib/pwp-customer-change.ts
/* When an SO is re-pointed to a different customer, its PWP entanglement must be
   undone (Loo 2026-06-13). The reward lines reprice to normal in the route (it
   re-derives the price off recomputeFromSnapshot); this pure helper decides what
   happens to each pwp_codes voucher tied to the SO. Mirrors Loo's tbc-swap
   precedent: dead vouchers are DELETEd; a cross-order voucher merely redeemed on
   this SO is RELEASEd back to its real owner (status AVAILABLE, redeemed_doc_no
   cleared). */
export type PwpVoucherRow = {
  code: string;
  status: string;
  source_doc_no: string | null;
  redeemed_doc_no: string | null;
};

export function classifyPwpVouchersForCustomerChange(
  codes: PwpVoucherRow[],
  docNo: string,
): { deleteCodes: string[]; releaseCodes: string[] } {
  const deleteCodes: string[] = [];
  const releaseCodes: string[] = [];
  for (const c of codes) {
    const mintedHere = c.source_doc_no === docNo;
    const redeemedHere = c.redeemed_doc_no === docNo;
    if (redeemedHere && mintedHere) deleteCodes.push(c.code);            // same-order promo → gone
    else if (redeemedHere && !mintedHere) releaseCodes.push(c.code);     // cross-order voucher → back to owner
    else if (mintedHere && c.status === 'AVAILABLE') deleteCodes.push(c.code); // minted here, unused, old customer → gone
    // else: not tied to this SO's earn/spend → leave it
  }
  return { deleteCodes, releaseCodes };
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `pnpm --filter @2990s/api test -- pwp-customer-change`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/pwp-customer-change.ts apps/api/src/lib/pwp-customer-change.test.ts
git commit -m "feat(api): pure classifier for an SO's PWP vouchers on customer change"
```

---

## Task 5: API — customer re-resolve + PWP strip in PATCH

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts`

Reuses existing module-scoped helpers: `planSofaRewardRevert` (line 4986), the
loaders `loadProductByCode` / `loadFabricByCode` / `loadFabricSellingTiers` /
`loadMaintenanceConfig` / `loadFabricTierAddonConfig` / `loadSpecialAddons`,
`recomputeFromSnapshot`, `buildVariantSummary`, `recomputeTotals`, `recordSoAudit`.

- [ ] **Step 1: Import the classifier** (top of file, with the other `../lib` imports)

```ts
import { classifyPwpVouchersForCustomerChange, type PwpVoucherRow } from '../lib/pwp-customer-change';
```

- [ ] **Step 2: Add `stripPwpForCustomerChange` helper** (place it just BEFORE the PATCH `/:docNo` handler, ~line 3313, after `planSofaRewardRevert`'s siblings are all defined — `planSofaRewardRevert` is at 4986 which is AFTER this point, so instead place this helper right AFTER `planSofaRewardRevert` ends, ~line 5085, and hoist via function declaration so the PATCH can call it).

```ts
/* Loo 2026-06-13 — when a PATCH re-points an SO to a different customer, undo its
   PWP promo: reward lines reprice to normal (no PWP grant) and the SO's vouchers
   are deleted/released. Plans the sofa reverts read-only first (returns ok:false
   if any can't be safely repriced) so the caller can 409 before touching the
   header. Replicates the proven tbc-swap revert block (non-sofa) + calls the
   existing planSofaRewardRevert (sofa). */
type PwpStripPlan = {
  nonSofa: Array<{ id: string; item_code: string; item_group: string; qty: number; discount_centi: number; unit_cost_centi: number; variants: Record<string, unknown> }>;
  sofaUpdates: SofaRewardRevertUpdate[];
};
async function planPwpStrip(sb: any, docNo: string): Promise<{ ok: true; plan: PwpStripPlan } | { ok: false }> {
  const { data } = await sb.from('mfg_sales_order_items')
    .select('id, item_code, item_group, qty, discount_centi, unit_cost_centi, variants')
    .eq('doc_no', docNo).eq('cancelled', false);
  type Row = { id: string; item_code: string; item_group: string; qty: number; discount_centi: number | null; unit_cost_centi: number | null; variants: Record<string, unknown> | null };
  const rows = ((data ?? []) as Row[]).filter((r) => ((r.variants ?? {}) as Record<string, unknown>).pwp);
  const nonSofa = rows
    .filter((r) => String(r.item_group) !== 'sofa')
    .map((r) => ({ id: r.id, item_code: r.item_code, item_group: String(r.item_group), qty: Number(r.qty), discount_centi: Number(r.discount_centi ?? 0), unit_cost_centi: Number(r.unit_cost_centi ?? 0), variants: (r.variants ?? {}) as Record<string, unknown> }));
  // Distinct pwpCode among sofa reward lines → one revert plan per build.
  const sofaCodes = Array.from(new Set(
    rows.filter((r) => String(r.item_group) === 'sofa')
        .map((r) => String(((r.variants ?? {}) as Record<string, unknown>).pwpCode ?? '').trim())
        .filter(Boolean),
  ));
  const sofaUpdates: SofaRewardRevertUpdate[] = [];
  for (const code of sofaCodes) {
    const res = await planSofaRewardRevert(sb, docNo, code);
    if (!res.ok) return { ok: false };
    sofaUpdates.push(...res.updates);
  }
  return { ok: true, plan: { nonSofa, sofaUpdates } };
}

async function applyPwpStrip(
  sb: any, docNo: string, plan: PwpStripPlan, user: { id: string },
): Promise<{ rewardsReset: number; deleteCodes: string[]; releaseCodes: string[] }> {
  let rewardsReset = 0;
  // 1. Non-sofa reward lines → revert to normal (tbc-swap 4849-4880 pattern).
  if (plan.nonSofa.length > 0) {
    const [cfgX, addonCfgX, specialDefsX] = await Promise.all([
      loadMaintenanceConfig(sb), loadFabricTierAddonConfig(sb), loadSpecialAddons(sb),
    ]);
    for (const line of plan.nonSofa) {
      const v: Record<string, unknown> = { ...line.variants };
      delete v.pwp; delete v.pwpCode; delete v.pwpTriggerLabel;
      const [rp, rfab, rtiers] = await Promise.all([
        loadProductByCode(sb, line.item_code),
        loadFabricByCode(sb, (v.fabricCode as string | undefined) ?? null),
        loadFabricSellingTiers(sb, (v.fabricId as string | undefined) ?? null),
      ]);
      const rec = recomputeFromSnapshot(
        { itemCode: line.item_code, itemGroup: line.item_group, qty: line.qty, unitPriceCenti: 0, variants: v as MfgItemForRecompute['variants'] },
        rp, rfab, cfgX, null, null, rtiers, addonCfgX, null, null, specialDefsX, null,
      );
      const revertUnit = rec.unit_price_sen > 0 ? rec.unit_price_sen : 0;
      if (revertUnit <= 0) continue; // can't reprice a non-sofa reward → leave it (rare; logged)
      const lTotal = (line.qty * revertUnit) - line.discount_centi;
      await sb.from('mfg_sales_order_items').update({
        variants: v,
        description2: buildVariantSummary(line.item_group, v) || null,
        unit_price_centi: revertUnit,
        total_centi: lTotal,
        total_inc_centi: lTotal,
        balance_centi: lTotal,
        line_margin_centi: lTotal - (line.unit_cost_centi * line.qty),
        divan_price_sen: rec.breakdown.divanSurchargeSen,
        leg_price_sen: rec.breakdown.legSurchargeSen,
        special_order_price_sen: rec.breakdown.specialsSurchargeSen,
        custom_specials: rec.custom_specials ?? null,
      }).eq('id', line.id);
      rewardsReset++;
    }
  }
  // 2. Sofa reward builds → apply pre-computed revert updates.
  for (const u of plan.sofaUpdates) {
    await sb.from('mfg_sales_order_items').update({
      unit_price_centi: u.unit_price_centi,
      total_centi: u.total_centi,
      total_inc_centi: u.total_centi,
      balance_centi: u.total_centi,
      line_margin_centi: u.line_margin_centi,
      variants: u.variants,
      description2: u.description2,
      divan_price_sen: u.divan_price_sen,
      leg_price_sen: u.leg_price_sen,
      special_order_price_sen: u.special_order_price_sen,
      custom_specials: u.custom_specials ?? null,
    }).eq('id', u.id);
  }
  if (plan.sofaUpdates.length > 0) rewardsReset += plan.sofaUpdates.length;
  // 3. Vouchers — classify then delete / release.
  const { data: codeRows } = await sb.from('pwp_codes')
    .select('code, status, source_doc_no, redeemed_doc_no')
    .or(`source_doc_no.eq.${docNo},redeemed_doc_no.eq.${docNo}`);
  const { deleteCodes, releaseCodes } = classifyPwpVouchersForCustomerChange(
    ((codeRows ?? []) as PwpVoucherRow[]), docNo,
  );
  if (deleteCodes.length > 0) await sb.from('pwp_codes').delete().in('code', deleteCodes);
  if (releaseCodes.length > 0) {
    await sb.from('pwp_codes').update({ status: 'AVAILABLE', redeemed_doc_no: null, updated_at: new Date().toISOString() })
      .in('code', releaseCodes);
  }
  await recomputeTotals(sb, docNo);
  return { rewardsReset, deleteCodes, releaseCodes };
}
```

> If `planSofaRewardRevert` / `SofaRewardRevertUpdate` are declared *after* this
> point in the file, move these two new `async function` declarations to sit
> immediately AFTER `planSofaRewardRevert` (≈ line 5085). Function declarations
> hoist, so the PATCH handler at 3314 can still call them.

- [ ] **Step 3: Wire customer re-resolve + strip into PATCH `/:docNo`**

Inside the PATCH handler, AFTER the `before` snapshot is read (line 3447) and AFTER the identity-lock check (lines 3511-3526, so a DO/SI still blocks the customer change), but BEFORE the final `update(...)` at line 3528, insert:

```ts
/* Loo 2026-06-13 — POS "Save in Proceed" opt-in. When recustomer is set and the
   name/phone changed, re-resolve customer_id the same way create does. A genuine
   change to a DIFFERENT existing customer strips this SO's PWP back to normal
   (read-only plan first so we can 409 before writing the header). A null→id
   resolve is a legacy backfill, not a swap → no strip. */
let pwpStripPlan: PwpStripPlan | null = null;
let resolvedNewCustomerId: string | null = null;
const beforeRowAll = before as unknown as Record<string, unknown> | null;
const oldCustomerId = (beforeRowAll?.['customer_id'] as string | null) ?? null;
if (body['recustomer'] === true) {
  const nm = typeof body['debtorName'] === 'string' ? (body['debtorName'] as string).trim()
           : typeof body['customerName'] === 'string' ? (body['customerName'] as string).trim() : '';
  const ph = typeof updates['phone'] === 'string' ? (updates['phone'] as string) : null; // already E.164-normalized above
  const nameChanged = nm !== '' && nm !== ((beforeRowAll?.['debtor_name'] as string | null) ?? '');
  const phoneChanged = ph !== null && norm(ph) !== norm(beforeRowAll?.['phone']);
  if ((nameChanged || phoneChanged) && nm && ph) {
    const { data: rid } = await sb.rpc('upsert_customer_by_name_phone', {
      p_name: nm, p_phone: ph,
      p_email: typeof body['email'] === 'string' && (body['email'] as string).trim() ? (body['email'] as string).trim() : null,
    });
    resolvedNewCustomerId = (rid as string | null) ?? null;
    if (resolvedNewCustomerId) {
      updates['customer_id'] = resolvedNewCustomerId; // write the (re)resolved link either way
      if (oldCustomerId && resolvedNewCustomerId !== oldCustomerId) {
        const planned = await planPwpStrip(sb, docNo);
        if (!planned.ok) {
          return c.json({ error: 'pwp_strip_failed', reason: 'This order’s sofa PWP can’t be auto-repriced — ask the coordinator.' }, 409);
        }
        pwpStripPlan = planned.plan;
      }
    }
  }
}
```

> `customer_id` is in `SO_IDENTITY_LOCK_COLS`, so the identity-lock check above
> already 409s the change when a DO/SI exists — we never reach the strip there.

- [ ] **Step 4: Apply the strip after the header UPDATE succeeds**

After the existing `update(updates)` + `if (!data) 404` (line 3530) and BEFORE the
final `return c.json({ ok: true, docNo })` (line 3574), add:

```ts
let pwpStripResult: { rewardsReset: number; deleteCodes: string[]; releaseCodes: string[] } | null = null;
if (pwpStripPlan) {
  pwpStripResult = await applyPwpStrip(sb, docNo, pwpStripPlan, { id: user.id });
}
```

Then change the final return (line 3574) to:

```ts
return c.json({
  ok: true,
  docNo,
  ...(pwpStripResult ? {
    pwpStripped: true,
    rewardsReset: pwpStripResult.rewardsReset,
    vouchersDeleted: pwpStripResult.deleteCodes.length,
    vouchersReleased: pwpStripResult.releaseCodes.length,
    newCustomerId: resolvedNewCustomerId,
  } : {}),
});
```

- [ ] **Step 5: Typecheck + run the api tests**

Run: `pnpm --filter @2990s/api exec tsc --noEmit && pnpm --filter @2990s/api test`
Expected: no type errors; all api tests pass (incl. Task 4).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/mfg-sales-orders.ts
git commit -m "feat(api): re-resolve customer on Save + strip PWP to normal on a customer change"
```

---

## Task 6: POS Save opt-in flag + hasPwp confirm + error legibility; /mine hasPwp

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts` (`/mine` payload)
- Modify: `apps/pos/src/pages/OrderStatus.tsx`

- [ ] **Step 1: Add `has_pwp` to `GET /mine`** (in the item mapper, ~line 854 region that builds each SO's item array)

In the `/mine` handler, when building each SO's response object, add a flag from the raw items' variants (they already carry `variants`):

```ts
// where the per-SO object is assembled in GET /mine:
has_pwp: (itemRows ?? []).some((it) => Boolean((it.variants as { pwp?: unknown } | null)?.pwp)),
```

(Find the object literal returned per SO in `/mine` (~line 880-905) and add the
`has_pwp` key. If items are keyed in a Map, derive from that doc's item list.)

- [ ] **Step 2: Carry `hasPwp` onto `MineSoRow` + `MyOrderRow`**

- `MineSoRow` (line 117): add `has_pwp?: boolean | null;`.
- `MyOrderRow` (line 86): add `hasPwp: boolean;`.
- In the `/mine` mapper (line 318 `return { … }`): add `hasPwp: r.has_pwp ?? false,`.

- [ ] **Step 3: Type the Save mutation result + send `recustomer`** (saveMutation, line 1373)

```ts
const saveMutation = useMutation({
  mutationFn: async (): Promise<{ pwpStripped?: boolean; rewardsReset?: number; vouchersDeleted?: number; vouchersReleased?: number }> => {
    const res = await authedFetch(`/mfg-sales-orders/${order.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...buildPatch(), recustomer: true }),
    });
    return (await res.json()) as { pwpStripped?: boolean; rewardsReset?: number };
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['my-orders'] });
    queryClient.invalidateQueries({ queryKey: ['so-payments', order.id] });
  },
});
```

- [ ] **Step 4: Pre-save confirm when a PWP order's customer changed** (the `onSave` handler, line 1463)

```ts
const onSave = () => {
  const nameOrPhoneChanged =
    edited.customerName !== order.customerName || edited.customerPhone !== order.customerPhone;
  if (order.hasPwp && nameOrPhoneChanged) {
    const ok = window.confirm(
      'Changing the customer will remove this order’s PWP promo and reprice it to normal. Continue?',
    );
    if (!ok) return;
  }
  saveMutation.mutate();
};
```

- [ ] **Step 5: Add `so_locked_processing` + `pwp_strip_failed` to error text** (`describeSoActionError`, line 399)

Add before the final `reason` fallback:

```ts
if (err === 'so_locked_processing') {
  return 'The processing date has passed — dates and items are locked. Customer, address and payment can still be updated.';
}
if (err === 'pwp_strip_failed') {
  return 'This order has a sofa PWP promo that can’t be auto-repriced for a new customer — ask the coordinator.';
}
if (err === 'so_identity_locked') {
  return 'This order already has a delivery order / invoice — customer and address are locked. Payment can still be updated.';
}
```

- [ ] **Step 6: Typecheck both apps**

Run: `pnpm --filter @2990s/pos exec tsc --noEmit && pnpm --filter @2990s/api exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/mfg-sales-orders.ts apps/pos/src/pages/OrderStatus.tsx
git commit -m "feat(pos): opt-in customer re-resolve on Save + PWP-change confirm + clearer lock errors"
```

---

## Task 7: Full quality gates + manual verification

- [ ] **Step 1: Run the whole suite**

Run: `pnpm typecheck && pnpm test && pnpm lint`
Expected: all green. (Known-flaky `slips.test.ts` SSL failures are environmental — ignore per memory.)

- [ ] **Step 2: Build (guarded)**

Run: `ALLOW_LOCAL_API_URL=1 pnpm build`
Expected: success (build-guard satisfied per #590 memory).

- [ ] **Step 3: Manual / staging checklist** (DB-coupled, not unit-tested)

- Proceeded SO (CONFIRMED+proceeded, no DO/SI): customer/address/payment editable + Save works; items pencil hidden; date inputs disabled; `Move to Order placed` still shows before the processing date.
- `IN_PRODUCTION` / `READY_TO_SHIP` SO: customer/address editable only if no DO/SI (else inline `so_identity_locked` message); payment record form always available.
- After the processing date: changing a date → `so_locked_processing`; changing customer/address (no DO/SI) → saves.
- Seeded PWP SO: change name+phone to a different customer → confirm dialog → on Save the reward line(s) reprice UP to normal, vouchers deleted/released, total raised, drawer notice shows.
- Non-PWP SO customer change: saves with no strip, no dialog.

- [ ] **Step 4: Deploy (when Loo approves the PR)**

Per memory: land on `main` HEAD, deploy **API first, then POS**, via `scripts/deploy-*.sh` (never a bare build). Remind Loo to PWA hard-refresh after the POS deploy.

---

## Self-review notes

- **Spec coverage:** D1 strip→Task 4+5; D2 re-resolve→Task 5 Step 3; D3 field lock→Task 3; D4 dates-locked→Task 2 Step 5; D5 Proceed-lane scope→Task 1/2; D6 no status dropdown→(nothing added); D7 identity lock kept→Task 5 Step 3 ordering + Task 6 Step 5 message. `hasPwp` confirm→Task 6.
- **Type consistency:** `getSoEditScope` shape matches Task 2 destructure; `PwpVoucherRow`/`classifyPwpVouchersForCustomerChange` names match Task 5 import; `SofaRewardRevertUpdate`/`planSofaRewardRevert` reused verbatim from existing code (lines 4974/4986); `recomputeFromSnapshot` arg order copied from the live tbc-swap call (line 4857-4860).
- **Open risk:** the non-sofa revert needs `loadProductByCode`/`loadFabricByCode`/`loadFabricSellingTiers`/`loadFabricTierAddonConfig`/`loadSpecialAddons`/`loadMaintenanceConfig` to be module-scoped (they are — used by tbc-swap at 4841-4856). If any is locally scoped inside another handler, hoist it to module scope in Task 5 Step 2.
