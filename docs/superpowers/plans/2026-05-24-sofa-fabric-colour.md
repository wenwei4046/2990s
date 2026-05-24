# Sofa fabric & colour selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let POS staff pick an upholstery **fabric** (with a transparent per-tier surcharge) and a **colour** (free, nested under the fabric) for every sofa, recorded on the order and priced server-side.

**Architecture:** Mirror the existing per-Model pricing pattern (`compartment_library`/`product_compartments`): a global seeded `fabric_library` + `fabric_colours`, plus a per-Model `product_fabrics` opt-in/surcharge table. Fabric surcharge is a **line-level add applied by the caller** on top of the bundle/cells price; the shared `computeOrderTotal` enforces it server-side (red line #4). The POS configurator appends Fabric + Colour blocks to the existing Quick-Pick left rail (and Custom Build); nothing in the locked layout/plan-view changes (red line #2).

**Tech Stack:** Drizzle + hand-written SQL migrations, Supabase (Postgres + RLS + Realtime), Hono on CF Workers (`apps/api`), Vite/React 19 (`apps/pos`, `apps/backend`), Zod (`packages/shared`), Vitest.

**Spec:** `docs/superpowers/specs/2026-05-24-sofa-fabric-colour-design.md` (9 decisions G1–G9).

**Design notes affecting the plan:**
- **"Required fabric" is enforced in `computeOrderTotal` (the sofa recompute branch), NOT in the Zod schema.** `fabricId`/`colourId` are *optional in shape* (keeps non-sofa configs + legacy fixtures valid) but a sofa line missing/inactive/invalid fabric is rejected there — same place the bundle-active rule already lives. This minimises fixture churn and keeps one enforcement point.
- Surcharge math lives only in shared code (`fabricSurchargeFor` + the `computeOrderTotal` sofa branch). `computeSofaPrice` stays geometry-only.

---

## File structure

**Phase A — DB + shared (foundation):**
- `packages/db/src/schema.ts` — 3 new tables + type helpers.
- `packages/db/migrations/0044_sofa_fabric_colour.sql` — tables + RLS + realtime + RPC update + trial seed + cross-join.
- `packages/shared/src/sofa-build.ts` — `SofaProductPricing.fabrics` + `fabricSurchargeFor`.
- `packages/shared/src/pricing.ts` — `SofaLineConfig` fields + `computeOrderTotal` surcharge/validation + `OrderTotalError` codes.
- `packages/shared/src/schemas/order.schema.ts` (+ `order-v1.schema.ts`) — `fabricId`/`colourId` (optional shape).
- `packages/shared/src/schemas/product.ts` — `sofaProductSchema.fabrics`.

**Phase B — server recompute + POS UI:**
- `apps/api/src/routes/orders.ts` — fetch `product_fabrics` + active `fabric_colours`, build `info.sofa.fabrics`.
- `apps/pos/src/state/cart.ts` — `SofaConfigSnapshot` fabric fields.
- `apps/pos/src/lib/queries.ts` — `useProductFabrics` + `useFabricLibrary` + `useFabricColours` + realtime.
- `apps/pos/src/pages/Configurator.tsx` — Fabric/Colour rail blocks, lifted state, total, gate, snapshot.
- `apps/pos/src/components/FabricColourPicker.tsx` (NEW) — shared Fabric+Colour block used by both modes.
- `apps/pos/src/pages/CustomBuilder.tsx` — render the picker + feed total/snapshot.

**Phase C — backend SKU editor:**
- `apps/backend/src/lib/queries.ts` — `useFabricLibrary` (backend).
- `apps/backend/src/components/PricingEditor.tsx` — `SofaEditor` Fabrics block + `SkuFormData.fabrics`.
- `apps/backend/src/components/SkuDrawer.tsx` — load + submit `fabrics`.

**Phase D — Sales Order display** (PO display DROPPED — Loo 2026-05-24: won't issue POs from here; the Sales Order listing fabric+colour is enough):
- `packages/shared/src/sofa-build.ts` — `describeSofaLine` keeps geometry; add a separate `fabricColourSuffix` helper (display only).
- `apps/pos/src/pages/SalesOrderPrint.tsx` — render fabric/colour + surcharge line.

---

# Phase A — DB + shared (foundation)

## Task A1: Drizzle schema — 3 new tables

**Files:**
- Modify: `packages/db/src/schema.ts` (add after `productBundles`, ~line 280; types after the `MyLocality` helpers ~line 853)

- [ ] **Step 1: Add the three tables** after the `productBundles` table definition

```ts
/* ─────────────────────────── Sofa fabric & colour ───────────────────── */
// Global fabric library + nested colours, plus per-Model opt-in/surcharge.
// Mirrors compartment_library/product_compartments. Fabric tiers add a
// transparent surcharge (whole MYR); colour is free. (Spec 2026-05-24, G1–G3.)

export const fabricLibrary = pgTable('fabric_library', {
  id:               text('id').primaryKey(),               // 'linen','velvet','leather-pu'
  label:            text('label').notNull(),               // 'Linen'
  tier:             text('tier').notNull().default('standard'), // 'standard' | 'premium' (display)
  defaultSurcharge: integer('default_surcharge').notNull().default(0), // seed default add-on
  swatchKey:        text('swatch_key'),                    // optional R2 texture; else hex chip
  active:           boolean('active').notNull().default(true),
  sortOrder:        integer('sort_order').notNull().default(0),
});

export const fabricColours = pgTable('fabric_colours', {
  fabricId:  text('fabric_id').notNull().references(() => fabricLibrary.id, { onDelete: 'cascade' }),
  colourId:  text('colour_id').notNull(),                  // 'sand','charcoal'
  label:     text('label').notNull(),                      // 'Sand'
  swatchHex: text('swatch_hex'),                           // '#D8C7A8' chip
  swatchKey: text('swatch_key'),                           // optional R2 image
  active:    boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.fabricId, t.colourId] }),
}));

export const productFabrics = pgTable('product_fabrics', {
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  fabricId:  text('fabric_id').notNull().references(() => fabricLibrary.id),
  active:    boolean('active').notNull().default(true),    // the per-Model "勾选"
  surcharge: integer('surcharge').notNull().default(0),    // seeded from default_surcharge
}, (t) => ({
  pk: primaryKey({ columns: [t.productId, t.fabricId] }),
}));
```

- [ ] **Step 2: Add type helpers** in the "Type helpers" section

```ts
export type FabricLibraryRow = typeof fabricLibrary.$inferSelect;
export type NewFabricLibraryRow = typeof fabricLibrary.$inferInsert;
export type FabricColourRow = typeof fabricColours.$inferSelect;
export type NewFabricColourRow = typeof fabricColours.$inferInsert;
export type ProductFabricRow = typeof productFabrics.$inferSelect;
export type NewProductFabricRow = typeof productFabrics.$inferInsert;
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/db typecheck`
Expected: PASS (no errors). `primaryKey`, `integer`, `boolean`, `text`, `uuid` are already imported in this file.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): add fabric_library, fabric_colours, product_fabrics tables"
```

---

## Task A2: Migration 0044 — tables, RLS, realtime, RPC, trial seed

**Files:**
- Create: `packages/db/migrations/0044_sofa_fabric_colour.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0044_sofa_fabric_colour.sql
-- Sofa fabric & colour selection (spec 2026-05-24). 3 tables mirror the
-- compartment pattern. Fabric tiers add a transparent surcharge (G1); colour
-- is free. Seeds 3 trial fabrics + 5 colours each and cross-joins them onto
-- every seeded sofa so the "required fabric" rule (enforced in server
-- recompute) never makes an existing Model un-orderable.

CREATE TABLE IF NOT EXISTS fabric_library (
  id                text PRIMARY KEY,
  label             text NOT NULL,
  tier              text NOT NULL DEFAULT 'standard',
  default_surcharge integer NOT NULL DEFAULT 0,
  swatch_key        text,
  active            boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fabric_colours (
  fabric_id  text NOT NULL REFERENCES fabric_library(id) ON DELETE CASCADE,
  colour_id  text NOT NULL,
  label      text NOT NULL,
  swatch_hex text,
  swatch_key text,
  active     boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (fabric_id, colour_id)
);

CREATE TABLE IF NOT EXISTS product_fabrics (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  fabric_id  text NOT NULL REFERENCES fabric_library(id),
  active     boolean NOT NULL DEFAULT true,
  surcharge  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, fabric_id)
);

-- RLS: read any authenticated staff, write admin only (same as libraries/pricing).
ALTER TABLE fabric_library  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fabric_colours  ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_fabrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY fabric_library_select ON fabric_library
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY fabric_library_admin_write ON fabric_library
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY fabric_colours_select ON fabric_colours
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY fabric_colours_admin_write ON fabric_colours
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY product_fabrics_select ON product_fabrics
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY product_fabrics_admin_write ON product_fabrics
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Realtime so POS sees Backend surcharge edits in ~300ms (mirrors product_bundles).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='product_fabrics') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.product_fabrics';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='fabric_library') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.fabric_library';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='fabric_colours') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.fabric_colours';
  END IF;
END $$;

-- ── Trial seed (Loo 2026-05-24): 3 fabrics + 5 colours each ──
INSERT INTO fabric_library (id, label, tier, default_surcharge, active, sort_order) VALUES
  ('linen',      'Linen',        'standard', 0,   true, 10),
  ('velvet',     'Velvet',       'premium',  300, true, 20),
  ('leather-pu', 'Leather (PU)', 'premium',  600, true, 30)
ON CONFLICT (id) DO NOTHING;

INSERT INTO fabric_colours (fabric_id, colour_id, label, swatch_hex, active, sort_order)
SELECT f.id, c.colour_id, c.label, c.swatch_hex, true, c.sort_order
FROM fabric_library f
CROSS JOIN (VALUES
  ('sand',     'Sand',     '#D8C7A8', 10),
  ('stone',    'Stone',    '#9A958C', 20),
  ('charcoal', 'Charcoal', '#3A3A3A', 30),
  ('forest',   'Forest',   '#3E5641', 40),
  ('rust',     'Rust',     '#A6492E', 50)
) AS c(colour_id, label, swatch_hex, sort_order)
WHERE f.id IN ('linen','velvet','leather-pu')
ON CONFLICT (fabric_id, colour_id) DO NOTHING;

-- Activate all 3 trial fabrics on every existing sofa (surcharge = default) so
-- "required fabric" keeps them orderable + the surcharge is testable in POS.
INSERT INTO product_fabrics (product_id, fabric_id, active, surcharge)
SELECT p.id, f.id, true, f.default_surcharge
FROM products p
CROSS JOIN fabric_library f
WHERE p.pricing_kind = 'sofa_build'
ON CONFLICT (product_id, fabric_id) DO NOTHING;

-- ── Extend create_product_with_pricing to upsert product_fabrics for sofas ──
CREATE OR REPLACE FUNCTION public.create_product_with_pricing(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_product_id uuid;
  v_kind text := p->>'pricingKind';
BEGIN
  INSERT INTO products (
    sku, category_id, series_id, pricing_kind, name, detail, size_display,
    img_key, thumb_key, stock, low_at, visible, flat_price, recliner_upgrade_price
  ) VALUES (
    p->>'sku',
    p->>'categoryId',
    NULLIF(p->>'seriesId', ''),
    v_kind::pricing_kind,
    p->>'name',
    NULLIF(p->>'detail', ''),
    NULLIF(p->>'sizeDisplay', ''),
    p->>'imgKey',
    p->>'thumbKey',
    COALESCE((p->>'stock')::int, 0),
    COALESCE((p->>'lowAt')::int, 5),
    COALESCE((p->>'visible')::boolean, true),
    CASE WHEN v_kind = 'flat'       THEN (p->>'flatPrice')::int            ELSE NULL END,
    CASE WHEN v_kind = 'sofa_build' THEN (p->>'reclinerUpgradePrice')::int ELSE NULL END
  )
  RETURNING id INTO v_product_id;

  IF v_kind = 'sofa_build' THEN
    INSERT INTO product_compartments (product_id, compartment_id, active, price)
    SELECT v_product_id, (r->>'compartmentId')::text, (r->>'active')::boolean, (r->>'price')::int
    FROM jsonb_array_elements(p->'compartments') r;

    INSERT INTO product_bundles (product_id, bundle_id, active, price)
    SELECT v_product_id, (r->>'bundleId')::text, (r->>'active')::boolean, (r->>'price')::int
    FROM jsonb_array_elements(p->'bundles') r;

    -- Fabric availability + per-Model surcharge (spec 2026-05-24).
    INSERT INTO product_fabrics (product_id, fabric_id, active, surcharge)
    SELECT v_product_id, (r->>'fabricId')::text, (r->>'active')::boolean, (r->>'surcharge')::int
    FROM jsonb_array_elements(COALESCE(p->'fabrics', '[]'::jsonb)) r;
  ELSIF v_kind = 'size_variants' THEN
    INSERT INTO product_size_variants (product_id, size_id, active, price)
    SELECT v_product_id, (r->>'sizeId')::text, (r->>'active')::boolean, (r->>'price')::int
    FROM jsonb_array_elements(p->'sizes') r;
  END IF;

  RETURN v_product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_product_with_pricing(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_product_with_pricing(jsonb) FROM anon;
```

- [ ] **Step 2: Apply the migration to the local/dev DB**

Run: `pnpm db:push` (or apply `0044_sofa_fabric_colour.sql` via the project's migration runner — match how 0043 was applied).
Expected: 3 tables created, policies + realtime added, 3 fabric rows, 15 fabric_colours rows, and one `product_fabrics` row per (sofa × 3 fabrics).

- [ ] **Step 3: Verify the seed + cross-join**

Run this SQL (via `psql`/Supabase SQL editor):
```sql
SELECT (SELECT count(*) FROM fabric_library)  AS fabrics,        -- expect 3
       (SELECT count(*) FROM fabric_colours)  AS colours,        -- expect 15
       (SELECT count(DISTINCT product_id) FROM product_fabrics)  AS sofas_with_fabric; -- expect = #sofa SKUs (15)
```
Expected: `fabrics=3, colours=15, sofas_with_fabric=15`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/0044_sofa_fabric_colour.sql
git commit -m "feat(db): migration 0044 — fabric/colour tables, RLS, realtime, RPC, trial seed"
```

---

## Task A3: Shared engine — `SofaProductPricing.fabrics` + `fabricSurchargeFor`

**Files:**
- Modify: `packages/shared/src/sofa-build.ts` (the `SofaProductPricing` interface ~line 51; add helper after the pricing helpers ~line 540)
- Test: `packages/shared/src/__tests__/sofa-build.test.ts`

- [ ] **Step 1: Write the failing test** (append to `sofa-build.test.ts`)

```ts
import { fabricSurchargeFor, type SofaProductPricing } from '../sofa-build';

describe('fabricSurchargeFor', () => {
  const pricing: SofaProductPricing = {
    compartments: [], bundles: [], reclinerUpgradePrice: 0,
    fabrics: [
      { fabricId: 'linen',  active: true,  surcharge: 0,   colourIds: ['sand', 'stone'] },
      { fabricId: 'velvet', active: true,  surcharge: 300, colourIds: ['sand'] },
      { fabricId: 'retired', active: false, surcharge: 999, colourIds: [] },
    ],
  };
  it('returns the surcharge of an active fabric', () => {
    expect(fabricSurchargeFor(pricing, 'velvet')).toBe(300);
    expect(fabricSurchargeFor(pricing, 'linen')).toBe(0);
  });
  it('returns 0 for missing, unknown, or inactive fabric', () => {
    expect(fabricSurchargeFor(pricing, undefined)).toBe(0);
    expect(fabricSurchargeFor(pricing, 'nope')).toBe(0);
    expect(fabricSurchargeFor(pricing, 'retired')).toBe(0);
  });
  it('handles a Model with no fabrics array', () => {
    expect(fabricSurchargeFor({ compartments: [], bundles: [], reclinerUpgradePrice: 0 }, 'velvet')).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `pnpm --filter @2990s/shared test -- sofa-build`
Expected: FAIL — `fabricSurchargeFor is not a function`.

- [ ] **Step 3: Extend `SofaProductPricing`** (add the `fabrics` field to the interface)

```ts
export interface SofaProductPricingFabric {
  fabricId: string;
  active: boolean;
  surcharge: number;
  /** Active colour ids for this fabric — server uses them to validate the
   *  chosen colour. Display labels/hex are loaded separately for the UI. */
  colourIds: string[];
}
export interface SofaProductPricing {
  compartments: SofaProductPricingRow[];
  bundles: SofaProductPricingBundle[];
  reclinerUpgradePrice: number;
  seatUpgradeLabel?: string | null;
  seatUpgradeFootrest?: boolean;
  /** Per-Model fabric availability + surcharge (spec 2026-05-24). Optional so
   *  callers that don't price fabric (e.g. plan-view) can omit it.
   *  `computeSofaPrice` ignores this — surcharge is a caller-applied line add. */
  fabrics?: SofaProductPricingFabric[];
}
```

- [ ] **Step 4: Add the helper** (after `bundleRow`, ~line 539)

```ts
/** Surcharge for an ACTIVE fabric on this Model, else 0. Pure; used by the POS
 *  LIVE TOTAL. The server (`computeOrderTotal`) does strict validation before
 *  adding the same value. */
export const fabricSurchargeFor = (
  pricing: SofaProductPricing,
  fabricId: string | undefined,
): number => {
  if (!fabricId) return 0;
  const f = pricing.fabrics?.find((x) => x.fabricId === fabricId && x.active);
  return f?.surcharge ?? 0;
};
```

- [ ] **Step 5: Run the test — verify it passes**

Run: `pnpm --filter @2990s/shared test -- sofa-build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sofa-build.ts packages/shared/src/__tests__/sofa-build.test.ts
git commit -m "feat(shared): SofaProductPricing.fabrics + fabricSurchargeFor helper"
```

---

## Task A4: Shared recompute — surcharge + colour validation in `computeOrderTotal`

**Files:**
- Modify: `packages/shared/src/pricing.ts` (`SofaLineConfig` ~line 108; `OrderTotalError` union ~line 194; sofa branch ~lines 231–257)
- Test: `packages/shared/src/__tests__/pricing.test.ts`

- [ ] **Step 1: Write the failing test** (append to `pricing.test.ts`)

```ts
import { computeOrderTotal, OrderPricingError, type ServerProductInfo } from '../pricing';

describe('computeOrderTotal — sofa fabric surcharge', () => {
  const sofaInfo: ServerProductInfo = {
    productId: 'P1', pricingKind: 'sofa_build', flatPrice: null,
    sofa: {
      compartments: [], reclinerUpgradePrice: 0,
      bundles: [{ bundleId: '2S', active: true, price: 1990 }],
      fabrics: [
        { fabricId: 'linen',  active: true,  surcharge: 0,   colourIds: ['sand', 'stone'] },
        { fabricId: 'velvet', active: true,  surcharge: 300, colourIds: ['sand'] },
        { fabricId: 'retired', active: false, surcharge: 999, colourIds: ['sand'] },
      ],
    },
  };
  const info = new Map<string, ServerProductInfo>([['P1', sofaInfo]]);
  const line = (fabricId?: string, colourId?: string) => ([{
    qty: 1, config: { kind: 'sofa' as const, productId: 'P1', bundleId: '2S', depth: '24', fabricId, colourId },
  }]);

  it('adds the active fabric surcharge to the sofa line', () => {
    const out = computeOrderTotal(line('velvet', 'sand'), info);
    expect(out.subtotal).toBe(2290); // 1990 + 300
  });
  it('adds 0 for a standard fabric', () => {
    expect(computeOrderTotal(line('linen', 'stone'), info).subtotal).toBe(1990);
  });
  it('rejects a sofa with no fabric (required)', () => {
    expect(() => computeOrderTotal(line(undefined, undefined), info)).toThrow(OrderPricingError);
  });
  it('rejects an inactive / unknown fabric', () => {
    expect(() => computeOrderTotal(line('retired', 'sand'), info)).toThrow(OrderPricingError);
    expect(() => computeOrderTotal(line('nope', 'sand'), info)).toThrow(OrderPricingError);
  });
  it('rejects a colour that does not belong to the fabric', () => {
    expect(() => computeOrderTotal(line('velvet', 'charcoal'), info)).toThrow(OrderPricingError);
  });
});
```

> Note: `subtotal` is the field returned by `computeOrderTotal` for the line/cart sum — confirm the exact return shape at the top of `pricing.test.ts` and adjust the asserted field name (e.g. `out.total` / per-line `unitPrice`) to match the existing tests in that file.

- [ ] **Step 2: Run the test — verify it fails**

Run: `pnpm --filter @2990s/shared test -- pricing`
Expected: FAIL — surcharge not added / no rejection.

- [ ] **Step 3: Add fabric fields to `SofaLineConfig`**

```ts
export type SofaLineConfig = {
  kind: 'sofa';
  productId: string;
  bundleId?: string;
  cells?: Cell[];
  depth?: Depth;
  seatUpgradeLabel?: string | null;
  seatUpgradeFootrest?: boolean;
  // Spec 2026-05-24. Optional in shape; the sofa branch below REQUIRES them.
  fabricId?: string;
  colourId?: string;
  // Display-only snapshots — computeOrderTotal ignores these.
  fabricLabel?: string | null;
  colourLabel?: string | null;
};
```

- [ ] **Step 4: Add error codes to the `OrderTotalError` union**

```ts
  | { code: 'unknown_fabric'; productId: string; fabricId?: string }
  | { code: 'inactive_fabric'; productId: string; fabricId: string }
  | { code: 'invalid_colour'; productId: string; fabricId: string; colourId?: string }
```

- [ ] **Step 5: Add surcharge + validation in the sofa branch** — after `unitPrice` is set by the bundle/cells sub-branches and BEFORE the line is pushed (currently around pricing.ts:257)

```ts
      // Fabric is REQUIRED for sofa lines (spec G6). Validate against the
      // Model's product_fabrics + the fabric's active colours, then add the
      // transparent surcharge on top of the bundle/cells unit price.
      const wantFabricId = cfg.fabricId;
      if (!wantFabricId) {
        throw new OrderPricingError({ code: 'unknown_fabric', productId: info.productId });
      }
      const fabric = info.sofa.fabrics?.find((f) => f.fabricId === wantFabricId);
      if (!fabric) {
        throw new OrderPricingError({ code: 'unknown_fabric', productId: info.productId, fabricId: wantFabricId });
      }
      if (!fabric.active) {
        throw new OrderPricingError({ code: 'inactive_fabric', productId: info.productId, fabricId: wantFabricId });
      }
      if (!cfg.colourId || !fabric.colourIds.includes(cfg.colourId)) {
        throw new OrderPricingError({ code: 'invalid_colour', productId: info.productId, fabricId: wantFabricId, colourId: cfg.colourId });
      }
      unitPrice += fabric.surcharge;
      breakdown.push(`Fabric ${fabric.fabricId} (+RM ${fabric.surcharge.toLocaleString('en-MY')})`);
```

> The `unitPrice` and `breakdown` identifiers already exist in this branch (see pricing.ts:238–256). Place this block after both the `cfg.cells` and `cfg.bundleId` sub-branches resolve `unitPrice`, before the line `out.push(...)`.

- [ ] **Step 6: Run the test — verify it passes**

Run: `pnpm --filter @2990s/shared test -- pricing`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/pricing.ts packages/shared/src/__tests__/pricing.test.ts
git commit -m "feat(shared): sofa fabric surcharge + colour validation in computeOrderTotal"
```

---

## Task A5: Order config schema — `fabricId`/`colourId`

**Files:**
- Modify: `packages/shared/src/schemas/order.schema.ts` (`sofaConfigSchema` ~line 17)
- Modify: `packages/shared/src/schemas/order-v1.schema.ts` (its sofa config object — confirm field name)
- Test: `packages/shared/src/schemas/order-v1.schema.test.ts` (or `order.schema` test if present)

- [ ] **Step 1: Write the failing test** (append to the active order-schema test)

```ts
it('accepts a sofa config with fabricId + colourId', () => {
  const cfg = { depth: '24', mode: 'preset', presetId: '2S', customCells: [], fabricId: 'velvet', colourId: 'sand' };
  expect(() => sofaConfigSchema.parse(cfg)).not.toThrow();
});
it('still accepts a sofa config without fabric (shape-optional; recompute enforces)', () => {
  const cfg = { depth: '24', mode: 'preset', presetId: '2S', customCells: [] };
  expect(() => sofaConfigSchema.parse(cfg)).not.toThrow();
});
```

- [ ] **Step 2: Run — verify it fails** (the fabric fields are stripped/unknown)

Run: `pnpm --filter @2990s/shared test -- order`
Expected: FAIL on the first case (fields not preserved) OR no `sofaConfigSchema` export — adjust import to the active schema module.

- [ ] **Step 3: Add the fields to `sofaConfigSchema`** (`order.schema.ts`)

```ts
const sofaConfigSchema = z.object({
  depth: z.string().regex(/^\d{2,3}$/),
  mode: z.enum(['preset', 'custom']),
  presetId: z.string().optional(),
  quickFlip: z.enum(['L', 'R']).optional(),
  customCells: z.array(cellSchema),
  // Spec 2026-05-24 — optional in shape; sofa recompute requires them.
  fabricId: z.string().optional(),
  colourId: z.string().optional(),
  fabricLabel: z.string().optional(),
  colourLabel: z.string().optional(),
});
```

- [ ] **Step 4: Mirror the fields in `order-v1.schema.ts`** — find its sofa config object and add the same four optional fields. (Confirm which schema the live `POST /orders` validates; the API route imports one of them.)

- [ ] **Step 5: Run — verify it passes**

Run: `pnpm --filter @2990s/shared test -- order`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas/order.schema.ts packages/shared/src/schemas/order-v1.schema.ts packages/shared/src/schemas/*.test.ts
git commit -m "feat(shared): sofa order config carries fabricId/colourId"
```

---

## Task A6: Product schema — `sofaProductSchema.fabrics`

**Files:**
- Modify: `packages/shared/src/schemas/product.ts` (add `fabricRow` + extend `sofaProductSchema` ~line 59; superRefine ~line 115)
- Test: `packages/shared/src/schemas/product.test.ts` (create if absent — minimal)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { sofaProductSchema } from './product';

const base = {
  pricingKind: 'sofa_build', sku: 'SOF-TEST', categoryId: 'sofa', seriesId: null,
  name: 'Test', detail: null, sizeDisplay: null, depthOptions: '24',
  imgKey: null, thumbKey: null, stock: 0, lowAt: 5, visible: true, includedAddons: [],
  reclinerUpgradePrice: 0,
  compartments: [{ compartmentId: '1A-LHF', active: true, price: 100 }],
  bundles: [{ bundleId: '2S', active: true, price: 1990 }],
};

describe('sofaProductSchema.fabrics', () => {
  it('requires at least one active fabric', () => {
    const bad = { ...base, fabrics: [{ fabricId: 'linen', active: false, surcharge: 0 }] };
    expect(sofaProductSchema.safeParse(bad).success).toBe(false);
  });
  it('passes with an active fabric', () => {
    const ok = { ...base, fabrics: [{ fabricId: 'linen', active: true, surcharge: 0 }] };
    expect(sofaProductSchema.safeParse(ok).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @2990s/shared test -- product`
Expected: FAIL — `fabrics` unknown / refine missing.

- [ ] **Step 3: Add `fabricRow` and extend `sofaProductSchema`**

```ts
const fabricRow = z.object({
  fabricId:  z.string().min(1),
  active:    z.boolean(),
  surcharge: money,
});
```
Add to `sofaProductSchema.extend({ ... })`:
```ts
  fabrics: z.array(fabricRow).min(1),
```

- [ ] **Step 4: Add the superRefine rule** (inside the existing `.superRefine`, in the `sofa_build` branch alongside the bundle check)

```ts
    const fabricOk = val.fabrics.some((f) => f.active);
    if (!fabricOk) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fabrics'],
        message: 'Activate at least one fabric — sofas require a fabric choice.',
      });
    }
```

- [ ] **Step 5: Run — verify it passes**

Run: `pnpm --filter @2990s/shared test -- product`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas/product.ts packages/shared/src/schemas/product.test.ts
git commit -m "feat(shared): sofaProductSchema requires >=1 active fabric"
```

---

# Phase B — server recompute + POS UI

## Task B1: API recompute — load `product_fabrics` + colours into `info.sofa`

**Files:**
- Modify: `apps/api/src/routes/orders.ts` (`Promise.all` block ~line 100; `ServerProductInfo` build ~line 215)
- Test: `apps/api/src/routes/orders.test.ts`

- [ ] **Step 1: Write the failing test** — add a case asserting a velvet sofa order's persisted total includes +300, and an order with an inactive/missing fabric is rejected. Follow the existing `orders.test.ts` harness (it already posts sofa orders; copy the closest sofa case and add `fabricId: 'velvet', colourId: 'sand'` to the line config + seed `product_fabrics`/`fabric_colours` rows in the test fixture).

```ts
// In the sofa-order describe block, mirroring the existing happy-path case:
it('adds the fabric surcharge to the recomputed total', async () => {
  // fixture: product P has bundle 2S @1990 + product_fabrics velvet @300 + colour sand
  const res = await postOrder({ /* …existing sofa body… */, lines: [{
    qty: 1, config: { kind: 'sofa', productId: P, bundleId: '2S', depth: '24', fabricId: 'velvet', colourId: 'sand' },
  }], clientTotal: 2290 /* 1990+300 + delivery as per existing cases */ });
  expect(res.status).toBe(201);
});
it('rejects a sofa order with a missing fabric', async () => {
  const res = await postOrder({ /* … */, lines: [{ qty: 1, config: { kind: 'sofa', productId: P, bundleId: '2S', depth: '24' } }] });
  expect(res.status).toBe(422);
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @2990s/api test -- orders`
Expected: FAIL — surcharge not applied (drift) / order not rejected.

- [ ] **Step 3: Add the fetches** to the `Promise.all` array (after the `product_bundles` select, ~line 112)

```ts
    supabase
      .from('product_fabrics')
      .select('product_id, fabric_id, active, surcharge')
      .in('product_id', productIds),
    supabase
      .from('fabric_colours')
      .select('fabric_id, colour_id, active'),
```
Add `fabricsRes, fabricColoursRes` to the destructured results and to the `for (const r of [...])` error-check array.

- [ ] **Step 4: Build a fabric→active-colours map and populate `info.sofa.fabrics`**

After `const bundles = bundlesRes.data ?? [];` add:
```ts
  const productFabrics = fabricsRes.data ?? [];
  const activeColourIdsByFabric = new Map<string, string[]>();
  for (const c of fabricColoursRes.data ?? []) {
    if (!c.active) continue;
    const arr = activeColourIdsByFabric.get(c.fabric_id) ?? [];
    arr.push(c.colour_id);
    activeColourIdsByFabric.set(c.fabric_id, arr);
  }
```
In the `infoById` builder, extend the `sofa` object:
```ts
      sofa: p.pricing_kind === 'sofa_build' ? {
        reclinerUpgradePrice: p.recliner_upgrade_price ?? 0,
        compartments: compartments.filter((r) => r.product_id === p.id)
          .map((r) => ({ compartmentId: r.compartment_id, active: r.active, price: r.price })),
        bundles: bundles.filter((r) => r.product_id === p.id)
          .map((r) => ({ bundleId: r.bundle_id, active: r.active, price: r.price })),
        fabrics: productFabrics.filter((r) => r.product_id === p.id)
          .map((r) => ({
            fabricId: r.fabric_id, active: r.active, surcharge: r.surcharge,
            colourIds: activeColourIdsByFabric.get(r.fabric_id) ?? [],
          })),
      } : undefined,
```

- [ ] **Step 5: Run — verify it passes**

Run: `pnpm --filter @2990s/api test -- orders`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/orders.ts apps/api/src/routes/orders.test.ts
git commit -m "feat(api): load product_fabrics + colours into sofa recompute"
```

---

## Task B2: POS cart snapshot — fabric/colour fields

**Files:**
- Modify: `apps/pos/src/state/cart.ts` (`SofaConfigSnapshot` ~line 10)

- [ ] **Step 1: Add the fields**

```ts
export interface SofaConfigSnapshot {
  kind: 'sofa';
  productId: string;
  productName: string;
  bundleId?: string;
  cells?: Cell[];
  depth?: Depth;
  seatUpgradeLabel?: string | null;
  seatUpgradeFootrest?: boolean;
  // Spec 2026-05-24 — chosen fabric/colour + display snapshots.
  fabricId?: string;
  colourId?: string;
  fabricLabel?: string;
  colourLabel?: string;
  colourHex?: string;
  total: number;
  summary: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS (fields are optional; no call sites break yet).

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/state/cart.ts
git commit -m "feat(pos): SofaConfigSnapshot carries fabric/colour"
```

---

## Task B3: POS queries — fabric hooks + realtime

**Files:**
- Modify: `apps/pos/src/lib/queries.ts` (add hooks after `useProductBundles` ~line 157; extend `useProductPricingRealtime` ~line 301)

- [ ] **Step 1: Add the row types + hooks** (mirror `useProductBundles`)

```ts
export interface FabricLibraryRow { id: string; label: string; tier: string; defaultSurcharge: number; active: boolean; sortOrder: number; }
export interface FabricColourRow { fabricId: string; colourId: string; label: string; swatchHex: string | null; active: boolean; sortOrder: number; }
export interface ProductFabricRow { fabricId: string; active: boolean; surcharge: number; }

export const useFabricLibrary = () =>
  useQuery({
    queryKey: ['fabric-library'],
    queryFn: async (): Promise<FabricLibraryRow[]> => {
      const { data, error } = await supabase
        .from('fabric_library')
        .select('id, label, tier, default_surcharge, active, sort_order')
        .eq('active', true).order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id, label: r.label, tier: r.tier, defaultSurcharge: r.default_surcharge,
        active: r.active, sortOrder: r.sort_order,
      }));
    },
  });

export const useFabricColours = () =>
  useQuery({
    queryKey: ['fabric-colours'],
    queryFn: async (): Promise<FabricColourRow[]> => {
      const { data, error } = await supabase
        .from('fabric_colours')
        .select('fabric_id, colour_id, label, swatch_hex, active, sort_order')
        .eq('active', true).order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        fabricId: r.fabric_id, colourId: r.colour_id, label: r.label,
        swatchHex: r.swatch_hex, active: r.active, sortOrder: r.sort_order,
      }));
    },
  });

export const useProductFabrics = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['product', productId, 'fabrics'],
    queryFn: async (): Promise<ProductFabricRow[]> => {
      if (!productId) throw new Error('no productId');
      const { data, error } = await supabase
        .from('product_fabrics')
        .select('fabric_id, active, surcharge')
        .eq('product_id', productId);
      if (error) throw error;
      return (data ?? []).map((r) => ({ fabricId: r.fabric_id, active: r.active, surcharge: r.surcharge }));
    },
  });
```

- [ ] **Step 2: Add a realtime subscription** for `product_fabrics` inside `useProductPricingRealtime` (mirror the `product_bundles` `.on(...)`)

```ts
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_fabrics', filter: `product_id=eq.${productId}` },
        () => void qc.invalidateQueries({ queryKey: ['product', productId, 'fabrics'] }),
      )
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/lib/queries.ts
git commit -m "feat(pos): useProductFabrics + fabric library/colours hooks + realtime"
```

---

## Task B4: POS — shared `FabricColourPicker` component

**Files:**
- Create: `apps/pos/src/components/FabricColourPicker.tsx`
- Create: `apps/pos/src/components/FabricColourPicker.module.css`

- [ ] **Step 1: Write the component** — reads the Model's active fabrics + the global library/colours, renders a Fabric chip row (grouped by tier, `+RM` badge when surcharge>0) then a Colour swatch row for the selected fabric. Controlled via props so `Configurator` owns the state.

```tsx
import { useMemo } from 'react';
import { fmtRM } from '@2990s/shared';
import { useFabricLibrary, useFabricColours, type ProductFabricRow } from '../lib/queries';
import styles from './FabricColourPicker.module.css';

export interface FabricColourPickerProps {
  productFabrics: ProductFabricRow[];     // from useProductFabrics(productId).data
  fabricId: string | null;
  colourId: string | null;
  onChange: (next: { fabricId: string; colourId: string; fabricLabel: string; colourLabel: string; colourHex: string | null; surcharge: number }) => void;
}

export const FabricColourPicker = ({ productFabrics, fabricId, colourId, onChange }: FabricColourPickerProps) => {
  const lib = useFabricLibrary();
  const colours = useFabricColours();

  // Active fabrics offered on this Model, joined to the library for label/tier.
  const fabrics = useMemo(() => {
    const byId = new Map((lib.data ?? []).map((f) => [f.id, f]));
    return productFabrics
      .filter((pf) => pf.active && byId.has(pf.fabricId))
      .map((pf) => ({ ...byId.get(pf.fabricId)!, surcharge: pf.surcharge }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [productFabrics, lib.data]);

  const coloursForFabric = useMemo(
    () => (colours.data ?? []).filter((c) => c.fabricId === fabricId).sort((a, b) => a.sortOrder - b.sortOrder),
    [colours.data, fabricId],
  );

  const pick = (fId: string, cId: string) => {
    const f = fabrics.find((x) => x.id === fId);
    const c = (colours.data ?? []).find((x) => x.fabricId === fId && x.colourId === cId);
    if (!f || !c) return;
    onChange({ fabricId: fId, colourId: cId, fabricLabel: f.label, colourLabel: c.label, colourHex: c.swatchHex, surcharge: f.surcharge });
  };

  if (lib.isLoading || colours.isLoading) return <p className={styles.muted}>Loading fabrics…</p>;
  if (fabrics.length === 0) return <p className={styles.muted}>No fabrics enabled for this Model.</p>;

  return (
    <>
      <section className={styles.block}>
        <header className={styles.head}>
          <span className={styles.eyebrow}>Fabric</span>
        </header>
        <div className={styles.fabricRow}>
          {fabrics.map((f) => {
            const on = f.id === fabricId;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                className={`${styles.fabricChip} ${on ? styles.fabricChipOn : ''}`}
                onClick={() => {
                  // Selecting a fabric resets colour to its first colour.
                  const first = (colours.data ?? []).filter((c) => c.fabricId === f.id).sort((a, b) => a.sortOrder - b.sortOrder)[0];
                  if (first) pick(f.id, first.colourId);
                }}
              >
                <span className={styles.fabricName}>{f.label}</span>
                <span className={styles.fabricMeta}>{f.surcharge > 0 ? `+${fmtRM(f.surcharge)}` : 'Included'}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles.block}>
        <header className={styles.head}>
          <span className={styles.eyebrow}>Colour</span>
        </header>
        <div className={styles.colourRow}>
          {coloursForFabric.map((c) => {
            const on = c.colourId === colourId;
            return (
              <button
                key={c.colourId}
                type="button"
                aria-pressed={on}
                aria-label={c.label}
                title={c.label}
                className={`${styles.swatch} ${on ? styles.swatchOn : ''}`}
                style={{ background: c.swatchHex ?? '#ccc' }}
                onClick={() => fabricId && pick(fabricId, c.colourId)}
              />
            );
          })}
        </div>
      </section>
    </>
  );
};
```

- [ ] **Step 2: Write the CSS** — match the brand tokens used in `Configurator.module.css` (cream/ink/burnt). Chips = rounded cards; selected chip uses `--c-burnt` border; swatches = 28px rounded squares with a ring when selected.

```css
.block { padding: var(--space-3) 0; }
.head { margin-bottom: var(--space-2); }
.eyebrow { font: var(--t-eyebrow); letter-spacing: .06em; text-transform: uppercase; color: var(--c-ink); }
.muted { color: var(--c-ink); opacity: .55; font: var(--t-caption); padding: var(--space-3) 0; }
.fabricRow { display: flex; gap: 8px; flex-wrap: wrap; }
.fabricChip { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; padding: 8px 12px; min-width: 84px; border: 1px solid rgba(34,31,32,.15); border-radius: 10px; background: #fff; cursor: pointer; }
.fabricChipOn { border: 1.5px solid var(--c-burnt); }
.fabricName { font-weight: 600; color: var(--c-ink); }
.fabricMeta { font: var(--t-caption); color: var(--c-ink); opacity: .6; }
.colourRow { display: flex; gap: 10px; flex-wrap: wrap; }
.swatch { width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(34,31,32,.2); cursor: pointer; padding: 0; }
.swatchOn { box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--c-burnt); }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/components/FabricColourPicker.tsx apps/pos/src/components/FabricColourPicker.module.css
git commit -m "feat(pos): FabricColourPicker component"
```

---

## Task B5: POS Configurator — wire picker into Quick Pick (state, total, gate, snapshot)

**Files:**
- Modify: `apps/pos/src/pages/Configurator.tsx`

- [ ] **Step 1: Lift fabric/colour state + load product fabrics** (near the other sofa state, ~line 92–110)

```tsx
import { fabricSurchargeFor } from '@2990s/shared';
import { useProductFabrics } from '../lib/queries';
import { FabricColourPicker } from '../components/FabricColourPicker';
// …inside Configurator:
const [fabricSel, setFabricSel] = useState<{ fabricId: string; colourId: string; fabricLabel: string; colourLabel: string; colourHex: string | null; surcharge: number } | null>(null);
const productFabrics = useProductFabrics(productId);
```

- [ ] **Step 2: Fold the surcharge into the sofa LIVE TOTAL** — change `sofaTotal`

```tsx
const fabricSurcharge = fabricSel?.surcharge ?? 0;
const sofaTotal = (pickedSofaRow?.price ?? 0) + (pickedSofaRow ? fabricSurcharge : 0);
```

- [ ] **Step 3: Require fabric+colour before Add to Cart** — extend `canAddSofa`

```tsx
const canAddSofa = pickedSofaRow != null && pickedSofaRow.active && pickedSofaRow.price != null && fabricSel != null;
```

- [ ] **Step 4: Write fabric/colour into the snapshot** — in `handleAddSofa`, add to the `SofaConfigSnapshot`

```tsx
      total: (pickedSofaRow.price) + (fabricSel?.surcharge ?? 0),
      fabricId: fabricSel?.fabricId,
      colourId: fabricSel?.colourId,
      fabricLabel: fabricSel?.fabricLabel,
      colourLabel: fabricSel?.colourLabel,
      colourHex: fabricSel?.colourHex ?? undefined,
      summary: lShape
        ? `${pickedSofaRow.bundle.id} · ${pickedSofaRow.bundle.label} · ${quickFlip}-facing · ${activeDepth}"${fabricSel ? ` · ${fabricSel.fabricLabel}/${fabricSel.colourLabel}` : ''}`
        : `${pickedSofaRow.bundle.id} · ${pickedSofaRow.bundle.label} · ${activeDepth}"${fabricSel ? ` · ${fabricSel.fabricLabel}/${fabricSel.colourLabel}` : ''}`,
```

- [ ] **Step 5: Render the picker in the Quick-Pick rail** — pass it into `<SofaQuickPick>` and render it below `qpGrid` (add a `fabricBlock` prop/child)

In the `<SofaQuickPick … />` call (~line 482) add:
```tsx
            fabricBlock={
              <FabricColourPicker
                productFabrics={productFabrics.data ?? []}
                fabricId={fabricSel?.fabricId ?? null}
                colourId={fabricSel?.colourId ?? null}
                onChange={setFabricSel}
              />
            }
```
In `SofaQuickPickProps` add `fabricBlock?: React.ReactNode;` and render `{fabricBlock}` in the `qpRail` **after** the closing `</div>` of `qpGrid` (Configurator.tsx ~line 1103).

- [ ] **Step 6: Auto-select the first fabric** so the rail isn't empty and the total is live — after `productFabrics` loads (small effect):

```tsx
useEffect(() => {
  if (fabricSel || !isSofa) return;
  const first = (productFabrics.data ?? []).find((f) => f.active);
  // The picker resolves labels/colour; here we just trigger its first-colour pick
  // by leaving selection null and letting the user tap, OR pre-resolve below.
}, [productFabrics.data, fabricSel, isSofa]);
```
> Simplest: leave `fabricSel` null until the user taps (the `canAddSofa` gate then forces a choice). If Loo wants a default pre-selected, resolve the first fabric+colour here using the library/colours hooks (move that resolution into `FabricColourPicker` via an `autoSelectFirst` prop). Decide during review.

- [ ] **Step 7: Verify in the running app**

Run: `pnpm --filter @2990s/pos dev`, open a sofa → Quick Pick. Confirm: Fabric + Colour appear under the layout cards; picking Velvet bumps LIVE TOTAL by +300; Add to Cart is disabled until a fabric+colour is chosen; cart line shows `… · Velvet/Sand`.
Also: `pnpm --filter @2990s/pos typecheck` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/pos/src/pages/Configurator.tsx
git commit -m "feat(pos): fabric/colour in Quick-Pick — rail block, total, required gate, snapshot"
```

---

## Task B6: POS CustomBuilder — wire the same picker

**Files:**
- Modify: `apps/pos/src/pages/CustomBuilder.tsx`

- [ ] **Step 1: Read the file** to find its panel layout, its total computation (it calls `computeSofaPrice`), and its `handleAdd` that builds the `SofaConfigSnapshot`.

- [ ] **Step 2: Add fabric/colour state + the picker** — same `fabricSel` state + `<FabricColourPicker productFabrics={useProductFabrics(productId).data ?? []} … onChange={setFabricSel} />` in its panel.

- [ ] **Step 3: Fold surcharge into its total** — `total = computeSofaPrice(cells, depth, pricing).total + (fabricSel?.surcharge ?? 0)`.

- [ ] **Step 4: Gate + snapshot** — require `fabricSel` before its Add-to-Cart; write the same fabric fields + `… · <fabric>/<colour>` suffix into the snapshot (use `summarizeSofaCells(...)` then append the suffix).

- [ ] **Step 5: Verify + typecheck**

Run: `pnpm --filter @2990s/pos dev` → sofa → Customize → build a closed sofa → fabric/colour required, surcharge in total. `pnpm --filter @2990s/pos typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/pages/CustomBuilder.tsx
git commit -m "feat(pos): fabric/colour in Custom Build"
```

---

# Phase C — backend SKU editor

## Task C1: Backend fabric hooks

**Files:**
- Modify: `apps/backend/src/lib/queries.ts`

- [ ] **Step 1: Add `useFabricLibrary`** (backend) — same query as the POS hook in B3 (select all, ordered by `sort_order`; backend may want inactive too — select without the `.eq('active', true)` filter so admin can re-enable). Return `{ id, label, tier, defaultSurcharge, active, sortOrder }`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/lib/queries.ts
git commit -m "feat(backend): useFabricLibrary hook"
```

---

## Task C2: Backend SofaEditor — Fabrics block

**Files:**
- Modify: `apps/backend/src/components/PricingEditor.tsx` (`SkuFormData` ~line 10; `SofaEditor` ~line 95 — add a Fabrics block after the Bundles block ~line 222)

- [ ] **Step 1: Add `fabrics` to `SkuFormData`**

```ts
  fabrics?: { fabricId: string; active: boolean; surcharge: number }[];
```

- [ ] **Step 2: Add the Fabrics block** inside `SofaEditor`, after the Bundles `</div>` block, mirroring the Bundles block exactly (uses `useFabricLibrary`, `useWatch name="fabrics"`, `setValue`, the `ActiveToggle` + `PriceInput` primitives)

```tsx
  const fabrics = useWatch({ control, name: 'fabrics' }) ?? [];
  const fabricLib = useFabricLibrary();
  const activeF = fabrics.filter((f) => f.active).length;
  const setFabricField = (i: number, patch: Partial<{ active: boolean; surcharge: number }>) => {
    setValue('fabrics', fabrics.map((f, idx) => (idx === i ? { ...f, ...patch } : f)), { shouldDirty: true });
  };
  const bulkFabric = (active: boolean) => setValue('fabrics', fabrics.map((f) => ({ ...f, active })), { shouldDirty: true });
  const fabricsErr = (errors as { fabrics?: { message?: string } }).fabrics?.message;
```
JSX (place after the Bundles block):
```tsx
      {/* Fabrics — per-Model availability + surcharge (spec 2026-05-24) */}
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <div>
            <div className={styles.blockTitle}>Fabrics</div>
            <div className={styles.blockSub}>
              Which fabrics this Model offers + the surcharge for each (RM 0 = included).
              Colour is free and comes with each fabric. At least one must be active.
            </div>
            {fabricsErr && <div className={styles.error} style={{ marginTop: 6 }}>{fabricsErr}</div>}
          </div>
          <div className={styles.blockActions}>
            <button type="button" className={styles.miniBtn} onClick={() => bulkFabric(true)}>All on</button>
            <button type="button" className={styles.miniBtn} onClick={() => bulkFabric(false)}>All off</button>
          </div>
        </div>
        <div className={styles.rows}>
          {fabrics.map((f, i) => {
            const def = (fabricLib.data ?? []).find((l) => l.id === f.fabricId);
            return (
              <div key={f.fabricId} className={`${styles.row} ${f.active ? '' : styles.rowOff}`}>
                <ActiveToggle value={f.active} onChange={(v) => setFabricField(i, { active: v })} />
                <code className={styles.rowId}>{f.fabricId}</code>
                <span className={styles.rowLabel}>
                  {def?.label ?? f.fabricId}
                  {def?.tier && <span className={styles.rowSub}> · {def.tier}</span>}
                </span>
                <PriceInput value={f.surcharge} onChange={(v) => setFabricField(i, { surcharge: v })} disabled={!f.active} />
              </div>
            );
          })}
        </div>
      </div>
```
Update the `<header>` stat to include fabrics: `… · {activeF}/{fabrics.length} fabrics`. Import `useFabricLibrary` at the top.

- [ ] **Step 3: Typecheck + visual check**

Run: `pnpm --filter @2990s/backend typecheck` → PASS. `pnpm --filter @2990s/backend dev` → open a sofa SKU → the Fabrics block lists library fabrics with toggle + surcharge.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/components/PricingEditor.tsx
git commit -m "feat(backend): SofaEditor fabrics block (per-Model toggle + surcharge)"
```

---

## Task C3: SkuDrawer — load + submit `fabrics`

**Files:**
- Modify: `apps/backend/src/components/SkuDrawer.tsx`

- [ ] **Step 1: Read the file** to find (a) where it builds the RHF default values for a sofa SKU (it loads compartments/bundles), and (b) where it submits — the create path calls `create_product_with_pricing` (already extended in A2), and the edit/update path writes pricing rows.

- [ ] **Step 2: Seed `fabrics` form defaults** — when opening a sofa SKU, build `fabrics` from `useFabricLibrary()` joined with the product's `product_fabrics` rows: every library fabric becomes a row `{ fabricId, active: existing?.active ?? (isNew ? true : false), surcharge: existing?.surcharge ?? library.defaultSurcharge }`. (Mirror exactly how bundles defaults are built from `bundle_library` + `product_bundles`.)

- [ ] **Step 3: Include `fabrics` in the create payload** — the RPC reads `p->'fabrics'` (A2); ensure the submit object passes `fabrics`.

- [ ] **Step 4: Handle the edit/update path** — wherever the edit flow upserts `product_bundles`/`product_compartments`, add an upsert + delete-removed for `product_fabrics` (same delete-then-insert or upsert strategy the edit path already uses for bundles). If edit goes through a dedicated RPC, extend that RPC too (new migration if needed — number after 0044).

- [ ] **Step 5: Verify end-to-end** — create a new sofa SKU with 2 fabrics active (one +RM surcharge), save, reopen → values persist; POS configurator shows them. Edit an existing sofa's surcharge → POS LIVE TOTAL updates within ~300ms (realtime). `pnpm --filter @2990s/backend typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/components/SkuDrawer.tsx packages/db/migrations/
git commit -m "feat(backend): SkuDrawer loads + persists product_fabrics"
```

---

# Phase D — Sales Order display

## Task D1: Fabric/colour on the printed Sales Order

**Files:**
- Modify: `packages/shared/src/sofa-build.ts` (add a small display helper)
- Modify: `apps/pos/src/pages/SalesOrderPrint.tsx`
- Test: `packages/shared/src/__tests__/sofa-build.test.ts`

- [ ] **Step 1: Write the failing test** for a display helper

```ts
import { fabricColourSuffix } from '../sofa-build';
describe('fabricColourSuffix', () => {
  it('formats fabric + colour', () => {
    expect(fabricColourSuffix('Velvet', 'Sand')).toBe(' · Velvet / Sand');
  });
  it('returns empty when missing', () => {
    expect(fabricColourSuffix(null, null)).toBe('');
    expect(fabricColourSuffix('Velvet', null)).toBe('');
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @2990s/shared test -- sofa-build`
Expected: FAIL — not a function.

- [ ] **Step 3: Implement the helper**

```ts
/** Display-only fabric/colour suffix for an invoice/cart sofa line. */
export const fabricColourSuffix = (fabricLabel?: string | null, colourLabel?: string | null): string =>
  fabricLabel && colourLabel ? ` · ${fabricLabel} / ${colourLabel}` : '';
```

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm --filter @2990s/shared test -- sofa-build`
Expected: PASS.

- [ ] **Step 5: Render on the Sales Order** — in `SalesOrderPrint.tsx`, where the sofa line description is built from `order_items.config` (it already reads config + calls `describeSofaLine`), append `fabricColourSuffix(config.fabricLabel, config.colourLabel)`; if the surcharge is non-zero (derivable: line `unit_price` vs the bundle base, or simply when fabric tier is premium) show a transparent note `Premium fabric +RM…`. Confirm the exact render site by reading the file.

- [ ] **Step 6: Verify** — print a sofa order placed with Velvet/Sand → the line shows `… · Velvet / Sand`. `pnpm --filter @2990s/pos typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/sofa-build.ts packages/shared/src/__tests__/sofa-build.test.ts apps/pos/src/pages/SalesOrderPrint.tsx
git commit -m "feat: fabric/colour on the printed Sales Order"
```

---

## Task D2: ~~Fabric/colour onto the factory PO~~ — DROPPED (Loo 2026-05-24)

Loo won't issue POs from this system; the Sales Order (D1) listing fabric + colour is
sufficient. No PO-side work. (`purchase_order_lines.colour` stays available for a future
need.) Skip this task.

---

# Final verification

- [ ] **Full typecheck:** `pnpm typecheck` → PASS across all packages.
- [ ] **Full test:** `pnpm test` → PASS (new sofa-build/pricing/product/order/orders tests green; note any pre-existing known failures listed in project memory, unchanged).
- [ ] **Manual smoke (POS):** place a sofa order with a premium fabric → LIVE TOTAL includes surcharge → submit succeeds → server total matches (no 422/drift) → Sales Order print shows fabric/colour.
- [ ] **Tamper check:** POST a sofa order with `fabricId` omitted or an inactive fabric → API returns 422 `unknown_fabric`/`inactive_fabric`; a colour not belonging to the fabric → 422 `invalid_colour`.

---

## Self-review notes (author)

- **Spec coverage:** G1 (surcharge) → A3/A4/B5; G2 (global+per-Model) → A1/A2/C2; G3 (nested colours) → A1/B4; G4 (capture only) → A4 config + D1 (Sales Order display; PO dropped per Loo, no inventory tie-in); G5 (left-rail placement) → B4/B5; G6 (both modes + required) → B5/B6 + A4 enforcement; G7 (flat per-line) → A4 (`unitPrice += surcharge` once); G8 (colours global per fabric) → B4 (`coloursForFabric`); G9 (seed-only library) → A2 seed, no admin-CRUD task. Cross-join migration risk (§3.7) → A2. Server-recompute parity (§6) → A4 + B1.
- **Type consistency:** `SofaProductPricingFabric{fabricId,active,surcharge,colourIds}` used identically in A3 (engine), A4 (recompute), B1 (API builder). Snapshot/config fields `fabricId,colourId,fabricLabel,colourLabel,colourHex` consistent across cart.ts (B2), order.schema (A5), pricing `SofaLineConfig` (A4), Configurator snapshot (B5). Hook return types `FabricLibraryRow/FabricColourRow/ProductFabricRow` shared B3 ↔ B4 ↔ C1.
- **Open confirmations folded as review-time decisions:** B5 Step 6 (pre-select first fabric vs force tap); D1 Step 5 (how to surface the surcharge note on the invoice). Neither blocks implementation.
