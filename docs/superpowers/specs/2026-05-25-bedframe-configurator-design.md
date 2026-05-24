# Bedframe configurator — design spec

> Status: DRAFT for Loo review · 2026-05-25
> Adds bedframes to the POS catalog + a multi-dimension bedframe configurator.
> Model names sourced from the manufacturing master (`mfg_products`); option
> CHOICE lists from the Maintenance config. **All POS retail pricing is owned by
> the Backend SKU Master — it does NOT follow the Maintenance tab or the mfg
> Product tab** (those are manufacturing cost/spec reference only).

## 1. Goal

Staff pick a bedframe Model in the POS catalog and configure it on a tab:
**size · colour · mattress gap · leg height · divan height · total height ·
specials**, then add to cart at a server-recomputed price.

## 2. Decisions (locked with Loo, 2026-05-25)

| # | Decision |
|---|---|
| Models | **18 base models** (by name; mfg variant suffixes `(A)`/`(HF)(W)`/`W/O PIPING` collapsed): HILTON, FENRIR, CODY, RICARDO, VALKRIE, JAGER, ARIZONA, COTY, TIFANNY, VICTORIA, ELEPHANE, REGAL, TRION, NINA, JACOB, CELENE, ELEGANT, DIVAN ONLY. |
| **Pricing ownership** | **Backend SKU Master only.** POS retail price does NOT follow Maintenance/mfg-Product tabs. Base price = placeholder (e.g. RM 2990) per Model+size, edited in SKU Master. All option/colour surcharges = **free (0) for pilot**; future surcharges set in SKU Master too. |
| Sizes | **Standard 4** as priced variants: 3FT→single, 3.5FT→super-single, 5FT→queen, 6FT→king (reuse `size_library`). **PLUS** optional free-text "special size" (e.g. `200 x 200`) captured on the order line for display — no structured price. |
| Colour | **Global `bedframe_colours` library**, all bedframes share it; Backend can **tick per-Model** which colours apply (`product_bedframe_colours`, default all-on). **All colours same / free for now**; surcharge column reserved for later. |
| Dimensions | Full set: size, colour, mattress gap, leg height, divan height, total height, specials (multi). **All required** — except DIVAN ONLY (below). |
| DIVAN ONLY | Special-cased: a single divan SKU. Configurator shows **size + colour + leg height only** (no gap / divan-height / total-height / specials). |
| Option choices | The gap/leg/divan/total/specials **value lists** are **snapshotted into a POS-owned `bedframe_options` table** at seed time (one-time copy of the current Maintenance values, surcharge 0). Fully decoupled from `maintenance_config` — edited in Backend from then on (Decision **B**, 2026-05-25). |

## 3. Architecture

### 3.1 Catalog products
Seed **18 `products`** (`category_id='bedframe'`, new `pricing_kind='bedframe_build'`),
one per base Model, `visible=true`, placeholder base, stable UUIDs (`ffffffff-…`),
optional `mfg_model_code` (e.g. HILTON → `1003`) for traceability. No brand/series.

### 3.2 Sizes
Reuse `product_size_variants` + `size_library` (the 4). Each product seeds the
standard sizes it offers @ placeholder retail (edited in SKU Master). Specials →
`sizeOther` free-text (§3.5), no structured price.

### 3.3 Colour library (new)
```
bedframe_colours(id text PK, label text, swatch_hex text,
                 surcharge integer DEFAULT 0, active boolean, sort_order int)
product_bedframe_colours(product_id uuid, colour_id text, active boolean DEFAULT true,
                         PRIMARY KEY(product_id, colour_id))   -- the per-Model tick
```
Global list, all surcharge 0 for pilot. Seed cross-joins all colours active onto
all 18 products (so "required colour" never blocks). Backend ticks per-Model later.
**Colour VALUES:** a neutral starter set for now (Loo refines soon) — proposing the
existing sofa palette for consistency: Sand / Stone / Charcoal / Forest / Rust.

### 3.4 Option choices — POS-owned `bedframe_options` (Decision B: snapshot, decoupled)
```
bedframe_options(
  id text PK,            -- 'gap-6','leg-7','divan-10','total-16','special-left-drawer'
  kind text,             -- 'gap'|'leg_height'|'divan_height'|'total_height'|'special'
  value text,            -- '6"','7"','Left Drawer'
  surcharge integer DEFAULT 0,   -- whole MYR, POS-owned (0 for pilot)
  active boolean DEFAULT true,
  sort_order integer
)
```
Seeded ONCE from a snapshot of the current `maintenance_config` values (gaps
4–10″, legHeights, divanHeights, totalHeights, specials) — values only, all
surcharge 0. From then on POS-owned: no live read of `maintenance_config`, no
coupling to the mfg side. The configurator reads `bedframe_options` by `kind`.
Future surcharges + list edits happen in Backend (SKU-Master domain), NOT the
Maintenance tab.

### 3.5 Order line config (`order_items.config`, bedframe)
```jsonc
{
  sizeId,                 // 'single'|'super-single'|'queen'|'king'
  sizeOther?,             // optional free-text special size "200 x 200" (display only)
  colourId,               // bedframe_colours.id   (required)
  gapId,                  // maintenance gaps value (required; hidden for DIVAN ONLY)
  legHeightId,            // maintenance legHeights value (required)
  divanHeightId,          // (required; hidden for DIVAN ONLY)
  totalHeightId,          // (required; hidden for DIVAN ONLY)
  specialIds: []          // maintenance specials (multi; hidden for DIVAN ONLY)
}
```

### 3.6 Pricing recompute (server-enforced — red line #4)
`computeBedframePrice(sizeVariantPrice, config, colours, bedframeOptions)`:
```
total = size_variant.price          (placeholder retail, SKU-Master-owned)
      + colour.surcharge             (bedframe_colours; 0 for pilot)
      + Σ option surcharges          (bedframe_options by id; 0 for pilot)
```
Lives in `packages/shared/src/pricing.ts`; POS + `POST /orders` share it. Client
vs server > 0.5% → 400. **No maintenance_config / mfg value enters the price.**
Options are captured (for the workshop / order display) but cost 0 until Loo sets
surcharges in Backend.

### 3.7 Configurator UI
New bedframe branch in `Configurator.tsx`:
- Size: 4 chips + "Special size (optional)" text input.
- Colour: swatch picker (reuse FabricColourPicker styling), only ticked colours.
- Gap / Leg / Divan / Total: labelled select rows (values from maintenance).
- Specials: multi-select chips.
- DIVAN ONLY: render only Size + Colour + Leg.
- Live total in topbar slot (= base size price for pilot, since options free).

### 3.8 Backend
- SKU Master: bedframes under the Bedframe category; Loo edits placeholder retail
  per size (existing size-variants PricingEditor). **All pricing lives here.**
- Colour: seed-only library for pilot + per-Model tick UI (later; default all-on).
- Maintenance tab: unchanged — still the place to edit the option value lists.

## 4. Migrations
1. `pricing_kind` enum `ADD VALUE 'bedframe_build'`.
2. `bedframe_colours` + `product_bedframe_colours` (+ RLS read-all-staff, realtime).
3. `bedframe_options` (+ RLS read-all-staff, realtime).
4. `products.mfg_model_code text NULL` (optional traceability).
5. Recreate `create_product_with_pricing` for the new kind if needed.

## 5. Seeds
- `bedframe-catalog.sql`: 18 products + standard-4 size variants @ placeholder + colour cross-join.
- `bedframe-colours.sql`: starter palette (Sand/Stone/Charcoal/Forest/Rust), free.
- `bedframe-options.sql`: one-time snapshot of current `maintenance_config` values (gaps/legHeights/divanHeights/totalHeights/specials), all surcharge 0.

## 6. Open dependencies
- Real colour list + any surcharges — Loo "soon" (starter palette ships meanwhile).
- Bedframe hero photos — none yet; catalog card falls back to the Model initial.

## 7. Out of scope
- mfg variant suffixes (collapsed to base Model).
- Real retail prices + option surcharges (Loo sets in SKU Master later).
- B2B / mfg sales-order linkage (POS retail only).
- Structured pricing for special (free-text) sizes.

## 8. Resolved
- ✅ Colour global + per-Model tick + free; ✅ all dims required; ✅ DIVAN ONLY = size+colour+leg.
- ✅ **Option lists: Decision B** — snapshot into POS-owned `bedframe_options` at seed; fully decoupled from `maintenance_config`; edited in Backend going forward.
