# Default Free Gift (Accessory) + PWP/Promo Card Polish — Design

> Date: 2026-06-13 · Status: **draft for review (v3 — accessory gifts; sofa trigger by combo)** · Author: Wei Siang (via Claude)
> Worktree: `default-free-gift` (branched fresh from `origin/main`)

Two deliverables in one feature branch:

1. **Card polish** — the PWP & Promo rule cards in the POS Products page blend into the cream background; give them a real surface + scannable Trigger→Reward layout. (Small, isolated, visual.)
2. **Default free gift (accessory)** — a per-trigger setting where buying a qualifying product (e.g. a mattress, or a matched **sofa combo**) automatically adds one or more **accessory** gifts at **RM 0**, shown in cart + checkout, labelled with an optional **campaign name**.

> **Scope note:** the **gift** is always a flat **accessory**. Gifting a *configurable* product (bedframe/mattress) or a **sofa combo** is **out of scope** — handled by the existing **Promo** flow ("Add New Promo" auto-issues a free promo code). Keeping the gift to flat accessories means an accessory is never a MAIN product and never a cross-category deliverable, so there is **no SO split and no delivery-fee change** (§3.7).

---

## 1. Locked decisions (brainstorming dialogue, 2026-06-13)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Where the gift is configured & stored | **On the trigger.** Non-sofa trigger → on the product (SKU Master). Sofa trigger → on the **combo** (Combo Pricing). |
| D2 | Gift quantity vs trigger qty | **One gift set per qualifying item** — gift qty scales with trigger line qty. |
| D3 | Card visual treatment | **Surface + labelled Trigger→Reward** (paper card, soft shadow, eyebrow, labelled rows, `+N more`). |
| D4 | What a gift line is | A **real RM 0 line** that flows to DO/SI/inventory — references an **Accessory** `mfg_product`. |
| D5 | Legacy "× N INCLUDED" customer rail | **Retire entirely** (remove the display-only rail; replace its admin editor). |
| D6 | Gift kinds in scope | **Accessory products only.** Configurable + sofa-combo gifts go to **Promo**. |
| D7 | Free pricing | **Only the base/principal price is waived (RM 0).** Any surcharge / special add-on is still calculated/charged. (Flat accessories have none → the line is simply RM 0.) |
| D8 | Cross-category / SO split | **None.** An accessory is never a MAIN product and never a cross-category deliverable → it shares the buyer's SO. |
| D9 | **Sofa trigger matching** | A **sofa** trigger is matched **by combo** (the cart's sofa build matches the combo), **never by individual compartment/module**. Mirrors PWP sofa triggers (`triggerComboIds`). |

**Campaign name** (per gift entry, free-text, optional): blank → the line shows generically as **"Free gift"**; filled (e.g. `Raya Campaign`) → shows that label. Price is **RM 0 / "Free"** regardless.

**Line merge:** gift lines obey the standard cart merge rules — identical SKU + identical remark → one line, qty ×2; differing remark → separate lines.

---

## 2. Part A — PWP & Promo card polish

**File:** `apps/pos/src/components/products/PwpRulesTab.tsx` (rule cards ~L337–361).
**Root cause:** the card container has a border but **no background fill**, so it inherits the cream canvas (`--c-cream #FFF9EB`) and melts into the page.

**Change (D3):**
- Card container: `background: var(--c-paper)` (`#F4F3F2`), `box-shadow: var(--shadow-2)`, `border: 1px solid var(--line)`, `border-radius: var(--radius-md)`, padding `var(--space-4)`. Lifts cleanly off the cream.
- **Type eyebrow** at top: `PWP · redeem at a set price` / `PROMO · redeem free` (`--fg-muted` small-caps eyebrow).
- **Labelled rows:** `TRIGGER · {Category}` + model summary; a `↓` glyph; `REWARD · {Category}` + reward summary. Long model lists truncate to `first, second · +N more` (reuse `itemSummary`, add a `+N more` tail).
- **Ratio** as a quiet line (`--fg-soft`); `· inactive` suffix preserved.
- Edit/delete icon buttons: behaviour unchanged; restyle to read on paper (keep `--c-burnt` delete colour).
- Inactive rules keep the `opacity: 0.55` fade.

**Non-goals:** no data/API change; no editor-form change; CSS/JSX only inside `PwpRulesTab.tsx`. Keep the two section headers as-is.

---

## 3. Part B — Default free gift (accessory)

### 3.1 Data model

Two new columns (one migration — number chosen at implementation time, §5):

```sql
ALTER TABLE mfg_products      ADD COLUMN IF NOT EXISTS default_free_gifts jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sofa_combo_pricing ADD COLUMN IF NOT EXISTS default_free_gifts jsonb NOT NULL DEFAULT '[]'::jsonb;
```

- `mfg_products.default_free_gifts` — gifts granted by a **non-sofa** trigger product (mattress / bedframe / accessory).
- `sofa_combo_pricing.default_free_gifts` — gifts granted by a **sofa** trigger, keyed to the **combo** (D9). `sofa_combo_pricing` is append-only/versioned; the field rides the combo row like `selling_prices_by_height` does (carries forward on edit).

Both hold the same entry shape (Drizzle in `schema.ts` + shared Zod in `packages/shared/src/schemas/`):

```ts
type DefaultFreeGift = {
  giftProductId: string;        // mfg_products.id of an ACCESSORY-category product (the gift is ALWAYS an accessory)
  qty: number;                  // count PER qualifying trigger unit (>=1)
  campaignName?: string | null; // free-text; blank => "Free gift"
};
```

- Effective cart qty for an entry = `entry.qty × triggerLine.qty` (D2).
- Multiple entries allowed per trigger (e.g. `2 × pillow` + `1 × bolster`).

**SO line marker — no new column.** A gift line is marked inside the existing `variants` JSONB on `mfg_sales_order_items`:

```ts
variants.freeGift = { triggerRef: string; triggerKind: 'product' | 'combo'; campaignName: string | null }
// triggerRef = the trigger product id (kind 'product') OR the combo id (kind 'combo')
```

`unit_price_centi = 0`; **cost is the real accessory cost** (truthful negative margin); inventory/COGS flow normally because it is a real SO line. No `gift_parent_doc_no`, no second SO (§3.7).

### 3.2 Auto-add, scaling, revert, no-chaining

New POS reconciler **`free-gift-sync.ts`** (twin of `pwp-code-sync.ts`) + cart-store changes (`apps/pos/src/state/cart.ts`):

- **Cart config marker:** add to `FlatConfigSnapshot` (the gift line) `isFreeGift?: boolean`, `freeGiftTriggerKey?: string`, `freeGiftCampaign?: string | null`. Gift lines always have `total = 0`.
- **Trigger detection (two paths):**
  - **Non-sofa trigger** — a cart line whose product has `default_free_gifts` (match by product id / model).
  - **Sofa trigger (D9)** — a sofa cart line whose build **matches a combo** that has `default_free_gifts`. Reuse the existing combo-match (`useSofaCombos` / `pickCombo`) the cart already uses for sofa pricing; match **by combo**, never by compartment.
- **Auto-add:** for each qualifying trigger × gift entry, ensure a `FlatConfigSnapshot` gift line keyed deterministically `gift-{triggerKey}-{entryIndex}`. Effective qty = `entry.qty × trigger.qty`.
- **Revert/remove:** trigger removed, or its product/combo changes so it no longer qualifies → remove the linked gift lines (mirror the `revertPwp` orphan sweep, `pwp-code-sync.ts` L147–154).
- **Qty derived:** gift line qty is computed → disable the qty stepper (reuse the `isPwpReward`-style affordance).
- **No chaining (one-way):** a line that is itself a gift (`isFreeGift === true`) never triggers gifts. Enforced in the reconciler and on the server.
- **No exclusivity change:** accessories already coexist with any category client-side (`accessory + sofa` shipped 2026-06-13). `cartCategoryConflict` untouched.

### 3.3 Config UI

Two surfaces, both granting accessory gifts:

- **SKU Master — "Default free gift" editor** (non-sofa triggers). Replaces the legacy `ProductGiftsDrawer`. 1..N rows, each: **accessory picker** (`useMfgProducts({category:'ACCESSORY'})`), **qty**, **campaign name** (optional). Persists via `PATCH /mfg-products/:id` body `{ defaultFreeGifts }` (extend existing route; reuse `EDIT_ROLES`). Hook `useUpdateMfgProductDefaultGifts`.
- **Combo Pricing — "Default free gift" section** per combo (sofa triggers, D9), in `SofaComboTab`. Same accessory-picker + qty + campaign rows, written onto the combo via the existing `useUpdateSofaCombo` mutation (`POST /sofa-combos`, `WRITE_ROLES`) alongside `sellingPricesByHeight`. The combo's append-only history carries `default_free_gifts` forward on edit.
- `MfgProductRow` / `SofaComboRule` gain `default_free_gifts`; the relevant row's gift indicator lights when non-empty.

### 3.4 POS display — cart + checkout

Mirror the existing PWP sub-line badge:
- **Cart** (`CartContents.tsx` L206–209, class `.lineSummary`): for `isFreeGift`, show price **"Free"** (RM 0) + sub-line `freeGiftCampaign ?? 'Free gift'`. Disable the qty stepper.
- **Handover summary** (`OrderSummaryPane.tsx` FormPane L82–86, class `.itemDetail`): same sub-line.
- Receipt / SO PDF: gift line renders as a normal RM 0 line; the campaign note rides in `variants.freeGift.campaignName`.

### 3.5 Server — validation + recompute (honest pricing, NON-NEGOTIABLE)

At `POST /mfg-sales-orders` (`apps/api/src/routes/mfg-sales-orders.ts`), extend the per-line recompute that already threads `pwpBaseByIdx`/`pwpSofaByIdx` into `recomputeFromSnapshot`:

1. Build a **trigger map** from the in-request lines:
   - non-sofa line whose product has `default_free_gifts` → `{ giftProductId → maxQty = entry.qty × line.qty }`;
   - sofa line whose **matched combo** (reuse the combo-match the recompute already performs for sofa pricing) has `default_free_gifts` → same map.
2. For each line carrying `variants.freeGift`:
   - Find a trigger entry whose `giftProductId` matches this line's product, qty ≤ allowed `maxQty`.
   - Valid → `pwpBaseSen = 0` → recompute returns `unit_price_sen = 0`; drift passes. **Base-only waiver (D7):** the 0 is the base; any surcharge/special-add-on amount on the line is still added (accessories have none → stays 0).
   - Invalid → `freeGiftRejections` → **`409 free_gift_not_eligible`** with the offending line (mirror `pwpRejections` L1877–1885). No silent reprice.
3. **Cost** snapshotted via `computeMfgLineCost` (real accessory cost).
4. **One-way:** a `freeGift` line is never added to the trigger map.

This closes the tamper hole: an RM 0 line without a matching trigger is rejected; the existing >0.5% drift gate is the backstop.

### 3.6 POS handover marshalling

`pos-handover-so.ts`: gift lines map to `PosHandoffItem` with `itemGroup = 'accessory'`, `unitPriceCenti = 0`, `variants.freeGift` attached. Single SO as today (no split).

### 3.7 Why there is no SO split or delivery-fee change

- **Sofa-exclusivity:** the server treats `ACCESSORY` (and `SERVICE`) as **always allowed** alongside a sofa (`mfg-sales-orders.ts` L1528/L1532–1539 — MAIN = {SOFA, BEDFRAME, MATTRESS}). An accessory gift never violates sofa-exclusivity, even when a sofa combo is the trigger.
- **Cross-category delivery fee:** `tripsCrossCategory` only fires for `sofa × (mattress|bedframe)` over `{sofa, mattress, bedframe}` (`pricing.ts` L170–171). Accessories aren't in that set → a free accessory never changes the delivery fee.
- Therefore: **no two-SO split, no `crossCategorySourceDocNo` interaction, no `gift_parent_doc_no` column.**

### 3.8 Retire the legacy "× N INCLUDED" rail (D5)

- Remove the customer-facing `RailSection title="Pillows · included free"` block in `apps/pos/src/pages/Configurator.tsx` (~L2079–2103) + its now-unused `includedPillows` memo.
- Remove / replace the admin `ProductGiftsDrawer` (Products.tsx ~L5378) and the `includedAddons` write path on the client; the new Default Free Gift editor (§3.3) takes its place.
- **Keep** `mfg_products.included_addons` column + historical data **dormant** (no migration, no delete).

---

## 4. Security / honest-pricing summary

- Every RM 0 gift line is **server-validated** against a trigger's `default_free_gifts` (product or matched combo) before being priced to 0; otherwise `409 free_gift_not_eligible`. The >0.5% drift gate is the backstop.
- Only the **base** is waived; surcharges/special-add-ons are still charged (D7).
- Role gates unchanged: `EDIT_ROLES` for product gifts, `WRITE_ROLES` for combo gifts.

---

## 5. Migration plan

Single migration `0170_default_free_gift.sql` (append-only; apply via Supabase MCP):
```sql
ALTER TABLE mfg_products       ADD COLUMN IF NOT EXISTS default_free_gifts jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sofa_combo_pricing ADD COLUMN IF NOT EXISTS default_free_gifts jsonb NOT NULL DEFAULT '[]'::jsonb;
```
No new tables, no RLS change (inherit table RLS), no backfill. `IF NOT EXISTS` makes a re-run / parallel-branch collision harmless.

> ✅ Worktree has been fast-forwarded to `origin/main` (#597); current highest migration is `0169_drop_pos_product_remark_setting`, so **`0170` is the next free number**. (Ledger ≠ files on disk — still re-confirm the live `mfg_products` / `sofa_combo_pricing` columns don't already exist before applying, and that no teammate landed a new `0170` in the meantime.)

---

## 6. Workstreams (for the implementation plan)

| WS | Scope | Risk |
|----|-------|------|
| WS1 | Card polish (`PwpRulesTab.tsx`) | low — isolated, ship first |
| WS2 | Migration + Drizzle + shared Zod (`default_free_gifts` on both tables) | low |
| WS3a | SKU Master Default Free Gift editor + `PATCH /mfg-products` field + accessory picker | medium |
| WS3b | Combo Pricing "Default free gift" section (sofa triggers) via `useUpdateSofaCombo` | medium |
| WS4 | Cart marker fields + `free-gift-sync.ts` (product **and** combo triggers; auto-add / scale / revert / no-chain) | medium-high |
| WS5 | Cart + checkout display ("Free · campaign") | low |
| WS6 | Server validation + recompute (product trigger + combo trigger; `409 free_gift_not_eligible`) | medium |
| WS7 | Retire legacy rail (Configurator rail + ProductGiftsDrawer) | low |

Suggested order: WS1 → WS2 → WS7 → WS3a → (WS4+WS5+WS6 end-to-end for a **product** trigger) → extend WS3b/WS4/WS6 to the **sofa combo** trigger. Each stage independently testable.

---

## 7. Test plan (high level)

- **Pricing/honest:** gift accessory recomputes to 0 with a valid product trigger AND with a valid sofa-combo trigger; `409 free_gift_not_eligible` when the trigger is absent or qty over-claimed; tampered RM 0 on a non-gift line still rejected by drift.
- **Sofa trigger by combo (D9):** a sofa build that matches the combo grants the gift; a sofa build that does NOT match the combo grants nothing; matching is by combo, not compartment.
- **Scaling:** trigger qty 1→2 doubles gift qty; removing the trigger removes its gifts; a gift line is not itself a trigger.
- **Same-SO:** sofa(combo trigger) + free accessory stays on ONE SO (no split, no delivery-fee change); mattress + free pillow stays on one SO.
- **Display:** "Free" + campaign label in cart and handover; blank campaign → "Free gift".
- **Legacy:** Configurator no longer shows "× N INCLUDED"; existing `included_addons` data untouched.
- **Unit:** the gift reconciler (both trigger paths); Zod schema for `default_free_gifts`; server gift-eligibility validation.

---

## 8. Resolved / out of scope

- ✅ Q1 — only the **base** is free; surcharge / special add-on charged (D7).
- ✅ Q2/Q3/Q5 — n/a (no split → no separate-SO payment, no two-SO API, no gift-SO graph node).
- ✅ Q4 — gift lines follow standard merge (same SKU+remark → qty ×2; differing remark → separate).
- ✅ Sofa trigger matched **by combo**, not compartment (D9).
- **Out of scope (use Promo):** configurable-product gifts (bedframe/mattress) and **sofa-combo gifts** (auto-issue a free promo code via "Add New Promo"). The Default Free Gift **gift** is accessory-only; the **trigger** may be a product or a sofa combo.
