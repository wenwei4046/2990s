# POS Proceed-state edit + customer-change PWP recalc — spec

> 2026-06-13 · author: Claude (with Loo)
> Branch: `feat/pos-proceed-status-edit` · worktree base: `origin/main` @ c1310c4 (has #589 un-proceed + #590)

## 1. Goal

In the POS **My orders** drawer, a Sales Order that has already been **Proceeded**
is currently fully read-only ("Locked · coordinator handling"). Loo wants the
salesperson to be able to **edit Customer info, Delivery Address, and Payment**
in the Proceed lane (payment in particular — "sometimes need to Update Payment"),
**without** un-proceeding. Product **items** stay locked (to change items you still
un-proceed back to *Order placed*, which is only allowed before the processing
date — the PR #589 rule is unchanged).

If, after editing, the order effectively belongs to a **different customer**
(`customer_id` changes), any **PWP promo tied to the old customer must be
recalculated to normal** — the discount is stripped and the order reprices at
full price, and the vouchers tied to this SO are cleaned up.

## 2. Decisions (locked with Loo, 2026-06-13)

- **D1 — What "recalculate PWP to normal" does.** Strip the PWP reward discount
  and reprice the reward line(s) at the normal full price; release/void the
  vouchers tied to this SO. (NOT "re-point vouchers to the new customer"; NOT
  "block the save".)
- **D2 — How a "different customer" is detected.** On Save, re-run the **same**
  `upsert_customer_by_name_phone(name, phone, email)` resolver the create path
  uses. If it resolves to a `customer_id` different from the SO's current
  (non-null) `customer_id`, it's a customer change. (Not "phone-only"; not a new
  picker UI.)
- **D3 — Processing-date lock is relaxed to "only product (+ schedule dates)
  lock".** After the processing date passes, the server currently 409s **every**
  header edit wholesale. Change it to a **field-scoped** lock: only the two
  production-schedule date columns (`internal_expected_dd`,
  `customer_delivery_date`) stay locked; customer/address/payment header fields
  pass. Items remain independently locked by their own routes' guards.
- **D4 — Dates locked in Proceed.** Processing/Delivery date fields are editable
  only in *Order placed*. In Proceed they're read-only (to change a date, un-proceed
  first, before the processing date).
- **D5 — Scope spans the whole Proceed lane.** Customer/Address/Payment editing
  applies to `CONFIRMED + proceeded_at` **and** the coordinator production
  statuses in the Proceed lane (`IN_PRODUCTION`, `READY_TO_SHIP`, `SHIPPED`).
  The *Delivered* lane (`DELIVERED`/`INVOICED`/`CLOSED`) stays fully locked.
- **D6 — "Status editable" = details editable in that state.** No production-status
  dropdown is added to POS (that stays the coordinator's job — locked decision
  "POS Proceed is a sales marker, not a status flip").
- **D7 — The DO/SI identity lock is KEPT (safety boundary).** The separate
  `SO_IDENTITY_LOCK_COLS` + `soHasDownstream` guard (Owner 2026-05-31) still
  freezes customer/branding/address once a non-cancelled DO/SI exists (the
  delivery doc already snapshotted them). So in production statuses, customer/
  address are editable **only until a DO/SI is cut**; after that the server 409s
  `so_identity_locked` and the drawer shows a clear message — **payment still
  works** (its ledger route is never locked). We do NOT relax this lock.

## 3. State → editable matrix (UI gating)

| Section | Order placed `CONFIRMED, !proceeded` | **Proceed lane** `CONFIRMED+proceeded` / `IN_PRODUCTION` / `READY_TO_SHIP` / `SHIPPED` | Delivered `DELIVERED/INVOICED/CLOSED` |
|---|---|---|---|
| Customer info | ✅ edit | ✅ edit¹ | 🔒 |
| Delivery **Address** | ✅ edit | ✅ edit¹ | 🔒 |
| Processing / Delivery **dates** | ✅ edit | 🔒 (un-proceed to edit) | 🔒 |
| **Items** (pencil / TBC) | ✅ edit | 🔒 (un-proceed to edit, before proc date) | 🔒 |
| **Payment** (record-payment form) | ✅ record | ✅ record | 🔒 |
| `Save changes` button | ✅ | ✅ | — |
| `Move to Proceed` | ✅ | — | — |
| `Move to Order placed` (un-proceed) | — | ✅ (CONFIRMED+proceeded, before proc date) | — |

¹ Server may still 409 `so_identity_locked` if a DO/SI exists (D7) or
`so_locked_processing` only for the date columns (D3). Both surface as a plain
inline sentence; payment is unaffected.

## 4. POS changes — `apps/pos/src/pages/OrderStatus.tsx`

### 4.1 Editable flags — extract a pure, testable helper

New pure helper `apps/pos/src/lib/so-edit-scope.ts` (unit-testable, keeps the
component logic-free):

```ts
export type SoEditScope = {
  isDeliveredLane: boolean;
  editablePlaced: boolean;   // Order placed — items + dates + everything
  editableProceed: boolean;  // Proceed lane — customer/address/payment only
  canEditDetails: boolean;   // editablePlaced || editableProceed
};
export function getSoEditScope(input: { status: string; proceededAt: string | null }): SoEditScope {
  const isDeliveredLane = ['DELIVERED', 'INVOICED', 'CLOSED'].includes(input.status);
  const editablePlaced  = input.status === 'CONFIRMED' && !input.proceededAt;
  // Proceed lane = anything that isn't Order-placed and isn't Delivered
  // (CONFIRMED+proceeded, IN_PRODUCTION, READY_TO_SHIP, SHIPPED). D5.
  // ON_HOLD / CANCELLED never reach the board (excluded server-side in /mine).
  const editableProceed = !isDeliveredLane && !editablePlaced;
  return { isDeliveredLane, editablePlaced, editableProceed, canEditDetails: editablePlaced || editableProceed };
}
```

In `OrderDetail`: `const scope = getSoEditScope(order); const { editablePlaced,
canEditDetails } = scope;`. (items + dates + Move-to-Proceed stay on
`editablePlaced`; customer/address/payment on `canEditDetails`.)

- `editable` (items, dates, Move-to-Proceed, pencil) → **rename usages that mean
  "Order placed only" to `editablePlaced`** (no behavior change there).
- Customer fields `disabled={!canEditDetails}`.
- Address fields `disabled={!canEditDetails}` (+ existing state/city cascade gating).
- **Date fields** `disabled={!editablePlaced}` (D4 — locked in Proceed).
- Items pencil + `TbcLineEditor` render gate stays `editablePlaced` (D-items).
- Payment record-payment block gate `editablePlaced && outstanding>0` →
  `canEditDetails && outstanding>0`.
- Footer:
  - Checklist + `Save changes` + `Move to Proceed`: keep on `editablePlaced`
    for `Move to Proceed`; **show `Save changes` whenever `canEditDetails && dirty`.**
  - `Move to Order placed` (un-proceed): unchanged (`!editablePlaced && canUnproceed`).
  - "Locked · coordinator handling" / "Delivered · managed in backend" only when
    `!canEditDetails && !canUnproceed`.

### 4.2 Save in Proceed → opt-in customer re-resolve

`buildPatch()` already sends `debtorName/phone/email/address…`. The POS Save adds
a flag so the server re-resolves the customer and runs the strip (D2):

```ts
// saveMutation body:
JSON.stringify({ ...buildPatch(), recustomer: true })
```

- The flag is POS-only and opt-in; Backend SO detail does **not** send it →
  Backend behavior is unchanged (blast radius minimal).
- `dirty` already flips on name/phone change (no `customerId` field in the row),
  so the existing dirty check is sufficient.

### 4.3 Pre-save confirm + post-save notice (customer change)

- The drawer learns whether the SO carries PWP via a lightweight `hasPwp` flag
  added to the `/mine` row (see §5.4) **or** reuse the existing `pwpCodes` from
  `GET /:docNo` if already fetched. (Decision in plan: prefer the cheap `/mine`
  flag.)
- When `hasPwp` **and** (name or phone changed), Save first shows a confirm:
  > "Changing the customer will remove this order's PWP promo and reprice it to
  > normal. Continue?"
- On success the PATCH returns a strip summary (§5.3); show a one-line notice:
  > "Customer changed · PWP promo removed, N line(s) repriced to normal."
- `describeSoActionError` gets cases for `so_identity_locked` (already partially)
  and `so_locked_processing` so the foot strip stays human.

## 5. Server changes — `apps/api/src/routes/mfg-sales-orders.ts`

### 5.1 Field-scoped processing lock (D3) — replace lines ~3449-3458

Add a constant and swap the wholesale guard:

```ts
// Production-schedule columns that stay frozen after the processing date.
// Customer / address / payment header fields are intentionally NOT here —
// they don't feed the supplier PO. Items are locked by their own route guards.
const SO_PROCESSING_LOCK_COLS = new Set<string>([
  'internal_expected_dd', 'customer_delivery_date',
]);
```

```ts
// was: if (soProcessingLocked(before…)) return 409 wholesale;
if (soProcessingLocked(before as …)) {
  const changedLocked = [...SO_PROCESSING_LOCK_COLS].filter(
    (col) => col in updates && norm(updates[col]) !== norm(beforeRow[col]),
  );
  if (changedLocked.length > 0) return c.json(SO_PROCESSING_LOCKED_RESPONSE, 409);
}
```

- Keep `soProcessingLocked` and `SO_PROCESSING_LOCKED_RESPONSE` as-is.
- Item write routes (`POST/PATCH/DELETE /items`, `tbc-*`, override) already call
  `soProcessingLockBlocked` independently → items stay frozen post-proc-date. No
  change there.

### 5.2 Customer re-resolve + PWP strip (D1/D2) — in PATCH `/:docNo`

When `body.recustomer === true` and (`debtorName`/`customerName` or `phone`
present and differs from stored), AFTER passing the existing guards and BEFORE
(or as part of) the update:

1. Resolve `newCustomerId = upsert_customer_by_name_phone(name, phone, email)`
   (same RPC as create, line ~1688).
2. `oldCustomerId = before.customer_id`.
3. If `oldCustomerId == null` → backfill only: set `updates.customer_id = newCustomerId`,
   **no strip** (legacy SO getting its first customer link, not a swap).
4. If `newCustomerId === oldCustomerId` → no-op (set `customer_id` anyway, harmless).
5. If **different** → set `updates.customer_id = newCustomerId`, then after the
   header UPDATE succeeds call `stripPwpForCustomerChange(sb, docNo, oldCustomerId, newCustomerId, user)`.

The identity lock (§5.3 / D7) runs first: if a DO/SI exists, the `customer_id`
change trips `so_identity_locked` (409) and we never reach the strip — correct
(can't reassign an invoiced/delivered order's customer).

> Behavioral note (Loo): `upsert_customer_by_name_phone` is an **upsert** — same
> as the create path. Editing the name/phone to a value that doesn't match an
> existing customer **creates a new customer record** and re-points the SO to it.
> That's intended (it mirrors create), but it means a name typo-fix can mint a
> new customer. The PWP strip only fires when the resolved id actually differs
> from the stored non-null id, so a no-op edit can't strip anything.

### 5.3 PWP strip on customer change — reuse the tbc-swap revert machinery

**⚠ Correction to an earlier assumption.** A PWP reward line does NOT store its
discount in `discount_centi`. The create path passes `pwpBaseSen` into
`recomputeFromSnapshot`, so the **PWP grant price is baked into
`unit_price_centi`** (verified line 1970-2076: `unit = recomputed.unit_price_sen`
with the pwp grant; `discount = client discountCenti`, usually 0). The reward
line is marked by **`variants.pwp === true`** (+ `variants.pwpCode`). Therefore
"recalculate to normal" must **re-derive the full price WITHOUT the PWP grant** —
not zero a discount.

The codebase already does exactly this in `tbc-swap` when a trigger line is
swapped and strands a reward (lines 4839-4925). **Reuse that proven pattern.**

**Pure, unit-tested core** — new file `apps/api/src/lib/pwp-customer-change.ts`:

```ts
// Decide what to do with each of an SO's PWP vouchers when its customer changes.
export type PwpVoucherRow = {
  code: string; status: string; source_doc_no: string | null; redeemed_doc_no: string | null;
};
export function classifyPwpVouchersForCustomerChange(
  codes: PwpVoucherRow[], docNo: string,
): { deleteCodes: string[]; releaseCodes: string[] } {
  const deleteCodes: string[] = [];
  const releaseCodes: string[] = [];
  for (const c of codes) {
    const mintedHere = c.source_doc_no === docNo;
    const redeemedHere = c.redeemed_doc_no === docNo;
    if (redeemedHere && mintedHere) deleteCodes.push(c.code);        // same-order promo → gone
    else if (redeemedHere && !mintedHere) releaseCodes.push(c.code); // cross-order voucher → back to its real owner
    else if (mintedHere && c.status === 'AVAILABLE') deleteCodes.push(c.code); // minted here for old customer → gone
    // else: unrelated to this SO → leave it
  }
  return { deleteCodes, releaseCodes };
}
```

**Strip flow inside PATCH `/:docNo`** — `stripPwpForCustomerChange(sb, docNo, user)`,
defined near `planSofaRewardRevert` (line 4986). **Plan read-only first, then write**
(mirrors tbc-swap):

```
PLAN (read-only, before the header UPDATE):
  - load non-cancelled lines with variants.pwp === true.
  - sofa reward builds: for each distinct variants.pwpCode among sofa lines,
    call planSofaRewardRevert(sb, docNo, pwpCode). If ANY returns {ok:false}
    (can't safely reprice) → PATCH returns 409 { error:'pwp_strip_failed',
    reason:'This order’s sofa PWP can’t be auto-repriced — ask the
    coordinator.' } and NOTHING is written (customer_id not changed).

APPLY (after the header UPDATE succeeds):
  1. Non-sofa reward lines: same block as tbc-swap 4849-4880 —
     strip {pwp, pwpCode, pwpTriggerLabel} from variants, load
     [loadProductByCode, loadFabricByCode, loadFabricSellingTiers] +
     [loadMaintenanceConfig, loadFabricTierAddonConfig, loadSpecialAddons],
     recomputeFromSnapshot(draft{unitPriceCenti:0, variants}, prod, fab, cfg,
       null, null, tiers, addonCfg, null, null, specialDefs, null) → revertUnit,
     update unit_price_centi/total_*/balance/margin/breakdown/description2.
  2. Sofa reward builds: apply the planSofaRewardRevert updates (already computed).
  3. Vouchers: classifyPwpVouchersForCustomerChange(codes, docNo) →
       delete deleteCodes (sb.from('pwp_codes').delete().in('code', …)),
       release releaseCodes (update {status:'AVAILABLE', redeemed_doc_no:null,
       updated_at}). (delete, not VOID — matches Loo’s tbc-swap precedent
       “dead vouchers go”, so no new status value / no migration.)
  4. recomputeTotals(sb, docNo). Stripping a grant only RAISES the total → the
     so_total_below_original POS guard is never tripped.
  5. recordSoAudit(action:'UPDATE_DETAILS', fieldChanges:[customer_id from→to,
     {field:'pwpStripped', to:`${rewardsReset} line(s)`},
     {field:'pwpCodesDeleted', to: deleteCodes.join(', ')},
     {field:'pwpCodesReleased', to: releaseCodes.join(', ')}]).
```

PATCH returns `{ ok, docNo, pwpStripped:boolean, rewardsReset, vouchersDeleted,
vouchersReleased, newCustomerId }` so the POS can show the notice.

> Idempotent: a re-run finds no `variants.pwp` lines and no matching vouchers → no-ops.
> Reuse, don't refactor: PWP code is incident-prone (many memory entries) — do
> NOT restructure tbc-swap; the strip REPLICATES its non-sofa block and CALLS the
> existing `planSofaRewardRevert`.

### 5.4 `hasPwp` on `/mine` (optional, for the pre-save confirm)

In `GET /mine` item mapping, set a per-SO `has_pwp` boolean = any line has a
truthy `variants.pwpCode` OR any `pwp_codes` row references the doc. Cheapest:
derive from the items already fetched (`variants.pwpCode`). Surface as
`MyOrderRow.hasPwp`. If the plan finds this adds a query per row, fall back to
reusing the drawer's `GET /:docNo` `pwpCodes` instead.

## 6. No DB migration

- `pwp_codes.status` is free-text (`RESERVED|USED|AVAILABLE`, no CHECK) → writing
  `'VOID'` needs no migration; existing AVAILABLE/USED queries simply won't match
  VOID rows.
- Everything else is column writes on existing columns.

## 7. Tests

The DB-coupled apply logic (Supabase query builders) is not unit-tested — like
the rest of the route file. Extract the **decision logic** into pure helpers and
unit-test those (vitest); the price re-derivation rides the already-tested
`recomputeFromSnapshot` (`apps/api/src/lib/mfg-pricing-recompute.test.ts`).

- **api lib unit** — `apps/api/src/lib/pwp-customer-change.test.ts` for
  `classifyPwpVouchersForCustomerChange`:
  (a) redeemed+minted here (same-order promo) → delete;
  (b) redeemed here, minted elsewhere (cross-order) → release;
  (c) minted here + AVAILABLE (unused, old customer) → delete;
  (d) unrelated code (other SO) → untouched;
  (e) empty input → empty result.
- **pos lib unit** — `apps/pos/src/lib/so-edit-scope.test.ts` for `getSoEditScope`:
  CONFIRMED+!proceeded → placed; CONFIRMED+proceeded → proceed (canEditDetails,
  !placed); IN_PRODUCTION/READY_TO_SHIP/SHIPPED → proceed; DELIVERED/INVOICED/
  CLOSED → delivered (no edit).
- **manual / staging verification** (DB-coupled, can't unit-test): field-scoped
  processing lock (date change after proc date → 409 `so_locked_processing`;
  customer/address change after proc date with no DO/SI → ok; with DO/SI →
  `so_identity_locked`); end-to-end customer-change-strip on a seeded PWP SO
  (reward reprices up, vouchers deleted/released, totals raised).
- Run full `pnpm typecheck && pnpm test && pnpm lint && pnpm build`
  (build hits build-guard → `ALLOW_LOCAL_API_URL=1` per #590 memory).

## 8. Deploy (per memory lessons)

- Land on `main` HEAD; deploy **API first, then POS**.
- Use `scripts/deploy-*.sh` (never a bare `build`) — manual builds shipped a
  localhost `VITE_API_URL` before. Remind Loo to PWA hard-refresh after POS deploy.

## 9. Non-goals / explicitly out of scope

- No production-status dropdown in POS (D6).
- No relaxing the DO/SI identity lock (D7) — editing customer/address on an
  invoiced/delivered order is a separate, larger task (would need to re-sync
  DO/SI snapshots).
- No payment editing in the Delivered lane (kept locked; possible later ask).
- No change to the un-proceed flow (#589) or the create-path PWP logic.
