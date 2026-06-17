# Add Product to a Placed SO (POS) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give the POS Order-Placed drawer an **"Add product"** button that opens the **same** catalog/configurator UI, lets staff add a configured product **directly into the placed SO** (not a new cart), with **honest server pricing** (no drift), proper **sofa module split**, automatic **Free Item Campaign** zeroing when eligible, and automatic **PWP (换购)** redemption when the order's existing trigger (e.g. a mattress) minted a code.

**Architecture:** Reuse the existing `POST /:docNo/items` add-line endpoint (already does honest recompute + drift + locks + composition + discount + audit + reconcile/totals) and add the 3 create-path subsystems it currently lacks on the add path: (a) **sofa split** (reuse shared `splitSofaBuildIntoModuleLines`), (b) **PWP single-line claim** (new `claimPwpForSingleLine` helper that MIRRORS create's loop — create is NOT refactored, to protect the live, test-less create path), (c) **free-item** apply via a server-validated `freeItemCampaignId` body param (reuse shared `campaignsCoveringLine`; keep stripping client `variants.freeItem`). POS reuses the Configurator via an `addToOrder=SO-XXXX` mode (mirrors the existing `?swapDoc/?swapItem` sofa-swap flow), with PWP auto-fill from the order's codes and the cart's make-free affordance.

**Tech Stack:** Hono/CF Workers + Supabase, React 19 + TanStack Query 5 + Zustand 5, Zod 3, Vitest. Money: POS whole-MYR, SO `*_centi` sen.

## Global Constraints

- **Builds on** the completed Free Item Campaign feature (same branch `worktree-free-item-campaign`). Shared `campaignsCoveringLine`, `parseFreeItemEligible`, `loadActiveFreeItemCampaigns`, `stripFreeItem`, `isFreeItemLine`, `splitSofaBuildIntoModuleLines`, `recomputeFromSnapshot` already exist — REUSE, do not duplicate.
- **Honest-pricing red line:** the server is authoritative. A line reaches RM 0 ONLY via (i) a server-validated `freeItemCampaignId` (free-item) or (ii) a server-validated PWP code claim. NEVER trust client `variants.freeItem` (keep `stripFreeItem`). NEVER trust a client unitPrice for free/PWP — the server forces it.
- **Do NOT modify the create PWP loop** (`mfg-sales-orders.ts` ~1822-2023) or the create free-item block — they are live and lack an HTTP test harness. The add path gets a NEW `claimPwpForSingleLine` helper that mirrors create's rules; the final review cross-checks parity rule-by-rule.
- **Respect every existing add-line guard:** downstream-lock (DO/SI exists → 409), processing-date lock (409), sofa/mattress composition (400), allowed-options (400), qty gate (422), discount gate (422), self-scoped-sales 404.
- **PWP rules (mirror create):** reward line `qty === 1`; code must be redeemable (RESERVED/AVAILABLE, or orphaned-USED self-heal); `customer_id` binding; `reward_category` + `eligible_reward_model_ids` (or reward combo for sofa) match; atomic `UPDATE → USED`; rollback on insert failure; reject if another line on the order already claimed the code.
- **Free-item vs PWP are mutually exclusive on one line.** A line is never both.
- **Migration:** none (no schema change). Next free number remains 0177 if ever needed.
- **Quality gates per task:** `pnpm --filter @2990s/api typecheck` / `pnpm --filter @2990s/pos typecheck`, scoped `pnpm test`, `ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos build`. Stage only changed files; never `git add -A`. No prod deploy/migration.
- **POS-only.** No backend SO-detail changes.

---

## File structure

**Create**
- `apps/api/src/lib/pwp-claim-single.ts` — `claimPwpForSingleLine` + `rollbackPwpClaim` (new, mirrors create's PWP validate/claim/rollback for ONE code).
- `apps/pos/src/lib/products/pwp-codes-for-order.ts` (or a hook in queries.ts) — query redeemable PWP codes for an order's customer/source SO + reward category.

**Modify**
- `apps/api/src/routes/mfg-sales-orders.ts` — enhance `POST /:docNo/items`: sofa split + PWP claim + free-item apply (+ mutual exclusion + rollback). Mount the helper.
- `apps/pos/src/lib/queries.ts` (or flow-queries) — `useAddProductToPlacedSo` mutation + the PWP-codes-for-order query hook + a hook to load SO/customer context for addToOrder mode.
- `apps/pos/src/pages/Configurator.tsx` — `addToOrder=SO-XXXX` mode: SO/customer context, "Add to this order" submit, PWP auto-fill, free-item make-free affordance.
- `apps/pos/src/pages/OrderStatus.tsx` — "Add product" button on the placed-order drawer, gated on add-eligibility, navigates to Catalog/Configurator in addToOrder mode.
- `apps/pos/src/pages/Catalog.tsx` (if needed) — pass the `addToOrder` param through catalog → configurator links.

---

## Task A1: Server — `claimPwpForSingleLine` helper

**Files:**
- Create: `apps/api/src/lib/pwp-claim-single.ts`
- Test: `apps/api/test/pwp-claim-single.test.ts` (pure-eligibility cases where feasible; DB claim is integration — note harness gap)

**Interfaces:**
- Produces:
```ts
export interface SinglePwpClaimResult {
  pwpBaseSen: number | null;          // non-sofa PWP base (0 for promo-free, >0 for pwp price)
  pwpSofaComboIds: string[] | null;   // sofa reward combo ids (sofa reward path)
  claimed: { code: string; prevStatus: string } | null;  // for rollback
  rejection: { code: string; reason: string } | null;    // 409 if set
}
export async function claimPwpForSingleLine(sb: any, args: {
  code: string; docNo: string; itemCode: string;
  product: { category: string; model_id: string | null; base_model: string | null; pwp_price_sen?: number | null };
  customerId: string | null; ownerStaffId: string; qty: number;
  variants: Record<string, unknown> | null;  // for sofa reward combo matching
}): Promise<SinglePwpClaimResult>;
export async function rollbackSinglePwpClaim(sb: any, claimed: { code: string; prevStatus: string }): Promise<void>;
```

- [ ] **Step 1: Write the failing test** — assert: qty !== 1 → rejection `qty_not_one`; missing code row → `code_not_found`; wrong reward_category → `category_mismatch`; model not in eligible list → `model_not_eligible`; (DB-dependent claim paths documented as integration-gap).
- [ ] **Step 2: Run it (RED).** `pnpm --filter @2990s/api test -- pwp-claim-single`
- [ ] **Step 3: Implement** by MIRRORING `mfg-sales-orders.ts` create PWP loop (~1822-2023): prefetch the single code row; validate status redeemable (RESERVED/AVAILABLE/orphaned-USED self-heal), `customer_id` binding for AVAILABLE, `reward_category` match, `eligible_reward_model_ids` / reward combo (sofa) match, `pwp_price_sen` present (unless promo type → 0), `qty === 1`; ALSO `SELECT redeemed_item_code FROM mfg_sales_order_items WHERE doc_no=docNo` to reject a code already claimed on this order; atomic `UPDATE pwp_codes SET status='USED', redeemed_doc_no=docNo, redeemed_item_code=itemCode WHERE code=code AND status=prevStatus`; return `{ pwpBaseSen | pwpSofaComboIds, claimed:{code,prevStatus}, rejection:null }`. `rollbackSinglePwpClaim` restores prevStatus + nulls redeemed_*. **Copy the create rules exactly — the reviewer cross-checks.**
- [ ] **Step 4: GREEN.** Run the test.
- [ ] **Step 5: Commit** (`git add apps/api/src/lib/pwp-claim-single.ts apps/api/test/pwp-claim-single.test.ts`).

---

## Task A2: Server — sofa split on `POST /:docNo/items`

**Files:** Modify `apps/api/src/routes/mfg-sales-orders.ts` (the add-line handler ~4449-4493).

**Interfaces:** Consumes `splitSofaBuildIntoModuleLines` (shared), `loadModelSofaModulePrices`/`loadModelSofaModuleCostRows` (already loaded in the handler for SOFA).

- [ ] **Step 1:** After the recompute + drift + discount gates, BEFORE the single-row insert, branch: if `productLite.category === 'SOFA'` AND `variants.cells` present AND `base_model` known → build per-module rows exactly as the create path does (mirror `mfg-sales-orders.ts` ~2466-2527): `buildKey = \`build-add-${nextLineNo}\``, spread `sharedVariants` (minus cells) + `buildKey/cellIndex/x/y/rot` onto each row, distribute `buildUnitPriceSen = unit` + `buildUnitCostSen`, breakdown columns on first row only, `description` = `SOFA {MODEL} {code}`. Insert all module rows (not one). Non-sofa keeps the single-row insert.
- [ ] **Step 2:** Show the code block for the sofa branch (mirror create's split-row builder). Reuse the existing `nextLineNo` numbering (continue from there for each module row).
- [ ] **Step 3:** Typecheck + run API tests. Manual reasoning note: a sofa added to a placed SO now produces per-module rows like create.
- [ ] **Step 4: Commit.**

(No test harness for the endpoint; add a focused test asserting `splitSofaBuildIntoModuleLines` output shape is persisted if a unit-level seam exists, else note the gap. Reviewer verifies the branch by reading.)

---

## Task A3: Server — PWP claim on `POST /:docNo/items`

**Files:** Modify `apps/api/src/routes/mfg-sales-orders.ts` add-line handler.

**Interfaces:** Consumes `claimPwpForSingleLine` / `rollbackSinglePwpClaim` (Task A1).

- [ ] **Step 1:** Load the SO header's `customer_id` (add to the existing header select). If `variants.pwpCode` present: enforce `qty === 1` (else 422), call `claimPwpForSingleLine(...)`. On `rejection` → 409 `pwp_code_rejected` with the reason. On success → pass `pwpBaseSen` / `pwpSofaComboIds` into `recomputeFromSnapshot` (replace the hardcoded `null` at ~4384-4385).
- [ ] **Step 2:** Wrap the `insert` (and sofa multi-row insert) in try/catch (or check `error`): on failure, call `rollbackSinglePwpClaim(claimed)` BEFORE returning 500 — never burn a code on a failed insert (mirrors create's `rollbackPwpClaims` on insert failure).
- [ ] **Step 3:** Typecheck + tests. Commit.

---

## Task A4: Server — free-item apply on `POST /:docNo/items`

**Files:** Modify `apps/api/src/routes/mfg-sales-orders.ts` add-line handler.

**Interfaces:** Consumes `loadActiveFreeItemCampaigns`, `campaignsCoveringLine` (shared), `loadActiveSofaCombos` (already loaded as `sofaCombosLite`).

- [ ] **Step 1:** Accept a body field `freeItemCampaignId?: string`. **Mutual exclusion:** if both `freeItemCampaignId` and `variants.pwpCode` present → 400 `free_and_pwp_exclusive`.
- [ ] **Step 2:** If `freeItemCampaignId` present: build `comboModulesById` from `sofaCombosLite`; `covering = campaignsCoveringLine({ category, modelId: productLite.model_id, builtModuleIds: cells.map(moduleId) }, await loadActiveFreeItemCampaigns(sb), comboModulesById)`; the chosen campaign must be in `covering` AND `qty <= campaign.maxFreeQty` → else 409 `free_item_not_eligible`. On success: set `unit = 0`, stamp the persisted `variants.freeItem = { campaignId, campaignName }` (server-resolved name) on the row (and every sofa module row), and SKIP the drift check for this line. Keep `stripFreeItem` applied to the CLIENT variants first (the validated marker is re-added server-side, exactly like create).
- [ ] **Step 3:** Typecheck + tests. Commit.

---

## Task P1: POS — load context for addToOrder mode (hooks)

**Files:** Modify `apps/pos/src/lib/queries.ts` (or flow-queries).

**Interfaces:** Produces:
- `useSoHeaderForAdd(docNo)` — SO header + customer + add-eligibility (CONFIRMED, not proceeded-locked, no DO/SI, processing not passed). Reuse existing SO/my-orders queries where possible.
- `useRedeemablePwpCodesForOrder(docNo)` — list `pwp_codes` redeemable for the order's customer + source SO (status AVAILABLE/RESERVED, bound customer), with reward_category + eligible models, so the configurator can auto-fill.
- `useAddProductToPlacedSo()` — mutation → `POST /:docNo/items` with `{ itemCode, itemGroup, qty, variants, unitPriceCenti, freeItemCampaignId? }` (and `variants.pwpCode` for PWP).

- [ ] Steps: define the row types + hooks mirroring existing query patterns; typecheck; commit.

---

## Task P2: POS — Configurator `addToOrder` mode + submit

**Files:** Modify `apps/pos/src/pages/Configurator.tsx`, `apps/pos/src/pages/Catalog.tsx` (param passthrough).

- [ ] **Step 1:** Detect `?addToOrder=SO-XXXX` (mirror the existing `?swapDoc/?swapItem` handling). Load SO/customer context (P1). Keep ALL configurator UI/logic identical.
- [ ] **Step 2:** Replace the final submit slot: when in addToOrder mode, the button reads **"Add to this order"** (not "+ Add to Cart"); on click, marshal the SAME config snapshot to the `POST /:docNo/items` payload (reuse `buildVariants` from `pos-handover-so.ts`) and call `useAddProductToPlacedSo`. On success → navigate back to the order (`/my-orders/:docNo` or the drawer). On `pricing_drift` 400 → show the server breakdown and let the user re-submit at the server price (honest price wins).
- [ ] **Step 3:** Catalog links carry the `addToOrder` param so picking a product keeps the mode.
- [ ] Typecheck + build. Commit.

---

## Task P3: POS — PWP auto-fill in addToOrder mode

**Files:** Modify `apps/pos/src/pages/Configurator.tsx`.

- [ ] **Step 1:** In addToOrder mode, when the configured product is a PWP **reward** (its category/model matches a redeemable code from `useRedeemablePwpCodesForOrder`), auto-apply the code: set the line `pwp=true`, `pwpCode`, show "PWP price · 换购自 <trigger>", and reflect the PWP price (the configurator's existing PWP apply logic — reuse `validatePwpCode` + the same display the cart uses). Send `variants.pwpCode` in the submit; the SERVER re-validates + claims (Task A3) and forces the PWP price.
- [ ] **Step 2:** If multiple codes are redeemable, pick the appropriate one (FIFO / matching reward category), mirroring the cart's same-cart auto-pick.
- [ ] Typecheck + build. Commit.

---

## Task P4: POS — free-item make-free affordance in addToOrder mode

**Files:** Modify `apps/pos/src/pages/Configurator.tsx`.

- [ ] **Step 1:** In addToOrder mode, compute `campaignsCoveringLine` for the configured product (reuse `useActiveFreeItemCampaigns` + `useSofaCombos`, exactly like `CartContents`). If covered AND not a PWP line, show a **"Make free · campaign"** control (1 campaign → button; 2+ → pick). Mutually exclusive with PWP (hide if PWP applied).
- [ ] **Step 2:** When made free, the submit sends `freeItemCampaignId` (NOT a client `variants.freeItem`); the SERVER validates + forces RM 0 (Task A4). Display the line as `FREE · campaign`.
- [ ] Typecheck + build. Commit.

---

## Task P5: POS — "Add product" button on the Order Placed drawer

**Files:** Modify `apps/pos/src/pages/OrderStatus.tsx`.

- [ ] **Step 1:** Add an **"Add product"** button in the placed-order drawer's Items area, shown ONLY when the SO is add-eligible (reuse the existing editable/scope logic: CONFIRMED, not proceeded-locked, no DO/SI, processing date not passed — mirror `so-edit-scope.ts` / the editablePlaced gate). The server enforces these regardless.
- [ ] **Step 2:** Clicking navigates to the catalog/configurator in `addToOrder=SO-XXXX` mode (`navigate('/catalog?addToOrder=' + docNo)`), reusing the normal POS add UI.
- [ ] Typecheck + build. Commit.

---

## Final review (whole increment)

Dispatch the most-capable reviewer on the full add-product increment diff. Focus:
- **Honest pricing end-to-end:** no path zeroes a line or reduces the order total without a server-validated free-item OR PWP claim. Client `variants.freeItem` still stripped. PWP base only from `claimPwpForSingleLine`.
- **PWP parity:** `claimPwpForSingleLine` matches create's rules exactly (status/binding/category/model/price/qty=1/orphan-heal/atomic-claim); rollback fires on insert failure; the "already claimed on this order" guard works.
- **Sofa split** on add matches create (per-module rows, buildKey, breakdown on first row); free/PWP zero reaches every module row.
- **Live create path UNCHANGED** (no edits to the create PWP loop / free block).
- **Locks** (downstream/processing/composition/allowed-options/qty/discount) all still fire on the add path; mutual exclusion free×PWP.
- **POS** addToOrder reuses the configurator faithfully; drift surfaced; add-eligibility gating matches the server.

---

## Out of scope
- Backend SO-detail add-free (dropped per Loo — POS only).
- Making an EXISTING placed-SO line free (this is add-NEW-line only).
- Delivery-fee recompute on add (server fee locked at create — unchanged behavior; note to coordinator if a big add changes the picture).
- Refactoring/​unifying the create PWP loop with `claimPwpForSingleLine` (deliberate duplication now to protect the live path; unify later under test coverage).
