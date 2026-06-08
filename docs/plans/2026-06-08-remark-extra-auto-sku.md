# Auto-SKU from remark + extra charge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a POS product line carries an extra add-on price, mint a traceable, inactive one-shot SKU per component at SO-create; let an admin re-activate it so it's selectable again in POS, reusing the base compartment's art/geometry.

**Architecture:** A new shared pure module (`one-shot-sku.ts`) derives codes/names; `so-sofa-split.ts` gains an even-split mode; the SO-create route mints SKUs (service-role, batched) after `checkAllowedOptions` and rewrites `item_code`; a backend activation endpoint flips `pos_active` + adds the compartment to `allowed_options`; the POS configurator palette is extended (sanctioned `UI_REFERENCE.md` deviation) to render synthesized custom compartments using a shared `representativeArtCode()` art fallback. Pricing auto-flows because the one-shot SKU shares `base_model`.

**Tech Stack:** TS 5.7 strict · pnpm workspace · Hono on CF Workers · Supabase Postgres · React 19 + Vite · vitest. Spec: `docs/specs/2026-06-08-remark-extra-auto-sku-spec.md` (this plan refines it: migration **0161**, normalized code form, `representativeArtCode` art reuse).

**Worktree:** all work in `.claude/worktrees/remark-auto-sku` on branch `feat/remark-extra-auto-sku`. ⚠️ Task 9 (`ProductModelDetail.tsx`) overlaps the parallel branch `feat/backend-special-addons-parity` — rebase before/after.

**Run-test commands (from repo root):**
- shared: `pnpm --filter @2990s/shared test -- src/<file>.test.ts`
- api: `pnpm --filter @2990s/api test -- src/routes/<file>.test.ts`
- typecheck a package: `pnpm --filter @2990s/shared typecheck` (NEVER pipe to `| tail` — it swallows the exit code; SO-SKU spec #489 was bitten by this).

---

## Task 1: Migration 0161 + schema column

**Files:**
- Create: `packages/db/migrations/0161_one_shot_skus.sql`
- Modify: `packages/db/src/schema.ts` (mfgProducts table, ~line 1833-1875)

- [ ] **Step 1: Verify 0161 is free**

Run: `ls packages/db/migrations | sort | tail -5`
Expected: highest is `0160_addons_service_sku.sql`; `0161_*` does not exist. If a higher number appeared (parallel branch), use the next free number and update every reference in this plan.

- [ ] **Step 2: Write the migration file**

Create `packages/db/migrations/0161_one_shot_skus.sql`:

```sql
-- 0161_one_shot_skus.sql
-- Loo 2026-06-08 — auto-mint one-shot SKUs from a product-page remark + extra
-- charge. Two new mfg_products columns mark + trace the minted rows; one new
-- so_settings flag gates the whole behaviour (default OFF: ship code dark, flip
-- ON after live verification). Spec docs/specs/2026-06-08-remark-extra-auto-sku-spec.md.

BEGIN;

ALTER TABLE mfg_products ADD COLUMN IF NOT EXISTS one_shot      boolean NOT NULL DEFAULT false;
ALTER TABLE mfg_products ADD COLUMN IF NOT EXISTS source_doc_no text;

INSERT INTO so_settings (key, enabled, label)
VALUES ('pos_remark_extra_auto_sku', false, 'Auto-mint SKU from remark + extra charge')
ON CONFLICT (key) DO NOTHING;

COMMIT;
```

- [ ] **Step 3: Mirror the columns in the Drizzle schema (source of truth)**

In `packages/db/src/schema.ts`, inside the `mfgProducts` table (after `branding: text('branding'),`), add:

```ts
  // 0161 — system-minted one-shot SKUs (remark + extra charge). one_shot marks
  // the row for the SKU-Master badge/filter; source_doc_no links back to the SO
  // that minted it. Born pos_active=false; an admin re-activates from Modular.
  oneShot:                boolean('one_shot').notNull().default(false),
  sourceDocNo:            text('source_doc_no'),
```

- [ ] **Step 4: Typecheck the db package**

Run: `pnpm --filter @2990s/db typecheck`
Expected: PASS (no errors).

- [ ] **Step 5: Apply the migration to the DB (Supabase MCP)**

Apply `0161_one_shot_skus.sql` via the Supabase MCP `apply_migration` (the GH workflow is known-broken). Then verify:

Run (MCP `execute_sql`): `SELECT column_name FROM information_schema.columns WHERE table_name='mfg_products' AND column_name IN ('one_shot','source_doc_no');`
Expected: 2 rows. And `SELECT key, enabled FROM so_settings WHERE key='pos_remark_extra_auto_sku';` → 1 row, `enabled=false`.

- [ ] **Step 6: Commit**

```bash
git -C .claude/worktrees/remark-auto-sku add packages/db/migrations/0161_one_shot_skus.sql packages/db/src/schema.ts
git -C .claude/worktrees/remark-auto-sku commit -m "feat(db): 0161 one_shot + source_doc_no on mfg_products, pos_remark_extra_auto_sku flag"
```

---

## Task 2: Shared `one-shot-sku.ts` (pure code + name helpers)

**Files:**
- Create: `packages/shared/src/one-shot-sku.ts`
- Test: `packages/shared/src/one-shot-sku.test.ts`
- Modify: `packages/shared/src/index.ts` (add export — confirm the barrel pattern first)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/one-shot-sku.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { remarkSlug, oneShotSofaCode, oneShotSimpleCode, buildOneShotName } from './one-shot-sku';

describe('remarkSlug', () => {
  it('uppercases and dash-joins alphanumerics', () => {
    expect(remarkSlug('Seat Extend 40cm')).toBe('SEAT-EXTEND-40CM');
  });
  it('collapses punctuation runs and trims edge dashes', () => {
    expect(remarkSlug('  extend++40 cm!! ')).toBe('EXTEND-40-CM');
  });
  it('caps at 40 chars and never ends on a dash', () => {
    const s = remarkSlug('a'.repeat(60));
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('oneShotSofaCode — normalized parens form (D6)', () => {
  it('produces a canonical, Phase-2-stable code', () => {
    expect(oneShotSofaCode('ANNSA', '1A(LHF)', 'SEAT-EXTEND-40CM'))
      .toBe('ANNSA-1A(LHF)(SEAT)(EXTEND)(40CM)');
  });
  it('collision suffix stays inside the normalization (no stray dash)', () => {
    expect(oneShotSofaCode('ANNSA', '1A(LHF)', 'SEAT-EXTEND-40CM', 2))
      .toBe('ANNSA-1A(LHF)(SEAT)(EXTEND)(40CM)(2)');
  });
  it('uppercases a lowercase model code', () => {
    expect(oneShotSofaCode('annsa', '2A(RHF)', 'WIDE')).toBe('ANNSA-2A(RHF)(WIDE)');
  });
});

describe('oneShotSimpleCode — mattress/bedframe (no compartment axis)', () => {
  it('suffixes the base SKU code with the slug', () => {
    expect(oneShotSimpleCode('2990 AKKA-FIRM MATT (Q)', 'EXTEND-5CM'))
      .toBe('2990 AKKA-FIRM MATT (Q)-EXTEND-5CM');
  });
  it('appends a collision counter', () => {
    expect(oneShotSimpleCode('1003-(K)', 'TALLER', 3)).toBe('1003-(K)-TALLER-3');
  });
});

describe('buildOneShotName', () => {
  it('appends the remark in parentheses', () => {
    expect(buildOneShotName('SOFA ANNSA 1A(LHF)', 'Seat Extend 40cm'))
      .toBe('SOFA ANNSA 1A(LHF) (Seat Extend 40cm)');
  });
  it('returns the base name unchanged when remark is empty', () => {
    expect(buildOneShotName('SOFA ANNSA 1A(LHF)', '  ')).toBe('SOFA ANNSA 1A(LHF)');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @2990s/shared test -- src/one-shot-sku.test.ts`
Expected: FAIL — `Cannot find module './one-shot-sku'`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/one-shot-sku.ts`:

```ts
import { normalizeCompartmentCode } from './sofa-build';

/** Slug a free-text remark into an UPPERCASE dash-joined token, capped at 40. */
export function remarkSlug(remark: string): string {
  return (remark ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, ''); // re-trim if the slice cut mid-dash
}

/**
 * SOFA one-shot SKU code (D6): `{MODEL}-{normalizeCompartmentCode(comp-slug[-n])}`.
 * The compartment portion is normalized to canonical parens so a Phase-2
 * re-selection (the configurator normalizes moduleId) produces the SAME code.
 * `n > 1` is the collision suffix; it rides the raw string so it normalizes
 * into a `(n)` group and stays normalization-stable.
 */
export function oneShotSofaCode(modelCode: string, compartment: string, slug: string, n = 1): string {
  const raw = `${compartment}-${slug}${n > 1 ? `-${n}` : ''}`;
  return `${(modelCode ?? '').trim()}-${normalizeCompartmentCode(raw)}`.toUpperCase();
}

/**
 * MATTRESS/BEDFRAME one-shot SKU code: `{baseSkuCode}-{slug}[-n]`. These have no
 * compartment axis and re-activate via pos_active (no configurator matching), so
 * a plain suffix is fine — no normalization needed.
 */
export function oneShotSimpleCode(baseCode: string, slug: string, n = 1): string {
  return `${(baseCode ?? '').trim()}-${slug}${n > 1 ? `-${n}` : ''}`;
}

/** One-shot SKU display name: base name + ` (remark)` (remark kept as typed). */
export function buildOneShotName(baseName: string, remark: string): string {
  const r = (remark ?? '').trim();
  return r ? `${baseName} (${r})` : baseName;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @2990s/shared test -- src/one-shot-sku.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Export from the package barrel**

Confirm the barrel: `grep -n "sofa-build" packages/shared/src/index.ts`. Match the existing style and add an export line for `./one-shot-sku` (e.g. `export * from './one-shot-sku';`). If `@2990s/shared` is imported by subpath elsewhere, no barrel edit is needed — verify how `so-sofa-split` is consumed and mirror it.

- [ ] **Step 6: Commit**

```bash
git -C .claude/worktrees/remark-auto-sku add packages/shared/src/one-shot-sku.ts packages/shared/src/one-shot-sku.test.ts packages/shared/src/index.ts
git -C .claude/worktrees/remark-auto-sku commit -m "feat(shared): one-shot-sku code/name helpers"
```

---

## Task 3: `representativeArtCode()` in sofa-build.ts (art reuse key)

**Files:**
- Modify: `packages/shared/src/sofa-build.ts` (add export near `findModule`, ~line 279)
- Test: `packages/shared/src/sofa-build.test.ts` (append; if absent, create with the import shown)

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/sofa-build.test.ts` (create the file with `import { describe, it, expect } from 'vitest';` + the import below if it doesn't exist):

```ts
import { representativeArtCode } from './sofa-build';

describe('representativeArtCode — base art key for custom/one-shot codes', () => {
  it('returns the code itself for a standard module', () => {
    expect(representativeArtCode('1A(LHF)')).toBe('1A(LHF)');
  });
  it('falls back to the base family representative for a custom code', () => {
    expect(representativeArtCode('1A(LHF)(SEAT)(EXTEND)(40CM)')).toBe('1A(LHF)');
  });
  it('handles armless / single-token families', () => {
    expect(representativeArtCode('1NA(TALL)')).toBe('1NA');
  });
  it('passes through an unknown family unchanged (no representative)', () => {
    expect(representativeArtCode('Console')).toBe('Console');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @2990s/shared test -- src/sofa-build.test.ts`
Expected: FAIL — `representativeArtCode is not a function`.

- [ ] **Step 3: Implement (uses the file-private `MODULE_BY_ID`, `parseCompartmentStructure`, `familyRepresentative`)**

In `packages/shared/src/sofa-build.ts`, immediately AFTER `export const findModule = ...` (≈ line 279), add:

```ts
/**
 * The asset key whose PNG/SVG a (possibly custom/one-shot) compartment code
 * should draw. Standard codes return themselves; synthesized codes like
 * '1A(LHF)(SEAT)(EXTEND)(40CM)' fall back to their base family representative
 * ('1A(LHF)') so a one-shot variant reuses the base compartment art with no
 * new asset + no maintenance-config write. Unknown families pass through.
 */
export const representativeArtCode = (code: string): string => {
  const norm = normalizeCompartmentCode(code);
  if (MODULE_BY_ID.has(norm)) return norm;
  const s = parseCompartmentStructure(norm);
  const rep = s ? familyRepresentative(s) : undefined;
  return rep ?? norm;
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @2990s/shared test -- src/sofa-build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C .claude/worktrees/remark-auto-sku add packages/shared/src/sofa-build.ts packages/shared/src/sofa-build.test.ts
git -C .claude/worktrees/remark-auto-sku commit -m "feat(shared): representativeArtCode — base-art key for custom compartments"
```

---

## Task 4: Even-split mode in `so-sofa-split.ts` (D4)

**Files:**
- Modify: `packages/shared/src/so-sofa-split.ts` (args type ~line 77; weights ~line 108-114)
- Test: `packages/shared/src/so-sofa-split.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/so-sofa-split.test.ts`:

```ts
describe('splitSofaBuildIntoModuleLines — evenSplitPrice (D4, one-shot path)', () => {
  const cells = [{ moduleId: '1A(LHF)' }, { moduleId: 'L(RHF)' }];
  // Asymmetric module prices: proportional would give 1000:1990, even gives 50:50.
  const modulePrices = { '1A(LHF)': 100000, 'L(RHF)': 199000 };

  it('splits SELLING evenly when evenSplitPrice=true (residue on last)', () => {
    const split = splitSofaBuildIntoModuleLines({
      baseModel: 'ANNSA', cells, buildUnitPriceSen: 349000, buildUnitCostSen: 0,
      modulePrices, evenSplitPrice: true,
    });
    expect(split?.map((s) => s.unitPriceSen)).toEqual([174500, 174500]);
  });

  it('keeps COST on the catalog-weight split even when price is even', () => {
    const split = splitSofaBuildIntoModuleLines({
      baseModel: 'ANNSA', cells, buildUnitPriceSen: 349000, buildUnitCostSen: 100000,
      modulePrices, evenSplitPrice: true,
    });
    // cost weights 100000:199000 of 100000 → floor(33444)=33444 ... residue last.
    const costs = split!.map((s) => s.unitCostSen);
    expect(costs.reduce((a, b) => a + b, 0)).toBe(100000);
    expect(costs[0]).not.toBe(costs[1]); // proportional, NOT even
  });

  it('default (no flag) still splits price proportionally', () => {
    const split = splitSofaBuildIntoModuleLines({
      baseModel: 'ANNSA', cells, buildUnitPriceSen: 299000, buildUnitCostSen: 0, modulePrices,
    });
    // 299000 × 100000/299000 = 100000 floor; residue 199000 on last.
    expect(split?.map((s) => s.unitPriceSen)).toEqual([100000, 199000]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @2990s/shared test -- src/so-sofa-split.test.ts`
Expected: FAIL — `evenSplitPrice` not honoured (first test gets `[100000, 249000]`).

- [ ] **Step 3: Implement the flag**

In `packages/shared/src/so-sofa-split.ts`, add to the `args` object type (after the `modulePrices` field):

```ts
  /** D4 one-shot path: split the SELLING price EVENLY across modules (cost stays
   *  on the catalog-weight split). Default false = legacy proportional split. */
  evenSplitPrice?: boolean;
```

Then change the price-shares line. Replace:

```ts
  const priceShares = distributeProportionally(args.buildUnitPriceSen, weights);
  const costShares = distributeProportionally(args.buildUnitCostSen, weights);
```

with:

```ts
  const priceWeights = args.evenSplitPrice ? codes.map(() => 1) : weights;
  const priceShares = distributeProportionally(args.buildUnitPriceSen, priceWeights);
  const costShares = distributeProportionally(args.buildUnitCostSen, weights);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @2990s/shared test -- src/so-sofa-split.test.ts`
Expected: PASS (new + existing tests).

- [ ] **Step 5: Commit**

```bash
git -C .claude/worktrees/remark-auto-sku add packages/shared/src/so-sofa-split.ts packages/shared/src/so-sofa-split.test.ts
git -C .claude/worktrees/remark-auto-sku commit -m "feat(shared): even-split price mode for one-shot sofa lines (D4)"
```

---

## Task 5: Server — mint one-shot SKUs at SO create

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts`
- Test: `apps/api/src/routes/mfg-sales-orders.test.ts` (create if absent; mirror `orders.test.ts` mock-supabase pattern)

This is the core. Read the current `POST '/'` handler regions first (anchors from extraction):
- `checkAllowedOptions` loop: ~1356-1371 (BEFORE recompute — minting must run AFTER).
- extra/flag check: ~1612-1628 (`hasDeclaredExtra` → `pos_product_remark`).
- sofa split + per-module row build: ~1835-1889.
- final items insert: ~2471-2480 (`if (itemRows.length > 0) { ... sb.from('mfg_sales_order_items').insert(rowsWithDoc) ... }`).
- supabase client var is `sb`; service-role client is built via `createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, ...)` (confirm `createClient` is imported; add `import { createClient } from '@supabase/supabase-js';` if not).

- [ ] **Step 1: Load the auto-SKU flag once (near the existing extra/flag block ~1612)**

Replace the `hasDeclaredExtra` block so it also reads the new flag in the SAME query (avoid an extra subrequest — CF cap). New:

```ts
  const hasDeclaredExtra = items.some((it) =>
    Number((it.variants as { extraAddonAmountRM?: unknown } | null)?.extraAddonAmountRM ?? 0) > 0);
  let autoSkuEnabled = false;
  if (hasDeclaredExtra) {
    const { data: flagRows, error: flagErr } = await sb
      .from('so_settings').select('key, enabled')
      .in('key', ['pos_product_remark', 'pos_remark_extra_auto_sku']);
    if (flagErr) { await rollbackPwpClaims(); return c.json({ error: 'lookup_failed', reason: flagErr.message }, 500); }
    const flags = new Map((flagRows ?? []).map((r) => [(r as { key: string }).key, (r as { enabled: boolean }).enabled]));
    if (flags.get('pos_product_remark') === false) {
      await rollbackPwpClaims();
      return c.json({ error: 'extra_amount_disabled', reason: 'Product-page extra charge is turned off in SO Maintenance.' }, 400);
    }
    autoSkuEnabled = flags.get('pos_remark_extra_auto_sku') === true; // missing row → OFF
  }
```

- [ ] **Step 2: Declare the mint-request accumulator before the item-build loop**

Just before the loop/`.map` that builds `itemRows` (where `sofaModulePricesByIdx` etc. are in scope), add:

```ts
  type OneShotMintReq = {
    row: Record<string, unknown>;   // the itemRow to rewrite (mutated by reference)
    category: 'SOFA' | 'OTHER';
    modelCode: string;              // base_model (sofa) — '' for non-sofa
    baseSkuCode: string;            // base SKU code (non-sofa)
    modelId: string | null;
    branding: string | null;
    compartment: string;            // normalized base compartment (sofa)
    remark: string;
    sellPriceSen: number;           // D9 list price
  };
  const oneShotReqs: OneShotMintReq[] = [];
  const extraRMof = (it: { variants?: unknown }) =>
    Math.max(0, Math.round(Number((it.variants as { extraAddonAmountRM?: unknown } | null)?.extraAddonAmountRM ?? 0)));
  const remarkOf = (it: { variants?: unknown }) => {
    const r = (it.variants as { remark?: unknown } | null)?.remark;
    return typeof r === 'string' ? r.trim() : '';
  };
```

- [ ] **Step 3: In the sofa-split block (~1841), pass evenSplitPrice and record mint requests**

Inside the `if (group === 'sofa')` block: compute `const extraRM = autoSkuEnabled ? extraRMof(it) : 0;` then pass `evenSplitPrice: extraRM > 0` to `splitSofaBuildIntoModuleLines`. Inside the `split.map((s, i) => { ... })`, after building the row object `const row = { ...baseRow, item_code: s.itemCode, ... }`, and BEFORE returning it, add:

```ts
          if (extraRM > 0 && product?.base_model) {
            const remark = remarkOf(it);
            const n = split.length;
            const baseSell = modulePrices?.[s.moduleCode] ?? 0;
            oneShotReqs.push({
              row,
              category: 'SOFA',
              modelCode: product.base_model,
              baseSkuCode: s.itemCode,
              modelId: (product as { model_id?: string | null }).model_id ?? null,
              branding: (product as { branding?: string | null }).branding ?? null,
              compartment: s.moduleCode,
              remark,
              sellPriceSen: baseSell + Math.round((extraRM * 100) / n),
            });
          }
          return row;
```

(Refactor the existing inline `return { ...baseRow, ... }` into `const row = { ...baseRow, ... }; return row;` so the push can reference it.)

- [ ] **Step 4: For non-sofa lines, record a single mint request**

Find where the non-sofa (size/bedframe/accessory) line row is built (the `else` of the sofa branch / the single-line path). After the row is assembled, add:

```ts
        const extraRM = autoSkuEnabled ? extraRMof(it) : 0;
        if (extraRM > 0 && product) {
          oneShotReqs.push({
            row,
            category: 'OTHER',
            modelCode: (product as { base_model?: string | null }).base_model ?? '',
            baseSkuCode: String((product as { code?: string }).code ?? row.item_code),
            modelId: (product as { model_id?: string | null }).model_id ?? null,
            branding: (product as { branding?: string | null }).branding ?? null,
            compartment: '',
            remark: remarkOf(it),
            sellPriceSen: Number(row.unit_price_centi ?? 0), // base + extra (N=1)
          });
        }
```

- [ ] **Step 5: After itemRows are built, resolve codes (collision-safe) + mint + rewrite item_code**

Immediately BEFORE the `if (itemRows.length > 0) {` insert block (~2471), add:

```ts
  if (oneShotReqs.length > 0) {
    // Resolve final codes with a single existence check (CF subrequest cap).
    const candidate = (req: OneShotMintReq, n: number) =>
      req.category === 'SOFA'
        ? oneShotSofaCode(req.modelCode, req.compartment, remarkSlug(req.remark), n)
        : oneShotSimpleCode(req.baseSkuCode, remarkSlug(req.remark), n);
    const firstPass = oneShotReqs.map((r) => candidate(r, 1));
    const { data: existing } = await sb.from('mfg_products').select('code').in('code', firstPass);
    const taken = new Set((existing ?? []).map((x) => (x as { code: string }).code));
    const finalCodes: string[] = [];
    for (const req of oneShotReqs) {
      let n = 1;
      let code = candidate(req, n);
      while (taken.has(code)) { n += 1; code = candidate(req, n); }
      taken.add(code);
      finalCodes.push(code);
    }
    // Build mfg_products rows (service-role: POS-role RLS forbids SKU writes).
    const now = new Date().toISOString();
    const skuRows = oneShotReqs.map((req, i) => {
      const code = finalCodes[i]!;
      const namePrefix = req.branding ? `${req.branding} ` : '';
      const baseName = req.category === 'SOFA'
        ? `${namePrefix}SOFA ${req.modelCode} ${req.compartment}`.trim()
        : String(req.row.description ?? req.baseSkuCode);
      // Rewrite the SO line to point at the minted SKU (+ remark in the desc).
      req.row.item_code = code;
      req.row.description = buildOneShotName(String(req.row.description ?? baseName), req.remark);
      const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID() : `${now}-${Math.random().toString(36).slice(2, 10)}`;
      return {
        id:             `mfg-${rand.replace(/-/g, '').slice(0, 12)}`,
        code,
        name:           buildOneShotName(baseName, req.remark),
        category:       req.category === 'SOFA' ? 'SOFA' : ((req.row.item_group as string)?.toUpperCase?.() ?? 'ACCESSORY'),
        base_model:     req.modelCode || null,
        model_id:       req.modelId,
        branding:       req.branding,
        description:    req.remark || null,
        sell_price_sen: req.sellPriceSen,
        cost_price_sen: null,        // D5 — blank cost
        status:         'ACTIVE',
        pos_active:     false,       // D7 — born inactive
        one_shot:       true,
        source_doc_no:  docNo,
        created_at:     now,
        updated_at:     now,
      };
    });
    const admin = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: skuErr } = await admin.from('mfg_products').insert(skuRows);
    // Best-effort: orphan inactive SKUs are harmless tombstones. 23505 = a
    // concurrent identical mint — treat as success. Other errors: log loudly
    // (CF reaper lesson) but DO NOT fail the SO — the line still references the
    // code; Master Admin can re-create the row from SKU Master if needed.
    if (skuErr && skuErr.code !== '23505') {
      console.error(`[so-create] one-shot SKU mint failed for ${docNo}: ${skuErr.message}`);
    }
  }
```

`category` for OTHER maps the SO `item_group` (`mattress`/`bedframe`/`accessory`) to a valid `mfgProductCategory`. Confirm the mapping against `VALID_CATEGORIES` (`SOFA|BEDFRAME|ACCESSORY|MATTRESS|SERVICE`); add an explicit lookup if `item_group` values differ (e.g. `others` → `ACCESSORY`).

- [ ] **Step 6: Add imports**

At the top of `mfg-sales-orders.ts`, ensure:

```ts
import { oneShotSofaCode, oneShotSimpleCode, remarkSlug, buildOneShotName } from '@2990s/shared';
import { createClient } from '@supabase/supabase-js'; // only if not already imported
```

- [ ] **Step 7: Write the route test**

Create `apps/api/src/routes/mfg-sales-orders.test.ts` mirroring `orders.test.ts` (mock `../middleware/auth` passthrough; `createMockSupabase` with table handlers; mock `@supabase/supabase-js` `createClient` to return a capturing insert). Cover:
1. **Flag OFF** (`pos_remark_extra_auto_sku` absent/false) + extra>0 → SO succeeds, **no** `mfg_products` insert, line keeps the base `item_code`.
2. **Flag ON** + sofa build (2 cells) + extra 500 → two `mfg_products` rows inserted with `one_shot=true`, `pos_active=false`, `cost_price_sen=null`, `source_doc_no=<docNo>`, code `…-1A(LHF)(…)`; the two SO lines' `item_code` rewritten to those codes; SO line `unit_price_centi` even (`Σ == build total`).
3. **Collision** — pre-seed `existing` codes so the candidate is taken → minted code gets the `(2)` suffix.
4. **Mattress** single line + extra → one SKU, `oneShotSimpleCode` shape.

```ts
// sketch of the key assertion in test 2:
const minted = adminInsertCapture.last as any[];
expect(minted).toHaveLength(2);
expect(minted.every((r) => r.one_shot === true && r.pos_active === false && r.cost_price_sen === null)).toBe(true);
expect(minted.map((r) => r.code)).toEqual([
  'ANNSA-1A(LHF)(SEAT)(EXTEND)(40CM)', 'ANNSA-1A(RHF)(SEAT)(EXTEND)(40CM)',
]);
```

- [ ] **Step 8: Run the route test**

Run: `pnpm --filter @2990s/api test -- src/routes/mfg-sales-orders.test.ts`
Expected: PASS.

- [ ] **Step 9: Guard against `recomputeTotals` clobbering the even split**

Read `recomputeTotals` (called at ~2479). Confirm it re-derives **header** totals + combo COST spread but does NOT overwrite per-line `unit_price_centi` for non-combo sofas. Add a test/assertion (or a code comment) that an extra-charged custom build (no combo match) keeps its even per-line sell after `recomputeTotals`. If it DOES clobber, scope the even-split persistence accordingly and note it here.

- [ ] **Step 10: Typecheck + commit**

Run: `pnpm --filter @2990s/api typecheck` → PASS.
```bash
git -C .claude/worktrees/remark-auto-sku add apps/api/src/routes/mfg-sales-orders.ts apps/api/src/routes/mfg-sales-orders.test.ts
git -C .claude/worktrees/remark-auto-sku commit -m "feat(api): mint one-shot SKUs at SO create (gated, batched, collision-safe)"
```

---

## Task 6: Surface `one_shot` + `source_doc_no` on GET /mfg-products

**Files:**
- Modify: `apps/api/src/routes/mfg-products.ts` (GET `/` select ~line 64-76)

- [ ] **Step 1: Add the columns to the select**

In the `.select(...)` string for GET `/`, append `one_shot, source_doc_no,` (before the `model:product_models(...)` join). Keep the `.eq('status','ACTIVE')` filter — one-shot SKUs are ACTIVE (only `pos_active=false`), so they appear in SKU Master.

- [ ] **Step 2: Verify the frontend row type**

In `apps/backend/src/lib/mfg-products-queries.ts` (and `apps/pos/src/lib/products/mfg-products-queries.ts` if it mirrors), add `one_shot?: boolean; source_doc_no?: string | null;` to the `MfgProductRow` type so TS is happy downstream.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @2990s/api typecheck && pnpm --filter @2990s/backend typecheck` → PASS.
```bash
git -C .claude/worktrees/remark-auto-sku add apps/api/src/routes/mfg-products.ts apps/backend/src/lib/mfg-products-queries.ts
git -C .claude/worktrees/remark-auto-sku commit -m "feat(api): expose one_shot + source_doc_no on GET /mfg-products"
```

---

## Task 7: Activation endpoint `POST /mfg-products/:id/activate-one-shot`

**Files:**
- Modify: `apps/api/src/routes/mfg-products.ts` (new route + `moduleCodeFromSku` import)
- Test: `apps/api/src/routes/mfg-products.test.ts` (create/extend)

- [ ] **Step 1: Write the failing test**

Assert: given a one-shot SOFA SKU `ANNSA-1A(LHF)(SEAT)(EXTEND)(40CM)` with `model_id` M and `base_model` ANNSA, calling `POST /mfg-products/:id/activate-one-shot` → (a) updates `mfg_products.pos_active=true` for the SKU; (b) updates `product_models.allowed_options.compartments` to include `1A(LHF)(SEAT)(EXTEND)(40CM)` (idempotent); for a MATTRESS one-shot → only flips `pos_active`. Use the mock-supabase capture pattern.

- [ ] **Step 2: Implement the route**

Add to `apps/api/src/routes/mfg-products.ts` (admin/master gate — reuse the role gate used by PATCH price routes):

```ts
import { moduleCodeFromSku } from '@2990s/shared';

mfgProducts.post('/:id/activate-one-shot', async (c) => {
  const gate = await requireRole(c, CREATE_ROLES); // admin / master_account
  if (!gate.ok) return gate.res;
  const id = c.req.param('id');
  const admin = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sku, error: skuErr } = await admin
    .from('mfg_products')
    .select('id, code, category, base_model, model_id, one_shot')
    .eq('id', id).maybeSingle();
  if (skuErr) return c.json({ error: 'lookup_failed', reason: skuErr.message }, 500);
  if (!sku || !(sku as { one_shot?: boolean }).one_shot) return c.json({ error: 'not_one_shot' }, 400);

  // Flip POS visibility (catalog gate for mattress/bedframe; selection for sofa).
  const { error: upErr } = await admin.from('mfg_products').update({ pos_active: true }).eq('id', id);
  if (upErr) return c.json({ error: 'activate_failed', reason: upErr.message }, 500);

  // SOFA: add the compartment to the Model's allowed_options so the palette shows it.
  const s = sku as { category: string; code: string; base_model: string | null; model_id: string | null };
  if (s.category === 'SOFA' && s.model_id) {
    const moduleCode = moduleCodeFromSku(s.code, s.base_model);
    const { data: model } = await admin.from('product_models')
      .select('allowed_options').eq('id', s.model_id).maybeSingle();
    const opts = ((model as { allowed_options?: Record<string, unknown> } | null)?.allowed_options) ?? {};
    const comps = Array.isArray((opts as { compartments?: unknown }).compartments)
      ? ((opts as { compartments: unknown[] }).compartments).map(String) : [];
    if (!comps.includes(moduleCode)) {
      const next = { ...opts, compartments: [...comps, moduleCode] };
      const { error: moErr } = await admin.from('product_models')
        .update({ allowed_options: next }).eq('id', s.model_id);
      if (moErr) return c.json({ error: 'allowed_options_update_failed', reason: moErr.message }, 500);
    }
  }
  return c.json({ ok: true });
});
```

Add a CORS note: `POST` is allowed (orders use POST). No PATCH/PUT needed.

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @2990s/api test -- src/routes/mfg-products.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git -C .claude/worktrees/remark-auto-sku add apps/api/src/routes/mfg-products.ts apps/api/src/routes/mfg-products.test.ts
git -C .claude/worktrees/remark-auto-sku commit -m "feat(api): activate-one-shot endpoint (pos_active + allowed_options)"
```

---

## Task 8: POS art fallback — `representativeArtCode` in queries.ts

**Files:**
- Modify: `apps/pos/src/lib/queries.ts` (useSofaCustomizerData imageKey default ~line 1303)

- [ ] **Step 1: Use the representative art key for the bundled fallback**

Import `representativeArtCode` from `@2990s/shared`. Change the imageKey default line:

```ts
        const imageKey = meta.imageKey ?? `sofa-modules/${representativeArtCode(rawCode)}.svg`;
```

(Was `sofa-modules/${norm}.svg`.) This makes a custom code `1A(LHF)(SEAT)(EXTEND)(40CM)` resolve to `sofa-modules/1A(LHF).svg`. Standard codes are unchanged (`representativeArtCode('1A(LHF)') === '1A(LHF)'`).

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @2990s/pos typecheck` → PASS.
```bash
git -C .claude/worktrees/remark-auto-sku add apps/pos/src/lib/queries.ts
git -C .claude/worktrees/remark-auto-sku commit -m "feat(pos): one-shot compartments reuse base art via representativeArtCode"
```

---

## Task 9: POS palette extension (sanctioned deviation) — render custom compartments

**Files:**
- Modify: `apps/pos/src/pages/CustomBuilder.tsx` (palette block ~1030-1097; resolveModuleArtSrc ~333-342)

⚠️ Configurator file — sanctioned deviation (D10). Additive only: NO snap-math, drag, or PNG change. Read `UI_REFERENCE.md` "Approved deviations" + "What NOT to do" before editing.

- [ ] **Step 1: Build an augmented module list including synthesized custom specs**

Inside the palette IIFE (after `customizerByNormId` is built, before `PALETTE_GROUPS.map`), add:

```ts
            // One-shot / custom compartments (activated in Modular) aren't in the
            // static SOFA_MODULES list. Synthesize their spec from the base family
            // (findModule → base geometry) so they render in their natural group.
            // Additive only — base art + geometry reused, no snap-math change (D10).
            const stdIds = new Set(SOFA_MODULES.map((m) => m.id));
            const customSpecs = (modelCustomizer?.compartments ?? [])
              .map((cc) => cc.normalizedCode)
              .filter((nc) => !stdIds.has(nc))
              .map((nc) => findModule(nc))
              .filter((m): m is SofaModuleSpec => !!m);
            const allModules = [...SOFA_MODULES, ...customSpecs];
```

Then change the per-group filter from `SOFA_MODULES.filter((m) => m.group === g)` to `allModules.filter((m) => m.group === g)`. The existing `customizerByNormId.has(m.id)` membership test already admits them (their `m.id` is the normalized code, which IS a `customizerByNormId` key).

- [ ] **Step 2: Add the structural art fallback in resolveModuleArtSrc**

Change the final fallback line of `resolveModuleArtSrc`:

```ts
    return `${ASSET_BASE}/${representativeArtCode(moduleId)}.png`;
```

(Was `${ASSET_BASE}/${moduleId}.png`.) Import `representativeArtCode`, `findModule`, and the `SofaModuleSpec` type from `@2990s/shared` (alongside the existing `SOFA_MODULES`, `normalizeCompartmentCode` imports).

- [ ] **Step 3: Manual verification (no unit test — canvas/DOM)**

Build + run POS dev (`pnpm --filter @2990s/pos dev`). With a Model that has an activated one-shot compartment in `allowed_options.compartments`: the palette shows the extra option (base art, label = the code, price = the SKU's `sell_price_sen`); tapping it drops a cell that draws with base geometry/art; the live total reflects the SKU price. Open the network tab — no 404 on the art request.

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter @2990s/pos typecheck` → PASS.
```bash
git -C .claude/worktrees/remark-auto-sku add apps/pos/src/pages/CustomBuilder.tsx
git -C .claude/worktrees/remark-auto-sku commit -m "feat(pos): palette renders activated one-shot compartments (UI_REFERENCE deviation)"
```

---

## Task 10: Backend — one-shot group + Activate toggle in ProductModelDetail

**Files:**
- Modify: `apps/backend/src/pages/ProductModelDetail.tsx` (SKU variants section ~516-579 / SofaAllowedOptions ~990-1094)
- Modify: `apps/backend/src/lib/product-models-queries.ts` (activation mutation hook)

⚠️ **Overlaps the parallel branch `feat/backend-special-addons-parity`.** Before this task: `git -C .claude/worktrees/remark-auto-sku fetch origin && git -C .claude/worktrees/remark-auto-sku rebase origin/main` (after that branch lands) so the edits apply cleanly.

- [ ] **Step 1: Add an activation mutation hook**

In `product-models-queries.ts`, add `useActivateOneShot()` that POSTs `/mfg-products/:id/activate-one-shot` and invalidates the model + mfg-products queries (mirror the existing `useUpdateProductModel` / `statusMut` pattern).

- [ ] **Step 2: Render the model's one-shot SKUs with an Activate button**

In the SKU variants list (`data.skus`), the rows now carry `one_shot` + `pos_active`. For rows where `one_shot === true`, show a "One-shot" badge + an **Activate** button (when `pos_active === false`) that calls `useActivateOneShot().mutate({ id })`, and an "Active" pill when `pos_active === true`. Copy: sentence case, calm (brand voice). Reuse existing `Button`/pill styles — no new components.

- [ ] **Step 3: Typecheck + manual check + commit**

Run: `pnpm --filter @2990s/backend typecheck` → PASS. Manually: a one-shot SKU shows the badge; Activate flips it (re-query shows Active; the compartment appears in POS).
```bash
git -C .claude/worktrees/remark-auto-sku add apps/backend/src/pages/ProductModelDetail.tsx apps/backend/src/lib/product-models-queries.ts
git -C .claude/worktrees/remark-auto-sku commit -m "feat(backend): one-shot badge + Activate toggle in Model detail"
```

---

## Task 11: SKU Master grid — badge + filter

**Files:**
- Modify: the SKU Master tab component (find it: `grep -rn "SKU Master" apps/backend/src/pages`) — likely `Products.tsx` or a child grid.

- [ ] **Step 1: Add a "one-shot" badge on rows where `one_shot === true`**, showing `source_doc_no` as a link/tooltip to the SO. Add a filter chip "One-shot" that narrows the grid to `one_shot === true`. Reuse existing chip/badge styles.

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @2990s/backend typecheck` → PASS.
```bash
git -C .claude/worktrees/remark-auto-sku add apps/backend/src/pages
git -C .claude/worktrees/remark-auto-sku commit -m "feat(backend): one-shot badge + filter in SKU Master"
```

---

## Task 12: Record the UI_REFERENCE deviation

**Files:**
- Modify: `UI_REFERENCE.md` ("Approved deviations" section)

- [ ] **Step 1: Append a deviation entry** (date 2026-06-08, Loo sign-off): "POS sofa configurator palette may render a Model's **activated one-shot** custom compartments as additional selectable options, reusing the base compartment's existing PNG + geometry (via `representativeArtCode` / `findModule`). No change to snap math, the 22 plan-view PNGs, drag handling, or visuals." Do not delete existing entries (audit trail).

- [ ] **Step 2: Commit**

```bash
git -C .claude/worktrees/remark-auto-sku add UI_REFERENCE.md
git -C .claude/worktrees/remark-auto-sku commit -m "docs(ui-reference): approve one-shot compartment palette extension"
```

---

## Task 13: Full gate + deploy

- [ ] **Step 1: Whole-repo gates**

Run: `pnpm -w typecheck` and `pnpm -w test` (or per-package). Expected: PASS (known-environmental: `slips.test.ts` 3 local-SSL failures — don't chase).

- [ ] **Step 2: Deploy order** (per spec §9)
1. Migration 0161 already applied (Task 1 Step 5) — flag still OFF.
2. Merge `feat/remark-extra-auto-sku` → `main` (PR). API deploys via `wrangler`; the two SPAs via CF Pages on `main`.
3. Verify on live with the flag OFF (no behaviour change). Then flip `pos_remark_extra_auto_sku` ON (`PATCH /so-settings/:key` or SQL) and smoke-test: a sofa build with an extra → one-shot SKUs minted, visible in SKU Master, inactive; activate one → it appears in the POS configurator. Remind Loo: PWA hard-refresh on POS tablets.

- [ ] **Step 3: Update the project memory** `project_2990s_remark_auto_sku.md` to ✅ shipped (PR #, deploy date), and add any gotchas found.

---

## Self-review notes (author)

- **Spec coverage:** D1 (Task 5 step 1), D2 (flag gate, Task 1+5), D3 (per-module Task 5 step 3 / single Task 5 step 4), D4 (Task 4 + step 3), D5 (Task 5 step 5 `cost_price_sen:null`, cost weights unchanged), D6 (Task 2), D7 (Task 5 step 5 `pos_active:false,one_shot:true,source_doc_no`), D8 (Tasks 7-9), D9 (Task 5 step 3 sellPriceSen), D10 (Tasks 9+12). ✅
- **Open verification:** Task 5 step 9 (recomputeTotals must not clobber even split) — confirm during execution; Task 5 step 4 needs the exact non-sofa row-build anchor (read the handler); Task 11 needs the SKU Master grid component located.
- **Type consistency:** `oneShotSofaCode`/`oneShotSimpleCode`/`remarkSlug`/`buildOneShotName` (Task 2) used verbatim in Task 5; `representativeArtCode` (Task 3) used in Tasks 8+9; `evenSplitPrice` (Task 4) used in Task 5 step 3.
