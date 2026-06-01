# PWP Code Voucher System — Design Spec (v2)

> 2026-06-02. Chairman-driven. **SPEC ONLY — no code written yet.** A fresh
> session will implement from this. POS-SELLING only; cost/procurement untouched.
> Default data → ZERO price change.
>
> This supersedes the redemption mechanism of the shipped PWP v1. It does NOT
> change the rules model (multi-rule, shipped) or the per-SKU `pwp_price_sen`
> (shipped). It ADDS a voucher-code layer and KEEPS the in-cart toggle.

---

## 0. Where we are (already shipped + deployed on prod)

| Piece | Status | Where |
|---|---|---|
| `mfg_products.pwp_price_sen` (per-SKU PWP selling price) + SKU Master "PWP Price" column | ✅ shipped (PR #422, migration 0128) | `packages/db/src/schema.ts` ~1751; POS `apps/pos/src/pages/Products.tsx` SkuMasterTab grid |
| `pwp_rules` table (Trigger cat+models → Reward cat+models, ratio `qty_per_trigger`, active) | ✅ shipped (0128) + multi-rule (PR #424, migration 0129 dropped the one-per-pair unique idx) | schema.ts (`pwpRules`); API `apps/api/src/routes/pwp-rules.ts`; POS `apps/pos/src/components/products/PwpRulesTab.tsx` (multi-rule list + editor) |
| Pure `resolvePwp(rules, lines)` (shared by POS+server) | ✅ shipped | `packages/shared/src/pwp.ts` + `__tests__/pwp.test.ts` |
| Server PWP base in recompute (`recomputeFromSnapshot(... pwpBaseSen)`) | ✅ shipped | `apps/api/src/lib/mfg-pricing-recompute.ts` (~L259 `effectiveBaseSen`); order-level resolve in `apps/api/src/routes/mfg-sales-orders.ts` (~L930 pre-pass) |
| In-cart "Apply PWP" toggle (same-cart, no codes) | ✅ shipped | `apps/pos/src/pages/Configurator.tsx` (`pwpEval` memo, `pwpActive`, the toggle in the bedframe Build rail); `cart.ts` snapshot carries `pwp`/`pwpTriggerLabel`/`modelId`/`category`; `pos-handover-so.ts` threads `pwp`; sub-line in `CartContents.tsx` + `OrderSummaryPane.tsx` |

**Live env:** Supabase project `dolvxrchzbnqvahocwsu` (Singapore). Latest applied migration = `0129`. **Next migration = `0130`.** Live order path = `POST /mfg-sales-orders` (NOT `/orders`, which is an escape hatch). POS Master page = `apps/pos/src/pages/Products.tsx` (writes `sell_price_sen`/`pwp_price_sen`; the Backend app's Products.tsx is a separate cost-side surface — do NOT touch for PWP).

**Why the toggle "didn't appear" (diagnosed 2026-06-02):** the toggle is gated on the reward having `pwp_price_sen > 0`. ARIA bed frame had `pwp_price_sen = 0` for all sizes (rule was set, price was not). Setting a PWP Price in SKU Master makes the existing toggle appear. **Not a bug — a data gap.** The toggle stays (Chairman: "那个开关还是需要存在的").

---

## 1. Goal (白话)

把换购 (PWP) 从"同购物车开关"升级成一个**换购券 (PWP Code) 系统**，统一同单 + 跨单两种场景，并因此**自动解决沙发**（沙发自成一单，靠 code 跨单连起来，不用动 sofa-exclusivity）。

- **加触发品进 Cart → 后端立刻生成 N 个 PWP code 并全局占号**（N = `ratio × 触发品数量`，一个 code 换一个奖励）。
- **换购品 (Bed Frame) 配置器**：按 Apply → 自动填入同 Cart 的一个 code（不用手打）；另有「Insert PWP Code」栏给跨单手填。
- **移除触发品 → 它的 code 删掉（释放号）**，不算"用过"。
- **下单 Confirm**：被 apply 的 code → USED（印在 SO、锁死）；没 apply 的 → AVAILABLE（印在 SO，可留到下一单用）。
- **跨单**：把 SO 上的 AVAILABLE code 填进另一单 → 验证 → PWP 价 → USED。
- Server 在下单时**权威重算 + 锁 code**（防重复用、防伪、防撞号）。

---

## 2. Locked decisions

| # | Decision |
|---|---|
| C1 | **Codes 数 = `ratio × 触发品数量`.** Ratio 1:2 + 1 mattress → **2 codes** (NOT one code with capacity 2). Each code = single reward redemption. |
| C2 | **Code 一进 Cart 就 server 占号（全局唯一）.** Even when only saved to a Quote. Others cannot generate the same code (DB unique). |
| C3 | **移除触发品 → 它的 RESERVED codes 删除（释放）.** Deleting a code ≠ "used". One trigger SKU line owns its own code(s); remove the line → its codes go. |
| C4 | **下单 Confirm:** applied codes → `USED`; un-applied reserved codes → `AVAILABLE` (printed on the SO, redeemable in a future order). |
| C5 | **跨单**: an `AVAILABLE` code from a prior SO is entered manually in "Insert PWP Code" → validated → priced PWP → `USED`. |
| C6 | **Same-cart Apply auto-fills** a reserved code (no manual typing). The in-cart toggle is KEPT and now surfaces/consumes a code. |
| C7 | **Code format `PWP-NNNNAAAA`** = `PWP-` + 4 digits + 4 uppercase letters (human-readable; sales reads it off the SO + types it cross-order). |
| C8 | **Server is authoritative** at order placement: re-validate the code (exists, redeemable, reward model eligible under the code's rule) + atomically mark USED. A forged/used/ineligible code → reward reprices at full → drift → HTTP 400 for POS-tablet callers. |
| C9 | **Reward categories** = Mattress + Bed Frame for Phase 1 (both sit in one cart + PWP pricing wired). **Sofa reserved** (Phase 2). |
| C10 | Multi-rule already shipped; the code's rule reference snapshots the rule's `reward_category` + `eligible_reward_model_ids` so a later rule edit/delete never breaks an outstanding code. |

---

## 3. Code lifecycle (state machine)

```
                 add trigger SKU to cart/quote
                 (server reserves N = ratio×qty codes, globally unique)
                              │
                              ▼
                        ┌───────────┐   remove trigger line (pre-SO)
                        │ RESERVED  │ ───────────────────────────────►  (DELETED, number freed)
                        └───────────┘
                              │
            order Confirm ────┼──────────────────────────────┐
                              │                               │
                applied to a reward in THIS order      not applied
                              │                               │
                              ▼                               ▼
                        ┌───────────┐                   ┌────────────┐
                        │   USED    │                   │ AVAILABLE  │  (printed on SO)
                        └───────────┘                   └────────────┘
                                                              │
                              cross-order: entered in "Insert PWP Code"
                              + that order Confirm
                                                              ▼
                                                        ┌───────────┐
                                                        │   USED    │
                                                        └───────────┘
```

**States:** `RESERVED` (trigger in an open cart/quote — occupies the number, not yet bought) · `USED` (applied to a reward + that order confirmed) · `AVAILABLE` (trigger bought but code not applied → redeemable voucher).

---

## 4. Data model — migration `0130_pwp_codes.sql`

```sql
CREATE TABLE pwp_codes (
  code               text PRIMARY KEY,              -- 'PWP-1234ABCD' (globally unique = the occupy-the-number guarantee)
  rule_id            uuid REFERENCES pwp_rules(id) ON DELETE SET NULL,
  -- snapshot from the rule so a later rule edit/delete never breaks this code:
  reward_category    mfg_product_category NOT NULL,
  eligible_reward_model_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status             text NOT NULL DEFAULT 'RESERVED'
                       CHECK (status IN ('RESERVED','USED','AVAILABLE')),
  owner_staff_id     uuid REFERENCES staff(id) ON DELETE SET NULL,  -- who generated it (whose cart)
  cart_line_key      text,                          -- the trigger cart line that owns it (for delete-on-remove)
  trigger_item_code  text,                          -- the trigger SKU code (audit)
  source_doc_no      text,                          -- trigger SO (set at Confirm)
  redeemed_doc_no    text,                          -- reward SO that consumed it (set when USED)
  redeemed_item_code text,                          -- the reward SKU it paid for (audit)
  customer_id        uuid REFERENCES customers(id) ON DELETE SET NULL,  -- C2-binding: set when the code turns AVAILABLE at the trigger SO; a cross-order code redeems ONLY for this customer (see §8.8)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pwp_codes_owner_status ON pwp_codes (owner_staff_id, status);
CREATE INDEX idx_pwp_codes_cart_line   ON pwp_codes (cart_line_key);
-- RLS (mirror pwp_rules): SELECT for authenticated staff; INSERT/UPDATE/DELETE for
-- the staff system (the reserve/free/consume goes through the API with the staff's
-- JWT). Editors set = {admin,super_admin,coordinator,master_account} for admin ops;
-- but reserve/free/consume must be allowed for any sales staff (they own their cart).
-- ⚠️ RLS = NEW table — get Chairman OK before applying to prod (per red line #4).
```

Drizzle: add `pwpCodes` pgTable in `packages/db/src/schema.ts` after `pwpRules`. Add a `pwp_code_status` consideration (text + CHECK is fine, mirror existing string-status columns).

**Code generation (string):** `PWP-` + 4 random digits + 4 random uppercase A–Z. ~4.5B combos. On INSERT, retry on unique-violation (astronomically rare).

---

## 5. Server (API)

### 5a. Reserve on add-to-cart — `POST /pwp-codes/reserve`
Body: `{ cartLineKey, triggerItemCode, qty }`. Server:
1. Load the trigger product (category + model_id) by `triggerItemCode`.
2. For each active rule whose trigger matches (category + model in `trigger_eligible_model_ids` or empty=all): `n = qty_per_trigger × qty`. Generate `n` codes, status `RESERVED`, owner = caller staff, `cart_line_key`, snapshot `reward_category` + `eligible_reward_model_ids` from the rule.
3. Return the generated `[{ code, rewardCategory, eligibleRewardModelIds, ruleId }]`.
- Idempotency: if codes already exist for this `cart_line_key`, return them (don't double-generate). Re-reserve only the delta if qty grew.
- A trigger matching MULTIPLE rules → generate per rule (rare; document).

### 5b. Free on remove — `DELETE /pwp-codes/reserve?cartLineKey=...`
Delete all `RESERVED` codes for that `cart_line_key` (never touch `USED`/`AVAILABLE`).

### 5c. Validate / redeem-preview — `GET /pwp-codes/:code?rewardItemCode=...&customerId=...`
Returns `{ valid, reason, pwpPriceSen, rewardCategory, customerMatches }`:
- valid iff code exists AND status ∈ {RESERVED (owned by caller's cart) , AVAILABLE} AND the reward product's model ∈ the code's `eligible_reward_model_ids` (or empty) AND the reward product's category === code's `reward_category` AND that reward SKU's `pwp_price_sen > 0`.
- `pwpPriceSen` = the reward SKU's `pwp_price_sen` (per size). `used = false` here (preview only).
- `customerMatches`: for an AVAILABLE (cross-order) code, true iff the passed `customerId` (or name+phone) equals the code's `customer_id` (§8.8). When no customer passed yet (cart-stage Apply) → return the price anyway (optimistic); the handover gate (§6e) enforces the match once the customer is entered. RESERVED codes (same-cart) → `customerMatches` n/a (true).

### 5d. Consume at order Confirm — inside `POST /mfg-sales-orders`
Replace/extend the current order-level PWP pass (`resolvePwp` over cart lines, ~L930):
1. For each reward line carrying a `pwpCode` (from the cart line / handover variants): validate the code (5c rules) + the reward model eligibility. If valid → `pwpBaseSen = reward.pwp_price_sen` → priced PWP (existing `recomputeFromSnapshot(... pwpBaseSen)` path). Mark that code `USED` (atomic `UPDATE ... WHERE code=? AND status IN ('RESERVED','AVAILABLE')`; if 0 rows → already used → reprice full → drift).
2. For RESERVED codes owned by this order's triggers that were NOT applied: set `status='AVAILABLE'`, `source_doc_no = this SO`, **`customer_id = this SO's customer`** (binds the voucher to the earner — §8.8). (Carried-forward voucher.)
3. For RESERVED codes applied in this order: `status='USED'`, `source_doc_no = this SO`, `redeemed_doc_no = this SO`, `redeemed_item_code`.
4. Anti-tamper: a reward line claiming PWP price with no valid/redeemable code → server prices full → drift → 400 (POS-tablet). Same drift gate as today.
- **Atomicity:** the mark-USED must be a conditional UPDATE so two concurrent orders can't both consume one code.

### 5e. Code on the SO
The trigger SO response + the persisted SO must surface the codes (USED + AVAILABLE) so the printed/за displayed Sales Order shows them. Add `pwp_codes` to the SO read (by `source_doc_no`) for the SO detail/print.

---

## 6. POS

### 6a. Cart integration (reserve/free)
- `apps/pos/src/state/cart.ts` + `apps/pos/src/lib/cart-sync.ts`: when a line whose product is a **trigger** is added → call `POST /pwp-codes/reserve` (cartLineKey = the cart line `key`, qty = line qty) → store the returned codes on the trigger cart line (`pwpCodes: {code, ...}[]`). When removed (or qty reduced) → `DELETE` the freed codes. When qty increased → reserve the delta.
- The cart is per-staff (synced to `pos_carts`). Codes are owned by `owner_staff_id` so a staff's reserved codes follow them; another staff can't reserve the same number (DB unique).
- **How to know a product is a trigger:** it matches an active rule's trigger (category + model). The POS can call reserve unconditionally and the server returns `[]` if no rule matches (cheap), OR the POS checks `usePwpRules()` client-side first to avoid a call. Prefer: client-side check via `usePwpRules` + product category/model, then reserve only if it matches.

### 6b. Reward configurator (`Configurator.tsx`, bedframe; later mattress)
Replace the current `pwpActive` price logic with code-driven:
- **"Apply PWP" toggle (same-cart):** show when the cart has reserved codes whose `eligibleRewardModelIds` include this reward's model + `pwp_price_sen > 0`. Toggle On → auto-pick one unused reserved code from the cart → price = `pwp_price_sen` (+ fabric Δ + surcharges, same stacking as today) → store `pwpCode` + `pwp:true` + `pwpTriggerLabel` on the `BedframeConfigSnapshot`.
- **"Insert PWP Code" field (cross-order):** optional text input + Apply button, placed in the **Size area** of the reward configurator (Chairman's screenshot). On Apply → `GET /pwp-codes/:code?rewardItemCode=...` → valid → set the line to PWP price + store `pwpCode`. Invalid/used → show "Apply Failed".
- Display the applied code on the line (so the salesperson sees it). `cart.ts BedframeConfigSnapshot` gains `pwpCode?: string`.
- Keep the existing `resolvePwp`-based eligibility ONLY as the "is a code available in this cart" check for the toggle; actual pricing authority = the code.

### 6c. SO display
The confirmation screen + printed SO (`apps/pos/src/pages/Confirmed.tsx` / `SalesOrderPrint.tsx`) show the order's PWP codes (USED ones inline on the reward line as "PWP price · code PWP-XXXX"; AVAILABLE ones in a "PWP vouchers earned" block so the customer can use them next time).

### 6d. `pos-handover-so.ts`
Thread `pwpCode` into the SO item variants (alongside the existing `pwp` flag) so the server's consume step (5d) knows which code each reward line claims.

### 6e. Handover customer-match gate (cross-order codes) — Chairman C2
At the handover customer-entry step (`apps/pos/src/pages/Handover.tsx`, the "Next" after name/phone): if any reward line carries a **cross-order (AVAILABLE)** `pwpCode`, validate the entered customer against the code's `customer_id` (server check — extend `GET /pwp-codes/:code` to take a `customerId`/name+phone and return `customerMatches`). **Mismatch → block Next with "PWP code invalid for this customer" + revert that line to full price** (clear its `pwpCode`/`pwp` flag → LIVE TOTAL updates). **Match → proceed.** Same-cart (RESERVED) codes skip this gate (same order's customer). This is also re-checked server-side at Confirm (5d) — the handover gate is the UX; the server is authoritative.

---

## 7. Phase split

- **Phase 1 — Mattress ↔ Bed Frame, full code lifecycle.** migration 0130 + `pwp_codes` + reserve/free/validate/consume endpoints + cart reserve/free integration + reward configurator (Apply auto-fill toggle + Insert-code field) + SO display + anti-tamper. Keep the toggle. Mattress as trigger, Bed Frame as reward (and Bed Frame trigger → Mattress reward, symmetric, since both are wired).
- **Phase 2 — Sofa.** (a) Sofa **Combo** as a trigger: the `pwp_rules` trigger for a SOFA-category rule references **combo ids** (not model ids) — extend the rule model + the reserve step to recognise a sofa build that matches a combo and reserve codes then. (b) Sofa / Mattress as **reward**: wire sofa `pwp_price_sen` into the recompute (today `recomputeFromSnapshot` excludes `category === 'SOFA'` from the authoritative selling branch — needs a sofa PWP path). Cross-order is the natural flow (sofa is its own cart).

---

## 8. Edge cases (must handle)
1. **Concurrent consume** of one code by two orders → atomic conditional UPDATE; loser reprices full → 400.
2. **Trigger removed after a reward applied its code (same cart):** freeing the trigger's RESERVED codes must NOT free a code already earmarked by a reward line in the same cart — or, simpler, re-validate at Confirm (the reward line's code must still be valid; if the trigger was removed, the reserved code was deleted → reward reprices full → 400 / toggle clears). Decide: on trigger removal, also clear any same-cart reward line that auto-applied one of its codes (re-run the toggle eval). Recommend: re-evaluate reward lines when cart changes (the `pwpEval` already reacts to `cartLines`).
3. **qty changes** on a trigger line → reserve/free the delta.
4. **Quote save/restore:** reserved codes persist with the quote (owner_staff_id). Restoring a quote must re-attach the codes (they're keyed by cart_line_key / owner). Deleting a quote frees its RESERVED codes.
5. **Abandoned carts:** RESERVED codes with no SO linger. Add a reaper (cron) OR free them when the cart is cleared. (Phase 1: free on cart clear + on logout; a TTL reaper can come later — `log()` the policy.)
6. **Reward `pwp_price_sen = 0`** → code can't apply (no PWP price) → Apply Failed / toggle hidden.
7. **Rule deleted/deactivated after codes generated:** the code snapshotted `reward_category` + `eligible_reward_model_ids`, so it still redeems (Chairman can decide if deactivating a rule should also invalidate outstanding codes — default: outstanding codes honour their snapshot).
8. **Customer binding (LOCKED — Chairman 2026-06-02):** a cross-order (AVAILABLE) code is bound to the customer who earned it. `customer_id` is set when the code turns AVAILABLE at the trigger SO Confirm (customer is known by then). Redemption flow:
   - (1) At add-to-cart, "Apply" / "Insert PWP Code" succeeds and shows the PWP price **even though no customer is entered yet** (optimistic — customer isn't collected until handover).
   - (2) At handover, the salesperson fills the customer name / phone (first line) and clicks **Next** → the server validates the entered customer matches the code's `customer_id`.
   - (3) **Mismatch → error "PWP code invalid for this customer" → the PWP price auto-reverts to full** (clear the code/PWP flag on that line). Cannot Continue until resolved.
   - (4) **Match → no error, PWP price holds, Continue.**
   - Same-cart (RESERVED→USED in ONE order) needs no match (it's the same order's customer). Match key = `customer_id` (resolve the handover customer to a `customers` row; fall back to name+phone match if the customer has no id yet).

---

## 9. Acceptance criteria
1. Add a trigger mattress to cart → `pwp_codes` gets N=ratio×qty RESERVED rows owned by that staff; the cart line carries the codes. Another staff cannot get the same code string.
2. Remove the mattress → its RESERVED codes are deleted.
3. Configure an eligible bed frame (PWP price set) → "Apply PWP" toggle shows; On → line priced at PWP + shows the code; LIVE TOTAL updates.
4. Confirm the order → applied code = USED, printed on SO; any un-applied reserved code = AVAILABLE, printed on SO as an earned voucher.
5. New order, different/empty cart → "Insert PWP Code" with that AVAILABLE code → priced PWP; Confirm → USED. Re-using the same code → "Apply Failed" / 400.
6. Tamper (claim PWP price with no/used/ineligible code) → server reprices full → HTTP 400 (POS-tablet).
7. **Default (no rules / no PWP prices) → ZERO change.** typecheck + shared/api/pos tests green.
8. Sofa untouched in Phase 1 (no sofa trigger/reward yet).

---

## 10. File map (verified this session)
- DB: `packages/db/src/schema.ts` (add `pwpCodes`); `packages/db/migrations/0130_pwp_codes.sql` (new). Apply to prod via Supabase MCP after Chairman RLS OK. Latest applied = 0129.
- Shared: `packages/shared/src/pwp.ts` (`resolvePwp` — reuse for trigger-match in reserve + toggle eligibility); `packages/shared/package.json` exports `./pwp`.
- API: NEW `apps/api/src/routes/pwp-codes.ts` (reserve/free/validate) + register in `apps/api/src/index.ts`; `apps/api/src/routes/mfg-sales-orders.ts` (~L930 consume step replaces the resolvePwp-only pass); `apps/api/src/lib/mfg-pricing-recompute.ts` (pwpBaseSen already there). Existing `apps/api/src/routes/pwp-rules.ts` unchanged.
- POS: `apps/pos/src/state/cart.ts` (+`pwpCode`, `pwpCodes` on lines); `apps/pos/src/lib/cart-sync.ts` (reserve/free hooks); `apps/pos/src/pages/Configurator.tsx` (toggle → code-driven + Insert-code field in Size area); `apps/pos/src/lib/products/pwp-queries.ts` (+ reserve/free/validate hooks); `apps/pos/src/lib/pos-handover-so.ts` (thread `pwpCode`); `apps/pos/src/pages/Confirmed.tsx` / `SalesOrderPrint.tsx` (show codes).
- Branch so far: `feat/pwp-multi-rules` (multi-rule shipped via #424). The new session should branch fresh off latest `origin/main` (which already has all shipped PWP). Worktree: `C:\Users\User\2990s\.claude\worktrees\pwp`.

## 11. Open questions for the implementer / Chairman
1. **Abandoned RESERVED codes** — free on cart-clear/logout only (Phase 1), or add a TTL reaper cron? (Recommend: free on clear/logout now; reaper later.)
2. ✅ **RESOLVED (Chairman 2026-06-02) — customer-bound.** See §8.8 + §6e: code binds to the earning customer at the trigger SO; cross-order redemption is validated at the handover "Next" step (mismatch → error + revert price to full). `pwp_codes.customer_id` added. Apply still works pre-customer (optimistic); the gate fires when the customer is entered.
3. **Sofa Combo trigger (Phase 2)** — confirm the rule's sofa trigger references combo ids; confirm sofa-as-reward needs `pwp_price_sen` wired into the recompute's selling path.
4. **One trigger matching multiple rules** — generate codes per matching rule (could over-issue). Acceptable, or restrict a trigger to one rule?

---

## 12. Implementation order (suggested for the new session)
1. migration 0130 + Drizzle `pwpCodes` + (get Chairman RLS OK) apply to prod.
2. `pwp-codes.ts` route (reserve/free/validate) + register + tests.
3. Cart reserve/free integration (cart.ts + cart-sync.ts) + POS hooks.
4. Reward configurator: code-driven toggle + Insert-code field (Size area).
5. `mfg-sales-orders.ts` consume step (USED/AVAILABLE) + anti-tamper + tests.
6. SO display (Confirmed + print) + handover-so threading.
7. Verify (typecheck, shared/api/pos tests, build) → PR → Chairman GO → merge → deploy → live e2e.
8. Phase 2 (sofa) separately.
