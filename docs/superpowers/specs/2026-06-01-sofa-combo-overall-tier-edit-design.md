# Sofa Combo — "Overall Edit price tier" (P1 base + global P2/P3 premiums)

> **Date:** 2026-06-01 · **Branch:** `worktree-combo-overall-tier-edit` (off `origin/main`)
> **Surface:** POS Master Admin → Products → **Combo Pricing** tab (`apps/pos`)
> **Status:** spec — pending Chairman review before plan + implementation.

---

## 1. What the Chairman asked for (verbatim)

> 在 Combo Pricing 加多一个 setting「Overall Edit price tier」：
> 1. 只编辑 Fabric Price（Fabric Tier 跟着布料走，有 Price 1 / 2 / 3）。
> 2. 一键同时编辑全部 Price 1 / 2 / 3。
> 3. 一键 = 以 Price 1 为基础：Price 2 设「比 Price 1 多 50」→ 全部 Combo 的 Price 2 自动 +50；24/28/30… 所有座高同等规则；Price 3 同理。
> 4. 点 Edit 后系统自动保存完整内容，但支持手动改；手动改没问题，**除非再次点 Save，系统会重新 Overwrite 之前的手动改动**。

Clarification from the Chairman (this session): he has **deleted all existing Price 2 combos**; going forward **every sofa combo is created at Price 1 (the base) first**.

---

## 2. Plain-language summary

Each sofa combo is stored as its **Price 1 base**. A new **"Overall Edit price tier"** panel on the Combo Pricing tab lets the Master Admin set two global numbers — *Price 2 premium* and *Price 3 premium* (flat RM over Price 1). One click sweeps **every** Price-1 combo and (re)generates its **Price 2** and **Price 3** sibling rows = `Price 1 + premium`, for **every seat height (24/28/30/32/35)**. The generated rows are ordinary combo rows, so the existing pricing engine consumes them unchanged.

---

## 3. Success criteria (testable)

1. Master Admin sees an **"Overall Edit price tier"** button on the Combo Pricing tab; sales/view roles do **not**.
2. The panel shows two RM inputs (Price 2 premium, Price 3 premium), **pre-filled** with the last saved values.
3. Clicking **Apply** with e.g. `P2 +50, P3 +120`: for **every** active Price-1 combo, a PRICE_2 row appears = `P1 + 50` and a PRICE_3 row = `P1 + 120` at **each** seat height that P1 has a price for. Heights where P1 is blank stay blank.
4. Re-clicking Apply after a manual edit to a generated row **overwrites** that manual value back to the formula (Chairman point 4). The manual value remains visible in **History** (append-only).
5. The two premium numbers **persist** across reloads and devices.
6. **No change** to the customer-facing pricing path: combo lookup, server-side `POST /orders` recompute, PO cost rollup are byte-identical. A combo build prices exactly as before for a given `(modules, tier)`.
7. `pnpm typecheck`, the shared unit test for the premium math, and the API route test all pass.

---

## 4. Non-goals / explicitly out of scope

- **POS fabric→tier wiring.** Today `apps/pos/src/pages/Configurator.tsx:432` hardcodes `fabricTier: 'PRICE_2'`; the customer's selected fabric tier does not yet drive combo selection. Making customers pay per their *actual* fabric tier is the **other section's Phase B** (`feat/sofa-compartments-from-pool`, "sofa SELLING price + P1-base tier auto-derive"). This PR produces correct **data**; end-to-end tiering needs Phase B too. **Decided with Chairman: keep this PR clean & independent — wiring is out.**
- **The per-module SKU price grid** tier-derive (#7 in the other section's spec). Different surface; not touched here.
- **Scheduling** (future effective dates from the panel). Generated rows are effective **today**. YAGNI until asked.
- **Percentage premiums.** Flat RM only (Chairman said "多 50 块").

---

## 5. Background — how combos work today (on `origin/main`)

- Table `sofa_combo_pricing` (migration `0090`, later columns added by cost-sell split): one row per `(base_model, modules, tier, customer_id, supplier_id, effective_from)`.
  - `tier` is a single `fabric_price_tier` enum value (`PRICE_1` | `PRICE_2` | `PRICE_3`) **or NULL** (matches any).
  - `prices_by_height` = **COST** (jsonb `{ "24": <sen>, … }`); `selling_prices_by_height` = **SELLING** (what the customer pays). Sen = RM×100.
  - **Append-only**: an "edit" inserts a new effective-dated row; the latest row ≤ today per scope wins. Soft-delete via `deleted_at`.
- Lookup (`packages/shared/src/sofa-combo-pricing.ts` → `pickComboMatch`): filters candidate rows by `r.tier === args.tier || r.tier === null`, matches the built modules to the combo's OR-set slots, ranks by scope, returns the winning row's price. **Used identically by POS live price and the server `POST /orders` recompute** (the honest-pricing guarantee).
- POS Combo tab (`apps/pos/src/components/products/SofaComboTab.tsx`): one price grid per combo card (5 seat heights), `mode` gate (`view`/`add-only`/`full`); `master_account` → `full` (`Products.tsx:127`).
- Write gate: `apps/api/src/routes/sofa-combos.ts` → `requireWriteRole` = `{admin, super_admin, coordinator, master_account}`. `sofa_combo_pricing` has **no RLS**; the app-layer gate is the only writer guard (Phase 5 review noted + accepted this).

**Consequence used by this design:** because P2/P3 are generated as *real* `tier=PRICE_2` / `tier=PRICE_3` rows, the lookup needs **zero changes** — it already selects rows by tier.

---

## 6. Design

### 6.1 Storage — `sofa_combo_tier_offsets` (new, migration `0123`)

Mirror the proven `delivery_fee_config` single-row pattern (one global row, `id = 1`).

```sql
-- 0123_sofa_combo_tier_offsets.sql
CREATE TABLE IF NOT EXISTS sofa_combo_tier_offsets (
  id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Flat premium (sen = RM×100) added to each combo's Price 1 to derive the tier.
  p2_premium_sen  INTEGER NOT NULL DEFAULT 0 CHECK (p2_premium_sen >= 0),
  p3_premium_sen  INTEGER NOT NULL DEFAULT 0 CHECK (p3_premium_sen >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      UUID
);
INSERT INTO sofa_combo_tier_offsets (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
```

- **No RLS** — consistent with `sofa_combo_pricing` (same domain). App-layer `requireWriteRole` is the gate. (Deliberate: avoids touching RLS policies — a global red line — and matches the combo table's existing posture. Hardening to RLS later is a separate, approval-gated migration.)
- Migration number `0123` — the next free number after main's `0122_reset_test_transactions_keep_so_fn` (which merged while this branch was open). The repo also tolerates duplicate numbers (two `0118_*` exist), so any future collision is resolvable at merge.

### 6.2 API (`apps/api/src/routes/sofa-combos.ts`)

Add two routes (static paths, declared **before** `/:id` handlers so they aren't captured by the param route):

**`GET /sofa-combos/tier-premiums`** — any authed staff may read.
→ `{ p2PremiumSen, p3PremiumSen, updatedAt, updatedBy }` from the `id=1` row.

**`POST /sofa-combos/tier-premiums/apply`** — `requireWriteRole`.
Body: `{ p2PremiumSen: int≥0, p3PremiumSen: int≥0 }` (zod-validated).
Algorithm (server-authoritative — the server already holds both cost & selling):
1. Upsert the two premiums into `sofa_combo_tier_offsets` (`id=1`, set `updated_by`/`updated_at`).
2. Load **active Price-1 bases**: `tier='PRICE_1'`, `customer_id IS NULL`, `supplier_id IS NULL`, `deleted_at IS NULL`, reduce to the latest `effective_from ≤ today` per `(base_model, comboSlotsKey(modules))` (reuse the same reducer as `GET /`).
3. For each base, for `prem ∈ {PRICE_2: p2, PRICE_3: p3}`:
   - `selling[h] = base.selling_prices_by_height[h] + prem` for every height `h` where the base selling is a number; blanks stay blank.
   - `cost[h] = base.prices_by_height[h]` (copied — P2/P3 are the **same modules**, so the module cost is unchanged; the premium is a selling-only fabric upcharge).
   - **Insert** a new row: same `base_model` + `modules` + `customer_id=NULL` + `supplier_id=NULL`, `tier=PRICE_2|PRICE_3`, `effective_from = today`, `label = base.label`, `selling_prices_by_height = selling`, `prices_by_height = cost`, `notes = 'auto: P1 + tier premium'`.
4. Return `{ generated: <rowsInserted>, p1Count: <bases>, skipped: <bases with no selling at any height> }`.

Reuses existing validators (`validatePricesByHeight`) and the `rowToWire` shape. No new pricing math beyond integer addition.

> **Append-only + overwrite (point 4):** re-running inserts fresh `effective_from=today` PRICE_2/PRICE_3 rows. The latest row per scope (newest `effective_from`, then `created_at`) wins → any manual edit made since the last Apply is superseded. The manual row stays in History.

### 6.3 Pure helper (`packages/shared`)

`comboTierPrices(baseSelling: Record<string, number|null>, premiumSen: number): Record<string, number|null>` — adds the premium to each non-null height, preserves nulls. Unit-tested. Shared so a later server/POS reuse can't diverge.

### 6.4 UI (`apps/pos/src/components/products/SofaComboTab.tsx`)

- New **"Overall Edit price tier"** button in the header, beside **"+ New Combo"**, rendered only when `canEdit` (`mode === 'full'`).
- Opens a `ModalShell` panel (reuse the existing modal primitive):
  - Two number inputs (RM, step 1): **"Price 2 = Price 1 + RM ___"**, **"Price 3 = Price 1 + RM ___"**, pre-filled from `GET /tier-premiums` (sen→RM ÷100).
  - Caption: *"套用到所有 combo、所有座高（24/28/30/32/35）。Price 1 是每个 combo 自己的基准价。再按一次 Apply 会按公式重算并覆盖手改。"*
  - A confirm line on Apply: *"This will (re)generate Price 2 & Price 3 for N Price-1 combos and overwrite manual edits. Continue?"* (N from the current combo list).
  - **Apply** → `POST /tier-premiums/apply` → toast *"已为 N 个 combo 生成 Price 2 / Price 3"* → invalidate `['sofa-combos']` so cards refresh.
- New POS query hooks (mirror `useDeliveryFeeConfig`/`useUpdateDeliveryFeeConfig`) in `apps/pos/src/lib/products/sofa-combos-queries.ts`: `useSofaComboTierPremiums()` + `useApplySofaComboTierPremiums()`.

### 6.5 Role gate

- UI: button only in `full` mode (`master_account`/`admin`/`super_admin`).
- API: both write paths behind `requireWriteRole` (existing set). GET open to authed staff.

### 6.6 Pricing engine — untouched (verification)

No edits to `pickComboMatch` / `pickComboPrice` / `comboChargedPrices` / `computeSofaPrice` / `mfg-pricing-recompute.ts` / `orders.ts`. Generated rows flow through the unchanged lookup. The `POST /orders` recompute keeps re-deriving totals exactly as today. This is the core safety property and a test asserts pre/post parity for a fixed `(modules, tier)`.

---

## 7. Assumptions (locked unless corrected)

- Premiums are **flat RM**, one global `Δ2` + one global `Δ3`, applied to **every** base model, every combo, every seat height.
- The number edited is the **customer-facing SELLING** price; cost copies Price 1's (same modules).
- Re-Apply **overwrites** manual edits (Chairman point 4) — *differs* from the per-module #7 design's "explicit Reset button". Flagged; align only if asked.
- Combo **card layout unchanged**: still one card per `(modules, tier)`; Apply just makes the PRICE_2/PRICE_3 cards appear/refresh.
- A "Price-1 combo" = `tier='PRICE_1'`, `customer_id IS NULL`, `supplier_id IS NULL`, active.

---

## 8. Testing

1. **Unit** (`packages/shared`): `comboTierPrices` — adds premium, preserves nulls, integer-safe.
2. **API** (`apps/api`): `POST /tier-premiums/apply` generates correct PRICE_2/PRICE_3 selling = base+Δ across heights; cost copied; role gate returns 403 for sales; re-apply supersedes a manual edit (latest row wins).
3. **Parity guard**: `pickComboMatch` for a fixed `(modules, PRICE_2)` returns the same price before/after a no-op refactor (engine untouched).
4. `pnpm typecheck` clean.

Evidence to deliver before "done": test output + a POS screenshot of the panel + a before/after of a combo's generated PRICE_2/PRICE_3 cards.

---

## 9. Rollout

- Migration `0123` applied to **prod first + verified** (read-back the seeded `id=1` row) before deploy, per project practice for pricing tables.
- Standalone PR off `main`; merges independently of `feat/sofa-compartments-from-pool`.

## 10. Risks / coordination

- **Other section overlap:** if Phase B introduces its own global tier-premium store, reconcile at merge (this table is combo-scoped; theirs is module-scoped — they can stay separate or unify later).
- **Interim POS behavior:** until Phase B wires fabric→tier, POS looks up `PRICE_2`, so after Apply a combo build is charged the PRICE_2 (P1+Δ2) price for every customer. Documented; acceptable per scope decision.
- **Migration number:** main shipped `0122_reset_test_transactions_keep_so_fn` while this branch was open; mine was renumbered to `0123` (no collision).
