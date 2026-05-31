# Sofa Compartments from Maintenance Pool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every sofa-compartment list in the app (combo picker + Customize palette) driven by the Maintenance Sofa Compartments pool — so pool-only codes (`1S`/`2S`/`3S`, recliner/power variants, `Console`) become first-class: selectable in combos, placeable in Customize with their uploaded PNG art, priceable, and combo-matchable — then re-wire the SKU Master Edit-Price grid to set the sofa SELLING (buyer) price with P1-base tier auto-derive.

**Architecture:** Phase A appends 9 geometry rows + a `'3-seater'` group to the shared `SOFA_MODULES` catalogue, renames code-side `WC-45` → `Console` (and sweeps the data), repoints the combo picker to read `config.sofaCompartments` from the resolved master maintenance config, and inverts the Customize palette to iterate the Model's activated compartments directly (PNG art from the pool). Phase B adds an optional per-`(height,tier)` `sellingPriceSen` to the seat-height entry, a `resolveSeatHeightSelling` resolver, and a depth/tier-aware `SofaModulePriceSen` assembly helper consumed identically by POS and the server drift gate; the POS sofa Edit-Price grid is re-wired to write `sellingPriceSen` with global Δ2/Δ3 tier auto-derive, pin-on-manual-edit, and a Reset-to-formula button — all Master-Admin-gated.

**Tech Stack:** pnpm + Turborepo monorepo; React 19 + Vite (apps/pos, apps/backend); Hono on CF Workers (apps/api); Drizzle + Supabase Postgres; Vitest. Money in sen (integer; 100 sen = RM 1).

---

## ⚠️ Open question / conflict for Chairman (resolve before merging Phase A)

There are **two contradictory decisions on the books** for what `WC-45` becomes:

| Source | Date | Decision |
|---|---|---|
| `SOFA-SELLING-PLAN.md:19,44` (repo root) | earlier | **WC-45 → CNR.** "Naming: WC-45 (old retail) = CNR (backend). Use CNR everywhere; WC-45 retires." The data-copy table (line 44) maps the old `WC-45` price (RM 590) into `<MODEL>-CNR`. |
| `docs/superpowers/specs/2026-05-31-sofa-compartments-from-maintenance-pool-design.md` decision 5 | 2026-05-31 (newer) | **WC-45 → Console.** Merge `Console`, `Console/WC` (pool) and code-side `WC-45` into a single `Console`. |

**Recommendation:** the **newer 2026-05-31 Console decision wins** (it is dated, Chairman-confirmed, and the spec this plan implements). But this is a one-way door for data, so confirm before the migration runs.

**What currently assumes CNR (so it isn't silently broken):**
- `SOFA-SELLING-PLAN.md:44` — the pending (not-yet-run, "separate explicit go" required) data-copy step maps `WC-45 → <MODEL>-CNR @ RM 590`. If that copy has NOT run, no production data carries a CNR-as-console price yet, so Console is safe. **Verify with the live query in Task A0 before proceeding.**
- `CNR` already exists as a distinct **Corner piece** in `SOFA_MODULES` (`packages/shared/src/sofa-build.ts:165`, `group: 'Corner'`) and in `MODULE_EDGES_BASE` (`'CNR': ['arm','arm','open','open']`). It is a real, in-use corner module — **do NOT** fold the console into CNR; that would conflate a corner piece with an accessory console and break corner geometry/closure. This is itself a strong reason Console (a fresh accessory code) is the safer merge target.

If the Chairman instead chooses CNR: STOP — this plan's decision-5 tasks (rename to `Console`, the `0122` migration, the Backend map edits) would all need re-targeting to CNR, and the console's `accessory: true` semantics would have to be reconciled against CNR's corner geometry. Escalate; do not guess.

---

## Task ordering & dependency note (read before starting)

- **Hard ordering inside Phase A:** Task A1 (shared geometry: append 9 rows + `'3-seater'` group + Console rename + edges) MUST land before Task A4 (Customize palette). The palette calls `addCell → spawnPos → findModule(code)`; if `findModule('1S')` is `undefined`, the cell gets a fallback 95×95 footprint and mis-prices. A1 also must land before/with A2 (Console data sweep) so code and data agree.
- **Phase B is gated behind Phase A shipping** (spec #6 header). Do not entangle the grid rework with the pool/combo/Console changes. Ship Phase A, verify on prod, then start Phase B.
- **Naming consistency across all tasks** (pick once, use everywhere): the new resolver is `resolveSeatHeightSelling`; the new per-entry field is `sellingPriceSen`; the depth/tier-aware assembly helper is **`sofaModuleSellingPricesFromSkus`** (returns `SofaModulePriceSen`).

---

# PHASE A — visible fix, shippable on its own (spec #1–#5)

After Phase A: `1S`/`2S`/`3S` (and recliner/power variants + `Console`) appear in the combo picker chips and the Customize palette, are placeable on the canvas, price via the existing module `sell_price_sen`, render their uploaded PNG, and combos defined with those codes match a built sofa carrying them.

---

## TASK A0 — Verify live pool + console-data state (read-only; no code)

**Files:**
- Read-only: live Supabase (master `maintenance_config_history`, `mfg_products`, `product_models`, `sofa_combos`, `sofa_quick_picks`).

**Steps:**
- [ ] Confirm the live master pool codes (expect the 25 from the spec, incl. `Console`, `Console/WC`, `1S`, `2S`, `3S`):
  ```sql
  SELECT config->'sofaCompartments'
  FROM maintenance_config_history
  WHERE scope = 'master'
    AND effective_from <= CURRENT_DATE
  ORDER BY effective_from DESC, created_at DESC
  LIMIT 1;
  ```
  Expected: a JSON array containing `"Console"` and `"Console/WC"` (and `1S`/`2S`/`3S`). Record the exact array.
- [ ] Confirm whether ANY production data already carries `WC-45` or `Console/WC` (this sizes the migration sweep + confirms the CNR-copy did NOT run):
  ```sql
  -- module SKUs named for the old console code
  SELECT code, sell_price_sen, base_price_sen FROM mfg_products
    WHERE code ILIKE '%-WC-45' OR code ILIKE '%-WC%45%' OR code ILIKE '%-CNR';
  -- Models that activated WC-45 / Console/WC
  SELECT id, name, allowed_options->'compartments' FROM product_models
    WHERE allowed_options::text ILIKE '%WC-45%' OR allowed_options::text ILIKE '%Console/WC%';
  -- saved combos / quick picks carrying the old codes
  SELECT id, modules FROM sofa_combos WHERE modules::text ILIKE '%WC-45%' OR modules::text ILIKE '%Console/WC%';
  SELECT id, cells FROM sofa_quick_picks WHERE cells::text ILIKE '%WC-45%' OR cells::text ILIKE '%Console/WC%';
  ```
- [ ] If any `<MODEL>-CNR` SKU carries a `sell_price_sen` of `59000` (RM 590), the CNR-as-console copy MAY have run — STOP and resurface the Chairman conflict above before continuing.
- [ ] Record findings in the PR description (counts per table). These drive the `0122` migration sweep (Task A2).

---

## TASK A1 — Shared geometry: 9 new rows + `'3-seater'` group + Console rename + edges (`packages/shared/src/sofa-build.ts`)

**Files:**
- Modify: `packages/shared/src/sofa-build.ts`
  - `SofaModuleSpec.group` union (line 34)
  - `SOFA_MODULES` array (lines 151–175) — append 9 rows + rename `WC-45`→`Console` at line 171
  - `SofaCompartmentGroup` union (lines 203–209)
  - `BUNDLES` `2WC` (line 398)
  - `BUNDLE_INVOICE_DECOMP` `2WC` (line 483)
  - `MODULE_EDGES_BASE` (lines 576–593) — rename `WC-45`→`Console` key + add 9 entries
  - stale comment (lines 262–264)
- Test: `packages/shared/src/__tests__/sofa-build.test.ts` (new cases + lockstep fixture updates)

### Steps

- [ ] **Write failing tests first.** Append to `packages/shared/src/__tests__/sofa-build.test.ts`:
  ```ts
  describe('pool-sourced whole-unit + variant modules (2026-06-01)', () => {
    it('findModule resolves all 9 new codes with explicit dims', () => {
      expect(findModule('1S')).toMatchObject({ group: '1-seater', w: 115, d: 95, cushions: 1 });
      expect(findModule('2S')).toMatchObject({ group: '2-seater', w: 174, d: 95, cushions: 2 });
      expect(findModule('3S')).toMatchObject({ group: '3-seater', w: 220, d: 95, cushions: 3 });
      expect(findModule('1A-P-LHF')).toMatchObject({ group: '1-seater', w: 95, d: 95 });
      expect(findModule('1A-R-RHF')).toMatchObject({ group: '1-seater', w: 95, d: 95 });
      expect(findModule('1NA-P')).toMatchObject({ group: '1-seater', w: 75, d: 95 });
      expect(findModule('1NA-R')).toMatchObject({ group: '1-seater', w: 75, d: 95 });
    });
    it('classifySofaCompartment buckets new codes deterministically', () => {
      expect(classifySofaCompartment('1S')).toBe('1-seater');
      expect(classifySofaCompartment('2S')).toBe('2-seater');
      expect(classifySofaCompartment('3S')).toBe('3-seater');
      expect(classifySofaCompartment('1A(P)(LHF)')).toBe('1-seater'); // parens form normalizes
    });
    it('Console replaces WC-45: accessory, resolvable, edges all-open', () => {
      expect(findModule('WC-45')).toBeUndefined();
      expect(isAccessoryModule('Console')).toBe(true);
      expect(findModule('Console')).toMatchObject({ group: 'Accessory', w: 45, d: 95, accessory: true });
    });
    it('placed single 1S cell prices à-la-carte, NOT as a bundle (namespace check)', () => {
      // detectBundle on a lone 1S must be null (the 1S BUNDLE signature is "1A", not "1S")
      expect(detectBundle(['1S'])).toBeNull();
    });
  });
  ```
  Ensure `findModule`, `classifySofaCompartment`, `isAccessoryModule`, `detectBundle` are imported at the top of the test file (add any missing to the existing `import { ... } from '../sofa-build'`).
- [ ] Run it — expect FAIL (new codes undefined, `'3-seater'` not a valid group, Console missing):
  ```
  pnpm --filter @2990s/shared exec vitest run src/__tests__/sofa-build.test.ts
  ```
  Expected: failures in the new `describe` block; `findModule('1S')` returns `undefined`; TS error on `'3-seater'` literal once the fixture references it (resolved by the next step).
- [ ] **Widen `SofaModuleSpec.group`** (line 34). Replace:
  ```ts
    group: '1-seater' | '2-seater' | 'Corner' | 'L-Shape' | 'Accessory';
  ```
  with:
  ```ts
    group: '1-seater' | '2-seater' | '3-seater' | 'Corner' | 'L-Shape' | 'Accessory';
  ```
- [ ] **Widen `SofaCompartmentGroup`** (lines 203–209). Replace:
  ```ts
  export type SofaCompartmentGroup =
    | '1-seater'
    | '2-seater'
    | 'Corner'
    | 'L-Shape'
    | 'Accessory'
    | 'Other';
  ```
  with:
  ```ts
  export type SofaCompartmentGroup =
    | '1-seater'
    | '2-seater'
    | '3-seater'
    | 'Corner'
    | 'L-Shape'
    | 'Accessory'
    | 'Other';
  ```
- [ ] **Append 9 rows + rename `WC-45`→`Console`** in `SOFA_MODULES`. Replace the `WC-45` row (line 171) and the closing `];` (line 175) so the tail of the array reads:
  ```ts
    // Accessory — 45cm console. Slots between sofa pieces; doesn't count
    // toward bundles or closure. Renamed from WC-45 → Console (Chairman 2026-05-31, decision 5).
    { id: 'Console', group: 'Accessory', label: 'Console · 45cm', w: 45,  d: 95,  cushions: 0, accessory: true },
    // Ottoman / stool — 75×75 free-standing accessory (F1). Doesn't count toward
    // bundles or closure. Art: STOOL.png (Loo provides).
    { id: 'STOOL',  group: 'Accessory', label: 'Ottoman / stool',        w: 75,  d: 75,  cushions: 0, accessory: true },
    // ── Pool-sourced whole-unit presets + variants (Chairman 2026-05-31, decisions 3+4).
    //    APPROXIMATE dims (Chairman adjusts later); first-class placeable cells.
    // Whole-unit presets (both arms).
    { id: '1S',  group: '1-seater', label: '1-Seater (both arms)', w: 115, d: 95, cushions: 1 },
    { id: '2S',  group: '2-seater', label: '2-Seater (both arms)', w: 174, d: 95, cushions: 2 },
    { id: '3S',  group: '3-seater', label: '3-Seater (both arms)', w: 220, d: 95, cushions: 3 },
    // 1-seater power/recliner variants — closed footprint = base 1A (95w).
    { id: '1A-P-LHF', group: '1-seater', label: '1A · Power · Left hand facing',  w: 95, d: 95, cushions: 1 },
    { id: '1A-P-RHF', group: '1-seater', label: '1A · Power · Right hand facing', w: 95, d: 95, cushions: 1 },
    { id: '1A-R-LHF', group: '1-seater', label: '1A · Recliner · Left hand facing',  w: 95, d: 95, cushions: 1 },
    { id: '1A-R-RHF', group: '1-seater', label: '1A · Recliner · Right hand facing', w: 95, d: 95, cushions: 1 },
    // 1NA power/recliner variants — closed footprint = base 1NA (75w).
    { id: '1NA-P',    group: '1-seater', label: '1NA · No arms · Power',    w: 75, d: 95, cushions: 1 },
    { id: '1NA-R',    group: '1-seater', label: '1NA · No arms · Recliner', w: 75, d: 95, cushions: 1 },
  ];
  ```
- [ ] **Update the stale comment** at lines 262–264 (the `sofaModulePricesFromSkus` docstring). Replace:
  ```ts
   *  (unpriced → no entry → priced 0 at lookup, never a phantom price). Whole-
   *  unit preset SKUs (1S / 2S) normalize to codes no laid-out cell carries, so
   *  they're harmless if present (their Quick-Pick pricing is a separate phase). */
  ```
  with:
  ```ts
   *  (unpriced → no entry → priced 0 at lookup, never a phantom price). Whole-
   *  unit preset SKUs (1S / 2S / 3S) ARE first-class placeable cells (Chairman
   *  2026-05-31), so a laid-out cell can carry those codes and price from here. */
  ```
- [ ] **Rename `2WC` `canonicalModules`** in `BUNDLES` (line 398). Replace `canonicalModules: ['1A', 'WC-45', '1A']` with `canonicalModules: ['1A', 'Console', '1A']`.
- [ ] **Rename `2WC` `BUNDLE_INVOICE_DECOMP`** (line 483). Replace `'2WC': '1A-LHF + WC-45 + 1A-RHF',` with `'2WC': '1A-LHF + Console + 1A-RHF',`.
- [ ] **Rename + extend `MODULE_EDGES_BASE`** (lines 576–593). Replace the `'WC-45'` key with `'Console'` and add the 9 new entries so the map reads (showing the tail):
  ```ts
    'L-LHF':  ['open', 'back', 'open', 'front'],
    'L-RHF':  ['open', 'back', 'open', 'front'],
    'Console':['open', 'open', 'open', 'open'],
    'STOOL':  ['open', 'open', 'open', 'open'],
    // Whole-unit presets carry BOTH end arms (so they close standalone).
    '1S':     ['arm',  'back', 'arm',  'front'],
    '2S':     ['arm',  'back', 'arm',  'front'],
    '3S':     ['arm',  'back', 'arm',  'front'],
    // 1A power/recliner variants mirror the base 1A edge profile.
    '1A-P-LHF': ['arm',  'back', 'open', 'front'],
    '1A-P-RHF': ['open', 'back', 'arm',  'front'],
    '1A-R-LHF': ['arm',  'back', 'open', 'front'],
    '1A-R-RHF': ['open', 'back', 'arm',  'front'],
    // 1NA power/recliner variants mirror the base 1NA edge profile.
    '1NA-P':    ['open', 'back', 'open', 'front'],
    '1NA-R':    ['open', 'back', 'open', 'front'],
  };
  ```
- [ ] **Update lockstep WC-45 fixtures** in `packages/shared/src/__tests__/sofa-build.test.ts`. Grep the file for `WC-45` and replace every occurrence with `Console` (survey enumerated lines 42, 101, 102, 128, 151, 152, 544, 548, 634, 732, 804, 811, 817, 819 — confirm with the grep below, line numbers may have drifted). Run:
  ```
  pnpm --filter @2990s/shared exec vitest run src/__tests__/sofa-build.test.ts
  ```
  Then for any remaining `WC-45` literals, use Grep tool `pattern: "WC-45"` on the test file and edit each. The `2WC` invoice-decomp test must now assert `'1A-LHF + Console + 1A-RHF'`.
- [ ] **Update `sofa-combo-pricing.test.ts:109`** — Grep `pattern: "WC-45"` in `packages/shared/src/__tests__/sofa-combo-pricing.test.ts`, replace with `Console`.
- [ ] Run both shared test files — expect PASS:
  ```
  pnpm --filter @2990s/shared exec vitest run src/__tests__/sofa-build.test.ts src/__tests__/sofa-combo-pricing.test.ts
  ```
  Expected: all green, including the new `describe` block and the renamed fixtures.
- [ ] Run the full shared suite to catch `sofa-selling.test.ts` collateral:
  ```
  pnpm --filter @2990s/shared test
  ```
  Expected: all green. If `sofa-selling.test.ts` has a `WC-45` literal, fix it the same way.
- [ ] Commit: `git commit -m "feat(shared): pool-sourced sofa modules (1S/2S/3S + variants), '3-seater' group, WC-45→Console"`.

---

## TASK A2 — Console rename: code call-sites + data migration `0122`

**Files:**
- Modify: `packages/shared/src/sofa-quick-presets.ts` (line 63)
- Modify: `apps/pos/src/pages/Configurator.tsx` (lines 105–113)
- Modify: `apps/pos/src/lib/sofa-art.ts` (line 26 crop key) — see decision below
- Modify: `apps/backend/src/pages/Products.tsx` (`COMPARTMENT_DESCRIPTION_OVERRIDE` ~1520–1568; `EXTRA_MODULE_IMAGE_BY_NORM` ~1575–1595)
- Modify: `apps/pos/src/pages/Products.tsx` (mirror maps ~2581–2624)
- Create: `packages/db/migrations/0122_console_merge.sql` (append-only; latest existing is `0121`)
- Create asset: `apps/pos/public/sofa-modules/Console.svg` + `apps/backend/public/sofa-modules/Console.svg` (copy of existing `WC-45.svg` fallback) — see step
- **Do NOT edit** `prototype/*` (project red line #1) or any existing migration history.

### Steps

- [ ] **`sofa-quick-presets.ts:63`** — replace:
  ```ts
    { id: '2WC',      label: '2-Seater + Console',      modules: ['1A-LHF', 'WC-45', '1A-RHF'] },
  ```
  with:
  ```ts
    { id: '2WC',      label: '2-Seater + Console',      modules: ['1A-LHF', 'Console', '1A-RHF'] },
  ```
- [ ] **`Configurator.tsx:105-113`** — replace the `2WC` branch:
  ```ts
    if (bundleId === '2WC') {
      // 1A + wood console + 1A, left to right.
      const a = wOf('1A-LHF');
      const c = wOf('WC-45');
      cells = [
        { id: 'wc-l', moduleId: '1A-LHF', x: 0,     y: 0, rot: 0 },
        { id: 'wc-c', moduleId: 'WC-45',  x: a,     y: 0, rot: 0 },
        { id: 'wc-r', moduleId: '1A-RHF', x: a + c, y: 0, rot: 0 },
      ];
    }
  ```
  with:
  ```ts
    if (bundleId === '2WC') {
      // 1A + console + 1A, left to right.
      const a = wOf('1A-LHF');
      const c = wOf('Console');
      cells = [
        { id: 'wc-l', moduleId: '1A-LHF',  x: 0,     y: 0, rot: 0 },
        { id: 'wc-c', moduleId: 'Console', x: a,     y: 0, rot: 0 },
        { id: 'wc-r', moduleId: '1A-RHF',  x: a + c, y: 0, rot: 0 },
      ];
    }
  ```
- [ ] **Bundled art asset.** The bundled fallback art for the console lives at `apps/pos/public/sofa-modules/WC-45.svg` and `apps/backend/public/sofa-modules/WC-45.svg`. Because the fallback resolves `sofa-modules/<norm>.svg` and the norm is now `Console`, create `Console.svg` in BOTH public dirs as a copy:
  ```
  Copy-Item "C:\Users\User\2990s\apps\pos\public\sofa-modules\WC-45.svg"     "C:\Users\User\2990s\apps\pos\public\sofa-modules\Console.svg"
  Copy-Item "C:\Users\User\2990s\apps\backend\public\sofa-modules\WC-45.svg" "C:\Users\User\2990s\apps\backend\public\sofa-modules\Console.svg"
  ```
  Keep the old `WC-45.svg` files in place (harmless; cheap safety for any un-swept reference). Note: per decision 6 the *real* palette art is the uploaded PNG from the pool `imageKey`; this SVG is only the fallback.
- [ ] **`sofa-art.ts:26` crop key.** This map is keyed by `'/sofa-modules/WC-45.png'`. The bundled fallback now resolves `Console.svg`/`Console.png`. Add a `Console` entry alongside (do NOT delete the WC-45 entry — keep it as harmless dead-key safety):
  ```ts
    '/sofa-modules/WC-45.png':   { l: 0.3027, t: 0.1973, r: 0.6953, b: 0.8008 },
    '/sofa-modules/Console.png': { l: 0.3027, t: 0.1973, r: 0.6953, b: 0.8008 },
  ```
- [ ] **Backend Console-merge maps** (`apps/backend/src/pages/Products.tsx`). In `COMPARTMENT_DESCRIPTION_OVERRIDE` (~1520–1568): keep the `Console:` key, **remove** the `'Console/WC':` and `'Console-WC':` keys, and **remove** the standalone `'WC-45':` key (its description folds into `Console`). In `EXTRA_MODULE_IMAGE_BY_NORM` (~1575–1595): keep `Console: 'Console'`, **remove** the `'Console-WC':` and `'Console/WC':` keys. Use the Grep tool (`pattern: "Console/WC|Console-WC|WC-45"`, path `apps/backend/src/pages/Products.tsx`) to locate exact lines before editing (line numbers may have drifted).
- [ ] **POS mirror maps** (`apps/pos/src/pages/Products.tsx`, ~2581–2624). The SAME two maps are DUPLICATED here. Apply the identical edits (remove `Console/WC`, `Console-WC`, `WC-45` keys; keep `Console`). Grep `pattern: "Console/WC|Console-WC|WC-45"`, path `apps/pos/src/pages/Products.tsx`.
- [ ] **Create the data migration** `packages/db/migrations/0122_console_merge.sql`. This sweeps the live data so no reference dangles (sizing from Task A0). It renames `WC-45` → `Console`, drops the duplicate `Console/WC`, and rewrites JSON refs. **Tune the exact table/column set to Task A0's findings** — the skeleton below covers `compartment_library`, the master maintenance config, `product_models.allowed_options`, `sofa_combos.modules`, and `sofa_quick_picks.cells`:
  ```sql
  -- 0122_console_merge: collapse the console code to a single `Console`.
  -- Chairman 2026-05-31 (decision 5): merge code-side `WC-45` + pool `Console/WC`
  -- into one `Console`. Pre-pilot data, low volume — sweep every persisted ref so
  -- nothing dangles after the shared SOFA_MODULES rename (migration is append-only;
  -- existing 0018 history is NOT edited).

  BEGIN;

  -- 1. compartment_library: rename WC-45 → Console; drop a Console/WC row if present.
  DELETE FROM compartment_library WHERE id = 'Console/WC';
  UPDATE compartment_library
    SET id = 'Console', label = 'Console · 45cm', art_filename = 'Console.png'
    WHERE id = 'WC-45';

  -- 2. Master maintenance config: rewrite the sofaCompartments array + meta keys.
  --    a) drop 'Console/WC' from the array, b) rename 'WC-45' → 'Console' in the array,
  --    c) move sofaCompartmentMeta['WC-45'] / ['Console/WC'] under ['Console'].
  WITH cur AS (
    SELECT id, config
    FROM maintenance_config_history
    WHERE scope = 'master' AND effective_from <= CURRENT_DATE
    ORDER BY effective_from DESC, created_at DESC
    LIMIT 1
  )
  UPDATE maintenance_config_history m
  SET config = jsonb_set(
        cur.config,
        '{sofaCompartments}',
        (
          SELECT COALESCE(jsonb_agg(DISTINCT
                   CASE WHEN elem IN ('WC-45') THEN 'Console' ELSE elem END), '[]'::jsonb)
          FROM jsonb_array_elements_text(cur.config->'sofaCompartments') AS elem
          WHERE elem <> 'Console/WC'
        )
      )
  FROM cur
  WHERE m.id = cur.id;
  -- meta key fold (only if the old keys exist):
  WITH cur AS (
    SELECT id, config FROM maintenance_config_history
    WHERE scope = 'master' AND effective_from <= CURRENT_DATE
    ORDER BY effective_from DESC, created_at DESC LIMIT 1
  )
  UPDATE maintenance_config_history m
  SET config = (cur.config #- '{sofaCompartmentMeta,WC-45}') #- '{sofaCompartmentMeta,Console/WC}'
                 || jsonb_build_object('sofaCompartmentMeta',
                      COALESCE(cur.config->'sofaCompartmentMeta','{}'::jsonb)
                      || jsonb_build_object('Console',
                           COALESCE(cur.config->'sofaCompartmentMeta'->'Console',
                                    cur.config->'sofaCompartmentMeta'->'WC-45',
                                    cur.config->'sofaCompartmentMeta'->'Console/WC',
                                    '{}'::jsonb)))
  FROM cur
  WHERE m.id = cur.id
    AND (cur.config->'sofaCompartmentMeta' ? 'WC-45'
      OR cur.config->'sofaCompartmentMeta' ? 'Console/WC');

  -- 3. product_models.allowed_options.compartments: WC-45/Console/WC → Console.
  UPDATE product_models
  SET allowed_options = jsonb_set(
        allowed_options,
        '{compartments}',
        (
          SELECT COALESCE(jsonb_agg(DISTINCT
                   CASE WHEN elem IN ('WC-45','Console/WC') THEN 'Console' ELSE elem END), '[]'::jsonb)
          FROM jsonb_array_elements_text(allowed_options->'compartments') AS elem
        )
      )
  WHERE allowed_options ? 'compartments'
    AND allowed_options::text ~ '(WC-45|Console/WC)';

  -- 4. sofa_combos.modules (array of OR-set arrays) + sofa_quick_picks.cells:
  --    text-replace the codes. (Pre-pilot volume is tiny; verified in Task A0.)
  UPDATE sofa_combos
  SET modules = REPLACE(REPLACE(modules::text, '"WC-45"', '"Console"'), '"Console/WC"', '"Console"')::jsonb
  WHERE modules::text ~ '(WC-45|Console/WC)';
  UPDATE sofa_quick_picks
  SET cells = REPLACE(REPLACE(cells::text, '"WC-45"', '"Console"'), '"Console/WC"', '"Console"')::jsonb
  WHERE cells::text ~ '(WC-45|Console/WC)';

  COMMIT;
  ```
  > **Before applying:** verify the exact column names/types against `packages/db/src/schema.ts` (e.g. confirm `sofa_combos.modules` is `jsonb` and `sofa_quick_picks.cells` is `jsonb`; drop any table from the script that Task A0 showed has zero matching rows). Apply to prod FIRST and verify (per the project's migration-first convention), then commit the file.
- [ ] Run typecheck + POS build (catches any missed `WC-45` import/reference):
  ```
  pnpm typecheck
  pnpm --filter @2990s/pos build
  ```
  Expected: both succeed. If typecheck flags a stray `WC-45`, Grep `pattern: "WC-45"` repo-wide (excluding `prototype/`, `packages/db/migrations/0018*`, `0042*`, and docs) and fix.
- [ ] Commit: `git commit -m "feat(sofa): merge console code WC-45→Console across code + add 0122 data sweep"`.

---

## TASK A3 — Combo picker reads the pool (`apps/pos/src/components/products/SofaComboTab.tsx`)

**Files:**
- Modify: `apps/pos/src/components/products/SofaComboTab.tsx`
  - imports (line 28 `@2990s/shared`; line 37 mfg-products-queries)
  - delete module-level `ALL_MODULE_CODES` (line 60)
  - `SofaComboTab` body (after line ~92) — add hook + memo
  - `ComposerModal` param type (~340–345) — add `moduleCodes` prop
  - `ComposerModal` mount site (~225–230) — pass prop
  - chip render loop (~494–508) — iterate `moduleCodes`, store normalized

### Steps

- [ ] **Imports.** Replace line 28:
  ```ts
  import { SOFA_MODULES, type SofaPriceTier, buildComboLabel } from '@2990s/shared';
  ```
  with:
  ```ts
  import { type SofaPriceTier, buildComboLabel, normalizeCompartmentCode } from '@2990s/shared';
  ```
  And replace line 37:
  ```ts
  import { useMfgProducts } from '../../lib/products/mfg-products-queries';
  ```
  with:
  ```ts
  import { useMfgProducts, useMaintenanceConfig } from '../../lib/products/mfg-products-queries';
  ```
- [ ] **Delete the hardcoded constant** at line 60:
  ```ts
  const ALL_MODULE_CODES = SOFA_MODULES.map((m) => m.id).sort();
  ```
  (Removing this orphans the `SOFA_MODULES` import — already dropped above.)
- [ ] **Add the pool read** inside the `SofaComboTab` body, immediately after the `productsQ` line (`const productsQ = useMfgProducts({ category: 'SOFA' });`). `useMemo` is already imported. Insert:
  ```ts
    // Module chips come from the Maintenance Sofa Compartments pool (single
    // source of truth — Chairman 2026-05-31, decision 1+7). Full pool, no
    // base-model narrowing. Parens form for display; normalized for storage.
    const cfgQ = useMaintenanceConfig('master');
    const moduleCodes = useMemo(
      () => [...(cfgQ.data?.data?.sofaCompartments ?? [])].sort(),
      [cfgQ.data],
    );
  ```
- [ ] **Thread the prop into `ComposerModal`.** At the mount site (~225–230) replace:
  ```tsx
        <ComposerModal
          editing={composer.editing}
          baseModels={baseModels}
          onClose={() => setComposer({ open: false })}
        />
  ```
  with:
  ```tsx
        <ComposerModal
          editing={composer.editing}
          baseModels={baseModels}
          moduleCodes={moduleCodes}
          onClose={() => setComposer({ open: false })}
        />
  ```
- [ ] **Add the prop to `ComposerModal`'s signature** (~340–345). Replace:
  ```tsx
  function ComposerModal({
    editing, baseModels, onClose,
  }: {
    editing?: SofaComboRule;
    baseModels: string[];
    onClose: () => void;
  }) {
  ```
  with:
  ```tsx
  function ComposerModal({
    editing, baseModels, moduleCodes, onClose,
  }: {
    editing?: SofaComboRule;
    baseModels: string[];
    moduleCodes: string[];
    onClose: () => void;
  }) {
  ```
- [ ] **Rewrite the chip loop** (~494–508). Replace:
  ```tsx
                      {ALL_MODULE_CODES.map((c) => {
                        const on = slot.includes(c);
                        return (
                          <button
                            type="button"
                            key={c}
                            onClick={() => toggleSlotCode(idx, c)}
                            style={on ? moduleChipOn : moduleChipOff}
                          >
                            {c}
                          </button>
                        );
                      })}
  ```
  with:
  ```tsx
                      {moduleCodes.map((c) => {
                        const norm = normalizeCompartmentCode(c);
                        const on = slot.includes(norm);
                        return (
                          <button
                            type="button"
                            key={c}
                            onClick={() => toggleSlotCode(idx, norm)}
                            style={on ? moduleChipOn : moduleChipOff}
                          >
                            {c}
                          </button>
                        );
                      })}
  ```
  (Display = pool's parens form `{c}`; stored/compared value = `normalizeCompartmentCode(c)`. `toggleSlotCode` stays generic — it receives the already-normalized `norm`.)
- [ ] **Verify build + types:**
  ```
  pnpm --filter @2990s/pos build
  ```
  Expected: succeeds; no unused-`SOFA_MODULES` error.
- [ ] **Document the edit-path safety in the PR body** (no code change): editing an OLD combo renders modules read-only via `buildComboLabel` (the chip grid is new-combo-only), so switching new stores to normalized dash form does not break old parens-form combos. While `cfgQ` loads, the chip grid is briefly empty (defaults to `[]`) — acceptable, mirrors the existing Allowed-Options behavior.
- [ ] Commit: `git commit -m "feat(pos): combo picker chips read the Maintenance sofa compartments pool"`.

---

## TASK A4 — Customize palette iterates the activated subset + uses uploaded PNG (`apps/pos/src/pages/CustomBuilder.tsx`)

> **Depends on A1.** Do not start until A1 is merged/in-branch.

**Files:**
- Modify: `apps/pos/src/pages/CustomBuilder.tsx`
  - `PALETTE_GROUPS` (lines 226–232) — add `'3-seater'` + `'Other'`
  - palette IIFE (lines 795–859) — invert the loop

### Steps

- [ ] **Extend `PALETTE_GROUPS`** (lines 226–232). Replace:
  ```ts
  const PALETTE_GROUPS: SofaModuleSpec['group'][] = [
    '1-seater',
    '2-seater',
    'Corner',
    'L-Shape',
    'Accessory',
  ];
  ```
  with:
  ```ts
  // Includes '3-seater' (whole-unit 3S) and 'Other' so no activated pool code is
  // silently dropped (the empty-palette bug being fixed). 'Other' only renders if
  // a pool code falls outside SOFA_MODULES classification.
  const PALETTE_GROUPS: ('1-seater' | '2-seater' | '3-seater' | 'Corner' | 'L-Shape' | 'Accessory' | 'Other')[] = [
    '1-seater',
    '2-seater',
    '3-seater',
    'Corner',
    'L-Shape',
    'Accessory',
    'Other',
  ];
  ```
- [ ] **Invert the palette loop** (lines 795–859). Replace the IIFE body so the `modelCustomizer` branch iterates compartments directly (keeping the legacy `pricing.compartments` fallback for `modelCustomizer == null`). Replace lines 796–859 (the whole `{(() => { ... })()}` content) with:
  ```tsx
            /* Chairman 2026-05-31 (decisions 1-3, 6): when a modelCustomizer is
             * present, iterate the Model's ACTIVATED compartments directly (the
             * pool ∩ allowed_options subset), grouped by their classified group.
             * This surfaces pool-only codes (1S/2S/3S/recliner variants/Console)
             * the old SOFA_MODULES-membership filter silently dropped. Art comes
             * from the pool's uploaded PNG (cc.imageUrl) with the bundled SVG as
             * fallback. Falls back to the legacy pricing.compartments tick map for
             * orphan / unmigrated SKUs (modelCustomizer == null). */
            if (modelCustomizer) {
              const rows = modelCustomizer.compartments;
              return PALETTE_GROUPS.map((g) => {
                const items = rows.filter((cc) => cc.group === g);
                if (items.length === 0) return null;
                return (
                  <div key={g} className={styles.paletteGroup}>
                    <div className={styles.paletteGroupHead}>{g}</div>
                    {items.map((cc) => {
                      const priceRm = cc.priceSen > 0 ? Math.round(cc.priceSen / 100) : null;
                      const artSrc = cc.imageUrl ?? resolveModuleArtSrc(cc.normalizedCode);
                      return (
                        <button
                          key={cc.normalizedCode}
                          type="button"
                          className={styles.paletteItem}
                          onClick={() => addCell(cc.normalizedCode)}
                          title={cc.label}
                        >
                          <div className={styles.paletteArt}>
                            <img src={artSrc} alt={cc.label} draggable={false} />
                          </div>
                          <div className={styles.paletteInfo}>
                            <div className={styles.paletteCode}>{cc.normalizedCode}</div>
                            <div className={styles.paletteSub}>{cc.label}</div>
                            <div className={styles.palettePrice}>{priceRm != null ? fmtRM(priceRm) : 'TBC'}</div>
                          </div>
                          <span className={styles.paletteAdd} aria-hidden>+</span>
                        </button>
                      );
                    })}
                  </div>
                );
              });
            }
            // Legacy fallback (modelCustomizer == null): old SOFA_MODULES-filtered
            // palette for orphan / unmigrated SKUs.
            return PALETTE_GROUPS.map((g) => {
              const items = SOFA_MODULES.filter((m) => m.group === g).filter(
                (m) => pricing.compartments.find((cc) => cc.compartmentId === m.id)?.active,
              );
              if (items.length === 0) return null;
              return (
                <div key={g} className={styles.paletteGroup}>
                  <div className={styles.paletteGroupHead}>{g}</div>
                  {items.map((m) => {
                    const legacyRow = pricing.compartments.find((cc) => cc.compartmentId === m.id);
                    const priceRm = legacyRow?.price ?? null;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={styles.paletteItem}
                        onClick={() => addCell(m.id)}
                        title={m.label}
                      >
                        <div className={styles.paletteArt}>
                          <img src={resolveModuleArtSrc(m.id)} alt={m.label} draggable={false} />
                        </div>
                        <div className={styles.paletteInfo}>
                          <div className={styles.paletteCode}>{m.id}</div>
                          <div className={styles.paletteSub}>{m.label.replace(`${m.id} · `, '')}</div>
                          <div className={styles.palettePrice}>{priceRm != null ? fmtRM(priceRm) : 'TBC'}</div>
                        </div>
                        <span className={styles.paletteAdd} aria-hidden>+</span>
                      </button>
                    );
                  })}
                </div>
              );
            });
  ```
  Notes baked in:
  - `cc.group` is already on `ResolvedSofaCompartment` (computed by `classifyCompartmentCode` in `queries.ts`); reuse it — do NOT re-call a classifier (avoids a 3rd drifting call site).
  - `addCell(cc.normalizedCode)` passes dash form so `cell.moduleId` matches `findModule` / combo-match / snap math.
  - `cc.imageUrl` is the uploaded pool PNG (resolved in `useSofaCustomizerData`); `resolveModuleArtSrc(cc.normalizedCode)` is the bundled fallback (decision 6).
  - `SOFA_MODULES` stays imported (legacy branch still uses it) — no orphan.
- [ ] **Verify build + types:**
  ```
  pnpm typecheck
  pnpm --filter @2990s/pos build
  ```
  Expected: both succeed.
- [ ] Commit: `git commit -m "feat(pos): Customize palette iterates activated pool subset + uses uploaded PNG art"`.

---

## TASK A5 — Combo matching + placement verification (tests; mostly confirm-only)

> Spec #4 says the engine needs NO change — `pickComboMatch`/`matchComboSubset` match by code; `analyzeSofa`/`detectBundle` already treat a lone whole-unit cell as à-la-carte. This task PROVES it with tests so the claim is evidence-backed.

**Files:**
- Test: `packages/shared/src/__tests__/sofa-combo-pricing.test.ts` (new cases)
- Test: `packages/shared/src/__tests__/sofa-build.test.ts` (placement/closure case)

### Steps

- [ ] **Add a combo-match test.** In `sofa-combo-pricing.test.ts`, add a case proving a `[['1S']]` combo matches a built `['1S']` and prices from `pricesByHeight`:
  ```ts
  it('a combo defined with 1S matches a built sofa carrying a 1S cell', () => {
    const combo: SofaComboRow = {
      // copy the shape of an existing fixture in this file; minimal required fields:
      id: 'test-1s', baseModel: null, customerId: null, tier: null,
      modules: [['1S']], pricesByHeight: { '24': 99900 },
      effectiveFrom: '2020-01-01', deletedAt: null,
    } as unknown as SofaComboRow;
    const match = pickComboMatch(
      { modules: ['1S'], baseModel: '', tier: 'PRICE_2', height: '24', customerId: null },
      [combo],
    );
    expect(match?.comboPriceCenti).toBe(99900);
    expect(match?.matchedIndices).toEqual([0]);
  });
  ```
  > Confirm the exact `SofaComboRow` field names against the type at the top of the file before finalizing the fixture; copy an existing row literal from the file and change `modules` + `pricesByHeight`.
- [ ] **Add a placement/closure test.** In `sofa-build.test.ts`, prove a lone `1S` cell builds + prices à-la-carte from a `sofaModulePrices` map (not a phantom bundle):
  ```ts
  it('placed 1S cell prices from sofaModulePrices (à-la-carte, no bundle)', () => {
    const pricing: SofaProductPricing = {
      compartments: sofaCompartmentsFromModulePrices({ '1S': 120000 }),
      bundles: [], reclinerUpgradePrice: 0,
    };
    const res = computeSofaPrice([{ id: 'a', moduleId: '1S', x: 0, y: 0, rot: 0 }], 24, pricing);
    expect(res.total).toBe(1200); // 120000 sen ÷ 100, à-la-carte
  });
  ```
  > Confirm `SofaProductPricing`, `sofaCompartmentsFromModulePrices`, `computeSofaPrice`, `Cell` shape, and the `Depth` literal (`24`) against the actual exports; adapt the cell/depth literal to the real signature.
- [ ] Run — expect PASS:
  ```
  pnpm --filter @2990s/shared exec vitest run src/__tests__/sofa-combo-pricing.test.ts src/__tests__/sofa-build.test.ts
  ```
- [ ] Commit: `git commit -m "test(shared): prove pool codes (1S) place à-la-carte + combo-match"`.

---

## TASK A6 — Role gate: lock POS Maintenance pool edits to Master Admin (close the sales hole)

> Spec Portal table + #3 role gate. The survey found a **real hole**: in POS `SofaCompartmentsList`, the photo upload `<input type=file>` + delete button render for ALL modes incl. `view` (sales). POS must READ the pool, never EDIT it.

**Files:**
- Modify: `apps/pos/src/pages/Products.tsx` (POS `SofaCompartmentsList`, photo upload/delete affordances ~2828–2937; pass a `canEdit`/`mode` flag in)
- Modify (defense-in-depth, recommended): `apps/api/src/routes/sofa-compartment-photos.ts` (add `WRITE_ROLES` gate mirroring `delivery-fees.ts:13,44-58`)
- Optionally: `apps/api/src/routes/maintenance-config.ts` POST `/changes` + `apps/api/src/routes/product-models.ts` PATCH `/:id`

### Steps

- [ ] **Confirm the existing gate shape.** Read `apps/pos/src/pages/Products.tsx` `productsMode()` (~122–136): `full` = `admin|super_admin|master_account`; `add-only` = `sales_director`; else `view`. The POS `SofaCompartmentsList` receives `editMode`/`addOnly`; the photo block currently ignores both.
- [ ] **Gate the POS photo upload/delete affordances** behind full mode. In POS `SofaCompartmentsList` (~2718 component start; photo block ~2828–2937): thread a `canEdit: boolean` prop (= `mode === 'full'`) from the POS `MaintenanceTab` render site, and wrap the `<label>/<input type=file>` upload control, the delete `<button>`, and the `onContextMenu` delete handler so they only render/fire when `canEdit` is true. Use the Grep tool (`pattern: "uploadPhoto|deletePhoto|onContextMenu|type=\"file\""`, path `apps/pos/src/pages/Products.tsx`) to find the exact JSX before editing. Confirm the text/description/price/code edits in this list are ALREADY `editMode`-gated (they are: `editMode = canEdit && editModeRaw`).
- [ ] **Decide the `addOnly` (sales_director) compartment-add path.** The spec Portal table says POS *reads* the pool and never edits it. The POS `SofaCompartmentsList` `addItem` under `addOnly` calls `onQuickAdd` (immediate write). Per the Portal boundary, gate the add row behind `canEdit` (full) too — `addOnly` should NOT append codes to the master pool from POS. Record this as a deliberate tightening in the PR body (affects `sales_director` only).
- [ ] **Server defense-in-depth (recommended).** In `apps/api/src/routes/sofa-compartment-photos.ts`, after the `supabaseAuth` middleware, add a role gate mirroring `apps/api/src/routes/delivery-fees.ts:13,44-58`:
  ```ts
  const WRITE_ROLES = new Set(['admin', 'super_admin', 'coordinator', 'master_account']);
  ```
  then inside the POST and DELETE handlers, look up the staff role and `return c.json({ error: 'forbidden', reason: 'pool_editor_only' }, 403)` when the role is not in `WRITE_ROLES`. Use the exact lookup pattern from `delivery-fees.ts` (`staff.select('role, active').eq('id', userId)`).
  > **RED LINE CHECK:** this touches auth-adjacent middleware in a route. It is ADD-only (a new 403 gate, no change to existing session logic), but flag it in the PR body and get the Chairman's explicit nod if there is any doubt. Do NOT touch RLS policies in this plan.
- [ ] **Verify** the gate with build + a manual role check noted for QA:
  ```
  pnpm --filter @2990s/pos build
  pnpm --filter @2990s/api build
  ```
  Expected: both succeed. (Manual e2e: log in as `sales` → POS Products → Maintenance → Sofa Compartments → the photo upload/delete controls are absent.)
- [ ] Commit: `git commit -m "fix(pos,api): lock sofa-compartment pool edits to Master Admin (close sales hole)"`.

---

## TASK A7 — Phase A integration check + ship

**Steps:**
- [ ] Full typecheck + builds + tests:
  ```
  pnpm typecheck
  pnpm test
  pnpm --filter @2990s/pos build
  pnpm --filter @2990s/backend build
  pnpm --filter @2990s/api build
  ```
  Expected: all green.
- [ ] **Manual e2e (browse/Playwright) on a configured Model** (use the `/browse` or `qa` skill): activate `1S`/`2S` on a simple Model (e.g. Annsa) via Products → Modular → Allowed Options → Customize palette now renders `1S`/`2S` (was empty) → place `1S` → it prices from its module `sell_price_sen` (or `TBC` if unpriced) → New Combo chip grid shows `1S`/`2S` chips. Capture before/after screenshots.
- [ ] Ship Phase A (`/ship` → PR). PR body must include: the Chairman conflict note (CNR vs Console) resolution, Task A0 data counts, the role-gate tightening, and the e2e screenshots.

---

# PHASE B — sofa SELLING price + tier auto-derive (spec #6 + #7)

> Gated behind Phase A shipping. Re-wires the SKU Master Edit-Price grid (which today writes sofa COST) to write the buyer SELLING price, with P1-base tier auto-derive.

---

## TASK B1 — Shared: `sellingPriceSen` field + `resolveSeatHeightSelling` + `sofaModuleSellingPricesFromSkus`

**Files:**
- Modify: `packages/shared/src/mfg-pricing.ts`
  - `MfgSeatHeightPrice` type (lines 70–74) — add `sellingPriceSen?`
  - new exported `resolveSeatHeightSelling` (after `resolveSeatHeightSen`, ~line 236)
  - `computeMfgLineCost` SOFA branch (~350–364) MUST stay byte-identical (verify only)
  - `computeMfgLinePrice` SOFA branch (~262–275) MUST NOT receive the new selling base (verify only)
- Modify: `packages/shared/src/sofa-build.ts`
  - new exported `sofaModuleSellingPricesFromSkus` (after `sofaModulePricesFromSkus`, ~line 275)
- Test: `packages/shared/src/mfg-pricing.test.ts` (new selling-resolver cases)
- Test: `packages/shared/src/__tests__/sofa-build.test.ts` (assembly helper cases)

### Steps

- [ ] **Write failing tests** in `packages/shared/src/mfg-pricing.test.ts` (import `resolveSeatHeightSelling` from `../mfg-pricing` — add to the existing import):
  ```ts
  describe('resolveSeatHeightSelling (2026-06-01)', () => {
    const rows = [
      { height: '24', priceSen: 50000, tier: 'PRICE_1' as const, sellingPriceSen: 90000 },
      { height: '24', priceSen: 60000, tier: 'PRICE_2' as const }, // cost-only, no selling
    ];
    it('returns sellingPriceSen for an exact (height,tier) hit', () => {
      expect(resolveSeatHeightSelling(rows, '24', 'PRICE_1'))
        .toEqual({ sellingPriceSen: 90000, matchedTier: 'PRICE_1' });
    });
    it('SKIPS rows whose sellingPriceSen is null/undefined (falls through)', () => {
      // wants PRICE_2 but that row has no sellingPriceSen → no PRICE_2 selling →
      // no any-row selling either → null (caller falls back to flat sell_price_sen)
      expect(resolveSeatHeightSelling(rows, '24', 'PRICE_2')).toBeNull();
    });
    it('NEVER leaks priceSen (cost) into selling', () => {
      const res = resolveSeatHeightSelling(rows, '24', 'PRICE_2');
      expect(res).toBeNull(); // not { sellingPriceSen: 60000 }
    });
  });
  ```
- [ ] Run — expect FAIL (`resolveSeatHeightSelling` not exported):
  ```
  pnpm --filter @2990s/shared exec vitest run src/mfg-pricing.test.ts
  ```
- [ ] **Add `sellingPriceSen?` to `MfgSeatHeightPrice`** (lines 70–74). Replace:
  ```ts
  /** Per-(height, tier) sofa price entry. Legacy rows without `tier` are
   *  treated as PRICE_2 (HOOKKA's historic default). */
  export type MfgSeatHeightPrice = {
    height: string;
    priceSen: number;
    tier?: MfgFabricTier;
  };
  ```
  with:
  ```ts
  /** Per-(height, tier) sofa price entry. Legacy rows without `tier` are
   *  treated as PRICE_2 (HOOKKA's historic default).
   *  `priceSen` = COST (read by computeMfgLineCost; NEVER the buyer price).
   *  `sellingPriceSen` = the buyer (SELLING) price the POS Master-Admin grid
   *  authors (decision 6). Unset on cost-only rows → selling reads fall through
   *  to the flat module sell_price_sen. */
  export type MfgSeatHeightPrice = {
    height: string;
    priceSen: number;
    tier?: MfgFabricTier;
    sellingPriceSen?: number;
  };
  ```
- [ ] **Add `resolveSeatHeightSelling`** immediately after `resolveSeatHeightSen` (after line 236). It mirrors the cost resolver's exact→PRICE_2→any fallback but reads `.sellingPriceSen` and skips rows where it is null/undefined:
  ```ts
  /** SELLING-side sibling of resolveSeatHeightSen. Reads `.sellingPriceSen` for
   *  the picked (size, tier) with the same exact→PRICE_2→any fallback, but SKIPS
   *  any row whose `sellingPriceSen` is null/undefined so the caller falls through
   *  to the flat module sell_price_sen (never leaks `priceSen`/cost into the buyer
   *  price). Returns null when no priced selling row matches. */
  export const resolveSeatHeightSelling = (
    rows: MfgSeatHeightPrice[] | null | undefined,
    size: string | null | undefined,
    tier: MfgFabricTier | null | undefined,
  ): { sellingPriceSen: number; matchedTier: MfgFabricTier } | null => {
    if (!rows || rows.length === 0 || !size) return null;
    const wantTier: MfgFabricTier = tier ?? 'PRICE_2';
    const normalize = (t: MfgFabricTier | undefined): MfgFabricTier => t ?? 'PRICE_2';
    const priced = (r: MfgSeatHeightPrice): r is MfgSeatHeightPrice & { sellingPriceSen: number } =>
      r.sellingPriceSen != null;
    const exact = rows.find((r) => r.height === size && normalize(r.tier) === wantTier && priced(r));
    if (exact) return { sellingPriceSen: exact.sellingPriceSen!, matchedTier: wantTier };
    const fallback = rows.find((r) => r.height === size && normalize(r.tier) === 'PRICE_2' && priced(r));
    if (fallback) return { sellingPriceSen: fallback.sellingPriceSen!, matchedTier: 'PRICE_2' };
    const any = rows.find((r) => r.height === size && priced(r));
    return any ? { sellingPriceSen: any.sellingPriceSen!, matchedTier: normalize(any.tier) } : null;
  };
  ```
- [ ] Run the selling-resolver tests — expect PASS:
  ```
  pnpm --filter @2990s/shared exec vitest run src/mfg-pricing.test.ts
  ```
- [ ] **Verify the COST path is byte-identical.** Read `computeMfgLineCost`'s SOFA branch (~350–364): it calls `resolveSeatHeightSen` which reads `.priceSen` only. Adding `sellingPriceSen?` is purely additive — confirm no change to this branch. Also confirm `computeMfgLinePrice`'s SOFA branch (~262–275) still sets `basePriceSen = 0` and is NOT given the selling base. (No edit — verification only; note it in the commit message.)
- [ ] **Write failing test** for the assembly helper in `packages/shared/src/__tests__/sofa-build.test.ts` (import `sofaModuleSellingPricesFromSkus`):
  ```ts
  describe('sofaModuleSellingPricesFromSkus (2026-06-01)', () => {
    it('prefers per-(depth,tier) sellingPriceSen, falls back to flat sell, then drops 0', () => {
      const rows = [
        { code: 'OMMBUC-1S', sellPriceSen: 120000, seatHeightPrices: [
          { height: '24', priceSen: 50000, tier: 'PRICE_1' as const, sellingPriceSen: 99000 },
        ]},
        { code: 'OMMBUC-2S', sellPriceSen: 150000, seatHeightPrices: null }, // flat fallback
        { code: 'OMMBUC-1NA', sellPriceSen: null, seatHeightPrices: null },  // unpriced → dropped
      ];
      const map = sofaModuleSellingPricesFromSkus(rows, 'Ommbuc', '24', 'PRICE_1');
      expect(map['1S']).toBe(99000);   // seat selling wins
      expect(map['2S']).toBe(150000);  // flat sell fallback
      expect(map['1NA']).toBeUndefined(); // unpriced → no entry
    });
  });
  ```
- [ ] Run — expect FAIL:
  ```
  pnpm --filter @2990s/shared exec vitest run src/__tests__/sofa-build.test.ts
  ```
- [ ] **Add `sofaModuleSellingPricesFromSkus`** to `packages/shared/src/sofa-build.ts`, immediately after `sofaModulePricesFromSkus` (after line 275). It is a depth/tier-aware variant: prefer per-`(depth,tier)` `sellingPriceSen`, fall back to flat `sellPriceSen`, drop when 0/null. Add the import of the resolver at the top of the file:
  ```ts
  import { resolveSeatHeightSelling, type MfgSeatHeightPrice } from './mfg-pricing';
  ```
  Then:
  ```ts
  /** Build the per-Model module→SELLING-price map (sen) for the chosen depth+tier.
   *  For each SKU: prefer the per-(depth,tier) seatHeightPrices[].sellingPriceSen,
   *  else the flat module sell_price_sen, else drop (0/null → no entry → priced 0
   *  at lookup). Same normalized-code keying as sofaModulePricesFromSkus so POS and
   *  the server drift gate produce an identical map by construction. */
  export const sofaModuleSellingPricesFromSkus = (
    rows: Array<{
      code: string;
      sellPriceSen: number | null;
      seatHeightPrices?: MfgSeatHeightPrice[] | null;
    }>,
    baseModel: string | null | undefined,
    depth: string | null | undefined,
    tier: import('./sofa-combo-pricing').SofaPriceTier | null | undefined,
  ): SofaModulePriceSen => {
    const map: SofaModulePriceSen = {};
    for (const r of rows) {
      const seat = resolveSeatHeightSelling(r.seatHeightPrices, depth, tier ?? 'PRICE_2');
      const sen = seat?.sellingPriceSen ?? r.sellPriceSen ?? 0;
      if (sen <= 0) continue;
      map[normalizeCompartmentCode(moduleCodeFromSku(r.code, baseModel))] = sen;
    }
    return map;
  };
  ```
  > Note: `mfg-pricing.ts` and `sofa-build.ts` are both re-exported by `index.ts` (`export *`); confirm no import cycle is introduced (sofa-build already imports types from sofa-combo-pricing via `import('./...')`; importing a value `resolveSeatHeightSelling` from mfg-pricing is the new edge — if a cycle appears at build, switch to `import type` for `MfgSeatHeightPrice` and inline the resolver call via the package root, or move `resolveSeatHeightSelling` into sofa-build. Verify with the build step.)
- [ ] Run both test files — expect PASS:
  ```
  pnpm --filter @2990s/shared exec vitest run src/mfg-pricing.test.ts src/__tests__/sofa-build.test.ts
  pnpm --filter @2990s/shared typecheck
  ```
- [ ] Commit: `git commit -m "feat(shared): per-(depth,tier) sofa SELLING resolver + assembly helper (cost path unchanged)"`.

---

## TASK B2 — Wire the SELLING assembly into POS + server (same helper, no false drift)

**Files:**
- Modify: `apps/pos/src/lib/queries.ts` (`useSofaCustomizerData` ~887–930) — select `seat_height_prices`; build the map via the new helper
- Modify: `apps/api/src/lib/mfg-pricing-recompute.ts`
  - `loadModelSofaModulePrices` (~334–352) — select `seat_height_prices`; return the richer rows OR move map assembly into `recomputeFromSnapshot`
  - `recomputeFromSnapshot` (~268–289) — assemble the selling map with the line's `sofaDepth` + `fabricTier`
- Test: extend `apps/api`/shared recompute tests if present

> **Design note (judgment call — see report):** the POS `useSofaCustomizerData` builds `modulePrices` once per SKU WITHOUT the user's chosen depth/tier, while the server knows depth+tier inside `recomputeFromSnapshot`. To keep POS == server, the cleanest approach is: **load the raw rows (incl. `seat_height_prices`) on both sides, and call `sofaModuleSellingPricesFromSkus(rows, baseModel, depth, tier)` at the point where depth+tier are known.** On the server that is inside `recomputeFromSnapshot` (depth at line ~269, tier at ~159). On POS, thread the configurator's current depth + selected fabric tier into the map build (rebuild the map when depth/tier change). If threading depth/tier into the POS customizer is too invasive for this pass, an acceptable interim is to build the POS map at the default tier (`PRICE_2`) + the Model's default depth and document the limitation — BUT the server MUST then use the SAME default to avoid drift. **Surface this to the Chairman/eng-review before implementing** (recorded in the final report).

### Steps

- [ ] **Server: enrich the loader.** In `loadModelSofaModulePrices` (~339–351) change the select from `'code, sell_price_sen'` to `'code, sell_price_sen, seat_height_prices'` and return the raw rows (rename to `loadModelSofaModuleSellingRows` returning `Array<{ code; sell_price_sen; seat_height_prices }>`), OR keep the function and add a sibling that returns rows. Then in `recomputeFromSnapshot`, where `sofaModulePrices` is consumed (the `canPriceSofa` branch, ~268–289), build the map with the known depth+tier:
  ```ts
  const sofaSellingMap = sofaModuleSellingPricesFromSkus(
    sofaSellingRows,        // raw rows loaded by base_model
    product?.base_model,
    sofaDepth,              // line 269
    fabricTier,             // line 159 (sofa tier)
  );
  ```
  and pass `sofaSellingMap` into `computeSofaSellingSen(...)` in place of the old flat `sofaModulePrices`. Update the route call sites (`mfg-sales-orders.ts:938`, `:1815`, `:1993` and `mfg-pricing-recompute.ts:420`) to pass the raw rows through to `recomputeFromSnapshot` (the signature already takes `sofaModulePrices`; either keep that param as the assembled map built at the call site WHERE depth/tier are NOT yet known — which forces the interim default — or extend the signature to take the raw rows + let recompute assemble). **Pick one and keep POS identical.** Recommended: extend `recomputeFromSnapshot` to accept the raw selling rows and assemble internally (depth/tier are local there), preserving the "POS == server" invariant.
- [ ] **POS: enrich the customizer.** In `useSofaCustomizerData` (~920–930) change the select from `'code, sell_price_sen'` to `'code, sell_price_sen, seat_height_prices'` and build `modulePrices` via `sofaModuleSellingPricesFromSkus(rows, model.model_code, depth, tier)`. Thread the configurator's current depth + selected fabric tier (or the documented interim default) so the palette price + `computeSofaPrice` reflect the buyer SELLING price.
- [ ] **Verify the drift gate cannot false-reject:** add/extend a recompute test asserting that for a SKU with a per-`(depth,tier)` `sellingPriceSen`, the POS-built total and the server `recomputeFromSnapshot` total are equal (no drift) when fed the same depth+tier.
- [ ] Build + test:
  ```
  pnpm typecheck
  pnpm --filter @2990s/shared test
  pnpm --filter @2990s/api build
  pnpm --filter @2990s/pos build
  ```
  Expected: all green.
- [ ] Commit: `git commit -m "feat(pos,api): sofa SELLING reads per-(depth,tier) sellingPriceSen via shared assembly helper"`.

---

## TASK B3 — API PATCH accepts + audits `sellingPriceSen`

**Files:**
- Modify: `apps/api/src/routes/mfg-products.ts`
  - PATCH body type (~278) — widen entry shape
  - seat-height diff block (~371–392) — add selling diff
  - `PRICE_FIELDS` (~27) + audit guard (~416) — let `seat_height_selling:` through
  - light validation before the write
- Modify: `apps/pos/src/lib/products/mfg-products-queries.ts` (`SeatHeightPrice` type ~56–62) — add `sellingPriceSen?`

### Steps

- [ ] **POS write type.** In `mfg-products-queries.ts` (~56–62) add `sellingPriceSen?: number;` to `SeatHeightPrice` (mirrors the shared type). This flows through the `useUpdateMfgProductPrices` mutation body automatically.
- [ ] **API body type.** In `mfg-products.ts` (~278) replace:
  ```ts
      seatHeightPrices?: Array<{ height: string; priceSen: number; tier?: 'PRICE_1' | 'PRICE_2' | 'PRICE_3' }>;
  ```
  with:
  ```ts
      seatHeightPrices?: Array<{ height: string; priceSen: number; tier?: 'PRICE_1' | 'PRICE_2' | 'PRICE_3'; sellingPriceSen?: number }>;
  ```
- [ ] **Add the selling audit diff.** In the seat-height block (~371–392), extend the local `Slot` type with `sellingPriceSen?: number`, build `oldSellMap`/`newSellMap` keyed by the same `${height}|${tier ?? 'PRICE_2'}`, and push `field: \`seat_height_selling:${k}\`` rows for changed selling values (alongside the existing `seat_height:${k}` cost diff). The array is already stored verbatim (`updates.seat_height_prices = body.seatHeightPrices`), so `sellingPriceSen` persists with NO DB migration.
- [ ] **Let the audit rows through the guard.** The existing guard (`if (!PRICE_FIELDS.has(ch.field)) continue;`, ~416) silently drops ALL `seat_height:*` rows today (pre-existing bug). Relax it to allow seat-height fields:
  ```ts
    if (!PRICE_FIELDS.has(ch.field) && !ch.field.startsWith('seat_height')) continue;
  ```
  (This audits BOTH the new `seat_height_selling:` rows AND fixes the pre-existing `seat_height:` cost-audit gap in one line. `master_price_history.field` is free-text — no DB enum to extend.)
- [ ] **Add light validation** before the write (matching the handler's low-ceremony style): if any seat entry's `sellingPriceSen` is present but not a finite non-negative integer, `return c.json({ error: 'invalid_selling_price' }, 400)`.
- [ ] **Update the JSONB column comment** in `packages/db/src/schema.ts` (~1740) to mention the new `sellingPriceSen` sub-field on `seat_height_prices`. No migration — JSONB is schemaless.
- [ ] Build:
  ```
  pnpm typecheck
  pnpm --filter @2990s/api build
  ```
  Expected: succeeds.
- [ ] Commit: `git commit -m "feat(api): PATCH /mfg-products accepts + audits seat_height sellingPriceSen"`.

---

## TASK B4 — POS sofa Edit-Price grid: P1-base, derived P2/P3, pin + Reset, writes SELLING

**Files:**
- Modify: `apps/pos/src/pages/Products.tsx`
  - `priceForHeightTier` / `upsertHeightTier` (~1022–1061) — add selling-aware variants (do NOT break the 0/null-collapse handling)
  - `SkuMasterTab` state (~1076–1092) — global Δ2/Δ3 + storage; Reset signal
  - toolbar `actionsRow` (~1276–1320) — two Δ inputs + Reset-to-formula button (sofa-only, `canEdit`-gated)
  - `ProductRow` invocation (~1416–1441) — thread Δ2/Δ3 + reset signal
  - `ProductRow` helpers (~1534–1559) — `updateSofaCell` writes `sellingPriceSen`; derive P2/P3
  - sofa cell render (~1662–1688) — P1 editable; P2/P3 derived/pinned
  - `PriceInput` (~1847–1900) — add a `valueSen` sync so P2/P3 live-update as P1 is typed
- Modify: `apps/pos/src/lib/products/mfg-products-queries.ts` — `MaintenanceConfig` gains `sofaTierDeltaSen?` (global Δ storage)

### Steps

- [ ] **Storage for the global Δ2/Δ3.** They are explicitly GLOBAL (one pair for all sofa fabric). Add `sofaTierDeltaSen?: { p2: number; p3: number }` to the `MaintenanceConfig` type in `mfg-products-queries.ts` (near `sofaCompartments`). They persist via the existing `useSaveMaintenanceConfig` save path (already imported in `Products.tsx`). Read them in `SkuMasterTab` from `config.data?.data?.sofaTierDeltaSen ?? { p2: 0, p3: 0 }`.
- [ ] **`SkuMasterTab` state** (~1078): add `const [delta2Sen, setDelta2Sen]` / `const [delta3Sen, setDelta3Sen]` initialized from the config value, and a `const [resetSignal, setResetSignal] = useState(0)` bumped by the Reset button.
- [ ] **Toolbar controls** (~1302–1319, inside the `isSofaView && ...` block, gated by `canEdit`). Add two numeric inputs `P2 = P1 + [__]` and `P3 = P1 + [__]` (reusing `styles.tierGroup`/`styles.tierChip` tokens) bound to `delta2Sen`/`delta3Sen` (commit to config on blur via `useSaveMaintenanceConfig`), and a `Reset to formula` `Button variant="secondary"` that `confirm()`s then bumps `resetSignal` (the one primary orange CTA stays `Edit Prices` — Reset is secondary).
- [ ] **Thread props** into `ProductRow` (~1416–1441): pass `delta2Sen`, `delta3Sen`, `resetSignal` alongside `tier`.
- [ ] **`ProductRow` derive + write SELLING** (~1534–1559). Read the existing `(height, tier)` value via a selling-aware lookup (read `entry.sellingPriceSen` instead of `priceSen`). `updateSofaCell` writes `sellingPriceSen` on the entry (NOT `priceSen` — Backend owns `priceSen`/cost). Beware: `upsertHeightTier` deletes a slot when the value is `0`/`null` — for selling, write `{ height, tier, sellingPriceSen }` while PRESERVING any existing `priceSen` (cost) on that entry (do not clobber Backend's cost). Implement a `upsertHeightTierSelling(arr, height, tier, sellingPriceSen)` that merges onto the existing entry rather than replacing it, and does NOT delete the slot if `priceSen` (cost) is still present.
- [ ] **Sofa cell render — P1 base, derived P2/P3** (~1662–1688):
  - `tier === 'PRICE_1'`: editable `PriceInput` writing `sellingPriceSen` for P1.
  - `tier === 'PRICE_2' | 'PRICE_3'`: the displayed value = (P1 selling for that size) + `delta2Sen`/`delta3Sen`, UNLESS that `(size, tier)` cell is PINNED (has an explicit `sellingPriceSen` entry). A pinned cell shows + persists its manual value. Manually editing a P2/P3 cell pins it (writes an explicit `sellingPriceSen`). `resetSignal` clears all P2/P3 pins on this row (delete the P2/P3 `sellingPriceSen` entries → they re-derive). Persistence model: presence of a P2/P3 `sellingPriceSen` entry = pinned; absence = derived. (Reconciles spec #7's "Save persists everything" with the existing per-cell-blur auto-PATCH — each blur is the save; Reset is a bulk PATCH across pinned cells. Do NOT add a separate Save button — would violate the one-primary-CTA rule.)
- [ ] **`PriceInput` live-sync** (~1859). Today local state initialises once and never re-syncs to a changed `valueSen`, so derived P2/P3 would NOT update as P1 is typed. Add a controlled sync:
  ```ts
    useEffect(() => {
      setLocal(valueSen == null ? '' : (valueSen / 100).toFixed(2));
    }, [valueSen]);
  ```
  (import `useEffect`). This makes P2/P3 cells live-update when P1 changes. Keep commit-on-blur/Enter.
- [ ] **Reset-to-formula bulk op.** When `resetSignal` bumps, for every visible sofa row clear its P2/P3 `sellingPriceSen` entries (N PATCH calls via `Promise.all`, mirroring the existing `bulkDelete` pattern ~1174). Guard with `confirm()` (Chairman explicitly rejected silent double-save reset).
- [ ] **Role gate confirm.** The Δ inputs + Reset button + sofa cell inputs all sit inside `editMode`/`canEdit` (= `mode === 'full'`); `sales`/`sales_director` never reach them. Verify by reading the guard chain (`editMode = canEdit ? editModeRaw : false`).
- [ ] Build:
  ```
  pnpm typecheck
  pnpm --filter @2990s/pos build
  ```
  Expected: succeeds.
- [ ] **Manual e2e (browse/Playwright):** as Master Admin, Products → SKU Master → SOFA → Edit Prices → set Δ2/Δ3 in the header → type P1 for `ANNSA-1S` at a size → P2/P3 live-fill = P1 + Δ → manually edit P2 (pins) → Save (blur) → reopen: P1 + pinned P2 persist, P3 still derived → Reset to formula → P2 re-derives. Then confirm the Customize palette + a `1S` combo show the SELLING figure (not `TBC`) and the server drift gate accepts it. Screenshot.
- [ ] Commit: `git commit -m "feat(pos): sofa Edit-Price grid sets SELLING with P1-base tier auto-derive + pin/reset"`.

---

## TASK B5 — Phase B integration check + ship

**Steps:**
- [ ] Full suite:
  ```
  pnpm typecheck
  pnpm test
  pnpm --filter @2990s/pos build
  pnpm --filter @2990s/backend build
  pnpm --filter @2990s/api build
  ```
  Expected: all green.
- [ ] Confirm COST untouched: re-run shared `mfg-pricing.test.ts` cost-branch cases (they must be unchanged) and a manual Backend check that `priceSen`/cost edits still work.
- [ ] Ship Phase B (`/ship` → PR) with the e2e evidence + the depth/tier design-note resolution from B2.

---

## Spec coverage map (self-check)

| Spec requirement | Task(s) |
|---|---|
| #1 Geometry — 9 rows resolvable + `classifySofaCompartment` deterministic | A1 |
| #2 Combo picker reads the pool | A3 |
| #3 Customize palette reads activated subset (+ role gate) | A4, A6 |
| #4 Placement + pricing + matching (confirm) | A1, A5 |
| #5 Console merge (code + data) | A1, A2 |
| #6 Edit-Price grid sets sofa SELLING price | B1, B2, B3, B4 |
| #7 Tier auto-derive from P1 (Δ2/Δ3, pin, reset) | B4 |
| Decision 6 — palette art from uploaded PNG | A4 |
| Portal & role boundaries (POS reads pool, Master-Admin gates) | A6, B4 |
| `'3-seater'` group union widening | A1 |
| `MODULE_EDGES_BASE` for new codes | A1 |
| Namespace-collision proof (placed 1S ≠ bundle) | A1, A5 |
