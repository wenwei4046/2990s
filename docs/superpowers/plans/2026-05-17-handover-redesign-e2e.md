# Handover Redesign — End-to-End Verification (Task 19)

**Branch:** `handover-redesign` at `d89a0d8`
**Verified on:** 2026-05-17, Wenwei (Claude Code)
**Result:** **DONE_WITH_CONCERNS** — flow renders, submits, and persists; 4 issues surfaced (1 product, 1 wire, 2 UI).

---

## 1. Walk-through pass/fail

| Phase / Step | Status | Notes |
|---|---|---|
| P1.1 Customer | PASS | h1, 4 chips, eyebrow, h2, 5 fields, right pane all render. Continue disables / enables correctly on name+email. |
| P1.2 Address | PASS (1 nit) | Cascading state→city→postcode select chain works. "Fill in address later" hides fields + right pane Address row → "To be filled later". Billing-same defaults orange-checked. *Nit*: h2 still reads "Customer additional info" — by design (see Source note below). |
| P1.3 Emergency | PASS | All-empty Continue enabled (optional). Validation also accepts all-three-filled. |
| P1.4 Target date | PASS | Today (May 17) + all earlier days disabled, May 18+ enabled. Picking May 22 updates right pane DELIVERY Date to "Fri, 22 May" (en-MY short format). |
| P2.5 Add-ons & payment | PASS | 4 addon cards (Recycle/Recycle/ArrowUpFromLine/Wrench icons render). Lift expand shows FLOORS/ITEMS inputs. Floors=5, Items=2 → "Line total: RM 300" matches canonical `max(0, floors-2) * items * perFloorItem` formula. Selecting Lift updates right pane Add-ons RM 300 + Total RM 12,740. Debit Card method shows orange ring + right pane PAYMENT Method = "Debit Card". |
| P2.6 Confirm payment | PASS | Copy interpolates payment method label + half (RM 6,370) + full (RM 12,740) values. Default `paymentPreset='full'` means Full pill renders orange on entry; clicking it fills amount field to 12740. APPROVAL CODE = "123" + clicking "Confirm payment received" → green "Payment recorded · RM 12,740" + button morphs to "Continue to signature →". |
| P2.7 Sign & confirm | PASS | Canvas drawing via dispatched PointerEvent works. After draw, "Signed. Ready to place order." appears, Clear button enables, "Complete order ✓" enables. |
| Submit | PASS (via drift modal) | POST /orders returned 409 — see Issue #1 (real bug, drift modal worked as designed). Accepted via modal → SO-2052 created. |
| /confirmed/SO-2052 | PASS (with 2 nits) | Hero photo (`/imagery/bedroom-warm.jpg` fallback) renders. "Welcome **home**, QA." with script italic on "home" in orange. ORDER CONFIRMED · SO-2052 eyebrow + checkmark bubble. Right pane Receipt mode: Items / Delivery / Payment / Paid sections render. "+ New order" → `/catalog`. Print CSS rule loaded. |

---

## 2. End-to-end submit

**Result:** Succeeded. Order ID `SO-2052` persisted with full handover fields. `subtotal=12440`, `addon_total=300`, `total=12740`. Cart cleared, navigation to `/confirmed/SO-2052` happened (replace).

The submit took **two attempts** because of the drift bug (Issue #1 below). The first attempt returned 409 → PricingDriftModal rendered with the breakdown; clicking "Accept · RM 12,740 & place order" resubmitted with the server's total and succeeded.

---

## 3. Schema persistence (DB row)

`orders.SO-2052`:

| Column | Value | OK |
|---|---|---|
| customer_name | `QA Test Customer` | OK |
| customer_email | `qa@test.com` | OK |
| customer_type | `new` | OK |
| building_type | `condo` | OK |
| billing_same | `true` | OK |
| salesperson_id | `90d06620-…` (Loo) | OK |
| customer_address | `Unit 1, Jalan Test` | OK |
| customer_postcode / city / state | `68000` / `Ampang` / `Selangor` | OK |
| delivery_date | `2026-05-22` | OK |
| delivery_tbd | `false` | OK |
| delivery_notes | `null` (no special instructions entered) | OK |
| payment_method | `debit` | OK |
| subtotal | `12440` | OK |
| addon_total | `300` | OK |
| total | `12740` | OK |
| **paid** | **`0`** | **BUG — Issue #2** |

`order_items` rows for SO-2052:

| kind | qty | unit_price | line_total | extra |
|---|---|---|---|---|
| product | 1 | 1990 | 1990 | productId 5539 (2-seater 1A+1A) |
| product | 1 | 6460 | 6460 | productId 5539 (custom 2A+2NA+CNR+L) |
| product | 1 | 3990 | 3990 | productId 5539 (3+L 1NA+2A+L) |
| addon | 1 | 0 | 300 | addon_id=`lift`, floors_count=5, items_count=2 |

Addon row persisted correctly — `(5-2)*2*50 = 300`.

---

## 4. Pricing-drift round-trip (Task 19 §5)

Tested via direct fetch from the preview console:

| Test | Result |
|---|---|
| Submit `clientTotal: 50` for a 2980-priced sofa | 409 `pricing_drift`, body has clientTotal=50, serverTotal=2980, full lines breakdown |
| Submit `clientTotal: 2980` (matched) | 201 Created, SO-2053 persisted with total=2980 |

The drift modal flow also worked through the UI: PricingDriftModal renders with QUOTED → CURRENT prices, line-by-line breakdown, and an Accept button that resubmits with `acceptedServerTotal`.

---

## 5. Issues found

### Issue #1 — `clientTotal` excludes addon total (real bug)

**File:** `apps/pos/src/lib/orders.ts:101-102`

```ts
const clientTotal = input.acceptedServerTotal
  ?? input.lines.reduce((s, l) => s + l.qty * l.config.total, 0);
```

The reducer sums product lines only — addon selections (passed in `input.addons`) never roll into the client's submitted total. Server `computeOrderTotal` does sum `subtotal + addonTotal`, so any non-zero addon selection triggers a 409 on every first-attempt submit. The drift modal masks the bug functionally (Accept → resubmit with `acceptedServerTotal`), but users see a "Pricing changed" modal on every order with addons — which is wrong messaging (nothing actually drifted; the client just under-reported its own total).

**Suggested fix:** add `input.addons` math (mirror `computeAddonTotal` from handover-helpers) into the `clientTotal` calculation in `buildPostBody`.

### Issue #2 — `paid` column always written as `0`

**File:** `apps/api/src/routes/orders.ts:241`

```ts
const rpcPayload = {
  ...
  paid: 0,    // hardcoded
  ...
};
```

The Handover redesign collects `amountPaid` + `paymentRecorded` in form state, displays the live amount in the "Payment recorded · RM 12,740" confirmation, but never threads `amountPaid` to the wire. Server hardcodes `paid: 0` into the RPC payload. Consequence: every persisted order has `paid=0`, and the Confirmed page Receipt shows "PAID RM 0" regardless of what the customer actually paid.

This is a multi-layer omission:
1. `OrderSubmitInput` (`apps/pos/src/lib/orders.ts:39`) has no `amountPaid` field
2. `Handover.tsx:131-162` `submitOrder()` never passes `form.amountPaid`
3. `orderV1PostSchema` (`packages/shared/src/schemas/order-v1.schema.ts:73-114`) has no `amountPaid` field
4. Server hardcodes `paid: 0` in `orders.ts:241`

**Suggested fix:** thread `amountPaid` through all 4 layers; default to `total` when omitted so legacy clients (no handover redesign) still record fully-paid orders.

### Issue #3 — Confirmed page button overlap

**File:** `apps/pos/src/pages/Confirmed.module.css:11-18`

```css
.actions {
  position: absolute;
  bottom: var(--space-7);
  left: var(--space-7);
  ...
}
```

`.actions` is positioned `absolute bottom-left` of `.left` (the Hero column). The Hero copy is also bottom-aligned (`align-items: flex-end`). At the tested viewport (POS iPad target 1180×820) the "+ New order" and "Print receipt" buttons sit *on top of* the second line of body copy ("…test.com"), partially obscuring it.

**Suggested fix:** stack actions below Hero (`position: static`) and let `flex-direction: column` on `.left` do the work, or pad `Hero.body` with bottom margin to clear the action zone.

### Issue #4 — Duplicate React keys in Confirmed receipt

**File:** `apps/pos/src/pages/Confirmed.tsx:39-49`

```ts
const fakeLines: CartLine[] = data.lines.map((l) => ({
  key: l.product_id,
  ...
}));
```

The 3 sofa lines all share the same `product_id` (`ffffffff-ffff-ffff-ffff-ffffffff5539`), triggering React's "two children with the same key" warning (32 entries in the console log). The receipt still renders, but React's reconciler may drop/duplicate cards on re-render.

**Suggested fix:** use `key: \`${l.product_id}-${idx}\`` or pass the `order_items.id` UUID through `useOrderById`.

---

## 6. Source notes (for reference, not bugs)

- **Phase 1 sub-steps share an h2.** CustomerStep, AddressStep, EmergencyStep, TargetDateStep all render `<h2>Customer additional info</h2>`. Confirmed intentional: phase eyebrow ("PHASE 1 OF 2 · ADDITIONAL INFO") differentiates context, and the h3 subtitle ("Delivery address", "Emergency contact", "Delivery target date") localises each step. This matches the spec at lines 28-34 of the plan.

- **Lift formula uses `(floors − 2)` not `floors`.** Comment in `AddonCard.tsx:14-15` mirrors `packages/shared/src/pricing.ts:23`: first 2 floors free. Plan test in Task 19 spec said floors=5/items=2 → RM 300, which is `(5−2)*2*50 = 300`. ✓

- **HMR Vite reload errors in console** are transient from earlier editor sessions and do not affect runtime. Page re-renders cleanly.

---

## 7. Verdict

**DONE_WITH_CONCERNS.** Every step of the redesigned flow renders correctly, the form binds live to the right-pane summary, payment recording works, signature capture works, the order persists with the new schema columns, addon line items materialise correctly, the drift modal protects the "honest pricing" promise, and `/confirmed/:orderId` displays the receipt.

The 4 issues above are independently fixable and do not block the redesign from shipping behind a feature flag — but Issue #2 (paid=0) is functionally serious enough that a follow-up task to thread `amountPaid` should land before Loo demos to staff. Issue #1 (addon-drift always fires) is a UX wart but works around itself. Issue #3 (button overlap) needs a 2-line CSS fix. Issue #4 is a React hygiene fix.

No fixes were made as part of this verification task.
