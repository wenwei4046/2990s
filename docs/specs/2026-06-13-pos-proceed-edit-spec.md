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

### 4.1 Editable flags (replace the single `editable`)

```ts
const isDeliveredLane = ['DELIVERED','INVOICED','CLOSED'].includes(order.status);
const editablePlaced  = order.status === 'CONFIRMED' && !order.proceededAt; // Order placed
// Proceed lane = everything that isn't Order-placed and isn't Delivered.
const editableProceed = !editablePlaced && !isDeliveredLane;               // D5
const canEditDetails  = editablePlaced || editableProceed; // customer + address + payment
// items + dates + Move-to-Proceed stay gated on editablePlaced.
```

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

### 5.3 `stripPwpForCustomerChange` helper (new, near recomputeTotals)

```
1. reward lines: mfg_sales_order_items where doc_no = docNo, not cancelled,
   variants->>'pwpCode' is not null.
   For each: clear variants.pwpCode, set discount_centi = 0,
   total_centi = unit_price_centi * qty  (unit_price_centi is the FULL price;
   discount_centi held the PWP delta — verified at create insert ~2138/2228).
2. vouchers (pwp_codes) for this SO:
   a. status='USED' AND redeemed_doc_no = docNo  → release: status='AVAILABLE',
      redeemed_doc_no = null  (the voucher returns to whoever owns it — the old
      customer still earned it elsewhere). updated_at bumped.
   b. status='AVAILABLE' AND source_doc_no = docNo  → void: status='VOID'
      (free-text status, no CHECK constraint, no migration; keeps an audit trail
      and removes it from AVAILABLE circulation). updated_at bumped.
   c. A code that is BOTH minted and used by this same SO (same-order promo,
      source_doc_no = redeemed_doc_no = docNo) → void (case b wins over a).
3. recomputeTotals(sb, docNo).  Stripping a discount only RAISES the total, so
   the so_total_below_original POS guard is never tripped.
4. recordSoAudit(action='CUSTOMER_CHANGED', fieldChanges incl. customer_id +
   a pwp summary {rewardsReset, vouchersReleased, vouchersVoided}).
```

PATCH returns `{ ok, docNo, pwpStripped: boolean, rewardsReset, vouchersReleased,
vouchersVoided, newCustomerId }` so the POS can show the notice.

> Note: cancellation idempotency — the helper is safe to re-run (a second call
> finds no `pwpCode` lines and no matching vouchers → no-ops).

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

- **shared/api unit** (vitest): `stripPwpForCustomerChange` —
  (a) reward line reprices full + discount cleared;
  (b) USED-on-this-SO voucher → AVAILABLE, redeemed_doc_no null;
  (c) AVAILABLE-minted-by-this-SO voucher → VOID;
  (d) same-order promo voucher → VOID;
  (e) totals recomputed up; (f) idempotent re-run no-ops;
  (g) null old customer → backfill, no strip; (h) same customer → no strip.
- **api**: field-scoped processing lock — date change after proc date 409s;
  customer/address change after proc date passes (no DO/SI) succeeds; with DO/SI
  → `so_identity_locked`.
- **pos** (vitest + RTL): drawer in `IN_PRODUCTION` shows editable customer/address
  + payment + Save, items pencil hidden, dates disabled; Delivered lane fully
  locked. Pre-save confirm fires when hasPwp + phone changed.
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
