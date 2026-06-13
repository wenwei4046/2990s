# Default Free Gift (Accessory) + PWP/Promo Card Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a qualifying product (mattress/bedframe/accessory) or a matched sofa **combo** auto-add one or more **accessory** gifts at **RM 0** (optional campaign label) into the POS cart, surviving to the Sales Order with server-validated pricing; plus give the PWP & Promo rule cards a real surface so they stop blending into the cream.

**Architecture:** Gift config is stored per-trigger (`mfg_products.default_free_gifts` for non-sofa triggers, `sofa_combo_pricing.default_free_gifts` for sofa triggers — D9 matches by combo). Eligibility/diff logic lives in a pure, unit-tested module `packages/shared/src/free-gift.ts` shared by the POS cart reconciler (`free-gift-sync.ts`, a local effect — **no voucher codes**) and the server SO-create validator. A gift cart line is a `FlatConfigSnapshot` with `total: 0` + `isFreeGift` markers; on the SO it rides `variants.freeGift` and the server grants base `0` through the existing `pwpBaseSen` path (so a tampered RM 0 line without a real trigger is rejected). An accessory never violates sofa-exclusivity and is never a cross-category deliverable, so there is no SO split and no delivery-fee change.

**Tech Stack:** pnpm + Turborepo monorepo; Vite 6 + React 19 (POS); Hono 4 on CF Workers (API); Drizzle + Supabase Postgres; Zustand 5 + TanStack Query 5; vitest; CSS Modules + design-system tokens.

---

## Pre-flight (already done this session)

- ✅ Worktree fast-forwarded to `origin/main` (#597). Highest migration on disk: `0169_drop_pos_product_remark_setting` → **next number is `0170`**.
- Design spec: `docs/superpowers/specs/2026-06-13-default-free-gift-and-pwp-card-polish-design.md` (v3).

Run the quality gates from the worktree root: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`. The build guard rejects a localhost `VITE_API_URL`; if a local build is needed use `ALLOW_LOCAL_API_URL=1 pnpm build` (memory).

---

## File map

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `apps/pos/src/components/products/PwpRulesTab.tsx` | Modify | Card polish (paper surface + labelled Trigger→Reward). |
| `packages/db/migrations/0170_default_free_gift.sql` | Create | Add `default_free_gifts` to `mfg_products` + `sofa_combo_pricing`. |
| `packages/db/src/schema.ts` | Modify | Drizzle columns for the two new fields. |
| `packages/shared/src/free-gift.ts` | Create | Pure types + eligibility/diff functions (the brains). |
| `packages/shared/src/free-gift.test.ts` | Create | Unit tests for the pure functions. |
| `packages/shared/src/index.ts` | Modify | Export the new module. |
| `apps/api/src/routes/mfg-products.ts` | Modify | Accept `defaultFreeGifts` on `PATCH /:id`. |
| `apps/api/src/routes/sofa-combos.ts` | Modify | Accept `defaultFreeGifts` on `PUT /:id` (+ return it). |
| `apps/api/src/routes/mfg-sales-orders.ts` | Modify | Validate gift lines, grant base 0, `409 free_gift_not_eligible`. |
| `apps/pos/src/lib/products/mfg-products-queries.ts` | Modify | `MfgProductRow.default_free_gifts` + `useUpdateMfgProductDefaultGifts`. |
| `apps/pos/src/lib/products/sofa-combos-queries.ts` | Modify | `SofaComboRule.defaultFreeGifts` + thread through `useUpdateSofaCombo`. |
| `apps/pos/src/state/cart.ts` | Modify | `isFreeGift` markers + `reconcileFreeGifts` action. |
| `apps/pos/src/state/cart.test.ts` | Create/Modify | Test `reconcileFreeGifts`. |
| `apps/pos/src/lib/free-gift-sync.ts` | Create | Local reconciler hook + `<FreeGiftSync/>`. |
| `apps/pos/src/main.tsx` | Modify | Mount `<FreeGiftSync/>`. |
| `apps/pos/src/components/CartContents.tsx` | Modify | "Free · campaign" sub-line + disable gift qty stepper + price. |
| `apps/pos/src/components/handover/OrderSummaryPane.tsx` | Modify | "Free · campaign" sub-line. |
| `apps/pos/src/lib/pos-handover-so.ts` | Modify | Attach `variants.freeGift`; itemGroup accessory; unit 0. |
| `apps/pos/src/pages/Products.tsx` | Modify | Replace `ProductGiftsDrawer` with the Default Free Gift editor; add Combo Pricing gift section. |
| `apps/pos/src/pages/Configurator.tsx` | Modify | Retire the "Pillows · included free" rail. |

---

## Task 1: PWP & Promo card polish

**Files:**
- Modify: `apps/pos/src/components/products/PwpRulesTab.tsx:328-366`

This is a visual change (no unit test); verify by typecheck + build + eyeballing. All styling in this file is inline `CSSProperties` with design tokens (no CSS module).

- [ ] **Step 1: Replace the card render block**

Current (verbatim):

```tsx
                  {group.map((r) => (
                    <div key={r.id} style={{ border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', opacity: r.active ? 1 : 0.55 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', fontSize: 'var(--fs-14)' }}>
                          <span style={{ fontWeight: 600 }}>{itemSummary(r.triggerCategory === 'SOFA' ? r.triggerComboIds : r.triggerEligibleModelIds, r.triggerCategory)}</span>
                          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>({catLabel(r.triggerCategory)})</span>
                          <ArrowRight {...ICON} />
                          <span style={{ fontWeight: 600 }}>{itemSummary(r.rewardCategory === 'SOFA' ? r.rewardComboIds : r.eligibleRewardModelIds, r.rewardCategory)}</span>
                          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>({catLabel(r.rewardCategory)})</span>
                        </div>
                        <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginTop: 'var(--space-1)' }}>
                          Ratio 1 : {r.qtyPerTrigger}{r.active ? '' : ' · inactive'}
                        </div>
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
                          <button type="button" aria-label="Edit rule" title="Edit" onClick={() => openEdit(r)} style={{ background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', cursor: 'pointer', color: 'var(--c-ink)' }}>
                            <Pencil {...ICON} />
                          </button>
                          <button type="button" aria-label="Delete rule" title="Delete" disabled={busy} onClick={() => void onDelete(r.id)} style={{ background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', cursor: 'pointer', color: 'var(--c-burnt, #A6471E)' }}>
                            <Trash2 {...ICON} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
```

Replace with (paper surface + soft shadow + eyebrow + labelled Trigger→Reward rows; `kind` is in scope from the enclosing `.map((kind) => ...)`):

```tsx
                  {group.map((r) => (
                    <div key={r.id} style={{ background: 'var(--c-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-2)', padding: 'var(--space-4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', opacity: r.active ? 1 : 0.55 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 'var(--fs-12)', fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-2)' }}>
                          {kind === 'promo' ? 'Promo · redeem free' : 'PWP · redeem at a set price'}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                          <div style={{ fontSize: 'var(--fs-13)' }}>
                            <span style={{ color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', fontSize: 'var(--fs-12)' }}>Trigger · {catLabel(r.triggerCategory)}</span>
                            <div style={{ fontWeight: 600, fontSize: 'var(--fs-14)' }}>{itemSummary(r.triggerCategory === 'SOFA' ? r.triggerComboIds : r.triggerEligibleModelIds, r.triggerCategory)}</div>
                          </div>
                          <ArrowDown size={14} strokeWidth={1.75} style={{ color: 'var(--fg-muted)' }} />
                          <div style={{ fontSize: 'var(--fs-13)' }}>
                            <span style={{ color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', fontSize: 'var(--fs-12)' }}>Reward · {catLabel(r.rewardCategory)}</span>
                            <div style={{ fontWeight: 600, fontSize: 'var(--fs-14)' }}>{itemSummary(r.rewardCategory === 'SOFA' ? r.rewardComboIds : r.eligibleRewardModelIds, r.rewardCategory)}</div>
                          </div>
                        </div>
                        <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-soft)', marginTop: 'var(--space-3)' }}>
                          Ratio 1 : {r.qtyPerTrigger}{r.active ? '' : ' · inactive'}
                        </div>
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
                          <button type="button" aria-label="Edit rule" title="Edit" onClick={() => openEdit(r)} style={{ background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', cursor: 'pointer', color: 'var(--c-ink)' }}>
                            <Pencil {...ICON} />
                          </button>
                          <button type="button" aria-label="Delete rule" title="Delete" disabled={busy} onClick={() => void onDelete(r.id)} style={{ background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', cursor: 'pointer', color: 'var(--c-burnt, #A6471E)' }}>
                            <Trash2 {...ICON} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
```

- [ ] **Step 2: Add the `ArrowDown` import**

In the lucide import line (`import { Plus, Pencil, Trash2, ArrowRight } from 'lucide-react';`) add `ArrowDown`. `ArrowRight` is still used elsewhere — keep it. Result:

```tsx
import { Plus, Pencil, Trash2, ArrowRight, ArrowDown } from 'lucide-react';
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS. Then `ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos build` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/components/products/PwpRulesTab.tsx
git commit -m "feat(pos): give PWP & Promo rule cards a paper surface + labelled Trigger→Reward"
```

---

## Task 2: Migration 0170 — add `default_free_gifts` columns

**Files:**
- Create: `packages/db/migrations/0170_default_free_gift.sql`

- [ ] **Step 1: Re-confirm the next number is free**

Run: `ls packages/db/migrations | grep -E '^017' | sort`
Expected: no `0170_*` exists yet. (If a teammate landed one, bump to the next free number and use that everywhere below.)

- [ ] **Step 2: Write the migration file**

```sql
-- 0170_default_free_gift.sql
-- Default Free Gift (accessory). A qualifying trigger auto-grants accessory
-- gifts at RM 0 in the POS cart. Two homes for the gift config, matching where
-- a trigger's identity lives:
--   • mfg_products.default_free_gifts      — non-sofa triggers (mattress / bedframe / accessory), matched by product/model.
--   • sofa_combo_pricing.default_free_gifts — sofa triggers, matched BY COMBO (D9), never by compartment.
-- Entry shape: [{ "giftProductId": "<mfg_products.id of an ACCESSORY>", "qty": <int>=1>, "campaignName": "<text|null>" }]
-- The GIFT is always an accessory; only the TRIGGER may be a sofa combo.
-- Additive; IF NOT EXISTS guards a re-run / parallel-branch collision.
ALTER TABLE mfg_products       ADD COLUMN IF NOT EXISTS default_free_gifts jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sofa_combo_pricing ADD COLUMN IF NOT EXISTS default_free_gifts jsonb NOT NULL DEFAULT '[]'::jsonb;
```

- [ ] **Step 3: Apply to the live DB via Supabase MCP**

Use `apply_migration` with name `0170_default_free_gift` and the SQL above. Then verify the columns exist:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE (table_name = 'mfg_products' OR table_name = 'sofa_combo_pricing')
  AND column_name = 'default_free_gifts';
```
Expected: two rows, both `jsonb`, default `'[]'::jsonb`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/0170_default_free_gift.sql
git commit -m "feat(db): add default_free_gifts to mfg_products + sofa_combo_pricing (migration 0170)"
```

---

## Task 3: Drizzle columns + shared pure module (`free-gift.ts`) with tests

**Files:**
- Modify: `packages/db/src/schema.ts:1866` (mfgProducts) and `:1922` (sofaComboPricing)
- Create: `packages/shared/src/free-gift.ts`
- Create: `packages/shared/src/free-gift.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add Drizzle columns**

In `mfgProducts` (right after the `includedAddons` line) add:

```ts
  defaultFreeGifts:       jsonb('default_free_gifts').notNull().default([]), // 0170 — accessory free gifts ([{giftProductId, qty, campaignName?}]). Non-sofa trigger. Auto-added at RM 0 in POS cart; server grants base 0.
```

In `sofaComboPricing` (right after the `pwpPricesByHeight` line) add:

```ts
  defaultFreeGifts: jsonb('default_free_gifts').notNull().default([]),  // 0170 — accessory free gifts granted when this combo is the cart's sofa build (trigger by combo, D9).
```

- [ ] **Step 2: Write the failing test for the pure module**

Create `packages/shared/src/free-gift.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseDefaultFreeGifts,
  computeDesiredFreeGifts,
  validateFreeGiftClaims,
  freeGiftLineKey,
  type FreeGiftTrigger,
} from './free-gift';

describe('parseDefaultFreeGifts', () => {
  it('keeps well-formed entries and drops junk', () => {
    const out = parseDefaultFreeGifts([
      { giftProductId: 'mfg-p1', qty: 2, campaignName: 'Raya Campaign' },
      { giftProductId: 'mfg-p2', qty: 1 },
      { giftProductId: '', qty: 2 },           // empty id → dropped
      { giftProductId: 'mfg-p3', qty: 0 },      // qty < 1 → dropped
      { nope: true },                           // shapeless → dropped
    ]);
    expect(out).toEqual([
      { giftProductId: 'mfg-p1', qty: 2, campaignName: 'Raya Campaign' },
      { giftProductId: 'mfg-p2', qty: 1, campaignName: null },
    ]);
  });
  it('returns [] for non-arrays', () => {
    expect(parseDefaultFreeGifts(null)).toEqual([]);
    expect(parseDefaultFreeGifts('x')).toEqual([]);
  });
});

describe('computeDesiredFreeGifts', () => {
  it('scales gift qty by trigger qty and keys per (trigger, entry)', () => {
    const triggers: FreeGiftTrigger[] = [
      { triggerKey: 'cfg-mat', triggerRef: 'mfg-mat', triggerKind: 'product', triggerQty: 2,
        gifts: [
          { giftProductId: 'mfg-pillow', qty: 2, campaignName: 'Raya Campaign' },
          { giftProductId: 'mfg-bolster', qty: 1, campaignName: null },
        ] },
    ];
    const desired = computeDesiredFreeGifts(triggers);
    expect(desired).toEqual([
      { key: freeGiftLineKey('cfg-mat', 0), triggerKey: 'cfg-mat', giftProductId: 'mfg-pillow', qty: 4, campaignName: 'Raya Campaign' },
      { key: freeGiftLineKey('cfg-mat', 1), triggerKey: 'cfg-mat', giftProductId: 'mfg-bolster', qty: 2, campaignName: null },
    ]);
  });
  it('ignores triggers with no gifts', () => {
    expect(computeDesiredFreeGifts([
      { triggerKey: 'k', triggerRef: 'r', triggerKind: 'product', triggerQty: 1, gifts: [] },
    ])).toEqual([]);
  });
});

describe('validateFreeGiftClaims', () => {
  const triggers: FreeGiftTrigger[] = [
    { triggerKey: 't0', triggerRef: 'mfg-mat', triggerKind: 'product', triggerQty: 2,
      gifts: [{ giftProductId: 'mfg-pillow', qty: 2, campaignName: 'Raya Campaign' }] }, // allows up to 4 pillows
  ];
  it('accepts a claim within the allowance', () => {
    const res = validateFreeGiftClaims([{ idx: 5, giftProductId: 'mfg-pillow', qty: 4 }], triggers);
    expect(res.rejected).toEqual([]);
    expect(res.valid).toEqual([5]);
  });
  it('rejects an over-claim', () => {
    const res = validateFreeGiftClaims([{ idx: 5, giftProductId: 'mfg-pillow', qty: 5 }], triggers);
    expect(res.valid).toEqual([]);
    expect(res.rejected[0]).toMatchObject({ idx: 5, giftProductId: 'mfg-pillow', reason: 'qty_exceeds_allowance' });
  });
  it('rejects a gift with no matching trigger', () => {
    const res = validateFreeGiftClaims([{ idx: 1, giftProductId: 'mfg-ghost', qty: 1 }], triggers);
    expect(res.valid).toEqual([]);
    expect(res.rejected[0]).toMatchObject({ idx: 1, reason: 'no_trigger' });
  });
  it('pools allowance across multiple triggers and lines for the same gift', () => {
    const two: FreeGiftTrigger[] = [
      { triggerKey: 't0', triggerRef: 'a', triggerKind: 'product', triggerQty: 1, gifts: [{ giftProductId: 'g', qty: 1, campaignName: null }] },
      { triggerKey: 't1', triggerRef: 'b', triggerKind: 'product', triggerQty: 1, gifts: [{ giftProductId: 'g', qty: 1, campaignName: null }] },
    ];
    const res = validateFreeGiftClaims(
      [{ idx: 0, giftProductId: 'g', qty: 1 }, { idx: 1, giftProductId: 'g', qty: 1 }],
      two,
    );
    expect(res.rejected).toEqual([]);
    expect(res.valid.sort()).toEqual([0, 1]);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm --filter @2990s/shared test free-gift`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the pure module**

Create `packages/shared/src/free-gift.ts`:

```ts
// Default Free Gift (accessory) — pure, shared by the POS cart reconciler and
// the server SO-create validator. NO voucher codes: a gift is deterministic
// from the trigger's configured `default_free_gifts`. The GIFT is always an
// accessory; the TRIGGER may be a product (matched by id/model) or a sofa combo
// (matched by combo, D9). One gift set per qualifying item (qty scales).

export interface DefaultFreeGift {
  /** mfg_products.id of an ACCESSORY product (the gift). */
  giftProductId: string;
  /** count PER qualifying trigger unit (>= 1). */
  qty: number;
  /** free-text; null/blank => the line shows "Free gift". */
  campaignName?: string | null;
}

/** A trigger present in the cart/order, with the gifts it grants. */
export interface FreeGiftTrigger {
  /** cart line key (client) or a stable per-line ref (server). */
  triggerKey: string;
  /** product id ('product') or combo id ('combo'). */
  triggerRef: string;
  triggerKind: 'product' | 'combo';
  /** the trigger LINE's qty (gift qty scales by this). */
  triggerQty: number;
  gifts: DefaultFreeGift[];
}

/** A gift line the cart SHOULD contain. */
export interface DesiredFreeGift {
  key: string;
  triggerKey: string;
  giftProductId: string;
  qty: number;
  campaignName: string | null;
}

/** A gift line the order DOES contain (server side), to validate. */
export interface FreeGiftLineClaim {
  idx: number;
  giftProductId: string;
  qty: number;
}

export interface FreeGiftRejection {
  idx: number;
  giftProductId: string;
  reason: 'no_trigger' | 'qty_exceeds_allowance';
}

/** Deterministic cart-line key so the reconciler can find/replace a gift line. */
export const freeGiftLineKey = (triggerKey: string, entryIndex: number): string =>
  `gift-${triggerKey}-${entryIndex}`;

/** Coerce raw jsonb into clean DefaultFreeGift[] (drops malformed entries). */
export function parseDefaultFreeGifts(raw: unknown): DefaultFreeGift[] {
  if (!Array.isArray(raw)) return [];
  const out: DefaultFreeGift[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const giftProductId = typeof r.giftProductId === 'string' ? r.giftProductId.trim() : '';
    const qty = typeof r.qty === 'number' ? Math.floor(r.qty) : NaN;
    if (!giftProductId || !Number.isFinite(qty) || qty < 1) continue;
    const campaignName =
      typeof r.campaignName === 'string' && r.campaignName.trim() !== '' ? r.campaignName.trim() : null;
    out.push({ giftProductId, qty, campaignName });
  }
  return out;
}

/** The gift lines the cart should contain, scaled by each trigger's qty. */
export function computeDesiredFreeGifts(triggers: FreeGiftTrigger[]): DesiredFreeGift[] {
  const desired: DesiredFreeGift[] = [];
  for (const t of triggers) {
    t.gifts.forEach((g, i) => {
      desired.push({
        key: freeGiftLineKey(t.triggerKey, i),
        triggerKey: t.triggerKey,
        giftProductId: g.giftProductId,
        qty: Math.max(1, g.qty) * Math.max(1, t.triggerQty),
        campaignName: g.campaignName ?? null,
      });
    });
  }
  return desired;
}

/**
 * Server-side eligibility. Each claimed gift line must be covered by the order's
 * triggers: the gift product must be granted by some trigger, and the TOTAL
 * claimed qty for a gift product must not exceed the SUM of allowances
 * (Σ entry.qty × trigger.qty) across all triggers that grant it.
 */
export function validateFreeGiftClaims(
  claims: FreeGiftLineClaim[],
  triggers: FreeGiftTrigger[],
): { valid: number[]; rejected: FreeGiftRejection[] } {
  const allowance = new Map<string, number>();
  for (const t of triggers) {
    for (const g of t.gifts) {
      const cur = allowance.get(g.giftProductId) ?? 0;
      allowance.set(g.giftProductId, cur + Math.max(1, g.qty) * Math.max(1, t.triggerQty));
    }
  }
  const valid: number[] = [];
  const rejected: FreeGiftRejection[] = [];
  const remaining = new Map(allowance);
  for (const claim of claims) {
    if (!allowance.has(claim.giftProductId)) {
      rejected.push({ idx: claim.idx, giftProductId: claim.giftProductId, reason: 'no_trigger' });
      continue;
    }
    const left = remaining.get(claim.giftProductId) ?? 0;
    if (claim.qty > left) {
      rejected.push({ idx: claim.idx, giftProductId: claim.giftProductId, reason: 'qty_exceeds_allowance' });
      continue;
    }
    remaining.set(claim.giftProductId, left - claim.qty);
    valid.push(claim.idx);
  }
  return { valid, rejected };
}
```

- [ ] **Step 5: Export it**

In `packages/shared/src/index.ts` add (match existing export style in that file):

```ts
export * from './free-gift';
```

- [ ] **Step 6: Run tests to confirm pass + typecheck**

Run: `pnpm --filter @2990s/shared test free-gift` → PASS (all cases).
Run: `pnpm --filter @2990s/db typecheck && pnpm --filter @2990s/shared typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/shared/src/free-gift.ts packages/shared/src/free-gift.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): default-free-gift pure module (parse/desired/validate) + drizzle columns"
```

---

## Task 4: API — accept `defaultFreeGifts` on product + combo writes

**Files:**
- Modify: `apps/api/src/routes/mfg-products.ts:365-404` (body type) and `:468-471` (write)
- Modify: `apps/api/src/routes/sofa-combos.ts` (PUT body + rowToWire)

- [ ] **Step 1: Extend the `PATCH /mfg-products/:id` body type**

In the `let body: { ... }` type, after the `includedAddons?: Array<{ addonId: string; qty: number }>;` line add:

```ts
    /** 0170 — Default Free Gift (accessory). [{giftProductId, qty, campaignName?}]. */
    defaultFreeGifts?: Array<{ giftProductId: string; qty: number; campaignName?: string | null }>;
```

- [ ] **Step 2: Persist it (reuse the shared parser for safety)**

At the top of the file, add to the `@2990s/shared` import: `parseDefaultFreeGifts`. Then, right after the `if (Array.isArray(body.includedAddons)) { updates.included_addons = body.includedAddons; }` block, add:

```ts
  // 0170 — Default Free Gift (accessory). Coerce via the shared parser so a
  // malformed entry can never poison the column.
  if (Array.isArray(body.defaultFreeGifts)) {
    updates.default_free_gifts = parseDefaultFreeGifts(body.defaultFreeGifts);
  }
```

- [ ] **Step 3: Thread `defaultFreeGifts` through `PUT /sofa-combos/:id`**

Open `apps/api/src/routes/sofa-combos.ts`. Find the `PUT /:id` handler and its body parsing (it already accepts `sellingPricesByHeight` / `pwpPricesByHeight`). Add `defaultFreeGifts` to the body type and, where the row is built for the INSERT (append-only history), include:

```ts
    default_free_gifts: Array.isArray(body.defaultFreeGifts)
      ? parseDefaultFreeGifts(body.defaultFreeGifts)
      : (prev?.default_free_gifts ?? []),
```

(`prev` = the latest existing combo row this PUT supersedes; carry the value forward when the field is absent, exactly like the price-by-height fields. Import `parseDefaultFreeGifts` from `@2990s/shared`.) Also include `default_free_gifts` in `rowToWire` so the API returns it as `defaultFreeGifts`.

- [ ] **Step 4: Typecheck the API**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/mfg-products.ts apps/api/src/routes/sofa-combos.ts
git commit -m "feat(api): accept defaultFreeGifts on mfg-products PATCH + sofa-combos PUT"
```

---

## Task 5: POS query layer — types + mutation

**Files:**
- Modify: `apps/pos/src/lib/products/mfg-products-queries.ts:98` (type) and `:338-352` (mutation)
- Modify: `apps/pos/src/lib/products/sofa-combos-queries.ts:36-58` (type) and `:140-169` (mutation)

- [ ] **Step 1: Add the field to `MfgProductRow`**

After `included_addons: { addonId: string; qty: number }[];` add:

```ts
  default_free_gifts: { giftProductId: string; qty: number; campaignName?: string | null }[]; // 0170 — accessory free gifts (auto-added at RM 0)
```

- [ ] **Step 2: Add the product-gift mutation**

After `useUpdateMfgProductGifts` add:

```ts
/** 0170 — Default Free Gift (accessory). Writes mfg_products.default_free_gifts
 *  ([{giftProductId, qty, campaignName?}]). POS auto-adds the gift at RM 0. */
export function useUpdateMfgProductDefaultGifts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      defaultFreeGifts: { giftProductId: string; qty: number; campaignName?: string | null }[];
    }) => {
      const { id, defaultFreeGifts } = args;
      return authedFetch<{ ok: boolean; changed: number }>(`/mfg-products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ defaultFreeGifts }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mfg-products'] });
    },
  });
}
```

- [ ] **Step 3: Add the field to `SofaComboRule` + thread `useUpdateSofaCombo`**

In `SofaComboRule` (after `pwpPricesByHeight?`) add:

```ts
  /** 0170 — accessory free gifts granted when this combo is the cart's sofa build (trigger by combo, D9). */
  defaultFreeGifts?: { giftProductId: string; qty: number; campaignName?: string | null }[];
```

In `useUpdateSofaCombo`'s `mutationFn` args type add `defaultFreeGifts?: { giftProductId: string; qty: number; campaignName?: string | null }[];`, and in the `JSON.stringify({...})` body add `...(defaultFreeGifts !== undefined ? { defaultFreeGifts } : {})`.

- [ ] **Step 4: Typecheck POS**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS (no consumers yet).

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/lib/products/mfg-products-queries.ts apps/pos/src/lib/products/sofa-combos-queries.ts
git commit -m "feat(pos): query types + mutation for default_free_gifts (product + combo)"
```

---

## Task 6: Cart store — gift markers + `reconcileFreeGifts` action (TDD)

**Files:**
- Modify: `apps/pos/src/state/cart.ts`
- Create/Modify: `apps/pos/src/state/cart.test.ts`

- [ ] **Step 1: Add marker fields to `FlatConfigSnapshot`**

Replace the current `FlatConfigSnapshot` (lines 115-125) with:

```ts
export interface FlatConfigSnapshot {
  kind: 'flat';
  productId: string;
  productName: string;
  category?: string;
  // 0170 — Default Free Gift markers. A gift line is a flat line at total 0,
  // its qty derived by the reconciler (entry.qty × trigger.qty), linked to its
  // trigger by freeGiftTriggerKey so removing the trigger removes the gift.
  isFreeGift?: boolean;
  freeGiftTriggerKey?: string;
  freeGiftCampaign?: string | null;
  total: number;
  summary: string;
}
```

- [ ] **Step 2: Add the store action type**

Find the store's state/actions interface (the `type` passed to `create<...>()`) and add to the actions, next to `revertPwp`:

```ts
  /** 0170 — make the cart's free-gift lines match `desired` (add/update/remove). */
  reconcileFreeGifts(desired: import('@2990s/shared').DesiredFreeGift[], nameById: Map<string, string>): void;
```

- [ ] **Step 3: Write the failing test**

In `apps/pos/src/state/cart.test.ts` (create if absent; mirror existing cart tests — reset the store between cases), add:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCart } from './cart';
import { freeGiftLineKey, type DesiredFreeGift } from '@2990s/shared';

const reset = () => useCart.setState({ lines: [] });

describe('reconcileFreeGifts', () => {
  beforeEach(reset);

  const nameById = new Map([['mfg-pillow', 'Memory Pillow']]);

  it('adds a gift line at RM 0 with the campaign + derived qty', () => {
    const desired: DesiredFreeGift[] = [
      { key: freeGiftLineKey('t0', 0), triggerKey: 't0', giftProductId: 'mfg-pillow', qty: 4, campaignName: 'Raya Campaign' },
    ];
    useCart.getState().reconcileFreeGifts(desired, nameById);
    const lines = useCart.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0].key).toBe(freeGiftLineKey('t0', 0));
    expect(lines[0].qty).toBe(4);
    const cfg = lines[0].config as { isFreeGift?: boolean; total: number; freeGiftCampaign?: string | null; productId: string };
    expect(cfg.isFreeGift).toBe(true);
    expect(cfg.total).toBe(0);
    expect(cfg.freeGiftCampaign).toBe('Raya Campaign');
    expect(cfg.productId).toBe('mfg-pillow');
  });

  it('updates qty when the desired qty changes', () => {
    const mk = (qty: number): DesiredFreeGift[] => [
      { key: freeGiftLineKey('t0', 0), triggerKey: 't0', giftProductId: 'mfg-pillow', qty, campaignName: null },
    ];
    useCart.getState().reconcileFreeGifts(mk(2), nameById);
    useCart.getState().reconcileFreeGifts(mk(6), nameById);
    expect(useCart.getState().lines).toHaveLength(1);
    expect(useCart.getState().lines[0].qty).toBe(6);
  });

  it('removes a gift line whose trigger no longer desires it', () => {
    useCart.getState().reconcileFreeGifts(
      [{ key: freeGiftLineKey('t0', 0), triggerKey: 't0', giftProductId: 'mfg-pillow', qty: 2, campaignName: null }],
      nameById,
    );
    useCart.getState().reconcileFreeGifts([], nameById);
    expect(useCart.getState().lines).toHaveLength(0);
  });

  it('never touches non-gift lines', () => {
    useCart.setState({ lines: [{ key: 'cfg-x', qty: 1, config: { kind: 'flat', productId: 'mfg-mat', productName: 'Mat', total: 1990, summary: 'Flat price' } }] });
    useCart.getState().reconcileFreeGifts(
      [{ key: freeGiftLineKey('cfg-x', 0), triggerKey: 'cfg-x', giftProductId: 'mfg-pillow', qty: 1, campaignName: null }],
      nameById,
    );
    const lines = useCart.getState().lines;
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.key === 'cfg-x')!.config.total).toBe(1990);
  });
});
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `pnpm --filter @2990s/pos test cart`
Expected: FAIL (`reconcileFreeGifts` is not a function).

- [ ] **Step 5: Implement the action**

Add the import at the top of `cart.ts`:

```ts
import type { DesiredFreeGift } from '@2990s/shared';
```

Add the action inside the store object (next to `revertPwp`):

```ts
  reconcileFreeGifts(desired, nameById) {
    const want = new Map(desired.map((d) => [d.key, d]));
    const current = get().lines;
    const isGift = (l: { config: CartConfig }) =>
      (l.config as { isFreeGift?: boolean }).isFreeGift === true;

    // Keep non-gift lines untouched; update gift lines that are still wanted;
    // drop gift lines no longer wanted.
    const kept = current.flatMap((l) => {
      if (!isGift(l)) return [l];
      const d = want.get(l.key);
      if (!d) return [];                       // trigger gone → remove
      want.delete(l.key);                      // mark as satisfied
      const cfg = l.config as FlatConfigSnapshot;
      return [{ ...l, qty: d.qty, config: { ...cfg, productName: nameById.get(d.giftProductId) ?? cfg.productName, freeGiftCampaign: d.campaignName, total: 0 } }];
    });

    // Add any still-wanted gift lines that weren't already present.
    const added = [...want.values()].map((d) => ({
      key: d.key,
      qty: d.qty,
      config: {
        kind: 'flat' as const,
        productId: d.giftProductId,
        productName: nameById.get(d.giftProductId) ?? d.giftProductId,
        category: 'ACCESSORY',
        isFreeGift: true,
        freeGiftTriggerKey: d.triggerKey,
        freeGiftCampaign: d.campaignName,
        total: 0,
        summary: 'Free gift',
      } satisfies FlatConfigSnapshot,
    }));

    set({ lines: [...kept, ...added] });
  },
```

- [ ] **Step 6: Run tests to confirm pass**

Run: `pnpm --filter @2990s/pos test cart`
Expected: PASS (all `reconcileFreeGifts` cases).

- [ ] **Step 7: Commit**

```bash
git add apps/pos/src/state/cart.ts apps/pos/src/state/cart.test.ts
git commit -m "feat(pos): cart reconcileFreeGifts action + flat-line gift markers"
```

---

## Task 7: `free-gift-sync.ts` reconciler hook + mount

**Files:**
- Create: `apps/pos/src/lib/free-gift-sync.ts`
- Modify: `apps/pos/src/main.tsx:49`

The hook reads cart lines + the product catalog (for triggers' `default_free_gifts` and the gift accessory names) + sofa combos (for sofa-combo triggers, D9), computes the desired gift set via the shared pure function, and calls `reconcileFreeGifts`. It is a **local** effect — no server round-trip.

- [ ] **Step 1: Implement the hook**

Create `apps/pos/src/lib/free-gift-sync.ts`:

```ts
import { useEffect } from 'react';
import { useAuth } from './auth';
import { useCart } from '../state/cart';
import { useMfgProducts } from './products/mfg-products-queries';
import { useSofaCombos } from './products/sofa-combos-queries';
import { pickCombo } from '@2990s/shared';
import {
  computeDesiredFreeGifts,
  parseDefaultFreeGifts,
  type FreeGiftTrigger,
} from '@2990s/shared';

/**
 * Default Free Gift reconciler (0170). Keeps the cart's RM 0 accessory gift
 * lines in step with its triggers — NO server codes (unlike PWP):
 *   • a non-sofa line whose product has default_free_gifts is a trigger;
 *   • a sofa line whose build matches a combo with default_free_gifts is a
 *     trigger (matched BY COMBO, D9);
 *   • each trigger × gift entry yields a gift line at RM 0, qty = entry.qty ×
 *     trigger.qty; removing the trigger removes its gifts;
 *   • a gift line never triggers gifts (one-way) — gift lines are skipped.
 */
export function useFreeGiftSync(): void {
  const { user } = useAuth();
  const lines = useCart((s) => s.lines);
  const productsQ = useMfgProducts();
  const combosQ = useSofaCombos({ customerId: null });

  useEffect(() => {
    if (!user) return;
    const products = productsQ.data;
    const combos = combosQ.data;
    if (!products) return;                       // catalog not loaded yet

    const byId = new Map(products.map((p) => [p.id, p]));
    const nameById = new Map(products.map((p) => [p.id, p.name]));

    const triggers: FreeGiftTrigger[] = [];
    for (const l of useCart.getState().lines) {
      const c = l.config as {
        kind?: string; productId?: string; isFreeGift?: boolean; cells?: Array<{ moduleId?: string }>;
        modelId?: string | null;
      };
      if (c.isFreeGift) continue;                // one-way: a gift never triggers gifts
      if (!c.productId) continue;

      if (c.kind === 'sofa') {
        if (!combos) continue;
        const modules = (c.cells ?? []).map((cell) => String(cell.moduleId ?? '')).filter(Boolean);
        if (modules.length === 0) continue;
        const match = pickCombo(modules, combos);          // D9 — by combo, not compartment
        const gifts = match ? parseDefaultFreeGifts(match.defaultFreeGifts) : [];
        if (gifts.length > 0) {
          triggers.push({ triggerKey: l.key, triggerRef: match!.id, triggerKind: 'combo', triggerQty: l.qty, gifts });
        }
      } else {
        const p = byId.get(c.productId);
        const gifts = p ? parseDefaultFreeGifts(p.default_free_gifts) : [];
        if (gifts.length > 0) {
          triggers.push({ triggerKey: l.key, triggerRef: c.productId, triggerKind: 'product', triggerQty: l.qty, gifts });
        }
      }
    }

    const desired = computeDesiredFreeGifts(triggers);
    useCart.getState().reconcileFreeGifts(desired, nameById);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, lines, productsQ.data, combosQ.data]);
}

/** Mount once inside the providers (see main.tsx), beside <PwpCodeSync />. */
export function FreeGiftSync(): null {
  useFreeGiftSync();
  return null;
}
```

> Note for the implementer: confirm `pickCombo`'s exact signature in `packages/shared/src/sofa-combo-pricing.ts` and adapt the call (it may need `(modules, combos)` or a richer arg). If `pickCombo` is not directly importable/usable client-side with `SofaComboRule`, gate the sofa branch behind a tiny local matcher that compares `modules` against each combo's `modules` OR-set and skip sofa triggers if no clean match — the product-trigger path must still work. Keep the sofa branch isolated so it can land in its own commit.

- [ ] **Step 2: Mount it**

In `apps/pos/src/main.tsx`, import `FreeGiftSync` and add it right after `<PwpCodeSync />`:

```tsx
        <PwpCodeSync />
        {/* Default Free Gift reconciler (0170): auto-add RM 0 accessory gifts
            for trigger lines. Local only — no server codes. */}
        <FreeGiftSync />
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @2990s/pos typecheck` → PASS.
Run: `ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos build` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/lib/free-gift-sync.ts apps/pos/src/main.tsx
git commit -m "feat(pos): free-gift-sync reconciler (auto-add RM 0 accessory gifts) + mount"
```

---

## Task 8: Cart + handover display ("Free · campaign")

**Files:**
- Modify: `apps/pos/src/components/CartContents.tsx:187-248`
- Modify: `apps/pos/src/components/handover/OrderSummaryPane.tsx:66-95`

- [ ] **Step 1: CartContents — gift sub-line + disabled stepper + price**

In the `Line` component, after the existing PWP sub-line block, add a gift sub-line:

```tsx
      {'isFreeGift' in line.config && line.config.isFreeGift && (
        <div className={styles.lineSummary}>
          {('freeGiftCampaign' in line.config && line.config.freeGiftCampaign) ? line.config.freeGiftCampaign : 'Free gift'}
        </div>
      )}
```

Extend the `+` button's `disabled` to also cover gift lines:

```tsx
        disabled={('pwp' in line.config && line.config.pwp === true) || ('isFreeGift' in line.config && line.config.isFreeGift === true)}
        title={('isFreeGift' in line.config && line.config.isFreeGift === true) ? 'Free gift — quantity follows the qualifying item' : ('pwp' in line.config && line.config.pwp === true ? 'PWP — one unit per code' : undefined)}
```

(Leave the `−` button enabled so a salesperson can remove an unwanted gift; the reconciler re-adds it next pass unless the trigger is gone — acceptable.) The price render is unchanged: `fmtRM(line.qty * line.config.total)` shows `RM 0` for gifts.

- [ ] **Step 2: OrderSummaryPane — gift sub-line**

After the PWP sub-line block in the per-line render, add:

```tsx
              {'isFreeGift' in l.config && l.config.isFreeGift && (
                <div className={styles.itemDetail}>
                  {('freeGiftCampaign' in l.config && l.config.freeGiftCampaign) ? l.config.freeGiftCampaign : 'Free gift'}
                </div>
              )}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @2990s/pos typecheck` → PASS. `ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos build` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/components/CartContents.tsx apps/pos/src/components/handover/OrderSummaryPane.tsx
git commit -m "feat(pos): show free-gift lines as 'Free · campaign' in cart + handover"
```

---

## Task 9: Handover marshalling — tag the gift line

**Files:**
- Modify: `apps/pos/src/lib/pos-handover-so.ts:541-588` (`cartLineToSoItem`) and the `buildVariants` helper.

- [ ] **Step 1: Attach the `freeGift` marker to the SO line variants**

In `cartLineToSoItem`, after `const itemGroup = inferItemGroup(line.config, product);`, build the gift marker and merge it into `variants`:

```ts
  const cfg = line.config as {
    isFreeGift?: boolean; freeGiftCampaign?: string | null; freeGiftTriggerKey?: string; productId: string;
  };
  const freeGift = cfg.isFreeGift
    ? { freeGift: { triggerRef: cfg.freeGiftTriggerKey ?? '', triggerKind: 'product' as const, campaignName: cfg.freeGiftCampaign ?? null, giftProductId: cfg.productId } }
    : null;
```

In the returned object, replace `variants: buildVariants(line.config),` with:

```ts
    variants: freeGift ? { ...(buildVariants(line.config) ?? {}), ...freeGift } : buildVariants(line.config),
```

> `triggerRef`/`triggerKind` on the line are informational only — the server re-derives eligibility from the order's actual trigger lines (Task 10), so a stale client ref can't be exploited. The server only needs to know **this line is a free gift** and its **giftProductId + qty**.

- [ ] **Step 2: Typecheck + (existing) handover test**

Run: `pnpm --filter @2990s/pos typecheck` → PASS.
Run: `pnpm --filter @2990s/pos test pos-handover-so` → PASS (existing tests unaffected; flat lines without `isFreeGift` keep `variants: null`).

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/lib/pos-handover-so.ts
git commit -m "feat(pos): tag free-gift SO lines with variants.freeGift"
```

---

## Task 10: Server — validate gift lines + grant base 0 (honest pricing)

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts` (POST create: maps ~1713, rejection ~1891, recompute call ~1976)

The gift is always a non-sofa accessory → granting base `0` via the existing `pwpBaseSen` path makes it free with **no recompute signature change**. We build the order's triggers (non-sofa product `default_free_gifts` + sofa lines' matched-combo `default_free_gifts`) and validate every `variants.freeGift` line with the shared `validateFreeGiftClaims`.

- [ ] **Step 1: Add a free-gift grant map next to the PWP maps**

After the `pwpBaseByIdx` / `pwpSofaByIdx` declarations (~line 1713) add:

```ts
  const freeGiftBaseByIdx = new Map<number, number>();      // gift line idx → granted base (always 0)
```

- [ ] **Step 2: Build the order's free-gift triggers + claims, then validate**

After the PWP claim loop and its `pwpRejections` handling (so PWP grants are settled first), insert a free-gift validation block. It needs, per item: the resolved product row (the create handler already loads products for recompute — reuse that map/lookup; call it `productByIdx` / `productById` as it exists in this handler) and, for sofa lines, the matched combo. Add:

```ts
  // ── Default Free Gift (0170) — eligibility + RM 0 grant ─────────────────
  // The GIFT is always a non-sofa accessory; the TRIGGER may be a product
  // (default_free_gifts) or a sofa combo (D9). Validate each variants.freeGift
  // line against the order's real triggers — a tampered RM 0 accessory with no
  // trigger is rejected (honest pricing).
  {
    const triggers: import('@2990s/shared').FreeGiftTrigger[] = [];
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      if ((it?.variants as { freeGift?: unknown } | null)?.freeGift) continue; // one-way: a gift is never a trigger
      const product = productForIdx(idx);            // ← the row already loaded for recompute (rename to the handler's actual lookup)
      const cat = String(product?.category ?? '').toUpperCase();
      const qty = Number(it?.qty ?? 1);
      if (cat === 'SOFA') {
        const combo = matchedComboForIdx(idx);       // ← reuse the sofa combo match already computed for pricing (cachedCombos + pickCombo)
        const gifts = parseDefaultFreeGifts(combo?.default_free_gifts);
        if (gifts.length > 0) triggers.push({ triggerKey: `idx-${idx}`, triggerRef: combo!.id, triggerKind: 'combo', triggerQty: qty, gifts });
      } else {
        const gifts = parseDefaultFreeGifts(product?.default_free_gifts);
        if (gifts.length > 0) triggers.push({ triggerKey: `idx-${idx}`, triggerRef: product!.id, triggerKind: 'product', triggerQty: qty, gifts });
      }
    }

    const claims: import('@2990s/shared').FreeGiftLineClaim[] = [];
    for (let idx = 0; idx < items.length; idx++) {
      const fg = (items[idx]?.variants as { freeGift?: { giftProductId?: string } } | null)?.freeGift;
      if (!fg) continue;
      const giftProductId = String(fg.giftProductId ?? productForIdx(idx)?.id ?? '');
      claims.push({ idx, giftProductId, qty: Number(items[idx]?.qty ?? 1) });
    }

    if (claims.length > 0) {
      const { valid, rejected } = validateFreeGiftClaims(claims, triggers);
      if (rejected.length > 0) {
        await rollbackPwpClaims();   // free any PWP codes already claimed this request
        return c.json({
          error: 'free_gift_not_eligible',
          reason: rejected.map((r) => `line ${r.idx + 1}: ${r.giftProductId} — ${r.reason}`).join('; '),
          offendersFreeGift: rejected,
        }, 409);
      }
      for (const idx of valid) freeGiftBaseByIdx.set(idx, 0);
    }
  }
```

> Implementer note: `productForIdx`/`matchedComboForIdx` are placeholders for **the lookups this handler already has** — locate where each line's product row and (for sofa) matched combo are resolved for `recomputeFromSnapshot` and reuse them. If the matched combo isn't readily available pre-recompute, compute it once with the same `cachedCombos` + the shared combo matcher used by recompute, keyed by idx. The sofa-trigger branch may land in a follow-up commit; the product-trigger branch is the must-have.

Add to the `@2990s/shared` import at the top of the file: `parseDefaultFreeGifts`, `validateFreeGiftClaims`, and the types `FreeGiftTrigger`, `FreeGiftLineClaim` (or import the types inline as shown).

- [ ] **Step 3: Feed the grant into the recompute call**

At the recompute call (~line 1976), change the `pwpBaseSen` argument so a validated gift line forces base 0:

```ts
    const pwpBaseSen = pwpBaseByIdx.get(idx) ?? freeGiftBaseByIdx.get(idx) ?? null;
    const pwpSofaComboIds = pwpSofaByIdx.get(idx) ?? null;
    return recomputeFromSnapshot(draft, product, fabric, cachedConfig, cachedCombos, sofaModulePrices, sellingTiers, cachedFabricAddonConfig, pwpBaseSen, pwpSofaComboIds, cachedSpecialAddons, sofaModuleCostRows);
```

(`freeGiftBaseByIdx.get(idx)` is `0` for a granted gift → `effectiveBaseSen = 0` → line is free; client also sent 0 → no drift. A gift line with NO valid trigger never gets into the map, so it reprices to the accessory's real `sell_price_sen` and the client's 0-vs-server-price path fills the real price — i.e. it is NOT free, and a non-zero tampered price drifts → 400.)

- [ ] **Step 4: Typecheck the API**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/mfg-sales-orders.ts
git commit -m "feat(api): validate default-free-gift lines + grant RM 0 (409 free_gift_not_eligible)"
```

---

## Task 11: SKU Master editor — Default Free Gift (replace ProductGiftsDrawer)

**Files:**
- Modify: `apps/pos/src/pages/Products.tsx` (the `ProductGiftsDrawer` ~L5378 and its trigger/icon column)

Replace the legacy `included_addons` editor with a Default Free Gift editor that writes `default_free_gifts` (accessory picker + qty + campaign). Keep the gift icon/column that opens it; light it from `default_free_gifts.length > 0`.

- [ ] **Step 1: Read the current drawer to match props/wiring**

Run: open `apps/pos/src/pages/Products.tsx`, read the `ProductGiftsDrawer` component and where it's opened (the gift icon button + the `useUpdateMfgProductGifts` usage). Note the props it receives (the selected `MfgProductRow`, an `onClose`).

- [ ] **Step 2: Rewrite the drawer to edit `default_free_gifts`**

Replace the drawer body with an editor backed by `useUpdateMfgProductDefaultGifts` + an accessory picker (`useMfgProducts({ category: 'ACCESSORY' })`). Local draft state is `{ giftProductId, qty, campaignName }[]` seeded from `row.default_free_gifts`. Render one row per entry:
- accessory `<select>` populated from the accessory list (`id` → `name`),
- a qty number stepper (min 1),
- a campaign `<input type="text">` (optional, placeholder "Campaign name (optional)"),
- a remove button; plus an "Add gift" button that appends `{ giftProductId: '', qty: 1, campaignName: '' }`.

Save calls:

```tsx
await updateDefaultGifts.mutateAsync({
  id: row.id,
  defaultFreeGifts: draft
    .filter((g) => g.giftProductId)
    .map((g) => ({ giftProductId: g.giftProductId, qty: Math.max(1, g.qty), campaignName: g.campaignName.trim() || null })),
});
onClose();
```

Match the existing drawer's container/markup classes so styling is consistent (reuse whatever wrapper the old `ProductGiftsDrawer` used).

- [ ] **Step 3: Light the gift icon from `default_free_gifts`**

Where the SKU row's gift icon decides its "on" colour, switch the source from `row.included_addons.length > 0` to `row.default_free_gifts.length > 0`.

- [ ] **Step 4: Typecheck + build + eyeball**

Run: `pnpm --filter @2990s/pos typecheck` → PASS. `ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos build` → PASS. In dev, open SKU Master, add a pillow gift with qty 2 + "Raya Campaign", save, reopen → persists.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/pages/Products.tsx
git commit -m "feat(pos): SKU Master Default Free Gift editor (accessory + qty + campaign)"
```

---

## Task 12: Combo Pricing — Default Free Gift section (sofa trigger, D9)

**Files:**
- Modify: the Sofa Combo Pricing editor (`SofaComboTab`; locate via `grep -rn "useUpdateSofaCombo\|SofaComboTab" apps/pos/src`).

- [ ] **Step 1: Locate the combo editor + its save path**

Run: `grep -rn "useUpdateSofaCombo" apps/pos/src` and open the editor that builds the `useUpdateSofaCombo().mutateAsync({...})` call (it already sends `sellingPricesByHeight` / `pwpPricesByHeight`).

- [ ] **Step 2: Add a "Default free gift" sub-section per combo**

Mirror Task 11's accessory-gift row editor (accessory picker + qty + campaign), seeded from `combo.defaultFreeGifts ?? []`. Include the resulting array in the existing save call:

```ts
await updateCombo.mutateAsync({
  id: combo.id,
  pricesByHeight: combo.pricesByHeight,          // cost passed back unchanged
  sellingPricesByHeight,
  pwpPricesByHeight,
  effectiveFrom,
  // ...existing fields...
  defaultFreeGifts: giftDraft
    .filter((g) => g.giftProductId)
    .map((g) => ({ giftProductId: g.giftProductId, qty: Math.max(1, g.qty), campaignName: g.campaignName.trim() || null })),
});
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @2990s/pos typecheck` → PASS. `ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos build` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/pages/Products.tsx
git commit -m "feat(pos): Combo Pricing default-free-gift section (sofa trigger by combo)"
```

---

## Task 13: Retire the legacy "× N INCLUDED" rail

**Files:**
- Modify: `apps/pos/src/pages/Configurator.tsx:1155-1164` (memo) and `:2119-2144` (rail)

- [ ] **Step 1: Remove the rail + its memo**

Delete the `includedPillows` `useMemo` (1155-1164) and the `{includedPillows.length > 0 && (<RailSection title="Pillows · included free" ...>...)}` block (2119-2144). Remove any now-unused imports it leaves (`Sparkles`, `AddonRow`, `addonsById` if unused elsewhere — verify with the TS compiler).

- [ ] **Step 2: Typecheck + build**

Run: `pnpm --filter @2990s/pos typecheck` → PASS (fix any unused-import errors the removal surfaces). `ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos build` → PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/pages/Configurator.tsx
git commit -m "refactor(pos): retire the display-only 'Pillows · included free' rail (superseded by Default Free Gift)"
```

---

## Task 14: Full integration pass + quality gates

**Files:** none (verification only).

- [ ] **Step 1: Whole-repo gates**

Run: `pnpm typecheck` → PASS. `pnpm test` → PASS (new shared + cart tests green; no regressions). `pnpm lint` → PASS. `ALLOW_LOCAL_API_URL=1 pnpm build` → PASS.

- [ ] **Step 2: Manual end-to-end (dev)**

1. SKU Master: give a mattress Model a gift `pillow × 2`, campaign "Raya Campaign". Save.
2. POS: add that mattress to cart → a `Memory Pillow` line appears at **RM 0** with the **"Raya Campaign"** sub-line; its qty stepper is disabled.
3. Set the mattress qty to 2 → the pillow line qty becomes **4**.
4. Remove the mattress → the pillow gift line disappears.
5. Configure a sofa whose combo has a gift `pillow × 1` → adding it adds the pillow gift at RM 0 (sofa + accessory share one SO).
6. Handover → confirm → the SO persists the gift line at RM 0; the order total excludes the gift; no `409`.
7. Tamper check (optional, via API client): submit an accessory line with `variants.freeGift` but no qualifying trigger in the order → `409 free_gift_not_eligible`.
8. Configurator: confirm the old "Pillows · included free" rail is gone.

- [ ] **Step 3: Final commit (if any fixups)**

```bash
git add -A
git commit -m "test: default-free-gift end-to-end verification + fixups"
```

> Deploy (only when Loo asks): API via `wrangler deploy` (or the deploy script), POS via `scripts/deploy-pos.sh` (never a bare `pnpm build` — memory). Apply migration `0170` to prod via Supabase MCP **before** the API deploy. Remind Loo to PWA hard-refresh after the POS deploy.

---

## Self-review notes (author)

- **Spec coverage:** Card polish (T1) ✓; data model + migration 0170 (T2–T3) ✓; pure eligibility module + tests (T3) ✓; API writes (T4) ✓; query layer (T5) ✓; cart markers + reconcile (T6) ✓; reconciler hook (T7) ✓; display (T8) ✓; marshalling (T9) ✓; server validation + RM 0 grant + 409 (T10) ✓; SKU Master editor (T11) ✓; Combo gift section / D9 (T12) ✓; retire legacy rail (T13) ✓; no SO split / no delivery change — nothing to build (spec §3.7) ✓.
- **No codes:** deliberately no `free_gift_codes` table / reserve-free endpoints — the gift is deterministic from the trigger config; the server validates against in-order triggers.
- **Type consistency:** shared types (`DefaultFreeGift`, `FreeGiftTrigger`, `DesiredFreeGift`, `FreeGiftLineClaim`, `FreeGiftRejection`) + `freeGiftLineKey` are defined once in `free-gift.ts` and reused by cart/reconciler/server. Cart markers (`isFreeGift`, `freeGiftTriggerKey`, `freeGiftCampaign`) are consistent across `cart.ts`, `free-gift-sync.ts`, display, and marshalling.
- **Known implementer placeholders to resolve against live code:** `productForIdx` / `matchedComboForIdx` in T10 (reuse the handler's existing per-line product + combo lookups); `pickCombo` exact signature in T7; the `ProductGiftsDrawer` wrapper classes in T11; the `SofaComboTab` save call shape in T12. These are explicitly flagged where they occur.
