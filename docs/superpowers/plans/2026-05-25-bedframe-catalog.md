# Bedframe Configurator Implementation Plan (full)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the 18 base bedframe models to the POS catalog with a full configurator (size + special-size text · colour · mattress gap · leg height · divan height · total height · specials), priced + recomputed server-side.

**Architecture:** Bedframes are `pricing_kind='bedframe_build'`. Colour = new global `bedframe_colours` library + per-Model tick `product_bedframe_colours` (mirrors sofa `fabric_colours`/`product_fabrics`). Option choice-lists = POS-owned `bedframe_options` (Decision B — one-time snapshot of `maintenance_config`, then decoupled). All POS pricing owned by SKU Master; every option free for pilot (surcharge columns reserved). Price recompute lives in shared `pricing.ts`, enforced on `POST /orders`.

**Tech Stack:** Drizzle/Postgres + Supabase MCP, Hono Worker, React/Vite POS, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-25-bedframe-configurator-design.md`
**Closest analog (follow it):** the sofa fabric/colour feature — migration `0044_sofa_fabric_colour.sql`, `fabric_library`/`fabric_colours`/`product_fabrics`, `FabricColourPicker.tsx`, `fabricSurchargeFor` + the sofa branch of `computeOrderTotal` in `packages/shared/src/pricing.ts`, the fabric integration in `order-v1.schema.ts`/`cart.ts`/`orders.ts`/`POST /orders`. Bedframe mirrors this shape.

---

## File structure
- Migration: `packages/db/migrations/00NN_bedframe_configurator.sql` (next free number).
- Schema: `packages/db/src/schema.ts` — add 3 tables + `bedframe_build` enum value.
- Seeds: `packages/db/seeds/bedframe-catalog.sql`, `bedframe-colours.sql`, `bedframe-options.sql`.
- Shared: `packages/shared/src/schemas/order-v1.schema.ts` (+ `order.schema.ts`), `packages/shared/src/pricing.ts` (+ tests).
- POS: `apps/pos/src/pages/Configurator.tsx` (bedframe branch), `apps/pos/src/components/BedframeOptions.tsx` (new), `apps/pos/src/lib/queries.ts` (hooks), `apps/pos/src/state/cart.ts`, `apps/pos/src/lib/orders.ts`.
- API: `apps/api/src/routes/orders.ts` (recompute branch) + test.
- Backend: `apps/backend/src/lib/queries.ts` (bedframe colour/options load) — SKU-Master size pricing already works.

## The 18 models (UUID `ffffffff-…-00NN`)
0001 Hilton(1003) 0002 Fenrir(1005) 0003 Cody(1007) 0004 Ricardo(1008) 0005 Valkrie(1009)
0006 Jager(1013) 0007 Arizona(1019) 0008 Coty(1023) 0009 Tifanny(1030) 0010 Victoria(1041)
0011 Elephane(2003) 0012 Regal(2006) 0013 Trion(2009) 0014 Nina(2027) 0015 Jacob(2033)
0016 Celene(2038) 0017 Elegant(2041) 0018 Divan(DIVAN). SKU `BED-<NAME>`, all `visible`, `stock=99`.

---

### Task 1: Migration — enum + 3 tables

**Files:** Create `packages/db/migrations/00NN_bedframe_configurator.sql`; modify `packages/db/src/schema.ts`.

- [ ] **Step 1: Write the migration** (mirror `0044_sofa_fabric_colour.sql` for RLS + realtime boilerplate)

```sql
-- 00NN_bedframe_configurator.sql
ALTER TYPE pricing_kind ADD VALUE IF NOT EXISTS 'bedframe_build';

CREATE TABLE IF NOT EXISTS bedframe_colours (
  id text PRIMARY KEY, label text NOT NULL, swatch_hex text,
  surcharge integer NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS product_bedframe_colours (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  colour_id text NOT NULL REFERENCES bedframe_colours(id),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (product_id, colour_id)
);
CREATE TABLE IF NOT EXISTS bedframe_options (
  id text PRIMARY KEY,
  kind text NOT NULL,            -- 'gap'|'leg_height'|'divan_height'|'total_height'|'special'
  value text NOT NULL,
  surcharge integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);
-- RLS: read for any authenticated staff; write admin/coordinator. Copy the exact
-- policy + realtime publication lines from 0044 for the 3 tables.
ALTER TABLE bedframe_colours ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_bedframe_colours ENABLE ROW LEVEL SECURITY;
ALTER TABLE bedframe_options ENABLE ROW LEVEL SECURITY;
-- (policies + ALTER PUBLICATION supabase_realtime ADD TABLE … — mirror 0044)
```

- [ ] **Step 2:** Add the 3 tables + `'bedframe_build'` to the `pricingKind` enum array in `packages/db/src/schema.ts` (Drizzle), matching the `fabricColours`/`productFabrics` table definitions' style.
- [ ] **Step 3:** `pnpm --filter @2990s/db typecheck` (or build) — expect clean.
- [ ] **Step 4: Commit** `feat(db): bedframe configurator schema (colours, options, enum)`.

### Task 2: Seeds

**Files:** Create the 3 seed files.

- [ ] **Step 1: `bedframe-catalog.sql`** — 18 products (`pricing_kind='bedframe_build'`, `category_id='bedframe'`, `mfg_model_code` set, `img_key`=`https://2990s-pos.pages.dev/catalog/mattress-bed.png`), standard-4 `product_size_variants` @ 2990, and a cross-join of all `bedframe_colours` into `product_bedframe_colours` (active). Stable UUIDs `ffffffff-…-0001..0018`, idempotent ON CONFLICT. (Pattern: `mattress-catalog.sql`.)
- [ ] **Step 2: `bedframe-colours.sql`** — starter palette, all surcharge 0:
  `('sand','Sand','#D8C7A8'), ('stone','Stone','#B8B0A4'), ('charcoal','Charcoal','#3A3A3A'), ('forest','Forest','#3B5141'), ('rust','Rust','#A6471E')` (sort 1–5, active). Idempotent.
- [ ] **Step 3: `bedframe-options.sql`** — snapshot the CURRENT maintenance values (from the spec / a fresh `SELECT config FROM maintenance_config_history ORDER BY effective_from DESC LIMIT 1`): gaps 4″–10″ (kind `gap`); legHeights No Leg/1″/2″/4″/6″/7″ (kind `leg_height`); divanHeights 4″–16″ (kind `divan_height`); totalHeights 10″–28″ (kind `total_height`); specials (kind `special`). **ALL `surcharge=0`** (POS-owned; ignore the maintenance sen values). Deterministic `id` per row e.g. `gap-6`, `leg-7`, `special-left-drawer`. Idempotent.
- [ ] **Step 4: Commit** `feat(db): bedframe seeds (catalog, colours, options snapshot)`.

### Task 3: Shared — BedframeConfig Zod

**Files:** `packages/shared/src/schemas/order-v1.schema.ts`, `order.schema.ts`; tests `order-v1.schema.test.ts`.

- [ ] **Step 1: Write failing test** — a valid bedframe line `{ kind:'product', productId, qty:1, config:{ sizeId:'queen', colourId:'sand', gapId:'gap-6', legHeightId:'leg-4', divanHeightId:'divan-8', totalHeightId:'total-14', specialIds:[] } }` passes; a DIVAN line with only `{ sizeId, colourId, legHeightId }` passes; missing `colourId` fails.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Add `BedframeLineConfig`** to the config union: `{ sizeId: string; sizeOther?: string; colourId: string; gapId?: string; legHeightId: string; divanHeightId?: string; totalHeightId?: string; specialIds?: string[] }`. Required-ness: `sizeId,colourId,legHeightId` always; `gapId,divanHeightId,totalHeightId,specialIds` required for non-DIVAN (superRefine keyed off the product, OR keep optional in shape + enforce in UI — match how sofa fabric required-ness is done). Mirror in `order.schema.ts`.
- [ ] **Step 4: Run — passes.** **Step 5: Commit.**

### Task 4: Shared — computeBedframePrice + recompute wiring

**Files:** `packages/shared/src/pricing.ts`; `packages/shared/src/__tests__/pricing.test.ts`.

- [ ] **Step 1: Write failing tests** — base size price only (all options 0) → equals size variant price; with a (hypothetical) priced colour/option → adds surcharge; unknown colourId → throws `unknown_bedframe_colour`.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement**
```ts
// total = sizeVariant.price + colour.surcharge + Σ option.surcharge (by id)
export function computeBedframePrice(args: {
  sizeVariantPrice: number;
  config: BedframeLineConfig;
  colours: { id: string; surcharge: number }[];
  options: { id: string; surcharge: number }[];
}): number { /* lookup + sum; throw on unknown ids (mirror fabricSurchargeFor errors) */ }
```
Wire a `bedframe_build` branch into `computeOrderTotal` (next to the sofa branch), looking up the product's active size-variant price + the colours/options arrays passed in.
- [ ] **Step 4: Run — passes.** **Step 5: Commit.**

### Task 5: POS queries — colours + options hooks

**Files:** `apps/pos/src/lib/queries.ts`.

- [ ] Add `useBedframeColours()` + `useBedframeOptions()` (read `bedframe_colours` active, `product_bedframe_colours` for the product, `bedframe_options` grouped by `kind`) + realtime, mirroring `useProductFabrics`. Commit.

### Task 6: POS configurator — bedframe branch

**Files:** `apps/pos/src/pages/Configurator.tsx`; new `apps/pos/src/components/BedframeOptions.tsx` (+ `.module.css`).

- [ ] Render a `bedframe_build` branch: size chips (reuse size-variant picker) + a "Special size (optional)" text input → `sizeOther`; colour swatch picker (only ticked colours, reuse FabricColourPicker styling); gap / leg / divan / total as labelled select rows from `bedframe_options` by kind; specials multi-select chips. **DIVAN ONLY** (`sku='BED-DIVAN'` / `mfg_model_code='DIVAN'`): render only size + colour + leg. Live total in the topbar slot (= base size price for pilot). Gate Add-to-Cart on required selections. Commit.

### Task 7: POS cart + order body

**Files:** `apps/pos/src/state/cart.ts`, `apps/pos/src/lib/orders.ts`.

- [ ] Snapshot the bedframe `config` (+ resolved labels for display) into the cart line; `buildPostBody` carries the `BedframeLineConfig`. Mirror the sofa fabric snapshot. Commit.

### Task 8: API server recompute

**Files:** `apps/api/src/routes/orders.ts`; `apps/api/src/routes/orders.test.ts`.

- [ ] **Step 1: Failing test** — POST a bedframe order; server recomputes via `computeBedframePrice`; tampered total (>0.5%) → 400. **Step 2: fails. Step 3:** add the `bedframe_build` branch to the recompute (load size-variant price + bedframe_colours + bedframe_options, call `computeBedframePrice`). **Step 4: passes. Step 5: commit.**

### Task 9: Backend load (display) + typecheck gate

**Files:** `apps/backend/src/lib/queries.ts`.

- [ ] Ensure bedframe order lines render their config (size/colour/options) in order detail (mirror how sofa fabric suffix is shown). SKU-Master size pricing already works for `size_variants`-shaped variants; confirm `bedframe_build` products show in the Bedframe category + size-variant pricing editor. Commit.
- [ ] **Full gate:** `pnpm typecheck` + `pnpm test` (shared/api/backend) green. Fix any drift.

### Task 10: Ship + apply + verify

- [ ] Push `feat/bedframe-configurator`, open PR → main.
- [ ] Apply migration (Supabase MCP `apply_migration`) + the 3 seeds (`execute_sql`) to prod `dolvxrchzbnqvahocwsu`. Verify: 18 bedframe products, 72 size variants, 5 colours, options rows by kind, all `img_key` set.
- [ ] Merge → watch deploy green → Loo eyeballs live (Bed frames category → configure → size/colour/gap/leg/divan/total/specials; DIVAN ONLY shows only size+colour+leg). PWA hard-refresh.

---

## Self-review
- **Spec coverage:** §2 decisions (T1–T2 data, T3 required-ness, T6 DIVAN special-case, pricing-in-SKU-Master via placeholder seed); §3.1 catalog (T2); §3.2 sizes + sizeOther (T2,T3,T6); §3.3 colours (T1,T2,T5,T6); §3.4 bedframe_options snapshot/Decision B (T1,T2,T5,T6); §3.5 config (T3); §3.6 recompute (T4,T8); §3.7 UI (T6); §3.8 backend (T9); §4 migrations (T1); §5 seeds (T2). No gaps.
- **Placeholders:** load-bearing logic (Zod shape, computeBedframePrice signature, migration DDL, seed contents) is concrete; UI/queries/cart/recompute steps point to the exact sofa-fabric analog to follow (subagents read it).
- **Consistency:** `BedframeLineConfig` field names identical across T3/T4/T6/T7/T8; `bedframe_options.kind` values fixed; UUID range 0001–0018.

## Dependencies / deferred
- Real colour list + any surcharges — Loo later (1-line seed update; starter palette ships now).
- Per-Model colour tick UI in Backend — default all-on; tick UI optional follow-up.
- Bedframe hero photos — shared bed line-art for now.
