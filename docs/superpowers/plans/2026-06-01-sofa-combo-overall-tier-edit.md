# Sofa Combo "Overall Edit price tier" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Master-Admin "Overall Edit price tier" panel to the POS Combo Pricing tab that, from two global flat-RM premiums, one-click (re)generates every Price-1 combo's Price 2 & Price 3 rows = `Price 1 + premium` across all seat heights.

**Architecture:** A new singleton config table (`sofa_combo_tier_offsets`) stores the two premiums (mirrors `delivery_fee_config`). A thin API does the sweep server-side using one pure helper (`comboTierPrices`) — for each active `PRICE_1` master combo it inserts append-only `PRICE_2`/`PRICE_3` rows. The existing combo lookup + `POST /orders` recompute are **untouched** because the generated rows are ordinary tier-tagged combo rows.

**Tech Stack:** Drizzle (schema source of truth) + raw SQL migration · Hono on CF Workers · `@2990s/shared` pure functions + vitest · React 19 + TanStack Query (POS).

**Spec:** `docs/superpowers/specs/2026-06-01-sofa-combo-overall-tier-edit-design.md`

**Money unit:** combo prices are stored in **sen** (RM×100), matching `sofa_combo_pricing.prices_by_height`. UI converts RM→sen with `Math.round(n*100)` and sen→RM with `/100` (same as `SofaComboTab`'s existing grid).

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `packages/shared/src/sofa-combo-pricing.ts` | Modify | add pure `comboTierPrices(baseSelling, premiumSen)` |
| `packages/shared/src/__tests__/sofa-combo-pricing.test.ts` | Modify | unit tests for `comboTierPrices` |
| `packages/db/migrations/0124_sofa_combo_tier_offsets.sql` | Create | singleton config table |
| `packages/db/src/schema.ts` | Modify | Drizzle def `sofaComboTierOffsets` |
| `apps/api/src/routes/sofa-combos.ts` | Modify | `GET /tier-premiums` + `POST /tier-premiums/apply` |
| `apps/pos/src/lib/products/sofa-combos-queries.ts` | Modify | `useSofaComboTierPremiums` + `useApplySofaComboTierPremiums` |
| `apps/pos/src/components/products/SofaComboTab.tsx` | Modify | "Overall Edit price tier" button + panel modal |

---

## Task 1: Pure helper `comboTierPrices` (TDD)

**Files:**
- Modify: `packages/shared/src/sofa-combo-pricing.ts`
- Test: `packages/shared/src/__tests__/sofa-combo-pricing.test.ts`

- [ ] **Step 1: Write the failing test** — append to `sofa-combo-pricing.test.ts`. Add `comboTierPrices` to the existing import block at the top of the file (the `from '../sofa-combo-pricing'` import).

```ts
describe('comboTierPrices', () => {
  it('adds the premium (sen) to each non-null height', () => {
    expect(comboTierPrices({ '24': 245700, '28': 259900 }, 5000))
      .toEqual({ '24': 250700, '28': 264900 });
  });

  it('preserves nulls — no base price means no derived price', () => {
    expect(comboTierPrices({ '24': 245700, '32': null }, 5000))
      .toEqual({ '24': 250700, '32': null });
  });

  it('zero premium returns the base unchanged', () => {
    expect(comboTierPrices({ '24': 245700 }, 0)).toEqual({ '24': 245700 });
  });

  it('clamps a negative premium to 0 and rounds to integer sen', () => {
    expect(comboTierPrices({ '24': 100 }, -50)).toEqual({ '24': 100 });
    expect(comboTierPrices({ '24': 100 }, 49.6)).toEqual({ '24': 150 });
  });

  it('empty / undefined base → empty map', () => {
    expect(comboTierPrices(undefined, 5000)).toEqual({});
    expect(comboTierPrices({}, 5000)).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @2990s/shared test -- sofa-combo-pricing`
Expected: FAIL — `comboTierPrices is not a function` (or import error).

- [ ] **Step 3: Write minimal implementation** — append to `sofa-combo-pricing.ts` (near `comboChargedPrices`, which it mirrors in shape):

```ts
/** Derive a tier's per-height SELLING prices from a base (Price 1) selling map
 *  by adding a flat premium (sen) to every priced height. A null/absent base
 *  height stays null (no base price → no derived price). Premium is clamped to
 *  a non-negative integer. Pure — POS UI preview and the server sweep both call
 *  it so the generated prices can't diverge. (Chairman 2026-06-01: P1 base +
 *  global P2/P3 lump-sum premiums.) */
export const comboTierPrices = (
  baseSelling: Record<string, number | null> | null | undefined,
  premiumSen: number,
): Record<string, number | null> => {
  const prem = Math.max(0, Math.round(premiumSen));
  const out: Record<string, number | null> = {};
  for (const [height, v] of Object.entries(baseSelling ?? {})) {
    out[height] = v === null || v === undefined ? null : v + prem;
  }
  return out;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @2990s/shared test -- sofa-combo-pricing`
Expected: PASS (all `comboTierPrices` cases + the existing combo tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sofa-combo-pricing.ts packages/shared/src/__tests__/sofa-combo-pricing.test.ts
git commit -m "feat(sofa): comboTierPrices — derive tier selling from P1 base + premium"
```

---

## Task 2: Config table — migration + Drizzle schema

**Files:**
- Create: `packages/db/migrations/0124_sofa_combo_tier_offsets.sql`
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Create the migration** — `packages/db/migrations/0124_sofa_combo_tier_offsets.sql`:

```sql
-- ----------------------------------------------------------------------------
-- 0124 — sofa_combo_tier_offsets
--
-- Chairman 2026-06-01: Combo "Overall Edit price tier". A single global row
-- (id = 1) holding the two flat premiums (sen = RM×100) added to each combo's
-- Price 1 base to derive Price 2 / Price 3. The Master Admin sets these on the
-- POS Combo Pricing tab; the /sofa-combos/tier-premiums/apply sweep reads them
-- to (re)generate PRICE_2 / PRICE_3 sofa_combo_pricing rows.
--
-- No RLS — consistent with sofa_combo_pricing (same domain); the app-layer
-- requireWriteRole gate on /sofa-combos is the writer guard.
-- ----------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS sofa_combo_tier_offsets (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  p2_premium_sen  INTEGER NOT NULL DEFAULT 0 CHECK (p2_premium_sen >= 0),
  p3_premium_sen  INTEGER NOT NULL DEFAULT 0 CHECK (p3_premium_sen >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      UUID
);

INSERT INTO sofa_combo_tier_offsets (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE sofa_combo_tier_offsets IS
  'Singleton (id=1) global flat premiums (sen) added to each sofa combo Price 1 '
  'to derive Price 2 / Price 3. Chairman 2026-06-01.';

COMMIT;
```

- [ ] **Step 2: Add the Drizzle definition** — in `packages/db/src/schema.ts`, immediately AFTER the `deliveryFeeConfig` block (ends ~line 130):

```ts
/* ─────────────────── Sofa combo tier offsets ────────────────────────── */
// Singleton (id = 1) — two flat premiums (sen) added to each combo's Price 1
// to derive Price 2 / Price 3 (Chairman 2026-06-01). No RLS (matches
// sofa_combo_pricing); app-layer requireWriteRole gates writes.
export const sofaComboTierOffsets = pgTable('sofa_combo_tier_offsets', {
  id:           integer('id').primaryKey().default(1),        // CHECK (id = 1) at DB
  p2PremiumSen: integer('p2_premium_sen').notNull().default(0),
  p3PremiumSen: integer('p3_premium_sen').notNull().default(0),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:    uuid('updated_by'),
});
```

- [ ] **Step 3: Verify schema typechecks**

Run: `pnpm --filter @2990s/db typecheck`
Expected: PASS (no errors). If `@2990s/db` has no `typecheck` script, run `pnpm typecheck` and confirm the db package compiles.

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/0124_sofa_combo_tier_offsets.sql packages/db/src/schema.ts
git commit -m "feat(sofa): sofa_combo_tier_offsets singleton config table (migration 0124)"
```

> **Prod apply is a separate, user-gated deploy step** — see Task 6. Do NOT apply to prod inside this task.

---

## Task 3: API — read + apply endpoints

**Files:**
- Modify: `apps/api/src/routes/sofa-combos.ts`

- [ ] **Step 1: Import the helper** — extend the existing `@2990s/shared` import (currently `canonicalizeComboModulesForStorage, comboSlotsKey, sofaComboCostSen, type ComboSlots`) to add `comboTierPrices`:

```ts
import { canonicalizeComboModulesForStorage, comboSlotsKey, sofaComboCostSen, comboTierPrices, type ComboSlots } from '@2990s/shared';
```

- [ ] **Step 2: Add `GET /tier-premiums`** — insert immediately AFTER the `sofaCombos.get('/history', …)` handler (so the static path is registered before the `/:id` param handlers). GET stays open to any authed staff (the POS panel reads it):

```ts
// ── GET /tier-premiums ─────────────────────────────────────────────────
// The two global flat premiums (sen) added to each combo's Price 1 to derive
// Price 2 / Price 3. Read-open (the POS Overall-Edit panel pre-fills from it).
sofaCombos.get('/tier-premiums', async (c) => {
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('sofa_combo_tier_offsets')
    .select('p2_premium_sen, p3_premium_sen, updated_at, updated_by')
    .eq('id', 1)
    .maybeSingle();
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({
    p2PremiumSen: data?.p2_premium_sen ?? 0,
    p3PremiumSen: data?.p3_premium_sen ?? 0,
    updatedAt: data?.updated_at ?? null,
    updatedBy: data?.updated_by ?? null,
  });
});
```

- [ ] **Step 3: Add `POST /tier-premiums/apply`** — insert immediately AFTER the `sofaCombos.post('/', …)` handler:

```ts
// ── POST /tier-premiums/apply ──────────────────────────────────────────
// Persist the two premiums, then sweep every ACTIVE master Price-1 combo and
// insert append-only PRICE_2 + PRICE_3 rows = base SELLING + premium per height
// (cost copied from the base — same modules). Re-running inserts fresher rows,
// so the latest (today) wins → overwrites manual edits (Chairman point 4). The
// combo lookup is untouched: generated rows are ordinary tier-tagged rows.
sofaCombos.post('/tier-premiums/apply', async (c) => {
  const gate = await requireWriteRole(c);
  if (!gate.ok) return gate.res;

  let body: { p2PremiumSen?: unknown; p3PremiumSen?: unknown };
  try { body = (await c.req.json()) as typeof body; }
  catch { return c.json({ error: 'invalid_json' }, 400); }

  const p2 = Number(body.p2PremiumSen);
  const p3 = Number(body.p3PremiumSen);
  if (!Number.isInteger(p2) || p2 < 0 || !Number.isInteger(p3) || p3 < 0) {
    return c.json({ error: 'premiums_invalid', message: 'p2/p3 premium must be a non-negative integer (sen)' }, 400);
  }

  const supabase = c.get('supabase');
  const user = c.get('user');
  const today = todayIso();

  // 1) Persist premiums (singleton id = 1).
  const { error: upErr } = await supabase
    .from('sofa_combo_tier_offsets')
    .update({ p2_premium_sen: p2, p3_premium_sen: p3, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq('id', 1);
  if (upErr) return c.json({ error: 'save_failed', reason: upErr.message }, 500);

  // 2) Load active master PRICE_1 bases (customer + supplier NULL, not deleted).
  const { data: rows, error: loadErr } = await supabase
    .from('sofa_combo_pricing')
    .select('id, base_model, modules, tier, customer_id, supplier_id, prices_by_height, selling_prices_by_height, label, effective_from, deleted_at, created_at')
    .eq('tier', 'PRICE_1')
    .is('customer_id', null)
    .is('supplier_id', null)
    .is('deleted_at', null)
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false });
  if (loadErr) return c.json({ error: 'load_failed', reason: loadErr.message }, 500);

  // Reduce to the active row per (base_model, modules) — newest effective ≤ today.
  const seen = new Set<string>();
  const bases: Row[] = [];
  for (const r of (rows ?? []) as unknown as Row[]) {
    if (r.effective_from > today) continue;
    const key = JSON.stringify([r.base_model, comboSlotsKey(r.modules ?? [])]);
    if (seen.has(key)) continue;
    seen.add(key);
    bases.push(r);
  }

  // 3) Build PRICE_2 + PRICE_3 inserts (selling = base + premium; cost copied).
  const inserts: Array<Record<string, unknown>> = [];
  let skipped = 0;
  for (const b of bases) {
    const baseSelling = b.selling_prices_by_height ?? {};
    if (!Object.values(baseSelling).some((v) => v !== null && v !== undefined)) { skipped++; continue; }
    for (const [tier, prem] of [['PRICE_2', p2], ['PRICE_3', p3]] as const) {
      inserts.push({
        base_model: b.base_model,
        modules: b.modules,
        tier,
        customer_id: null,
        supplier_id: null,
        prices_by_height: b.prices_by_height ?? {},
        selling_prices_by_height: comboTierPrices(baseSelling, prem),
        label: b.label,
        effective_from: today,
        notes: 'auto: Price 1 + tier premium',
        created_by: user.id,
      });
    }
  }

  if (inserts.length > 0) {
    const { error: insErr } = await supabase.from('sofa_combo_pricing').insert(inserts);
    if (insErr) return c.json({ error: 'insert_failed', reason: insErr.message }, 500);
  }

  return c.json({ generated: inserts.length, p1Count: bases.length, skipped });
});
```

- [ ] **Step 4: Typecheck the API**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS. (`comboTierPrices`, `comboSlotsKey`, `Row`, `requireWriteRole`, `todayIso` all already in scope / imported.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/sofa-combos.ts
git commit -m "feat(sofa): /sofa-combos tier-premiums read + apply sweep"
```

---

## Task 4: POS query hooks

**Files:**
- Modify: `apps/pos/src/lib/products/sofa-combos-queries.ts`

- [ ] **Step 1: Add the hooks** — append to `sofa-combos-queries.ts` (the file already imports `useMutation, useQuery, useQueryClient` and defines `authedFetch`):

```ts
export type SofaComboTierPremiums = {
  p2PremiumSen: number;
  p3PremiumSen: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

/** The two global flat premiums (sen) for combo Price 2 / Price 3. */
export function useSofaComboTierPremiums() {
  return useQuery({
    queryKey: ['sofa-combo-tier-premiums'],
    queryFn: () => authedFetch<SofaComboTierPremiums>('/sofa-combos/tier-premiums'),
    staleTime: 30_000,
  });
}

/** Persist the premiums + (re)generate every Price-1 combo's Price 2 / Price 3. */
export function useApplySofaComboTierPremiums() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { p2PremiumSen: number; p3PremiumSen: number }) =>
      authedFetch<{ generated: number; p1Count: number; skipped: number }>(
        '/sofa-combos/tier-premiums/apply',
        { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sofa-combos'] });
      qc.invalidateQueries({ queryKey: ['sofa-combo-tier-premiums'] });
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/lib/products/sofa-combos-queries.ts
git commit -m "feat(sofa): POS hooks for combo tier-premiums read + apply"
```

---

## Task 5: POS UI — button + panel

**Files:**
- Modify: `apps/pos/src/components/products/SofaComboTab.tsx`

- [ ] **Step 1: Extend imports** — at the top of `SofaComboTab.tsx`:
  - Add `useEffect` to the React import: `import { useEffect, useMemo, useState, type CSSProperties } from 'react';`
  - Add `SlidersHorizontal` to the lucide import: `import { Plus, Pencil, Trash2, History, X, SlidersHorizontal } from 'lucide-react';`
  - Add the two new hooks to the queries import block (`from '../../lib/products/sofa-combos-queries'`): `useSofaComboTierPremiums, useApplySofaComboTierPremiums,`

- [ ] **Step 2: Add panel open-state + Price-1 count** — inside `SofaComboTab`, next to the existing `composer`/`historyFor` state:

```tsx
  const [tierPanelOpen, setTierPanelOpen] = useState(false);
  const p1Count = useMemo(
    () => (combosQ.data ?? []).filter((r) => r.tier === 'PRICE_1').length,
    [combosQ.data],
  );
```

- [ ] **Step 3: Add the header button** — in the header actions, replace the existing `{canAdd && (<Button …New Combo…/>)}` block with a flex row that adds the Overall-Edit button (gated on `canEdit`, the full-mode admin):

```tsx
        <div style={{ display: 'flex', gap: 8 }}>
          {canEdit && (
            <Button variant="ghost" onClick={() => setTierPanelOpen(true)}>
              <SlidersHorizontal {...ICON_PROPS} style={{ marginRight: 6 }} /> Overall Edit price tier
            </Button>
          )}
          {canAdd && (
            <Button variant="primary" onClick={() => setComposer({ open: true })}>
              <Plus {...ICON_PROPS} style={{ marginRight: 6 }} /> New Combo
            </Button>
          )}
        </div>
```

- [ ] **Step 4: Render the panel** — next to the existing `{composer.open && (…)}` and `{historyFor && (…)}` blocks at the end of the component's JSX:

```tsx
      {tierPanelOpen && (
        <TierPremiumModal p1Count={p1Count} onClose={() => setTierPanelOpen(false)} />
      )}
```

- [ ] **Step 5: Add the `TierPremiumModal` component** — define it after `ComposerModal` (and before the "Small primitives" section):

```tsx
// ─── Overall Edit price tier (P1 base + global P2/P3 premiums) ─────────

function TierPremiumModal({ p1Count, onClose }: { p1Count: number; onClose: () => void }) {
  const premiumsQ = useSofaComboTierPremiums();
  const applyM = useApplySofaComboTierPremiums();
  const [p2, setP2] = useState('');
  const [p3, setP3] = useState('');

  // Pre-fill once the saved premiums load (RM = sen / 100).
  useEffect(() => {
    if (premiumsQ.data) {
      setP2(String(premiumsQ.data.p2PremiumSen / 100));
      setP3(String(premiumsQ.data.p3PremiumSen / 100));
    }
  }, [premiumsQ.data]);

  const apply = async () => {
    const p2n = Number(p2 || '0');
    const p3n = Number(p3 || '0');
    if (!Number.isFinite(p2n) || p2n < 0 || !Number.isFinite(p3n) || p3n < 0) {
      return alert('Premiums must be ≥ 0.');
    }
    if (!confirm(
      `This will (re)generate Price 2 & Price 3 for ${p1Count} Price-1 combo${p1Count === 1 ? '' : 's'}, ` +
      `overwriting any manual edits. Continue?`,
    )) return;
    try {
      const res = await applyM.mutateAsync({
        p2PremiumSen: Math.round(p2n * 100),
        p3PremiumSen: Math.round(p3n * 100),
      });
      alert(
        `Generated Price 2 / Price 3 for ${res.p1Count} Price-1 combo(s) ` +
        `(${res.generated} rows${res.skipped ? `, skipped ${res.skipped} with no price` : ''}).`,
      );
      onClose();
    } catch (e) {
      alert(`Apply failed: ${String(e)}`);
    }
  };

  return (
    <ModalShell title="Overall Edit price tier" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{
          fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)',
          color: 'var(--fg-soft)', margin: 0,
        }}>
          Set how much Price 2 and Price 3 sit above each combo's <strong>Price 1</strong>.
          Applies to every combo and every seat height. Clicking Apply regenerates
          Price 2 / Price 3 and overwrites any manual edits.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Price 2 = Price 1 + RM">
            <input type="number" step="1" min="0" value={p2}
              onChange={(e) => setP2(e.target.value)} placeholder="0"
              style={{ ...inputStyle, textAlign: 'right', fontFamily: 'var(--font-mono)' }} />
          </Field>
          <Field label="Price 3 = Price 1 + RM">
            <input type="number" step="1" min="0" value={p3}
              onChange={(e) => setP3(e.target.value)} placeholder="0"
              style={{ ...inputStyle, textAlign: 'right', fontFamily: 'var(--font-mono)' }} />
          </Field>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply} disabled={applyM.isPending || premiumsQ.isLoading}>
            {applyM.isPending ? 'Applying…' : 'Apply'}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
```

- [ ] **Step 6: Typecheck + build the POS app**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.
Run: `pnpm --filter @2990s/pos build`
Expected: Vite build succeeds (no type/import errors).

- [ ] **Step 7: Commit**

```bash
git add apps/pos/src/components/products/SofaComboTab.tsx
git commit -m "feat(sofa): Combo tab Overall Edit price tier panel (P1 + global premiums)"
```

---

## Task 6: Full verification + prod migration

**Files:** none (verification + gated deploy step).

- [ ] **Step 1: Whole-repo gates**

Run: `pnpm typecheck`
Expected: PASS (all packages).
Run: `pnpm test`
Expected: PASS (includes the new `comboTierPrices` cases; existing combo + pricing tests unchanged).

- [ ] **Step 2: Apply migration `0124` to PROD — REQUIRES explicit Chairman "go"**

This is a new additive table (no data risk), but per project practice migrations land on prod **before** deploy and are verified. Apply via the Supabase migration tool, then verify the seeded singleton:

```sql
SELECT id, p2_premium_sen, p3_premium_sen FROM sofa_combo_tier_offsets;
-- expect exactly one row: (1, 0, 0)
```

Do NOT run this without the Chairman's explicit confirmation in the session.

- [ ] **Step 3: Manual e2e (evidence for the Chairman)**

1. POS → log in as Master Admin → Products → Combo Pricing. Confirm **"Overall Edit price tier"** button is visible.
2. Ensure ≥1 combo exists at **Price 1** (create one if needed).
3. Open the panel → it pre-fills (0/0 first time). Set Price 2 `+50`, Price 3 `+120` → Apply → confirm toast count.
4. Confirm new **PRICE_2** card = P1 + 50 and **PRICE_3** card = P1 + 120 at every seat height the P1 combo had a price for.
5. Manually edit one generated PRICE_2 card → re-open panel → Apply again → confirm the card reverts to P1 + 50 (overwrite), and the manual value still shows in **History**.
6. Log in as a sales role → confirm the button is **absent**.

Capture: `pnpm test` output + screenshots of steps 1, 4, 5.

---

## Self-review notes (author)

- **Spec coverage:** success criteria 1–2 → Task 5; #3 → Tasks 1+3+5; #4 (overwrite) → Task 3 append-only insert + Task 6 step 5; #5 (persist) → Task 2+3; #6 (engine untouched) → no engine files modified, asserted in Task 6; #7 (gates) → Tasks 1/6.
- **No placeholders:** every code step is complete; no TBD/TODO.
- **Type consistency:** `comboTierPrices(baseSelling, premiumSen)` signature identical across shared/api; `p2PremiumSen`/`p3PremiumSen` names identical across api/hooks/UI; query keys `['sofa-combos']` + `['sofa-combo-tier-premiums']` consistent.
- **Out of scope (unchanged):** `Configurator.tsx` fabric→tier wiring (Phase B); per-module grid (#7).
