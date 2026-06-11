# POS line quantity — mattress + bedframe configurator stepper

> Approved by Loo 2026-06-12. Scope locked: quantity selection on the POS product
> page is **mattress + bedframe only** (no sofa, no flat). SO representation is
> **one line × qty**. A PWP-trigger line with qty N reserves/earns **N × qty_per_trigger**
> codes (already the reconciler's contract — zero code change, verified live).

## What ships

### 1. POS Configurator — Quantity rail section (mattress + bedframe)

- New `RailSection title="Quantity"` directly under the **Size** section in both
  the `isSize` (mattress) and `isBedframe` rails (`apps/pos/src/pages/Configurator.tsx`).
- − / value / + stepper reusing the existing pillow-stepper classes
  (`styles.stepper` / `stepperBtn` / `stepperVal`), Lucide `Minus`/`Plus`, min 1,
  no upper cap. No native number input (iPad has no spinner — PR #570 lesson).
- When qty > 1 a muted hint shows the math: `2 × RM 2,990 = RM 5,980` (per-unit
  price × qty), so the salesperson sees the line they are about to add.
- **PWP lock**: while a PWP/promo code is applied (`pwpActive`), the stepper is
  locked at 1 with sub-copy `PWP — one unit per code`. Effective qty used for
  display + add is `pwpActive ? 1 : lineQty`.
- Topbar **LIVE TOTAL** shows the qty-multiplied amount; the label reads
  `LIVE TOTAL × N` when qty > 1. The snapshot `total` stays **per-unit**
  (server scales unit × qty — never pre-multiply).
- **Edit flow**: opening a line via `/configure/:id?edit=<key>` hydrates the
  stepper from `editingLine.qty` (in the size/bedframe hydrate branches);
  Save changes writes the new qty back to the same line.

### 2. Cart store (`apps/pos/src/state/cart.ts`)

- `addConfigured(config, opts?: { editingKey?: string; qty?: number })` — new
  optional qty (default 1, floored, min 1). Editing updates the line's qty when
  provided, else keeps it.
- **Reward clamp**: a config carrying `pwp: true` is always stored at qty 1, in
  both `addConfigured` and `setQty` (the cart −/+ stepper can no longer raise a
  reward line above 1). One code = one redemption = one unit.

### 3. Cart UIs (`CartContents.tsx`, `CustomerOrderSheet.tsx`)

- The + stepper button is disabled on PWP reward lines (`config.pwp`), with
  `title="PWP — one unit per code"`. The store clamp is the authority; the
  disabled button is affordance.

### 4. Server gates (`apps/api/src/routes/mfg-sales-orders.ts` POST /)

- **`invalid_qty` 422** — early gate after `validateItemCodes`: any provided
  line qty must be a positive integer (`Number.isInteger && >= 1`). Today
  `Number(it.qty ?? 1)` is trusted raw: qty 0 zeroes a line, NaN/fractions
  corrupt `total_centi`. qty is the one money input the drift gate (unit-price
  only) does not cover. Absent qty still defaults to 1.
- **PWP reward qty gate** — in the claim loop: a line redeeming a code
  (`variants.pwpCode`) with qty ≠ 1 is rejected into `pwpRejections`
  ("a PWP reward line must be quantity 1") → 409 before any code is burned.

## What already works (verified, no change)

- `CartLine.qty`, `setQty`, cart −/+ stepper, `cartSubtotal = Σ qty × total`.
- `pos-handover-so.ts` sends `qty: line.qty`; handover subtotal qty-aware.
- Server `lineTotal = qty × unit`, sofa split multiplies by qty, DO/SI remaining
  computed off SO line qty.
- PWP **trigger** reserve = `qty_per_trigger × qty` per cart line, re-reserved on
  qty change (`pwp-code-sync.ts` sig includes qty); at Confirm all reserved codes
  carry forward keyed by `cart_line_key`.
- `pos_carts` sync + quotes store whole `CartLine[]` (qty included).

## Out of scope (deliberate)

- Sofa / flat product-page quantity (Loo 2026-06-12: mattress + bedframe only).
- Sofa fold-display relaxation in `so-line-display.ts` (POS can't produce sofa
  qty > 1 from the product page; the cart stepper path keeps today's honest
  unfolded fallback).
- Reserve-route qty tamper hardening (pre-existing, separate concern).

## Tests

- POS vitest: cart store — `addConfigured` qty (new/edit/default), reward clamp
  in `addConfigured` + `setQty`.
- Manual on live: mattress qty 2 → cart ×2 → SO one line qty 2 → totals;
  PWP trigger qty 2 → 2 codes; reward + stepper locked.
