# Product-page remark + extra charge & payment full-set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-product remark + optional extra charge keyed on POS product pages flows onto SO lines (visible in SO detail / Detail Listing / SO PDF / POS drawer), gated by an SO Maintenance toggle; the POS Record-payment drawer becomes the full method/approval/slip set with a server overpayment guard, and EVERY payment row (POS, Backend, handover split) carries its own slip + approval code.

**Architecture:** Two phases, two PRs sharing nothing but vocabulary. Phase A threads `remark` + `extraAddonAmountRM` through cart snapshot → variants JSON → server recompute (drift gate taught the declared extra, never weakened) → `mfg_sales_order_items.remark` + folded display surfaces. Phase B adds `slip_key` to the payments ledger, hardens `POST /:docNo/payments` (method cascade + required slip + overpay 400) and upgrades the three payment-entry UIs.

**Tech Stack:** Existing locked stack — Vite/React 19, Hono on CF Workers, Drizzle/Supabase, TanStack Query 5, Zod. No new dependencies.

**Spec:** `docs/specs/2026-06-06-product-remark-extra-charge-payment-fullset-spec.md` (Loo-approved D1–D7). Deviation from spec §2: ONE migration per phase (0158 = `so_settings`, 0159 = `slip_key`) so each PR is self-contained.

**Branches:** Phase A `feat/pos-product-remark-extra`, Phase B `feat/payment-fullset-per-slip`. `git pull --ff-only` on main before EACH branch. ⚠️ Parallel sessions share this checkout — execute inside a git worktree (superpowers:using-git-worktrees), copy root `.env` into it.

**Deploy reality (Loo's rule):** every phase ends pushed + PR'd + deployed (migration via Supabase MCP `apply_migration`, NOT the broken GH workflow) + verified live + "PWA hard-refresh" reminder.

**Conventions that bite:**
- `pnpm typecheck` — NEVER pipe through `| tail` (swallows the exit code; bit us in #489).
- Money: POS cart `total` is whole MYR; SO ledger is centi/sen. The extra amount is **whole MYR** in cart/variants, ×100 at the server.
- `apps/api` slips.test.ts has 3 known-environmental local SSL failures — don't chase.
- Supabase destructures must bind + check `error` (CF-cap lesson, PR #502).

---

# PHASE A — Product-page remark + extra charge

### Task A1: Migration 0158 — `so_settings` table

**Files:**
- Create: `packages/db/migrations/0158_so_settings.sql`
- Modify: `packages/db/src/schema.ts` (append near `soDropdownOptions`, ~line 2331)

- [ ] **Step 1: Verify 0158 is still free** (parallel sessions land migrations)

Run: `ls packages/db/migrations | grep "^015"`
Expected: `0157_addons_show_at_handover.sql` is the highest. If a 0158 appeared, renumber to the next free slot everywhere in this plan.

- [ ] **Step 2: Write the migration**

```sql
-- 0158_so_settings.sql
-- Loo 2026-06-06 — SO Maintenance feature toggles (Pattern B-lite: one row
-- per switch; UIs read /so-settings). First switch: the POS product-page
-- "Remark & extra charge" card (spec D5, default ON).
CREATE TABLE IF NOT EXISTS so_settings (
  key        text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT true,
  label      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE so_settings ENABLE ROW LEVEL SECURITY;
-- Staff read; writes go through the API (service role). Mirrors the
-- restrictive-by-default posture; the API route gates PATCH by role.
DO $$ BEGIN
  CREATE POLICY so_settings_read ON so_settings
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO so_settings (key, enabled, label)
VALUES ('pos_product_remark', true, 'Product page remark & extra charge (POS)')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 3: Add Drizzle table** in `packages/db/src/schema.ts` (right after the `soDropdownOptions` table definition):

```ts
/* Migration 0158 (Loo 2026-06-06) — SO Maintenance feature toggles. One row
   per switch; seeded: 'pos_product_remark' (POS product-page remark + extra
   charge card, default ON). Read by POS/Backend UIs AND the SO create path
   (the extra-amount gate). */
export const soSettings = pgTable('so_settings', {
  key:       text('key').primaryKey(),
  enabled:   boolean('enabled').notNull().default(true),
  label:     text('label').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (exit 0)

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0158_so_settings.sql packages/db/src/schema.ts
git commit -m "feat(db): so_settings feature-toggle table + pos_product_remark seed (0158)"
```

(Do NOT apply to prod yet — applied at deploy time, Task A12.)

---

### Task A2: API — `/so-settings` route

**Files:**
- Create: `apps/api/src/routes/so-settings.ts`
- Modify: `apps/api/src/index.ts` (~line 38 import block, ~line 117 mount block)

- [ ] **Step 1: Create the route file** (auth/shape mirrors `so-dropdown-options.ts`):

```ts
// ----------------------------------------------------------------------------
// so-settings — SO Maintenance feature toggles (migration 0158, spec D5).
//   GET   /        — all rows: { settings: [{ key, enabled, label }] }
//   PATCH /:key    — { enabled: boolean } — coordinator-or-above only.
// The SO create path reads the same rows server-side (extra-amount gate).
// ----------------------------------------------------------------------------
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const soSettings = new Hono<{ Bindings: Env; Variables: Variables }>();

soSettings.use('*', supabaseAuth);

const ELEVATED = new Set([
  'coordinator', 'finance', 'admin', 'outlet_manager',
  'sales_director', 'super_admin', 'master_account',
]);

soSettings.get('/', async (c) => {
  const sb = c.get('supabase');
  const { data, error } = await sb
    .from('so_settings')
    .select('key, enabled, label')
    .order('key');
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ settings: data ?? [] });
});

const patchSchema = z.object({ enabled: z.boolean() });

soSettings.patch('/:key', async (c) => {
  const sb = c.get('supabase');
  const user = c.get('user');
  const key = c.req.param('key');

  const { data: staffRow, error: staffErr } = await sb
    .from('staff').select('role').eq('id', user.id).maybeSingle();
  if (staffErr) return c.json({ error: 'load_failed', reason: staffErr.message }, 500);
  if (!staffRow || !ELEVATED.has((staffRow as { role: string }).role)) {
    return c.json({ error: 'forbidden' }, 403);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

  const { data, error } = await sb
    .from('so_settings')
    .update({ enabled: parsed.data.enabled, updated_at: new Date().toISOString() })
    .eq('key', key)
    .select('key, enabled, label')
    .maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ setting: data });
});
```

- [ ] **Step 2: Mount it** in `apps/api/src/index.ts` — add alongside the existing pairs:

```ts
import { soSettings } from './routes/so-settings';      // with the other imports (~line 38)
app.route('/so-settings', soSettings);                  // with the other mounts (~line 117)
```

- [ ] **Step 3: Typecheck**, Run: `pnpm typecheck` — Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/so-settings.ts apps/api/src/index.ts
git commit -m "feat(api): /so-settings feature-toggle route (GET + role-gated PATCH)"
```

---

### Task A3: Shared — `so-line-display` carries the line remark

**Files:**
- Modify: `packages/shared/src/so-line-display.ts:31-62` (both interfaces) and `:151-164` (fold output)
- Test: locate with `ls packages/shared/src | grep -i "so-line-display"` — if `so-line-display.test.ts` exists extend it, else create it next to the source.

- [ ] **Step 1: Write the failing test** (append to / create `packages/shared/src/so-line-display.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { groupSoLinesForDisplay } from './so-line-display';

describe('groupSoLinesForDisplay — remark carry', () => {
  it('keeps the lead line remark on a folded sofa build', () => {
    const lines = [
      { item_code: 'BOOQIT-1A(LHF)', qty: 1, unit_price_centi: 100000, total_centi: 100000,
        remark: 'Customer wants firmer seat', variants: { buildKey: 'build-1', cellIndex: 0 } },
      { item_code: 'BOOQIT-2A(RHF)', qty: 1, unit_price_centi: 200000, total_centi: 200000,
        remark: null, variants: { buildKey: 'build-1', cellIndex: 1 } },
    ];
    const groups = groupSoLinesForDisplay(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe('sofa-build');
    expect(groups[0]!.display!.remark).toBe('Customer wants firmer seat');
  });

  it('falls back to the first non-empty remark in the group', () => {
    const lines = [
      { item_code: 'BOOQIT-1A(LHF)', qty: 1, unit_price_centi: 100000, total_centi: 100000,
        remark: null, variants: { buildKey: 'build-1', cellIndex: 0 } },
      { item_code: 'BOOQIT-2A(RHF)', qty: 1, unit_price_centi: 200000, total_centi: 200000,
        remark: 'left arm fabric swap', variants: { buildKey: 'build-1', cellIndex: 1 } },
    ];
    const groups = groupSoLinesForDisplay(lines);
    expect(groups[0]!.display!.remark).toBe('left arm fabric swap');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @2990s/shared test -- so-line-display`
Expected: FAIL — `display.remark` is `undefined` / TS error `remark` not on type.

- [ ] **Step 3: Implement.** In `RawSoDisplayLine` (after `variants?: unknown;`):

```ts
  /** Per-line operator remark (mfg_sales_order_items.remark). Optional —
   *  legacy callers that don't select it simply fold without remarks. */
  remark?: string | null;
```

In `SoDisplayGroup['display']` (after `totalCenti: number;`):

```ts
    /** Lead line's remark, else the first non-empty remark in the group. */
    remark: string | null;
```

In the fold output (the `out.push({ kind: 'sofa-build', ... display: { ... } })` block), after `totalCenti: ...`:

```ts
        remark: ordered.find((l) => typeof l.remark === 'string' && l.remark.trim() !== '')?.remark ?? null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @2990s/shared test -- so-line-display`
Expected: PASS. Also run the full shared suite: `pnpm --filter @2990s/shared test` — Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/so-line-display.ts packages/shared/src/so-line-display.test.ts
git commit -m "feat(shared): so-line-display fold carries the per-line remark"
```

---

### Task A4: API — recompute accepts the declared extra amount

The drift gate (`apps/api/src/lib/mfg-pricing-recompute.ts:180-429`) must learn `variants.extraAddonAmountRM` so a POS line whose price folds the extra in does NOT 400. The gate is NOT weakened: the extra is a declared input; tampering the base still drifts.

**Files:**
- Modify: `apps/api/src/lib/mfg-pricing-recompute.ts` (`MfgItemVariants` ~line 50-74; drift branches ~line 362-411)
- Test: locate with `Glob apps/api/**/*recompute*test*` / `Glob apps/api/src/**/*.test.ts`. If a recompute test file exists, extend it; else create `apps/api/src/lib/mfg-pricing-recompute.test.ts` (apps/api already runs vitest — slips.test.ts exists).

- [ ] **Step 1: Write the failing tests** (adapt imports to the existing test file's style if extending):

```ts
import { describe, expect, it } from 'vitest';
import { recomputeFromSnapshot, type ProductRowLite } from './mfg-pricing-recompute';

const product: ProductRowLite = {
  code: 'AKKA-FIRM-K', category: 'MATTRESS',
  base_price_sen: null, price1_sen: null, cost_price_sen: 100000,
  seat_height_prices: null, base_model: null, sell_price_sen: 299000,
};

describe('recomputeFromSnapshot — declared extraAddonAmountRM (spec D1)', () => {
  it('accepts a client price that folds in the declared extra (no drift)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'AKKA-FIRM-K', itemGroup: 'mattress', qty: 1,
        unitPriceCenti: 299000 + 20000,                       // RM2,990 + RM200 extra
        variants: { extraAddonAmountRM: 200 } },
      product, null, null,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(319000);                    // persisted price includes the extra
  });

  it('still drifts when the client inflates beyond the declared extra', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'AKKA-FIRM-K', itemGroup: 'mattress', qty: 1,
        unitPriceCenti: 299000 + 50000,                       // says RM200, charges RM500
        variants: { extraAddonAmountRM: 200 } },
      product, null, null,
    );
    expect(r.drift).toBe(true);
  });

  it('a negative declared extra is clamped to 0 (cannot discount via this field)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'AKKA-FIRM-K', itemGroup: 'mattress', qty: 1,
        unitPriceCenti: 299000,
        variants: { extraAddonAmountRM: -200 } },
      product, null, null,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(299000);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @2990s/api test -- mfg-pricing-recompute`
Expected: FAIL (TS: `extraAddonAmountRM` not on MfgItemVariants / drift true on test 1).

- [ ] **Step 3: Implement.** (a) Add to `MfgItemVariants` (after `pwp?:`):

```ts
  /** Per-line operator remark keyed on the POS product page (spec 2026-06-06).
   *  Not priced — persisted to mfg_sales_order_items.remark by the route. */
  remark?:        string | null;
  /** Declared extra charge keyed on the POS product page, WHOLE MYR (spec D1).
   *  The POS folds it into the line's selling price; the recompute adds the
   *  same amount to the authoritative figure so the drift gate stays exact.
   *  Clamped ≥ 0 — this field can never discount. */
  extraAddonAmountRM?: number | null;
```

(b) In `recomputeFromSnapshot`, right before the `let drift: boolean;` block (~line 362), derive the declared extra:

```ts
  /* Declared extra charge (spec 2026-06-06 D1) — whole MYR → sen, clamped ≥ 0.
     Added to BOTH authoritative branches below, symmetric with the POS folding
     the same amount into its submitted total. Never applied to the PWP base
     (it stacks AFTER pwp/combo/fabric folds) and never to the cost path. */
  const extraSen = Math.max(0, Math.round(Number(variants.extraAddonAmountRM ?? 0))) * 100;
```

(c) In the sofa branch change `const authoritativeSofaSen = sofaSellingSen + fabricAddonCenti;` to:

```ts
      const authoritativeSofaSen = sofaSellingSen + fabricAddonCenti + extraSen;
```

(d) In the catalog branch change `const authoritativeWithFabric = authoritativeSellingSen + fabricAddonCenti;` to:

```ts
    const authoritativeWithFabric = authoritativeSellingSen + fabricAddonCenti + extraSen;
```

(The `else` branch — no authoritative figure — trusts the operator price unchanged; the extra is already inside it.)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @2990s/api test -- mfg-pricing-recompute`
Expected: PASS. Then `pnpm --filter @2990s/api test` — expected: PASS except the 3 known slips.test.ts SSL failures.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/mfg-pricing-recompute.ts apps/api/src/lib/mfg-pricing-recompute.test.ts
git commit -m "feat(api): drift gate accepts the declared per-line extra charge (spec D1)"
```

---

### Task A5: API — SO create persists remark + gates the extra on the toggle

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts`
  - extra-amount gate: insert just before the recompute prefetch block (~line 1600, before `const fabricRowByCode = ...`)
  - `baseRow` (~line 1738-1784): add `remark`
  - sofa split block (~line 1820-1850): lead-line remark
  - `/mine` route (~line 611-660): add `remark` to the items select

- [ ] **Step 1: Add the toggle gate.** Before the recompute prefetch (`const fabricRowByCode = await loadFabricsByCodes(...)`), insert:

```ts
  /* Spec 2026-06-06 (D5) — the POS product-page extra charge is feature-
     gated in SO Maintenance (so_settings.pos_product_remark). When OFF, a
     line that still declares an extra is rejected EXPLICITLY (never silently
     dropped or silently charged — CF-cap lesson: surface, don't swallow).
     Remarks themselves are always accepted (free text, no money). */
  const hasDeclaredExtra = items.some((it) =>
    Number((it.variants as { extraAddonAmountRM?: unknown } | null)?.extraAddonAmountRM ?? 0) > 0);
  if (hasDeclaredExtra) {
    const { data: flagRow, error: flagErr } = await sb
      .from('so_settings').select('enabled').eq('key', 'pos_product_remark').maybeSingle();
    if (flagErr) {
      await rollbackPwpClaims();
      return c.json({ error: 'lookup_failed', reason: flagErr.message }, 500);
    }
    if (flagRow && (flagRow as { enabled: boolean }).enabled === false) {
      await rollbackPwpClaims();
      return c.json({
        error: 'extra_amount_disabled',
        reason: 'Product-page extra charge is turned off in SO Maintenance.',
      }, 400);
    }
  }
```

- [ ] **Step 2: Persist the remark on the goods line.** In the `baseRow` object (after `description2: ...` line):

```ts
      /* Spec 2026-06-06 — per-line operator remark from the POS product page.
         Same column SoLineCard edits (mfg_sales_order_items.remark). */
      remark: (() => {
        const r = (it.variants as { remark?: unknown } | null)?.remark;
        return typeof r === 'string' && r.trim() !== '' ? r.trim() : null;
      })(),
```

- [ ] **Step 3: Sofa split — remark on the LEAD module line only** (same rule as breakdown columns). In the `split.map((s, i) => { ... return { ...baseRow, ... } })` return object, after `custom_specials: ...` add:

```ts
            remark: i === 0 ? baseRow.remark : null,
```

- [ ] **Step 4: `/mine` items select += remark.** Find the `/mine` route's items select (the embedded `mfg_sales_order_items` select list near line 618-640 — grep `items:mfg_sales_order_items` or read `mfgSalesOrders.get('/mine'` body). Add `remark` to the selected item columns (alongside `item_code, description, qty, total_centi, variants`).

- [ ] **Step 5: Typecheck** — `pnpm typecheck` → PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/mfg-sales-orders.ts
git commit -m "feat(api): SO create persists product-page remark + gates extra charge on so_settings"
```

---

### Task A6: POS — cart snapshot + handover payload carry remark/extra

**Files:**
- Modify: `apps/pos/src/state/cart.ts` (3 interfaces)
- Modify: `apps/pos/src/lib/pos-handover-so.ts` (`buildVariants`, 3 branches)
- Test: `apps/pos` — extend the existing pos-handover test if present (`Glob apps/pos/src/**/pos-handover*test*`); else add assertions to `apps/pos/src/lib/handover-helpers.test.ts`'s sibling — create `apps/pos/src/lib/pos-handover-so.test.ts` if none exists.

- [ ] **Step 1: cart.ts — add to ALL THREE config interfaces** (`SofaConfigSnapshot` after `pwpCode?`, `SizeConfigSnapshot` after `pwpOriginalTotal?`, `BedframeConfigSnapshot` after `pwpOriginalTotal?`):

```ts
  /** Per-line remark keyed on the product page (spec 2026-06-06). Rides the
   *  SO variants → mfg_sales_order_items.remark. */
  remark?: string;
  /** Extra charge keyed on the product page, whole MYR (spec D1). Already
   *  folded into `total`; also declared in variants so the server drift gate
   *  adds the same amount to its authoritative figure. */
  extraAddonAmountRM?: number;
```

- [ ] **Step 2: pos-handover-so.ts `buildVariants` — declare both in every branch.** In the `sofa` branch (before `if (config.summary)`), the `bedframe` branch (before `if (config.summary)`) and the `size` branch (before `if (config.summary)`), add the SAME two lines:

```ts
    if (config.remark?.trim())          v.remark = config.remark.trim();
    if ((config.extraAddonAmountRM ?? 0) > 0) v.extraAddonAmountRM = config.extraAddonAmountRM;
```

(`flat` branch unchanged — flat lines have no product page card.)

- [ ] **Step 3: Write the test** (`apps/pos/src/lib/pos-handover-so.test.ts`, or extend the existing file):

```ts
import { describe, expect, it } from 'vitest';
import { cartLineToSoItem } from './pos-handover-so';
import type { CartLine } from '../state/cart';

describe('pos-handover-so — remark + extraAddonAmountRM threading', () => {
  it('threads remark + declared extra into variants and folds extra into the price', () => {
    const line: CartLine = {
      key: 'cfg-test1', qty: 1,
      config: {
        kind: 'size', productId: 'mfg-1', productName: '2990 AKKA-FIRM', sizeId: 'king',
        total: 3190,                       // 2990 base + 200 extra, folded at Add-to-Cart
        summary: 'King',
        remark: 'deliver before CNY',
        extraAddonAmountRM: 200,
      },
    };
    const item = cartLineToSoItem(line, new Map());
    expect(item.unitPriceCenti).toBe(319000);
    expect(item.variants).toMatchObject({ remark: 'deliver before CNY', extraAddonAmountRM: 200 });
  });
});
```

- [ ] **Step 4: Run** `pnpm --filter @2990s/pos test -- pos-handover-so` → PASS (after Steps 1-2; it fails type-wise before them — order Steps 3→1→2 if strict TDD is preferred).

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/state/cart.ts apps/pos/src/lib/pos-handover-so.ts apps/pos/src/lib/pos-handover-so.test.ts
git commit -m "feat(pos): cart snapshot + SO variants carry per-line remark and declared extra"
```

---

### Task A7: POS — `useSoSettings` hook + Configurator card (all 3 product kinds)

**Files:**
- Create: `apps/pos/src/lib/so-maintenance/so-settings-queries.ts`
- Modify: `apps/pos/src/pages/Configurator.tsx` (state ~line 410; hydration effect 594-724; totals 1075-1077 + 1292-1294; the four Add handlers 1149-1380; rails 1770/1886; SofaQuickPick props 2220+2354+2559)
- Modify: `apps/pos/src/pages/CustomBuilder.tsx` (props ~254-288; snapshot ~882-901; rail ~1094)

- [ ] **Step 1: Hook file** (mirrors `so-dropdown-options-queries.ts` style — same `authedFetch`):

```ts
// ----------------------------------------------------------------------------
// POS SO Settings hooks — /so-settings feature toggles (migration 0158).
// useSoSettingEnabled('pos_product_remark') gates the product-page
// "Remark & extra charge" card. Fallback while in flight = enabled (the
// seed default) so the card never flashes off for a working store.
// ----------------------------------------------------------------------------
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';

const API_URL = import.meta.env.VITE_API_URL;

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text(); }
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return (await res.json()) as T;
}

export type SoSetting = { key: string; enabled: boolean; label: string };

const STALE = 30 * 60 * 1000;

export function useSoSettings() {
  return useQuery({
    queryKey: ['so-settings'],
    staleTime: STALE,
    queryFn: () => authedFetch<{ settings: SoSetting[] }>('/so-settings').then((r) => r.settings),
  });
}

/** One toggle, defaulting to `fallback` while loading / on error. */
export function useSoSettingEnabled(key: string, fallback = true): boolean {
  const q = useSoSettings();
  const row = (q.data ?? []).find((s) => s.key === key);
  return row ? row.enabled : fallback;
}

export function useUpdateSoSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      authedFetch<{ setting: SoSetting }>(`/so-settings/${key}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['so-settings'] }); },
  });
}
```

- [ ] **Step 2: Configurator state + card.** In `Configurator.tsx`:

(a) Import the hook at the top: `import { useSoSettingEnabled } from '../lib/so-maintenance/so-settings-queries';`

(b) Near the other top-level state (after the `editKey`/`isEditing` block ~line 410):

```ts
  // Per-line remark + extra charge (spec 2026-06-06, Loo) — keyed on the
  // product page, stored in the cart snapshot, lands on the SO line. The
  // card is feature-gated in SO Maintenance (pos_product_remark).
  const remarkCardEnabled = useSoSettingEnabled('pos_product_remark');
  const [lineRemark, setLineRemark] = useState('');
  const [lineExtraRm, setLineExtraRm] = useState(0);
  useEffect(() => { setLineRemark(''); setLineExtraRm(0); }, [editKey, productId]);
```

(c) Define the shared card element next to where `pwpRailSection` is defined (grep `const pwpRailSection` and place after it):

```tsx
  const effectiveExtraRm = remarkCardEnabled ? Math.max(0, Math.round(lineExtraRm || 0)) : 0;
  const remarkExtraRailSection = remarkCardEnabled ? (
    <RailSection title="Remark & extra charge" sub="Optional — prints on the sales order">
      <textarea
        rows={2}
        className={styles.sizeOtherInput}
        placeholder="Remark for this item…"
        value={lineRemark}
        maxLength={300}
        onChange={(e) => setLineRemark(e.target.value)}
      />
      <label className={styles.sizeOtherField}>
        <span className={styles.sizeOtherLabel}>Extra add-on amount (RM)</span>
        <input
          type="number"
          min={0}
          step={1}
          className={styles.sizeOtherInput}
          placeholder="0"
          value={lineExtraRm || ''}
          onChange={(e) => setLineExtraRm(Math.max(0, Math.round(Number(e.target.value) || 0)))}
        />
      </label>
    </RailSection>
  ) : null;
```

(If `styles.sizeOtherInput` / `styles.sizeOtherField` / `styles.sizeOtherLabel` don't suit the textarea, reuse the closest existing classes — do NOT invent new CSS files; this page's module already styles inputs.)

(d) Placements:
- Mattress rail: directly after `{pickedSize && pwpRailSection}` (line ~1770) add `{pickedSize && remarkExtraRailSection}`
- Bedframe rail: directly after `{isBedframe && pwpRailSection}` (line ~1886) add `{remarkExtraRailSection}`
- Sofa: pass to both components (see Step 4).

- [ ] **Step 3: Fold the extra into every total + snapshot.**

(a) `sizeTotal` (~line 1077): append `+ effectiveExtraRm` to the expression.
(b) `bedframeTotal` (~line 1075): append `+ effectiveExtraRm`.
(c) `sofaTotal` (~line 1292-1294): append `+ effectiveExtraRm`.
(d) In **all four** snapshot builders (`handleAddBedframe`, `handleAddSize`, `handleAddSofa`, `handleAddQuickPick`), add to the snapshot object:

```ts
      ...(remarkCardEnabled && lineRemark.trim() ? { remark: lineRemark.trim() } : {}),
      ...(effectiveExtraRm > 0 ? { extraAddonAmountRM: effectiveExtraRm } : {}),
```

and append `+ effectiveExtraRm` to each handler's `total:` expression (`handleAddSofa` line ~1332, `handleAddQuickPick` line ~1375; `handleAddBedframe`/`handleAddSize` use `bedframeTotal`/`sizeTotal` indirectly — verify each `total:` reflects the extra exactly once).
(e) PWP original totals: in `handleAddBedframe`'s `pwpOriginalTotal` (~line 1176) and `handleAddSize`'s (~line 1219), append `+ effectiveExtraRm` (so reverting a voucher keeps the extra).

- [ ] **Step 4: Sofa surfaces.**

(a) `SofaQuickPickProps` (~line 2220): add `remarkBlock?: React.ReactNode;`. In the JSX where `{legBlock}` renders (~line 2559) add `{remarkBlock}` right after it. At the call site (~line 1716) pass `remarkBlock={remarkExtraRailSection}`.
(b) `CustomBuilder.tsx` props (~line 259): add to `CustomBuilderProps`:

```ts
  /** Product-page remark + extra charge (spec 2026-06-06) — parent-owned, like
   *  legBlock/legHeight. remarkBlock renders in the left rail; remark/extra
   *  land on the FIRST seamless group's snapshot only (a canvas usually holds
   *  one sofa; the extra must never multiply across groups). */
  remarkBlock?: ReactNode;
  remark?: string;
  extraAmountRm?: number;
```

Destructure them in the component signature (~line 288) with defaults `remarkBlock, remark = '', extraAmountRm = 0`.
(c) In CustomBuilder's snapshot loop (~line 882-901): the loop builds one snapshot per group with a `usedEditKey` flag — the first iteration is the lead group. Change:

```ts
        total: g.finalPrice + sofaFabricDelta + legSurchargeRm,
```

to:

```ts
        ...(!usedEditKey && remark.trim() ? { remark: remark.trim() } : {}),
        ...(!usedEditKey && extraAmountRm > 0 ? { extraAddonAmountRM: extraAmountRm } : {}),
        total: g.finalPrice + sofaFabricDelta + legSurchargeRm + (!usedEditKey ? extraAmountRm : 0),
```

(`usedEditKey` is `false` on the first group — reuse it as the lead-group marker; it flips to `true` right after the first `addConfigured`.)
(d) Render `{remarkBlock}` after `{legBlock}` (~line 1094).
(e) At the Configurator call site (~line 1719-1737) pass `remarkBlock={remarkExtraRailSection}`, `remark={remarkCardEnabled ? lineRemark : ''}`, `extraAmountRm={effectiveExtraRm}`.
(f) ⚠️ CustomBuilder's own group total / live price display: grep `finalPrice` display sites inside CustomBuilder and verify the on-canvas LIVE TOTAL also reflects the extra, or accept that the topbar total shows it at Add time — match whatever `legSurchargeRm` does (it's the precedent: follow exactly where `legSurchargeRm` is added and add `extraAmountRm` the same way, lead group only).

- [ ] **Step 5: Edit hydration.** In the hydrate effect (~594-724), in EACH of the three branches (size / bedframe / sofa) before `hydratedRef.current = true;` add:

```ts
      setLineRemark(cfg.remark ?? '');
      setLineExtraRm(cfg.extraAddonAmountRM ?? 0);
```

⚠️ Then in the totals (Step 3) the hydrated `total` must not double-count: the snapshot's stored `total` already includes the old extra, but the configurator REBUILDS totals from parts (sizeBase + surcharges + effectiveExtraRm) — since `lineExtraRm` is hydrated, the rebuilt total is correct. No further change.

- [ ] **Step 6: Typecheck + manual smoke**

Run: `pnpm typecheck` → PASS.
Run: `pnpm --filter @2990s/pos dev` → open a mattress page: card appears under PWP; type remark + RM200 → LIVE TOTAL rises by 200 → Add to Cart → cart line total includes it → Edit reopens with both prefilled. Repeat on a bedframe page and a sofa (Quick Pick AND Customize).

- [ ] **Step 7: Commit**

```bash
git add apps/pos/src/lib/so-maintenance/so-settings-queries.ts apps/pos/src/pages/Configurator.tsx apps/pos/src/pages/CustomBuilder.tsx
git commit -m "feat(pos): product-page Remark & extra charge card (all 3 kinds, maintenance-gated)"
```

---

### Task A8: POS — remove the handover "Special instructions" box (D2)

**Files:**
- Modify: `apps/pos/src/components/handover/TargetDateStep.tsx:106-113` (delete the Field)
- Modify: `apps/pos/src/lib/handover-helpers.ts:77` (drop `specialInstructions`)
- Modify: `apps/pos/src/pages/Handover.tsx:342` (drop the `note:` payload line) and the form-init default (`specialInstructions: ''` — grep it in Handover.tsx's initial form)
- Test: `apps/pos/src/lib/handover-helpers.test.ts` (drop any references)

- [ ] **Step 1:** Delete the `<Field label="Special instructions (optional)">…</Field>` block from TargetDateStep.
- [ ] **Step 2:** Remove `specialInstructions: string;` from `HandoverForm`; remove `specialInstructions: ''` from the Handover.tsx initial form object; remove line 342 (`...(form.specialInstructions.trim() ? { note: ... } : {})`).
- [ ] **Step 3:** Grep the残留: `pnpm exec rg -n "specialInstructions" apps/pos` → fix every hit (tests, sessionStorage snapshot is `Partial<HandoverForm>` so old snapshots with the key simply ignore it — no migration needed).
- [ ] **Step 4:** Run `pnpm --filter @2990s/pos test` → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(pos): retire handover special-instructions box (remarks live per-product now, spec D2)"`

---

### Task A9: Backend — remark visible in SO detail + SO PDF + POS drawer

**Files:**
- Modify: `apps/backend/src/pages/SalesOrderDetail.tsx:1098-1101` (Item cell)
- Modify: `apps/backend/src/lib/sales-order-pdf.ts:58-70` (SoItem), `:103-106` (hidden keys), `:273-305` (rows)
- Modify: `apps/pos/src/pages/OrderStatus.tsx:50-59` (OrderItem) + `:114-121` (MineSoRow) + `:145-159` (mapping) + the drawer items render (grep `detailItem` / where `order.items` maps in the drawer JSX)

- [ ] **Step 1: SO detail read-only table.** Verify the `items` row type already carries `remark` (it's selected by the detail fetch — grep `remark` in `apps/backend/src/pages/sales-order/types.ts`, it exists per SoItem types line 96-122). In the Item `<td>` (line 1098-1101) after the description div add:

```tsx
                    {it.remark && (
                      <div className={styles.muted} style={{ fontStyle: 'italic' }}>
                        Remark: {it.remark}
                      </div>
                    )}
```

(If the read-only `items` query doesn't select `remark`, add it to that select — grep the detail items fetch in `apps/backend/src/lib/flow-queries.ts`.)

- [ ] **Step 2: SO PDF.** In `sales-order-pdf.ts`:
(a) `SoItem` type: add `remark?: string | null;` after `variants`.
(b) `VARIANT_KEYS_HIDDEN` (line 103-106): add `'remark', 'extraAddonAmountRM',` — the remark prints as its own note line (next step), and the declared extra is an internal money key the customer never sees (the price already includes it). Without this, the blocklist-style `variantSummary` would leak both.
(c) In the `tableRows` builder: after the `notes` array creation (line 275-278) add:

```ts
    const remarkText = g.kind === 'sofa-build' && g.display
      ? g.display.remark
      : (typeof lead.remark === 'string' && lead.remark.trim() !== '' ? lead.remark : null);
    if (remarkText) notes.push(`Remark: ${remarkText}`);
```

(`g.display.remark` exists after Task A3. Both row shapes already join `notes` into the description cell — no other change.)
(d) Confirm the PDF's items fetch selects `remark` (grep where the detail page / list page builds the `items` array it passes in — add `remark` to that select if missing).

- [ ] **Step 3: POS drawer.** In `OrderStatus.tsx`:
(a) `OrderItem` (line 50-59): add `remark: string | null;`
(b) `MineSoRow.items` (114-121): add `remark?: string | null;` (the API now returns it after Task A5 Step 4).
(c) Mapping (145-159): sofa-build branch add `remark: g.display.remark,`; single branch add `remark: (g.lines[0] as { remark?: string | null }).remark ?? null,`
(d) Drawer items render: grep the JSX that maps `order.items` (search `items.map` / `detailItem` in the drawer section) and under the product name line add:

```tsx
                  {it.remark && <div className={styles.detailNotes}>Remark: {it.remark}</div>}
```

(match the existing class used for muted item meta in that list — reuse, don't invent).

- [ ] **Step 4:** `pnpm typecheck` → PASS. `pnpm --filter @2990s/backend test` (if backend has tests) / `pnpm test` → no new failures.

- [ ] **Step 5: Commit** — `git commit -am "feat(backend+pos): line remark visible on SO detail, SO PDF and POS drawer (spec D3)"`

---

### Task A10: SO Maintenance — "POS settings" toggle section (Backend + POS mirror)

**Files:**
- Create: `apps/backend/src/lib/so-settings-queries.ts` (verbatim mirror of the POS hook from A7 Step 1, with the backend's own `supabase` import path — copy the import style from `apps/backend/src/lib/so-dropdown-options-queries.ts`)
- Modify: `apps/backend/src/pages/SalesOrderMaintenance.tsx` (new section component + render it after the Dropdowns section — read the file top to find the section composition list, follow `VenuesSection`'s placement pattern)
- Modify: `apps/pos/src/pages/SalesOrderMaintenance.tsx` (same section, using the POS hooks from A7)

- [ ] **Step 1:** Create the backend hook file (mirror A7 Step 1; only the `supabase` import differs).
- [ ] **Step 2:** Add the section component (same file as the page, following the file's local-component convention):

```tsx
/* POS settings (spec 2026-06-06 D5) — feature toggles read by the POS at
   runtime. First switch: the product-page "Remark & extra charge" card.
   The SO create path enforces the same flag server-side. */
const PosSettingsSection = () => {
  const q = useSoSettings();
  const update = useUpdateSoSetting();
  return (
    <section>
      <h3>POS settings</h3>
      {(q.data ?? []).map((s) => (
        <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={s.enabled}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ key: s.key, enabled: e.target.checked })}
          />
          <span>{s.label}</span>
        </label>
      ))}
      {q.isLoading && <p>Loading…</p>}
    </section>
  );
};
```

⚠️ Adapt the wrapper markup/classes to the page's existing section pattern (look at `LeadTimesSection` lines 1445-1529 — use the same card/heading classes it uses, not bare `<section>`/`<h3>`). Render `<PosSettingsSection />` in the page body after the Dropdowns section.
- [ ] **Step 3:** Repeat for `apps/pos/src/pages/SalesOrderMaintenance.tsx` with the POS hooks.
- [ ] **Step 4:** `pnpm typecheck` → PASS. Manual: toggle off → POS product page card disappears (after the 30-min stale or a reload — mutation invalidates so the SAME browser updates immediately; other tablets update on refetch).
- [ ] **Step 5: Commit** — `git commit -am "feat(backend+pos): SO Maintenance POS-settings section (remark/extra toggle)"`

---

### Task A11: Phase A verification sweep

- [ ] **Step 1:** `pnpm typecheck` → PASS (exit 0 — no pipes).
- [ ] **Step 2:** `pnpm test` → all suites pass except the 3 known slips.test.ts SSL failures.
- [ ] **Step 3:** `pnpm build` → all three apps build.
- [ ] **Step 4: End-to-end dev smoke (the money path):** POS dev against prod API is NOT safe for order create — use the dev API if configured; otherwise verify on live after deploy (Task A12) with a real test order:
  - mattress + remark "test remark A" + RM100 extra → handover → confirm → SO created (no pricing_drift 400)
  - Backend SO detail: line shows "Remark: test remark A"; line price includes +100
  - Detail Listing: Order Remarks column shows it
  - SO PDF print: remark line under the description
  - POS drawer: item shows the remark
  - SO Maintenance: toggle OFF → product page card hidden; with a hand-crafted payload the API answers 400 `extra_amount_disabled`; toggle back ON
- [ ] **Step 5:** Invoke superpowers:requesting-code-review, fix findings.

---

### Task A12: Phase A ship

- [ ] **Step 1:** Apply migration 0158 to prod via Supabase MCP `apply_migration` (name `0158_so_settings`). Verify: `execute_sql` → `SELECT * FROM so_settings;` → 1 row, enabled=true.
- [ ] **Step 2:** Push branch, open PR titled `feat(pos+api+backend): product-page remark + extra charge, maintenance-gated (spec 2026-06-06)`, body summarises D1/D2/D3/D5 + the drift-gate teaching. Merge per repo flow.
- [ ] **Step 3:** Deploy: API `wrangler deploy` from apps/api; SPAs ride CI on main. Verify live (Step A11.4 list). Remind Loo: **POS tablets need a PWA hard-refresh**.

---

# PHASE B — Payment full set + per-payment slips

Branch from FRESH main (after Phase A merges): `git pull --ff-only && git switch -c feat/payment-fullset-per-slip`.

### Task B1: Migration 0159 — `mfg_sales_order_payments.slip_key`

**Files:**
- Create: `packages/db/migrations/0159_payment_slip_per_row.sql`
- Modify: `packages/db/src/schema.ts:1504-1526` (mfgSalesOrderPayments)

- [ ] **Step 1:** Verify 0159 is free (`ls packages/db/migrations | grep "^015"`).
- [ ] **Step 2:** Migration:

```sql
-- 0159_payment_slip_per_row.sql
-- Loo 2026-06-06 (spec D4) — EVERY payment carries its own slip. Legacy rows
-- stay NULL and the UIs fall back to the order-level slip (mfg_sales_orders.
-- slip_key) for display.
ALTER TABLE mfg_sales_order_payments ADD COLUMN IF NOT EXISTS slip_key text;
```

- [ ] **Step 3:** schema.ts — in `mfgSalesOrderPayments` after `accountSheet`:

```ts
  /* Migration 0159 (spec D4, 2026-06-06) — per-payment slip. R2 key resolved
     from pending_slip_uploads at record time. NULL on legacy rows → UIs fall
     back to the order-level mfg_sales_orders.slip_key. */
  slipKey:            text('slip_key'),
```

- [ ] **Step 4:** `pnpm typecheck` → PASS. Commit: `git commit -am "feat(db): per-payment slip_key on mfg_sales_order_payments (0159)"`

---

### Task B2: API — payments route full set: required slip + overpay guard + per-payment slip URL

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts:3840-3956` (PAYMENT_COLS, schema, POST) + add GET slip-url route after the DELETE (~line 3987)

- [ ] **Step 1: PAYMENT_COLS += slip_key** (line 3840-3843): add `slip_key` to the string (after `account_sheet`).

- [ ] **Step 2: Extend `paymentCreateSchema`** — add after `note:`:

```ts
  /* Spec D4 (2026-06-06) — every payment carries its own slip. The client
     uploads via /slips/init + confirm and sends the session id here. */
  uploadSessionId:    z.string().min(1),
```

- [ ] **Step 3: Harden the POST handler.** After the `parsed` guard (line 3901-3902), insert the overpayment guard + slip resolve:

```ts
  /* Spec D6 — server-side overpayment guard. The SO total is authoritative;
     Σ(ledger) + this payment may never exceed it. Honest error: the client
     shows the remaining balance. */
  const { data: soTotalRow, error: totalErr } = await sb
    .from('mfg_sales_orders').select('total_revenue_centi').eq('doc_no', docNo).maybeSingle();
  if (totalErr) return c.json({ error: 'lookup_failed', reason: totalErr.message }, 500);
  const totalCenti = Number((soTotalRow as { total_revenue_centi: number | null } | null)?.total_revenue_centi ?? 0);
  const { data: paidRows, error: paidErr } = await sb
    .from('mfg_sales_order_payments').select('amount_centi').eq('so_doc_no', docNo);
  if (paidErr) return c.json({ error: 'lookup_failed', reason: paidErr.message }, 500);
  const paidCenti = (paidRows ?? []).reduce((s, r) => s + Number((r as { amount_centi: number }).amount_centi ?? 0), 0);
  if (totalCenti > 0 && paidCenti + p.amountCenti > totalCenti) {
    return c.json({
      error: 'over_payment',
      reason: `Payment exceeds the order total. Balance: ${((totalCenti - paidCenti) / 100).toFixed(2)}`,
      balanceCenti: Math.max(0, totalCenti - paidCenti),
    }, 400);
  }

  /* Spec D4 — resolve the slip upload session → committed R2 key. Required:
     a payment without a slip is rejected (same vocabulary as the order-level
     slip_required guard). Mirrors the SO-create resolve at ~line 2075. */
  const { data: slipRow, error: slipErr } = await sb
    .from('pending_slip_uploads')
    .select('r2_key, status')
    .eq('upload_session_id', p.uploadSessionId)
    .maybeSingle();
  if (slipErr) return c.json({ error: 'lookup_failed', reason: slipErr.message }, 500);
  const slipRowT = slipRow as { r2_key: string | null; status: string } | null;
  if (!slipRowT || slipRowT.status !== 'uploaded' || !slipRowT.r2_key) {
    return c.json({ error: 'slip_required', reason: 'Upload the payment slip first.' }, 400);
  }
  const paymentSlipKey = slipRowT.r2_key;
```

Then in the `.insert({ ... })` object add `slip_key: paymentSlipKey,` (after `account_sheet`), and after the successful insert (before `recordSoAudit`) promote the pending row:

```ts
  await sb.from('pending_slip_uploads')
    .update({ status: 'promoted', promoted_at: new Date().toISOString() })
    .eq('upload_session_id', p.uploadSessionId);
```

- [ ] **Step 4: Per-payment slip URL route.** Read the existing order-level slip-url route at ~line 705-731 (it presigns a GET for `mfg_sales_orders.slip_key`) and add the per-payment variant right after the payments DELETE route, reusing the SAME presign helper it uses:

```ts
/* Spec D4 — per-payment slip view. Same presign helper + vocabulary as the
   order-level /:docNo/slip-url route (line ~705); legacy rows (slip_key NULL)
   → no_slip_attached and the UI falls back to the order slip. */
mfgSalesOrders.get('/:docNo/payments/:id/slip-url', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const id = c.req.param('id');
  const { data: row, error } = await sb
    .from('mfg_sales_order_payments')
    .select('so_doc_no, slip_key')
    .eq('id', id)
    .maybeSingle();
  if (error) return c.json({ error: 'db_fetch_failed', detail: error.message }, 500);
  const r = row as { so_doc_no: string; slip_key: string | null } | null;
  if (!r || r.so_doc_no !== docNo) return c.json({ error: 'not_found' }, 404);
  if (!r.slip_key) return c.json({ error: 'no_slip_attached' }, 400);

  const bindings = slipBindings(c.env);
  const url = await presign({
    bucket: bindings.bucketName,
    region: 'auto',
    accessKeyId: bindings.accessKeyId,
    secretAccessKey: bindings.secretAccessKey,
    endpoint: bindings.endpoint,
    key: r.slip_key,
    method: 'GET',
    expiresInSeconds: 5 * 60,
  });
  return c.json({
    url,
    contentType: mimeFromKey(r.slip_key),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
});
```

(`slipBindings`, `presign`, `mimeFromKey` are already imported/defined in this file — used by the order-level route at line 705-734.)

- [ ] **Step 5: GET /:docNo/payments** already selects via PAYMENT_COLS → now returns `slip_key`. No change needed beyond Step 1.

- [ ] **Step 6:** `pnpm typecheck` → PASS. Commit: `git commit -am "feat(api): payments route — required per-payment slip, overpay 400, slip-url (spec D4/D6)"`

---

### Task B3: API — SO create books per-payment slips (handover split)

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts:2097-2117` (posPayments schema), `:2262-2307` (split insert), `:2308-2358` (single insert)

- [ ] **Step 1: posPayments schema += uploadSessionId** (line 2105-2111):

```ts
      uploadSessionId:   z.string().min(1),        // spec D4 — one slip per payment
```

(REQUIRED: the POS is the only payments[] sender and ships the uploader in the same release. Old PWA clients don't send payments[] at all — they use the single-deposit path, unaffected.)

- [ ] **Step 2: Resolve every split slip BEFORE the header insert** (so a bad slip never strands a created SO). After the posPayments parse block (line 2117), add:

```ts
  /* Spec D4 — resolve each split payment's slip session → R2 key up front.
     All-or-nothing: any unresolved slip rejects the order BEFORE the header
     insert (and rolls back PWP claims), so no SO is created with half its
     payment proofs missing. */
  let posPaymentSlipKeys: string[] | null = null;
  if (posPayments) {
    const sessionIds = posPayments.map((p) => p.uploadSessionId);
    const { data: slipRows, error: slipErr } = await sb
      .from('pending_slip_uploads')
      .select('upload_session_id, r2_key, status')
      .in('upload_session_id', sessionIds);
    if (slipErr) { await rollbackPwpClaims(); return c.json({ error: 'lookup_failed', reason: slipErr.message }, 500); }
    const byId = new Map((slipRows ?? []).map((r) => {
      const t = r as { upload_session_id: string; r2_key: string | null; status: string };
      return [t.upload_session_id, t] as const;
    }));
    posPaymentSlipKeys = [];
    for (const sid of sessionIds) {
      const row = byId.get(sid);
      if (!row || row.status !== 'uploaded' || !row.r2_key) {
        await rollbackPwpClaims();
        return c.json({ error: 'slip_required', reason: `Payment slip missing for one of the split payments.` }, 400);
      }
      posPaymentSlipKeys.push(row.r2_key);
    }
  }
```

- [ ] **Step 3: Split insert += slip_key + promote.** In the `for (const p of posPayments)` loop (line 2267), use the loop index (`posPayments.forEach`-style or `for (let i = 0; ...)`) and add to the insert object:

```ts
        slip_key:           posPaymentSlipKeys![i],
```

and after a successful insert, promote that session:

```ts
      await sb.from('pending_slip_uploads')
        .update({ status: 'promoted', promoted_at: new Date().toISOString() })
        .eq('upload_session_id', p.uploadSessionId);
```

(Convert the `for...of` to an indexed loop: `for (let i = 0; i < posPayments.length; i++) { const p = posPayments[i]!; ... }`.)

- [ ] **Step 4: Single-deposit path** (line 2316-2337): the order-level slip doubles as the deposit row's slip. In the insert object add:

```ts
        slip_key:           slipKey,        // order-level handover slip = the deposit's proof
```

(`slipKey` is already in scope from the order-slip resolve at ~line 2075.)

- [ ] **Step 5:** `pnpm typecheck` → PASS. Commit: `git commit -am "feat(api): SO create books one slip per split payment (spec D4)"`

---

### Task B4: POS — handover split payments each upload a slip

**Files:**
- Modify: `apps/pos/src/lib/handover-helpers.ts:34-53` (ExtraPayment + completeness), `:176-192` (validateConfirmPayment), `:261-280` (blockers)
- Modify: `apps/pos/src/components/handover/ConfirmPaymentStep.tsx:151-263` (per-row uploader; primary slip heading)
- Modify: `apps/pos/src/pages/Handover.tsx:354-373` (payload)
- Test: `apps/pos/src/lib/handover-helpers.test.ts`

- [ ] **Step 1: Types + validators.** `ExtraPayment` += `slipUploadSessionId: string | null;`. `extraPaymentComplete` += `&& p.slipUploadSessionId !== null`. In `confirmPaymentBlockers`, the existing per-row incomplete message already fires via `extraPaymentComplete`; extend its text: append `' (and slip)'` when `p.slipUploadSessionId === null`. The `ExtraPayment` factory in ConfirmPaymentStep's "Add payment" onClick (line 246-249) gains `slipUploadSessionId: null`.

- [ ] **Step 2: Failing test first** (handover-helpers.test.ts):

```ts
it('extra payment is incomplete without its own slip (spec D4)', () => {
  const p = { method: 'cash' as const, amount: 100, approvalCode: 'R-1',
    merchantProvider: null, installmentMonths: null, slipUploadSessionId: null };
  expect(extraPaymentComplete(p)).toBe(false);
  expect(extraPaymentComplete({ ...p, slipUploadSessionId: 'sess-1' })).toBe(true);
});
```

Run `pnpm --filter @2990s/pos test -- handover-helpers` → FAIL → implement Step 1 → PASS.

- [ ] **Step 3: Per-row uploader.** In ConfirmPaymentStep's split-row grid (inside the `extras.map((p, i) => ...)` block, after the installment conditional ~line 240), add:

```tsx
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label={`Payment ${i + 2} slip / proof *`}>
              <SlipUploadStep
                onConfirmed={(id) => patchExtra(i, { slipUploadSessionId: id })}
                onCleared={() => patchExtra(i, { slipUploadSessionId: null })}
              />
            </Field>
          </div>
```

And retitle the existing bottom uploader heading (line 265-267) from `Payment slip / proof` to `Payment 1 slip / proof` (it remains `form.slipUploadSessionId` — the primary payment's slip AND the order-level slip).

- [ ] **Step 4: Payload.** In Handover.tsx's `payments:` array (line 356-371): primary entry += `uploadSessionId: form.slipUploadSessionId!,` (non-null — `validateConfirmPayment` guarantees it); each extra += `uploadSessionId: p.slipUploadSessionId!,`.

- [ ] **Step 5:** `pnpm typecheck` + `pnpm --filter @2990s/pos test` → PASS. Commit: `git commit -am "feat(pos): one slip per handover split payment (spec D4)"`

---

### Task B5: POS — Record-payment drawer becomes the full set + payment history

**Files:**
- Modify: `apps/pos/src/pages/OrderStatus.tsx` (state ~745-760; mutation 905-926; payment section JSX 1154-1220)

- [ ] **Step 1: State + data.** In `OrderDetail` add local state + history query:

```ts
  // Full-set payment entry (spec 2026-06-06) — method cascade synced with SO
  // Maintenance (same hooks as the handover), per-payment slip, history list.
  const methodLabels = usePaymentMethodLabels() as Record<string, string>;
  const merchants = useSoDropdownValues('payment_merchant', MERCHANT_FALLBACK);
  const onlineTypes = useSoDropdownValues('online_type', []);
  const installmentPlans = useSoDropdownValues('installment_plan', INSTALLMENT_FALLBACK);
  const [payMethod, setPayMethod] = useState<'merchant' | 'transfer' | 'cash' | 'installment'>('cash');
  const [payMerchant, setPayMerchant] = useState('');
  const [payOnlineType, setPayOnlineType] = useState('');
  const [payInstallmentMonths, setPayInstallmentMonths] = useState<number | null>(null);
  const [paySlipSession, setPaySlipSession] = useState<string | null>(null);
  const paymentsQ = useQuery({
    queryKey: ['so-payments', order.id],
    queryFn: async () => {
      const res = await authedFetch(`/mfg-sales-orders/${order.id}/payments`, { method: 'GET' });
      return ((await res.json()) as { payments: Array<{
        id: string; paid_at: string; method: string; approval_code: string | null;
        amount_centi: number; slip_key: string | null;
      }> }).payments;
    },
  });
```

Imports: `usePaymentMethodLabels, useSoDropdownValues` from `../lib/so-maintenance/so-dropdown-options-queries`; `MERCHANT_FALLBACK, INSTALLMENT_FALLBACK, parseTermMonths` from `../components/handover/AddonsPaymentStep`; `SlipUploadStep` from `../components/SlipUploadStep`; `PAYMENT_METHOD_CODES` from `@2990s/shared/payment-methods`. (Move `authedFetch` above the new query if needed — it's defined at line 860; relocate the query below it instead, order within the component is free.)

- [ ] **Step 2: Mutation.** Replace `paymentMutation`'s body JSON with the full set:

```ts
        body: JSON.stringify({
          paidAt: today,
          method: payMethod,
          amountCenti: Math.round(amount * 100),
          ...(payMethod === 'merchant' ? { merchantProvider: payMerchant || null } : {}),
          ...(payMethod === 'merchant' || payMethod === 'installment'
            ? { installmentMonths: payInstallmentMonths } : {}),
          ...(payMethod === 'transfer' ? { onlineType: payOnlineType || null } : {}),
          ...(edited.approvalCode?.trim() ? { approvalCode: edited.approvalCode.trim() } : {}),
          ...(user?.id ? { collectedBy: user.id } : {}),
          uploadSessionId: paySlipSession,
        }),
```

`onSuccess` additionally: `setPaySlipSession(null); queryClient.invalidateQueries({ queryKey: ['so-payments', order.id] });`. Delete the now-unused `paymentMethodFor()` (line 896-900).

- [ ] **Step 3: UI.** In the Payment section (1179-1219), above the amount/approval grid add the method cascade (pattern: ConfirmPaymentStep's split-row selects, reusing `DetailField`):

```tsx
                <div className={styles.detailFieldGrid} style={{ marginTop: 12 }}>
                  <DetailField label="Method *" disabled={false}>
                    <select value={payMethod} onChange={(e) => {
                      const m = e.target.value as typeof payMethod;
                      setPayMethod(m);
                      if (m !== 'merchant') setPayMerchant('');
                      if (m !== 'merchant' && m !== 'installment') setPayInstallmentMonths(null);
                      if (m !== 'transfer') setPayOnlineType('');
                    }}>
                      {PAYMENT_METHOD_CODES.map((code) => (
                        <option key={code} value={code}>{methodLabels[code] ?? code}</option>
                      ))}
                    </select>
                  </DetailField>
                  {payMethod === 'merchant' && (
                    <DetailField label="Merchant *" disabled={false}>
                      <select value={payMerchant} onChange={(e) => setPayMerchant(e.target.value)}>
                        <option value="">Select…</option>
                        {merchants.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </DetailField>
                  )}
                  {payMethod === 'transfer' && (
                    <DetailField label="Online type" disabled={false}>
                      <select value={payOnlineType} onChange={(e) => setPayOnlineType(e.target.value)}>
                        <option value="">Select…</option>
                        {onlineTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </DetailField>
                  )}
                  {(payMethod === 'merchant' || payMethod === 'installment') && (
                    <DetailField label="Installment term" disabled={false}>
                      <select
                        value={payInstallmentMonths ?? ''}
                        onChange={(e) => setPayInstallmentMonths(e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">One-off</option>
                        {installmentPlans
                          .map((o) => parseTermMonths(o.value))
                          .filter((n): n is number => n !== null)
                          .map((t) => <option key={t} value={t}>{t} months</option>)}
                      </select>
                    </DetailField>
                  )}
                </div>
```

Below the amount/approval grid add the required slip:

```tsx
                <div style={{ marginTop: 8 }}>
                  <DetailField label="Payment slip / proof *" disabled={false}>
                    <SlipUploadStep
                      onConfirmed={(id) => setPaySlipSession(id)}
                      onCleared={() => setPaySlipSession(null)}
                    />
                  </DetailField>
                </div>
```

Record button disabled until valid:

```tsx
                    disabled={
                      additionalPaid <= 0
                      || paymentMutation.isPending
                      || paySlipSession === null
                      || !(edited.approvalCode ?? '').trim()
                      || (payMethod === 'merchant' && !payMerchant)
                    }
```

And REPLACE the single "Paid so far" KV with the history list (keep the progress bar):

```tsx
            {(paymentsQ.data ?? []).length > 0 && (
              <div style={{ marginTop: 8 }}>
                {(paymentsQ.data ?? []).map((p) => (
                  <div key={p.id} className={styles.detailKV}>
                    <span>{p.paid_at} · {methodLabels[p.method] ?? p.method}</span>
                    <span>
                      <span className={styles.detailItemPriceUnit}>RM</span>
                      {fmtMoney(Math.round(p.amount_centi / 100))}
                      {p.approval_code ? <em> · {p.approval_code}</em> : null}
                    </span>
                  </div>
                ))}
                <div className={styles.detailPayLegend}>
                  <span>{(paymentsQ.data ?? []).length} payment{(paymentsQ.data ?? []).length > 1 ? 's' : ''} recorded</span>
                </div>
              </div>
            )}
```

- [ ] **Step 4:** `pnpm typecheck` → PASS. Dev smoke: record a payment without slip → button disabled; with slip → lands, history shows the new row with its approval code; over-pay attempt → API 400 `over_payment` surfaces in the error line.
- [ ] **Step 5: Commit** — `git commit -am "feat(pos): drawer Record payment full set — method cascade, required slip, history list (spec D4/D6)"`

---

### Task B6: Backend — PaymentsTable per-row slip (upload + display)

**Files:**
- Create: `apps/backend/src/lib/slip.ts` (mirror of apps/pos/src/lib/slip.ts — see Step 1a)
- Create: `apps/backend/src/components/SlipUploadField.tsx` (backend uploader — the POS SlipUploadStep is app-scoped)
- Modify: `apps/backend/src/components/PaymentsTable.tsx` (PaymentDraft ~150-167; commitDraft ~329-355; SoPayment type + slip column 380-560)
- Modify: backend pages that batch `PaymentDraft[]` to the SO payments endpoint — find them: `pnpm exec rg -ln "PaymentDraft" apps/backend/src/pages`

- [ ] **Step 1a: Backend slip lib.** Check first whether `apps/backend` already has a slip-upload lib: `pnpm exec rg -ln "slips/init" apps/backend/src`. If a helper exists, use it and skip to 1b. If not, create `apps/backend/src/lib/slip.ts` as a verbatim copy of `apps/pos/src/lib/slip.ts` (114 lines — `sha256Hex` / `initSlipUpload` / `putToR2` / `confirmUpload` / `uploadSlipFull` with the 1-retry PUT) changing ONLY the first import to the backend's supabase client path (`import { supabase } from './supabase';` — confirm the backend's client path with `pnpm exec rg -ln "createClient" apps/backend/src/lib`). The file is app-agnostic otherwise (same `/slips/init` → R2 PUT → `/slips/:session/confirm` flow, same `VITE_API_URL`). Per-app mirror copies are this repo's established pattern (cf. so-dropdown-options-queries).

- [ ] **Step 1b: Backend uploader component.** Create `apps/backend/src/components/SlipUploadField.tsx`:

```tsx
import { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { ALLOWED_SLIP_MIMES, MAX_SLIP_SIZE_BYTES } from '@2990s/shared/schemas';
import { uploadSlipFull, type SlipUploadPhase } from '../lib/slip';

type Phase = 'idle' | SlipUploadPhase | 'done' | 'error';

/* Spec D4 (2026-06-06) — per-payment slip uploader for PaymentsTable draft
   rows. Backend twin of the POS SlipUploadStep (file input only, no camera). */
export function SlipUploadField({ onConfirmed, onCleared }: {
  onConfirmed: (uploadSessionId: string) => void;
  onCleared: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setPhase('idle'); setErrorMsg(null); setFileName(null);
    if (inputRef.current) inputRef.current.value = '';
    onCleared();
  };

  const handleFile = async (f: File | null) => {
    if (!f) { reset(); return; }
    if (!(ALLOWED_SLIP_MIMES as readonly string[]).includes(f.type)) {
      setErrorMsg('Only JPG / PNG / WebP / PDF supported.'); setPhase('error'); return;
    }
    if (f.size > MAX_SLIP_SIZE_BYTES) {
      setErrorMsg('File too large (max 5 MB).'); setPhase('error'); return;
    }
    setFileName(f.name); setErrorMsg(null);
    try {
      const result = await uploadSlipFull({ file: f, onProgress: (p) => setPhase(p) });
      setPhase('done');
      onConfirmed(result.uploadSessionId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed.');
      setPhase('error'); onCleared();
    }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
      />
      {phase !== 'done' ? (
        <button type="button" onClick={() => inputRef.current?.click()}
          disabled={phase === 'init' || phase === 'put' || phase === 'confirm'}>
          <Upload size={14} strokeWidth={1.75} />
          {phase === 'idle' || phase === 'error' ? 'Slip *' : 'Uploading…'}
        </button>
      ) : (
        <span title={fileName ?? undefined}>
          ✓ {fileName && fileName.length > 14 ? `${fileName.slice(0, 12)}…` : fileName}
          <button type="button" onClick={reset} title="Remove slip" style={{ marginLeft: 4 }}>
            <X size={12} strokeWidth={2} />
          </button>
        </span>
      )}
      {errorMsg && <span style={{ color: 'var(--c-festive-b, #B8331F)' }}>{errorMsg}</span>}
    </span>
  );
}
```

⚠️ Match the table's existing button/cell classes (look at how the draft-row save/trash buttons are styled in PaymentsTable and reuse those classes instead of bare buttons). The "✓" is a check mark character in a label — swap to a Lucide `Check` icon to honour the no-emoji icon rule.

- [ ] **Step 2: PaymentDraft += slip.** `PaymentDraft` type += `slipUploadSessionId: string | null;`; `newPaymentDraft` += `slipUploadSessionId: null,`. Draft-row JSX (find where accountSheet/approvalCode inputs render per draft row, ~line 560-709): add a `<SlipUploadField onConfirmed={(id) => patchDraft(d.uid, { slipUploadSessionId: id })} onCleared={() => patchDraft(d.uid, { slipUploadSessionId: null })} />` cell. `commitDraft` guard: `if (d.amountCenti <= 0 || !d.slipUploadSessionId) return;` and body += `uploadSessionId: d.slipUploadSessionId,`. Disable the row's save button until `slipUploadSessionId` is set (match how the amount guard surfaces).

- [ ] **Step 3: Slip column goes per-row.** `SoPayment` type (grep its definition in `apps/backend/src/lib/flow-queries.ts` — PAYMENT_COLS now returns `slip_key`) += `slip_key?: string | null;`. In PaymentsTable's slip cell logic (382-412 + 531): per-row resolution —

```ts
  // Per-payment slip (0159) first; legacy rows fall back to the order slip.
  // Fetch per-row via GET /:docNo/payments/:id/slip-url when p.slip_key is set.
```

Implement: a small `PaymentSlipThumb({ docNo, payment, orderSlip })` local component that (a) if `payment.slip_key` → fetches `/mfg-sales-orders/${docNo}/payments/${payment.id}/slip-url` once (useQuery keyed `['payment-slip', payment.id]`, staleTime 30 min) and renders the same `<img>/<a>` markup as the existing `slipCell()`; (b) else falls back to the existing order-level `slipUrl` thumbnail. Replace the `{showSlip && <span ...>{slipCell()}</span>}` per-row usage with `<PaymentSlipThumb …/>`; keep Wei Siang's `slip` prop as the order-level fallback source.

- [ ] **Step 4: Draft-batching call sites.** For each page found by the rg in **Files** (e.g. the backend New SO page): if it POSTs drafts to `/mfg-sales-orders/:docNo/payments`, forward `uploadSessionId: d.slipUploadSessionId` and gate submit on every draft having one. If it batches to DO/SI/consignment payment endpoints, DO NOT add the requirement (out of scope §5) — only ensure the new field doesn't break their payload (it's additive client-side; omit it there).

- [ ] **Step 5:** `pnpm typecheck` → PASS. Smoke: backend SO detail → Add Payment → save blocked until slip uploaded → saved row shows its own thumbnail; an old row still shows the order slip.
- [ ] **Step 6: Commit** — `git commit -am "feat(backend): PaymentsTable per-row slip upload + display (spec D4)"`

---

### Task B7: Detail Listing — aggregate approval codes + payment count (D7)

**Files:**
- Modify: `apps/api/src/routes/reports.ts:122-161` (aggregation) + `:237-246` (flatten)

- [ ] **Step 1:** In the payments aggregation loop add a per-doc code list (after `paymentMetaByDoc` declaration):

```ts
  const approvalCodesByDoc = new Map<string, Array<{ paidAt: string | null; code: string }>>();
```

Inside the `for (const p of paymentTotals ?? [])` loop:

```ts
      if (row.approval_code && row.approval_code.trim() !== '') {
        const arr = approvalCodesByDoc.get(key) ?? [];
        arr.push({ paidAt: row.paid_at ?? null, code: row.approval_code.trim() });
        approvalCodesByDoc.set(key, arr);
      }
```

- [ ] **Step 2:** In the flatten (line 242-245) replace the `flat.approval_code` assignment with:

```ts
      /* Spec D7 (Loo 2026-06-06) — ALL approval codes, oldest→newest, plus a
         count when there are several ("123123 + 456456 (2)"). Header-level
         code keeps covering legacy single-shot SOs with no ledger rows. */
      const codes = (approvalCodesByDoc.get(r.doc_no) ?? [])
        .sort((a, b) => String(a.paidAt ?? '').localeCompare(String(b.paidAt ?? '')))
        .map((x) => x.code);
      flat.approval_code = codes.length > 0
        ? codes.join(' + ') + (codes.length > 1 ? ` (${codes.length})` : '')
        : ((h.approval_code as string | null) ?? null);
```

- [ ] **Step 3:** `pnpm typecheck` → PASS. Commit: `git commit -am "feat(api): Detail Listing approval-code column aggregates all codes + count (spec D7)"`

---

### Task B8: Phase B verification + ship

- [ ] **Step 1:** `pnpm typecheck`, `pnpm test`, `pnpm build` → all green (modulo the 3 known slips SSL failures).
- [ ] **Step 2:** Apply migration 0159 via Supabase MCP. Verify column: `execute_sql` → `SELECT column_name FROM information_schema.columns WHERE table_name='mfg_sales_order_payments' AND column_name='slip_key';`
- [ ] **Step 3:** Push, PR `feat(pos+api+backend): payment full set — per-payment slips, overpay guard, approval-code aggregate`, merge, `wrangler deploy`, SPAs via CI.
- [ ] **Step 4: Live verification (real test order):**
  - handover, split deposit 2× → each row demands its own slip + approval code → SO created → backend PaymentsTable shows 2 rows, 2 slips, 2 codes
  - POS drawer: record a 3rd payment — method cascade present, slip required, history lists 3 rows
  - over-pay attempt (amount > balance via devtools) → 400 `over_payment`
  - Detail Listing → Approval Code shows `code1 + code2 + code3 (3)`
  - backend SO detail → Add Payment without slip blocked
- [ ] **Step 5:** Remind Loo: **POS tablets PWA hard-refresh**. Invoke superpowers:requesting-code-review on the PR diff; fix findings before merge (reorder Steps 3↔5 if review-before-merge).

---

## Self-review results (spec coverage)

| Spec § | Tasks |
|---|---|
| §2 so_settings + slip_key | A1, B1 (split into 0158/0159 — noted deviation) |
| §3.1 product-page card ×3 kinds | A7 |
| §3.2 snapshot + PWP-exclusion + quote/edit survival | A6, A7 (hydration Step 5; pwpOriginalTotal Step 3e) |
| §3.3 payload threading | A6 |
| §3.4 recompute + gate + remark persist + sofa lead-line | A4, A5 |
| §3.5 display completion (detail/fold/PDF/drawer/listing) | A3, A9 (listing column already reads `remark` first — no change) |
| §3.6 remove old box | A8 |
| §3.7 maintenance toggle | A2, A10 (+ server gate A5) |
| §4.2 POS drawer full set | B5 |
| §4.3 payments route harden | B2 |
| §4.4 handover per-payment slips | B3, B4 |
| §4.5 PaymentsTable per-row slip | B6 |
| §4.6 approval-code aggregate | B7 |
| §6 tests | A3/A4/A6/B4 inline; suites in A11/B8 |
| §7 deploy order | A12, B8 |
