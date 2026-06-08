# Auto-SKU from product-page remark + extra charge — SPEC

> Date: 2026-06-08 · Decided with Loo (remote session) · Status: APPROVED design, pre-implementation
> Scope: POS + Backend + API + DB. Builds directly on the 2026-06-06 remark/extra-charge feature
> (`pos_product_remark`, `variants.extraAddonAmountRM`, sofa per-module split).
> Ships **Phase 1 + Phase 2 together** (Loo, 2026-06-08).

---

## 0 · Why

Today, when POS staff put an **extra add-on amount** on a product (e.g. sofa "Blatt", remark
"Seat 40cm Extend", +RM 500), the extra just folds into the line price. There is **no durable
record of that customised variant** — Finance can't trace it, and the shop can never re-sell the
exact same customisation without re-keying it.

New rule: **an extra-charged remark mints a real, traceable SKU.**

- Remark **with an extra price** → the system mints a **one-shot SKU** (one per sofa component) in
  SKU Master at order time. It inherits the base Model's code/name/description, carries the remark,
  is priced from the build, and is born **inactive** (a tombstone for track-back).
- Remark **without a price** → unchanged: a plain line-level remark, **no SKU** (the 2026-06-06
  behaviour, untouched).
- A one-shot SKU does **not** reappear in POS selection on the next order — unless an admin
  **re-activates** it from the Master-Admin **Allowed Options** panel, after which it behaves like a
  normal selectable variant that **reuses the base compartment's art**, with a different code/price.

## 1 · Locked decisions (Loo, 2026-06-08)

| # | Decision |
|---|---|
| D1 | **Trigger** = `extraAddonAmountRM > 0` on a line. Minting happens **server-side at SO create** (`POST /mfg-sales-orders`), atomically with the SO. Never at add-to-cart (avoids orphans on cancel). |
| D2 | **Remark-only (no extra) is unchanged** — line-level remark, no SKU. The whole minting path is gated by a new `so_settings` flag `pos_remark_extra_auto_sku`. |
| D3 | **One SKU per sofa component** (1A(LHF) + 1A(RHF) → two SKUs). Mattress/bedframe (single line) → one SKU. |
| D4 | **Selling apportionment** for the one-shot path = **whole build total (base + extra) ÷ N, evenly** (residue on last line). Normal sofa lines (no extra) keep the existing proportional-by-catalog-weight split. |
| D5 | **Cost**: the one-shot SKU's `cost_price_sen` is **left blank (NULL)**. The originating SO line keeps the **base module's real cost** (`unit_cost_centi` unchanged; extra portion = 0 cost). |
| D6 | **SKU code** = `{MODEL}-{normalizeCompartmentCode("{COMPARTMENT}-{REMARK_SLUG}")}` (uppercased) → e.g. `ANNSA-1A(LHF)(SEAT)(EXTEND)(40CM)`. The compartment portion MUST be the **canonical parens form** so Phase-2 re-selection (the configurator normalizes `moduleId`) yields the **identical** `item_code` and passes `checkAllowedOptions`. **Collision → append `-2/-3` to the raw `{COMPARTMENT}-{SLUG}` string then re-normalize** (stays normalization-stable). |
| D7 | **Born inactive** (`pos_active = false`, `one_shot = true`, `source_doc_no = <SO>`). Recorded in SKU Master for track-back; does **not** appear in POS selection until re-activated. |
| D8 | **Re-activation (Phase 2)** makes it selectable again in POS. Sofa: via the **Allowed Options** panel → add the compartment code to `allowed_options.compartments` + flip `pos_active`. Art reuses the base compartment PNG/SVG via a shared **`representativeArtCode()`** fallback (no maintenance-config write needed); **pricing auto-flows** because the one-shot SKU shares `base_model` (picked up by `sofaModuleSellingPricesFromSkus`). A **palette extension** renders the synthesized compartment (base geometry via `findModule`). Mattress/bedframe: flip `pos_active` only (the existing catalog gate). |
| D9 | **Re-activation price (Phase 2)** = **base module catalog price + (original extra ÷ N)** — recomputed at activation, not the stored even-split share. (For symmetric builds the two are identical.) Master Account can still edit `sell_price_sen` in SKU Master. |
| D10 | The sofa **palette extension** is a sanctioned **`UI_REFERENCE.md` deviation** (additive option reusing existing art + geometry; no snap-math / PNG / visual redesign). Sign-off given 2026-06-08. |

## 2 · Data model (migration `0161_one_shot_skus.sql`)

```sql
-- mark + trace system-minted one-shot SKUs
ALTER TABLE mfg_products ADD COLUMN one_shot      boolean NOT NULL DEFAULT false;
ALTER TABLE mfg_products ADD COLUMN source_doc_no text;            -- originating SO, e.g. 'SO-009559'

-- gate the whole minting behaviour (Pattern B-lite, same table as 0158)
INSERT INTO so_settings (key, enabled, label)
VALUES ('pos_remark_extra_auto_sku', false, 'Auto-mint SKU from remark + extra charge');
-- default OFF: ship code dark, flip ON after live verification (code-before-data rule).
```

- `mfg_products.cost_price_sen` is already nullable → blank cost needs no schema change.
- `mfg_products.code` / `name` / `description` / `base_model` / `model_id` / `branding` /
  `sell_price_sen` / `pos_active` / `status` already exist (schema.ts:1826).
- Apply via Supabase MCP (`apply_migration`); the GH workflow is known-broken (DATABASE_URL unset).
- ⚠️ **0160 is taken** (`0160_addons_service_sku.sql` on disk) → use **0161**. Re-verify the highest
  number on disk at implementation time — the ledger has dup-numbered migrations; check actual disk
  files + DB objects, don't trust `list_migrations`.

---

## 3 · Phase 1 — mint one-shot SKUs at order time

### 3.1 Trigger & gate (`apps/api/src/routes/mfg-sales-orders.ts`, `POST /`)

After the authoritative recompute + drift check, for each accepted line where
`variants.extraAddonAmountRM > 0` **and** `so_settings.pos_remark_extra_auto_sku` is ON: mint
one-shot SKU(s) and rewrite the line's `item_code`. When the flag is OFF, behaviour is exactly
today's (extra folds into price, no SKU).

### 3.2 What is minted (per one-shot `mfg_products` row)

| Field | Value |
|---|---|
| `id` | `mfg-{12 hex}` (existing id helper, mfg-products.ts:114) |
| `code` | `{MODEL}-{normalizeCompartmentCode("{COMPARTMENT}-{REMARK_SLUG}")}`, uppercased; collision → `-2/-3` (§3.3, D6) |
| `name` | `{base SKU name} ({remark})` → e.g. `SOFA ANNSA 1A(LHF) (Seat Extend 40cm)` |
| `description` | base description + remark (or just remark if base is empty) |
| `category` / `base_model` / `branding` / `model_id` | inherited from the base Model |
| `sell_price_sen` | the **re-activation list price** = base compartment catalog price + (extra ÷ N) (D9), computed at mint (§3.4) |
| `cost_price_sen` | **NULL** (blank) (D5) |
| `status` | `ACTIVE` |
| `pos_active` | **`false`** (D7) |
| `one_shot` | `true` (new column) |
| `source_doc_no` | the originating SO doc number (new column) |

### 3.3 Code & remark-slug rules (D6)

A shared pure helper (new `packages/shared/src/one-shot-sku.ts`) so client and server agree:

```ts
// "Seat Extend 40cm" -> "SEAT-EXTEND-40CM"
remarkSlug(remark): UPPERCASE → collapse non-alphanumerics to single '-' → trim '-' → cap ≤ 40 chars
// Compartment portion normalized to canonical parens (D6) so Phase-2 re-selection produces the same code:
oneShotModuleCode(compartment, slug, n?): normalizeCompartmentCode(`${compartment}-${slug}${n>1 ? `-${n}` : ''}`)
oneShotCode(modelCode, compartment, slug, n?): `${MODEL}-${oneShotModuleCode(compartment, slug, n)}`.toUpperCase()
```

- `COMPARTMENT` is the canonical parens code (`1A(LHF)`); for mattress/bedframe it is the size code
  (`(Q)`), matching the base SKU's code shape. Running the whole `{compartment}-{slug}` through
  `normalizeCompartmentCode` re-emits parens groups → `1A(LHF)(SEAT)(EXTEND)(40CM)`.
- **Collision**: the server checks `mfg_products.code` for the candidate; if taken, bump `n` (`-2`,
  `-3`, …) on the **raw** `{compartment}-{slug}-n` string and re-normalize (stays normalization-stable),
  until free. One batched `SELECT … WHERE code = ANY(...)` then resolve in memory (also against
  same-request candidates) — no per-candidate round-trip (CF 50-subrequest cap).

### 3.4 Pricing & cost (D4, D5, D9)

Two distinct prices, both computed at mint:

- **SO line sell price (this order)** = even split (D4). `splitSofaBuildIntoModuleLines`
  (so-sofa-split.ts:77) gains an **even-split mode** used only on the one-shot path: all-equal
  weights, so `distributeProportionally` (so-sofa-split.ts:54) yields `(buildTotal + extra)/N` per
  line with residue on the last → Σ still equals the drift-checked build total (drift does **not**
  re-fire).
- **SKU master list price (future reuse, D9)** = the base compartment's catalog price
  (`{MODEL}-{COMPARTMENT}` SKU `sell_price_sen`) **+ (extra ÷ N)**, stored on the one-shot row's
  `sell_price_sen`. Symmetric builds → equals the even share; asymmetric builds → the sensible
  standalone price (avoids absorbing other modules' value). This decouples "what this order charged"
  (the SO line) from "list price if reused" (the SKU row).
- **Cost** (D5): cost distribution (`unit_cost_centi`) on the SO line is **unchanged** — the physical
  sofa costs the same; the extra is pure markup, 0 cost. The minted SKU's `cost_price_sen` is **NULL**.
- **Mattress/bedframe**: single line, SO line sell = base + extra; SKU list price = base + extra
  (N = 1); `cost_price_sen` NULL; SO line keeps base cost.

### 3.5 Server flow & ordering (critical)

1. Recompute + drift gate run **on the original build** (base compartments) — unchanged. The base
   compartments are already validated against `allowed_options` by `checkAllowedOptions`
   (allowed-options-check.ts).
2. **Minting + `item_code` rewrite happen AFTER** that validation, so the custom code's compartment
   suffix is never fed back through `checkAllowedOptions` (it would 409 — the suffix isn't in
   `allowed_options.compartments`). One-shot lines are post-validation derived artifacts.
3. All minted rows for one SO go in **one batched `insert`** (CF subrequest cap lesson).
4. If the SKU insert succeeds but the SO insert later fails, the orphan one-shot rows are harmless
   (inactive tombstones) — acceptable; no compensating delete required for v1.

### 3.6 SO line rewrite

- Each affected SO line's `item_code` → the minted one-shot code.
- `variants.cells[].moduleId` **keeps the base compartment code** (`1A(LHF)`) so Backend/PDF sofa
  rendering uses the base art unchanged (Phase 1 needs **no** art/geometry work).
- `remark` continues to land on the **lead module line only** (existing P3 rule, mfg-sales-orders.ts
  ~1885); the one-shot codes carry the remark in their SKU `name`/`description`.

### 3.7 Result

SKU Master gains a traceable record per customisation; SO lines point at the custom codes; pricing
and cost follow D4/D5 — **all with zero configurator change.**

---

## 4 · Phase 2 — re-activation makes it selectable again

### 4.1 Activation surface (Backend Allowed Options panel)

`apps/backend/src/pages/ProductModelDetail.tsx` (SofaAllowedOptions, ~990–1094): the model's
one-shot SKUs (`mfg_products WHERE model_id = :id AND one_shot = true`) render as a distinct
**"One-shot / custom"** group with an **Activate** toggle, default off (separate visual treatment so
admin knows they're not standard pool compartments).

### 4.2 Sofa activation

On activate (a single backend endpoint, e.g. `POST /mfg-products/:id/activate-one-shot`):

1. Add the custom **compartment moduleCode** — `moduleCodeFromSku(code, base_model)` =
   `1A(LHF)(SEAT)(EXTEND)(40CM)` (canonical parens, D6) — to `product_models.allowed_options.compartments`.
2. Set the SKU `pos_active = true`. (`sell_price_sen` already holds the D9 price from mint — no recompute.)
3. **Art reuse — no maintenance-config write.** A shared `representativeArtCode(code)` (in `sofa-build.ts`:
   returns the code if it's a known `SOFA_MODULES` id, else `familyRepresentative(parseCompartmentStructure(code))`
   → `1A(LHF)`) is used by BOTH the POS image-key default (`queries.ts` `useSofaCustomizerData`, the
   `sofa-modules/${norm}.svg` line ~1303) and `resolveModuleArtSrc` (CustomBuilder.tsx:333–342 fallback) so
   the custom code renders the **base PNG/SVG**. No `sofaCompartmentMeta` seeding required.
4. **Palette extension** (the sanctioned deviation, D10): `apps/pos/src/pages/CustomBuilder.tsx`
   palette (~1030–1097) augments the static `SOFA_MODULES` list with synthesized specs for the model's
   custom compartments — `findModule(normalizedCode)` → base geometry via `synthesizeModule` /
   `parseCompartmentStructure` (sofa-build.ts:229,265). The existing `customizerByNormId` membership filter
   then includes them automatically.

Then it behaves like any compartment: tap → `addCell` (CustomBuilder.tsx:400) → `Cell.moduleId =
'1A(LHF)(SEAT)(EXTEND)(40CM)'`; pricing **auto-flows** because `sofaModuleSellingPricesFromSkus`
(sofa-build.ts:420) / `loadModelSofaModulePrices` (mfg-pricing-recompute.ts:503) key on
`(base_model, normalized compartment code)` and pick up the SKU's `sell_price_sen` with **no pricing
code change**; the Phase-2 SO split then mints `item_code = {MODEL}-{normalized code}` = the existing
one-shot SKU code, which `checkAllowedOptions` now accepts (it's in `allowed_options.compartments`).
Snap math, the 22 PNGs, drag — all untouched.

### 4.3 Mattress / bedframe activation

No configurator change: flip `pos_active = true`. For BEDFRAME/MATTRESS the catalog visibility gate
**is** `pos_active`, so the variant reappears in the POS catalog directly.

### 4.4 Re-activation price (D9)

The one-shot SKU's `sell_price_sen` **already holds the D9 price** (base compartment catalog price +
extra ÷ N), computed at mint (§3.4) — activation uses it directly; no recompute or original-cart
lookup needed. Master Account may override in SKU Master.

---

## 5 · SKU Master & Backend UI

- `apps/backend/src/pages/ProductModels.tsx` / SKU Master grid: a **"one-shot"** badge + a filter
  toggle; show `source_doc_no` (links to the SO).
- `GET /mfg-products` already returns the rows; surface `one_shot` + `source_doc_no` in the payload.
- Activate toggle wired in §4.1.

## 6 · UI_REFERENCE deviation (D10)

Add to `UI_REFERENCE.md` "Approved deviations": date 2026-06-08, scope = "POS sofa configurator
palette may render a Model's activated one-shot custom compartments as additional selectable options,
reusing the base compartment's existing PNG + geometry; no change to snap math, the 22 plan-view
PNGs, drag handling, or visuals."

## 7 · Out of scope

- POS retail `orders`/`products` legacy tables (POS creates SOs; legacy path untouched).
- DO/SI PDF treatment of one-shot codes beyond what already renders from `item_code` + base cells.
- Bulk re-activation / editing of many one-shot SKUs at once (single-row activate only, v1).
- Cost back-fill for one-shot SKUs (cost is deliberately blank).
- Combos/bundles interplay with one-shot compartments (one-shot path is custom-build only; combos are
  standard builds — not minted).

## 8 · Tests

- `packages/shared`: `remarkSlug`/`oneShotCode` (slug normalisation, collision suffix); even-split
  mode of `splitSofaBuildIntoModuleLines` (Σ == build total, residue on last); D9 re-activation price.
- API route: mint on extra>0 (gated by flag); `item_code` rewrite; minting runs after
  `checkAllowedOptions`; batched insert; no drift re-fire; mattress/bedframe single-SKU path.
- Backend: one-shot grid badge/filter; activate toggle writes allowed_options + meta + pos_active.
- POS: palette renders an activated custom compartment with base art; `addCell` → correct moduleId;
  live total uses the SKU price.

## 9 · Deploy order

1. Migration 0161 via Supabase MCP (additive — safe before code), flag default OFF.
2. API (wrangler) → Backend + POS (CF Pages via main).
3. Verify on live; flip `pos_remark_extra_auto_sku` ON; remind PWA hard-refresh for POS tablets.
4. Record the `UI_REFERENCE.md` deviation (§6).
