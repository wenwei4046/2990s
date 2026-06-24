# Part B-1 — Sales Analysis foundation (gating + endpoint + Overview KPIs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the read-only **Sales Analysis** page shell (super-admin-tier, under POS Maintain) backed by a new server-side `GET /sales-analysis` endpoint, with the first tab — **Overview** — showing order count, AOV, average delivery fee, gross margin %, and a monthly trend. This is the backbone the later tabs (Products, Customers, Promotions, Salespeople) reuse.

**Architecture:** A pure aggregation core in `@2990s/shared` (collapse cross-category follow-up SOs into "physical purchases" via union-find; summarize order/AOV/delivery/margin; monthly rollup) is fed by a thin Hono route that loads `mfg_sales_orders` + the `SVC-DELIVERY*` lines and returns display-ready aggregates. The POS page fetches it with the user's JWT and renders KPI cards + a CSS-bar trend. All read-only; money is integer centi end-to-end, RM only at display.

**Tech Stack:** pnpm workspace + Turborepo, TS 5.7 strict, React 19 + React Router 7 (POS), Hono on CF Workers (API), Drizzle + Supabase, Vitest.

## Global Constraints

- **Drizzle schema is the source of truth**; migrations append-only, applied to prod via the **Supabase MCP** (`apply_migration` / `execute_sql`).
- **Money** is integer **centi** end-to-end; convert to RM only at display (`fmtCenti` from `@2990s/shared`).
- **Gating:** the page mirrors the existing Maintain items — sidebar link + route both via `isGlobalCurator` = **`sales_director` / `admin` / `super_admin`** (the `MaintainGate` comment naming "master_account" is stale). The API endpoint gates to **the same three roles**.
- **Verified data rules (spec cross-cutting):** "physical purchase" collapses `cross_category_source_doc_no` chains/cycles (union-find); exclude cancelled (`status NOT IN ('CANCELLED','ON_HOLD')`); delivery = **sum of `item_code LIKE 'SVC-DELIVERY%'` lines** (`cancelled=false`), never the header `delivery_fee_centi`; AOV headline = full total incl. delivery (`total_revenue_centi`), product-only (minus `service_centi`) secondary; show **both** per-SO and per-purchase; show **n** + a min-sample guard on every rate; default **exclude test orders** (`is_test`).
- **No charting library** — simple CSS bars only.
- **Brand voice in copy:** warm, sentence case, no emoji, no hype.
- **Deploy** is owner-gated (do not deploy as part of this plan). Migration is applied; code deploy waits for approval. PWA hard-refresh reminder after a POS deploy.
- **Commits** end with the repo trailer (`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: …`) per CLAUDE.md.

**Reference numbers (live prod, ~43 SOs, mostly test — for cross-check in Task 5):** AOV full ≈ RM 2,725.00; avg delivery over all ≈ RM 204.07; avg delivery when charged ≈ RM 258.09 (34 charged).

---

### Task 1: Pure aggregation core (`@2990s/shared`)

**Files:**
- Create: `packages/shared/src/sales-analysis.ts`
- Create (test): `packages/shared/src/sales-analysis.test.ts`
- Modify: `packages/shared/src/index.ts` (add export)

**Interfaces:**
- Produces: `SaOrderRow`, `OverviewResult`, `MonthlyRow` types; `collapseToPurchases(orders) → string[][]`; `summarizeOverview(orders, deliveryByDoc) → OverviewResult`; `monthlyTrend(orders) → MonthlyRow[]`. Consumed by Task 3 (API) and Task 4 (POS types).

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/sales-analysis.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  collapseToPurchases, summarizeOverview, monthlyTrend, type SaOrderRow,
} from './sales-analysis';

const o = (docNo: string, over: Partial<SaOrderRow> = {}): SaOrderRow => ({
  docNo, sourceDocNo: null, soDate: '2026-06-12',
  totalRevenueCenti: 0, totalMarginCenti: 0, serviceCenti: 0, ...over,
});

describe('collapseToPurchases', () => {
  it('treats standalone SOs as singleton purchases', () => {
    const g = collapseToPurchases([{ docNo: 'A', sourceDocNo: null }, { docNo: 'B', sourceDocNo: null }]);
    expect(g.map((x) => x.sort()).sort()).toEqual([['A'], ['B']]);
  });
  it('merges a follow-up into its source (A follows B)', () => {
    const g = collapseToPurchases([{ docNo: 'A', sourceDocNo: 'B' }, { docNo: 'B', sourceDocNo: null }]);
    expect(g).toEqual([['A', 'B']]);
  });
  it('collapses a 3-SO chain C→B→A into one purchase', () => {
    const g = collapseToPurchases([
      { docNo: 'A', sourceDocNo: null }, { docNo: 'B', sourceDocNo: 'A' }, { docNo: 'C', sourceDocNo: 'B' },
    ]);
    expect(g).toEqual([['A', 'B', 'C']]);
  });
  it('handles a 2-cycle (A↔B) without looping', () => {
    const g = collapseToPurchases([{ docNo: 'A', sourceDocNo: 'B' }, { docNo: 'B', sourceDocNo: 'A' }]);
    expect(g).toEqual([['A', 'B']]);
  });
  it('ignores a source not in the loaded set (period excluded it)', () => {
    const g = collapseToPurchases([{ docNo: 'A', sourceDocNo: 'GONE' }]);
    expect(g).toEqual([['A']]);
  });
});

describe('summarizeOverview', () => {
  const orders: SaOrderRow[] = [
    o('A', { totalRevenueCenti: 300000, totalMarginCenti: 90000, serviceCenti: 20000, sourceDocNo: null }),
    o('B', { totalRevenueCenti: 100000, totalMarginCenti: 30000, serviceCenti: 0, sourceDocNo: 'A' }), // follow-up of A
    o('C', { totalRevenueCenti: 200000, totalMarginCenti: 40000, serviceCenti: 10000, sourceDocNo: null }),
  ];
  const delivery = new Map<string, number>([['A', 20000], ['C', 10000]]); // B has no delivery line

  it('counts orders by SO and by collapsed purchase', () => {
    const r = summarizeOverview(orders, delivery);
    expect(r.orderCount.bySo).toBe(3);
    expect(r.orderCount.byPurchase).toBe(2); // {A,B} + {C}
  });
  it('AOV full vs product, per SO and per purchase', () => {
    const r = summarizeOverview(orders, delivery);
    // full per SO = (300000+100000+200000)/3 = 200000
    expect(r.aovCenti.perSo.full).toBe(200000);
    // product per SO = (600000 - service 30000)/3 = 190000
    expect(r.aovCenti.perSo.product).toBe(190000);
    // full per purchase = 600000/2 = 300000
    expect(r.aovCenti.perPurchase.full).toBe(300000);
  });
  it('delivery average over all vs only charged orders', () => {
    const r = summarizeOverview(orders, delivery);
    expect(r.deliveryCenti.chargedCount).toBe(2);
    expect(r.deliveryCenti.avgAll).toBe(10000);     // 30000 / 3
    expect(r.deliveryCenti.avgCharged).toBe(15000); // 30000 / 2
  });
  it('gross margin % = margin / revenue', () => {
    const r = summarizeOverview(orders, delivery);
    expect(r.grossMarginPct).toBeCloseTo((160000 / 600000) * 100, 6);
  });
  it('is safe on an empty set (no divide-by-zero)', () => {
    const r = summarizeOverview([], new Map());
    expect(r.orderCount).toEqual({ bySo: 0, byPurchase: 0 });
    expect(r.aovCenti.perSo.full).toBe(0);
    expect(r.grossMarginPct).toBeNull();
  });
});

describe('monthlyTrend', () => {
  it('groups by YYYY-MM, sums revenue/margin/orders, sorted', () => {
    const rows = monthlyTrend([
      o('A', { soDate: '2026-05-30', totalRevenueCenti: 100, totalMarginCenti: 10 }),
      o('B', { soDate: '2026-06-02', totalRevenueCenti: 200, totalMarginCenti: 20 }),
      o('C', { soDate: '2026-06-20', totalRevenueCenti: 300, totalMarginCenti: 30 }),
    ]);
    expect(rows).toEqual([
      { month: '2026-05', orders: 1, revenueCenti: 100, marginCenti: 10 },
      { month: '2026-06', orders: 2, revenueCenti: 500, marginCenti: 50 },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @2990s/shared run test sales-analysis`
Expected: FAIL — cannot find module `./sales-analysis`.

- [ ] **Step 3: Write the module**

Create `packages/shared/src/sales-analysis.ts`:

```ts
// sales-analysis — pure aggregation core for the Sales Analysis page (Part B).
// Read-only: inputs are plain rows the API loads; outputs are display-ready
// aggregates. Money is integer centi throughout (UI converts to RM). Per the
// spec's cross-cutting rules: a "physical purchase" collapses cross-category
// follow-up SO chains into one; cancelled orders are filtered upstream.

export interface SaOrderRow {
  docNo: string;
  /** cross_category_source_doc_no — the earlier SO this one follows up; null = standalone. */
  sourceDocNo: string | null;
  /** so_date as 'YYYY-MM-DD'. */
  soDate: string;
  /** total_revenue_centi — full order grand total incl. delivery/service. */
  totalRevenueCenti: number;
  /** total_margin_centi. */
  totalMarginCenti: number;
  /** service_centi — delivery+lift+dispose bucket; subtracted for product-only. */
  serviceCenti: number;
}

export interface OverviewResult {
  /** Sample size = non-cancelled orders in scope. */
  n: number;
  orderCount: { bySo: number; byPurchase: number };
  aovCenti: {
    perSo: { full: number; product: number };
    perPurchase: { full: number; product: number };
  };
  deliveryCenti: { avgAll: number; avgCharged: number; chargedCount: number };
  /** margin / revenue × 100; null when revenue is 0. */
  grossMarginPct: number | null;
}

export interface MonthlyRow {
  month: string; // 'YYYY-MM'
  orders: number;
  revenueCenti: number;
  marginCenti: number;
}

/** Union-find collapse of cross_category follow-up chains into physical
 *  purchases. Handles chains (C→B→A) and cycles (A↔B). A standalone SO is its
 *  own singleton. Groups (and docs within them) are sorted for deterministic
 *  output. A source not present in `orders` is ignored (the period window may
 *  have excluded the partner SO). */
export function collapseToPurchases(
  orders: ReadonlyArray<{ docNo: string; sourceDocNo: string | null }>,
): string[][] {
  const parent = new Map<string, string>();
  const ensure = (x: string): void => { if (!parent.has(x)) parent.set(x, x); };
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) { const next = parent.get(cur)!; parent.set(cur, root); cur = next; }
    return root;
  };
  const union = (a: string, b: string): void => {
    ensure(a); ensure(b);
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const known = new Set(orders.map((row) => row.docNo));
  for (const row of orders) {
    ensure(row.docNo);
    if (row.sourceDocNo && known.has(row.sourceDocNo)) union(row.docNo, row.sourceDocNo);
  }
  const groups = new Map<string, string[]>();
  for (const row of orders) {
    const r = find(row.docNo);
    const arr = groups.get(r);
    if (arr) arr.push(row.docNo); else groups.set(r, [row.docNo]);
  }
  return [...groups.values()].map((g) => [...g].sort()).sort((a, b) => a[0]!.localeCompare(b[0]!));
}

const divRound = (num: number, den: number): number => (den > 0 ? Math.round(num / den) : 0);

export function summarizeOverview(
  orders: ReadonlyArray<SaOrderRow>,
  deliveryByDoc: ReadonlyMap<string, number>,
): OverviewResult {
  const n = orders.length;
  const purchaseCount = collapseToPurchases(orders).length;

  let sumRevenue = 0; let sumMargin = 0; let sumService = 0; let sumDelivery = 0; let chargedCount = 0;
  for (const ord of orders) {
    sumRevenue += ord.totalRevenueCenti;
    sumMargin += ord.totalMarginCenti;
    sumService += ord.serviceCenti;
    const d = deliveryByDoc.get(ord.docNo) ?? 0;
    sumDelivery += d;
    if (d > 0) chargedCount += 1;
  }
  const sumProduct = sumRevenue - sumService;

  return {
    n,
    orderCount: { bySo: n, byPurchase: purchaseCount },
    aovCenti: {
      perSo: { full: divRound(sumRevenue, n), product: divRound(sumProduct, n) },
      perPurchase: { full: divRound(sumRevenue, purchaseCount), product: divRound(sumProduct, purchaseCount) },
    },
    deliveryCenti: {
      avgAll: divRound(sumDelivery, n),
      avgCharged: divRound(sumDelivery, chargedCount),
      chargedCount,
    },
    grossMarginPct: sumRevenue > 0 ? (sumMargin / sumRevenue) * 100 : null,
  };
}

export function monthlyTrend(orders: ReadonlyArray<SaOrderRow>): MonthlyRow[] {
  const byMonth = new Map<string, MonthlyRow>();
  for (const ord of orders) {
    const month = ord.soDate.slice(0, 7);
    const row = byMonth.get(month) ?? { month, orders: 0, revenueCenti: 0, marginCenti: 0 };
    row.orders += 1;
    row.revenueCenti += ord.totalRevenueCenti;
    row.marginCenti += ord.totalMarginCenti;
    byMonth.set(month, row);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}
```

- [ ] **Step 4: Add the package export**

In `packages/shared/src/index.ts`, append after the `customer-demographics` export line:

```ts
export * from './sales-analysis'; // 2026-06-25 — Sales Analysis pure aggregation core (Part B)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @2990s/shared run test sales-analysis`
Expected: PASS (all describe blocks green).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sales-analysis.ts packages/shared/src/sales-analysis.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): Sales Analysis aggregation core (purchases, overview, monthly)"
```

---

### Task 2: `is_test` column for the test-data filter

**Files:**
- Create: `packages/db/migrations/0186_so_is_test.sql`
- Modify: `packages/db/src/schema.ts` (mfg_sales_orders — add after `customerAgeFrame`)

**Interfaces:**
- Produces: `mfg_sales_orders.is_test boolean NOT NULL DEFAULT false`. Consumed by Task 3 (endpoint filter).

- [ ] **Step 1: Write the migration**

Create `packages/db/migrations/0186_so_is_test.sql`:

```sql
-- 0186_so_is_test.sql
-- Sales Analysis (2026-06-25): a flag to exclude smoke-test SOs from analytics.
-- The current live set is mostly staff tests (junk names, shared phones), so
-- every analytics rate is noise until they are excluded. Default false; the
-- analysis endpoint excludes is_test=true unless ?includeTest=true. Flagging
-- the actual test rows is a SEPARATE owner-confirmed backfill (do not guess
-- which orders are real).

ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Update the Drizzle schema**

In `packages/db/src/schema.ts`, immediately after the `customerAgeFrame: text('customer_age_frame'),` line (added in Part A, mig 0185), insert:

```ts
  /* Sales Analysis test-data filter (2026-06-25, migration 0186) — excludes
     smoke-test SOs from analytics by default. NOT NULL default false; flagging
     real test rows is an owner-confirmed backfill, not automated. */
  isTest:                         boolean('is_test').notNull().default(false),
```

(`boolean` is already imported in schema.ts — confirm it appears in the drizzle-orm/pg-core import; it is used widely, e.g. `cancelled: boolean(...)`.)

- [ ] **Step 3: Apply via Supabase MCP**

Apply with `apply_migration` name `0186_so_is_test` and the SQL from Step 1.

- [ ] **Step 4: Verify**

Run via `execute_sql`:

```sql
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_name = 'mfg_sales_orders' and column_name = 'is_test';
```
Expected: one row, `boolean`, default `false`, `is_nullable = NO`.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @2990s/db typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/0186_so_is_test.sql packages/db/src/schema.ts
git commit -m "feat(db): add mfg_sales_orders.is_test for the analytics test-data filter (mig 0186)"
```

---

### Task 3: `GET /sales-analysis` endpoint

**Files:**
- Create: `apps/api/src/routes/sales-analysis.ts`
- Modify: `apps/api/src/index.ts` (import + mount)

**Interfaces:**
- Consumes: `summarizeOverview`, `monthlyTrend`, `SaOrderRow` from `@2990s/shared` (Task 1); `is_test` column (Task 2).
- Produces: `GET /sales-analysis?period=all|YYYY-MM&includeTest=false` → `{ period, includeTest, overview: OverviewResult, monthly: MonthlyRow[] }`. Consumed by Task 4 (POS hook).

- [ ] **Step 1: Write the route module**

Create `apps/api/src/routes/sales-analysis.ts`:

```ts
// /sales-analysis — read-only analytics for the POS Sales Analysis page.
// Gated to the same roles as the POS MaintainGate (isGlobalCurator:
// sales_director / admin / super_admin). Aggregation lives in the shared pure
// core (@2990s/shared sales-analysis); this route only loads rows and shapes
// the response. Money is integer centi.

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { summarizeOverview, monthlyTrend, type SaOrderRow } from '@2990s/shared';

const CURATOR_ROLES = new Set(['sales_director', 'admin', 'super_admin']);

export const salesAnalysis = new Hono<{ Bindings: Env; Variables: Variables }>();
salesAnalysis.use('*', supabaseAuth);

salesAnalysis.get('/', async (c) => {
  const sb = c.get('supabase');
  const userId = c.get('user').id;

  // Gate: same role set as the POS MaintainGate / isGlobalCurator.
  const staffRes = await sb.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (staffRes.error) return c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500);
  if (!staffRes.data || !staffRes.data.active || !CURATOR_ROLES.has(staffRes.data.role)) {
    return c.json({ error: 'forbidden', reason: 'sales_analysis_curator_only' }, 403);
  }

  const period = (c.req.query('period') ?? 'all').trim(); // 'all' | 'YYYY-MM'
  const includeTest = c.req.query('includeTest') === 'true';

  // Load all non-cancelled orders (monthly trend always spans everything;
  // the period filter scopes only the Overview below).
  let q = sb
    .from('mfg_sales_orders')
    .select('doc_no, cross_category_source_doc_no, so_date, total_revenue_centi, total_margin_centi, service_centi, is_test')
    .not('status', 'in', '("CANCELLED","ON_HOLD")');
  if (!includeTest) q = q.not('is_test', 'is', true);
  const { data: orderRows, error: ordErr } = await q.limit(100000);
  if (ordErr) return c.json({ error: 'load_failed', reason: ordErr.message }, 500);

  type Raw = {
    doc_no: string; cross_category_source_doc_no: string | null; so_date: string;
    total_revenue_centi: number | null; total_margin_centi: number | null; service_centi: number | null;
  };
  const allOrders: SaOrderRow[] = ((orderRows ?? []) as Raw[]).map((r) => ({
    docNo: r.doc_no,
    sourceDocNo: r.cross_category_source_doc_no ?? null,
    soDate: r.so_date,
    totalRevenueCenti: Number(r.total_revenue_centi) || 0,
    totalMarginCenti: Number(r.total_margin_centi) || 0,
    serviceCenti: Number(r.service_centi) || 0,
  }));

  const monthly = monthlyTrend(allOrders);
  const scoped = /^\d{4}-\d{2}$/.test(period)
    ? allOrders.filter((row) => row.soDate.slice(0, 7) === period)
    : allOrders;

  // Delivery actually charged = SVC-DELIVERY* lines (base + CROSS + ADD),
  // summed per doc, non-cancelled — for the scoped orders only.
  const docNos = scoped.map((row) => row.docNo);
  const deliveryByDoc = new Map<string, number>();
  if (docNos.length) {
    const { data: delRows, error: delErr } = await sb
      .from('mfg_sales_order_items')
      .select('doc_no, total_centi')
      .like('item_code', 'SVC-DELIVERY%')
      .eq('cancelled', false)
      .in('doc_no', docNos);
    if (delErr) return c.json({ error: 'load_failed', reason: delErr.message }, 500);
    for (const r of (delRows ?? []) as Array<{ doc_no: string; total_centi: number | null }>) {
      deliveryByDoc.set(r.doc_no, (deliveryByDoc.get(r.doc_no) ?? 0) + (Number(r.total_centi) || 0));
    }
  }

  const overview = summarizeOverview(scoped, deliveryByDoc);
  return c.json({ period, includeTest, overview, monthly });
});
```

- [ ] **Step 2: Mount the route**

In `apps/api/src/index.ts`, add the import alongside the other route imports (near the `mfg-sales-orders` import):

```ts
import { salesAnalysis } from './routes/sales-analysis';
```

And mount it alongside the other `app.route(...)` calls (e.g. just before `app.route('/hr', ...)`):

```ts
app.route('/sales-analysis', salesAnalysis);
```

- [ ] **Step 3: Typecheck the API**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS. (If `Env`/`Variables` import path differs from `../env`, match whatever `outstanding.ts` imports — open it and mirror the exact import.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/sales-analysis.ts apps/api/src/index.ts
git commit -m "feat(api): GET /sales-analysis — overview KPIs + monthly trend (curator-gated)"
```

---

### Task 4: POS page — hook, route, sidebar link, Overview UI

**Files:**
- Create: `apps/pos/src/lib/sales-analysis-queries.ts`
- Create: `apps/pos/src/pages/SalesAnalysis.tsx`
- Create: `apps/pos/src/pages/SalesAnalysis.module.css`
- Modify: `apps/pos/src/router.tsx` (lazy import + route)
- Modify: `apps/pos/src/pages/Catalog.tsx` (sidebar link + icon import)

**Interfaces:**
- Consumes: `OverviewResult`, `MonthlyRow` types from `@2990s/shared` (Task 1); `GET /sales-analysis` (Task 3); `fmtCenti`, `fmtQty` from `@2990s/shared`.
- Produces: the `/sales-analysis` route renders the Overview tab.

- [ ] **Step 1: Write the query hook**

Create `apps/pos/src/lib/sales-analysis-queries.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import type { OverviewResult, MonthlyRow } from '@2990s/shared';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export interface SalesAnalysisResponse {
  period: string;
  includeTest: boolean;
  overview: OverviewResult;
  monthly: MonthlyRow[];
}

export function useSalesAnalysis(period: string, includeTest: boolean) {
  return useQuery({
    queryKey: ['sales-analysis', period, includeTest],
    staleTime: 60_000,
    queryFn: async (): Promise<SalesAnalysisResponse> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const params = new URLSearchParams({ period });
      if (includeTest) params.set('includeTest', 'true');
      const res = await fetch(`${API_URL}/sales-analysis?${params.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /sales-analysis failed (${res.status})`);
      return (await res.json()) as SalesAnalysisResponse;
    },
  });
}
```

- [ ] **Step 2: Write the page CSS module**

Create `apps/pos/src/pages/SalesAnalysis.module.css`:

```css
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6) var(--space-7);
  background: var(--c-cream);
  min-height: 100%;
}
.headerRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.titleBlock { display: flex; align-items: center; gap: var(--space-3); }
.backBtn {
  display: inline-flex; align-items: center; gap: 6px;
  color: var(--c-ink); text-decoration: none; font-size: var(--fs-14);
}
.title { font-size: var(--fs-20); margin: 0; color: var(--c-ink); }
.controls { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
.controls select { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; }
.toggle { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-14); color: var(--c-ink); }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-3); }
.card { background: #fff; border: 1px solid var(--line); border-radius: var(--radius-md); padding: var(--space-4); display: flex; flex-direction: column; gap: 4px; }
.cardLabel { font-size: var(--fs-12); color: #6b6b6b; text-transform: uppercase; letter-spacing: 0.03em; }
.cardValue { font-size: var(--fs-24); color: var(--c-ink); font-weight: 600; }
.cardSub { font-size: var(--fs-13); color: #6b6b6b; }

.section { background: #fff; border: 1px solid var(--line); border-radius: var(--radius-md); padding: var(--space-4); }
.sectionTitle { font-size: var(--fs-16); margin: 0 0 var(--space-3); color: var(--c-ink); }
.trendRow { display: grid; grid-template-columns: 80px 1fr 120px; align-items: center; gap: var(--space-3); padding: 4px 0; }
.bar { height: 14px; background: var(--c-accent, #b06a3b); border-radius: 3px; min-width: 2px; }
.barTrack { background: #f0ebe4; border-radius: 3px; }
.muted { color: #9a9a9a; }
.note { font-size: var(--fs-13); color: #9a6a2a; }
```

- [ ] **Step 3: Write the page component**

Create `apps/pos/src/pages/SalesAnalysis.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { fmtCenti, fmtQty } from '@2990s/shared';
import { Topbar } from '../components/Topbar';
import { useSalesAnalysis } from '../lib/sales-analysis-queries';
import styles from './SalesAnalysis.module.css';

const MIN_SAMPLE = 10; // below this, rates are noise — flag them.

const pct = (v: number | null): string => (v == null ? '—' : `${v.toFixed(1)}%`);

export const SalesAnalysis = () => {
  const [period, setPeriod] = useState('all');
  const [includeTest, setIncludeTest] = useState(false);
  const { data, isLoading, error } = useSalesAnalysis(period, includeTest);

  // Period options derive from the (always-full) monthly trend.
  const monthOptions = useMemo(() => (data?.monthly ?? []).map((m) => m.month).reverse(), [data]);
  const maxRevenue = useMemo(
    () => Math.max(1, ...(data?.monthly ?? []).map((m) => m.revenueCenti)),
    [data],
  );

  const ov = data?.overview;
  const thin = !!ov && ov.n < MIN_SAMPLE;

  return (
    <>
      <Topbar />
      <div className={styles.page}>
        <div className={styles.headerRow}>
          <div className={styles.titleBlock}>
            <Link to="/catalog" className={styles.backBtn}>
              <ArrowLeft size={16} strokeWidth={1.75} /> <span>Catalog</span>
            </Link>
            <h1 className={styles.title}>Sales analysis</h1>
          </div>
          <div className={styles.controls}>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="all">All time</option>
              {monthOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <label className={styles.toggle}>
              <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />
              Include test orders
            </label>
          </div>
        </div>

        {isLoading && <p className={styles.muted}>Loading…</p>}
        {error && <p className={styles.note}>Could not load analytics: {(error as Error).message}</p>}

        {ov && (
          <>
            {thin && (
              <p className={styles.note}>
                Only {ov.n} order{ov.n === 1 ? '' : 's'} in this view — figures are directional, not a stable trend.
              </p>
            )}

            <div className={styles.cards}>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Orders</span>
                <span className={styles.cardValue}>{fmtQty(ov.orderCount.bySo)}</span>
                <span className={styles.cardSub}>{fmtQty(ov.orderCount.byPurchase)} physical purchases (cross-category merged)</span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>AOV (per order)</span>
                <span className={styles.cardValue}>{fmtCenti(ov.aovCenti.perSo.full)}</span>
                <span className={styles.cardSub}>
                  {fmtCenti(ov.aovCenti.perSo.product)} goods only · {fmtCenti(ov.aovCenti.perPurchase.full)}/purchase
                </span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Avg delivery fee</span>
                <span className={styles.cardValue}>{fmtCenti(ov.deliveryCenti.avgAll)}</span>
                <span className={styles.cardSub}>
                  {fmtCenti(ov.deliveryCenti.avgCharged)} when charged ({fmtQty(ov.deliveryCenti.chargedCount)} orders)
                </span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Gross margin</span>
                <span className={styles.cardValue}>{pct(ov.grossMarginPct)}</span>
                <span className={styles.cardSub}>n = {fmtQty(ov.n)} orders</span>
              </div>
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Monthly trend (revenue)</h2>
              {(data?.monthly ?? []).length === 0 && <p className={styles.muted}>No orders yet.</p>}
              {(data?.monthly ?? []).map((m) => (
                <div key={m.month} className={styles.trendRow}>
                  <span className={styles.cardSub}>{m.month}</span>
                  <span className={styles.barTrack}>
                    <span
                      className={styles.bar}
                      style={{ width: `${Math.round((m.revenueCenti / maxRevenue) * 100)}%` }}
                    />
                  </span>
                  <span className={styles.cardSub}>{fmtCenti(m.revenueCenti)} · {fmtQty(m.orders)} ord</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
};
```

- [ ] **Step 4: Add the route**

In `apps/pos/src/router.tsx`, add the lazy import alongside the other Maintain page imports (near `Products` / `SalesOrderMaintenance`):

```tsx
const SalesAnalysis = lazy(() => import('./pages/SalesAnalysis').then((m) => ({ default: m.SalesAnalysis })));
```

And add the route in the children array, after the `/sales-order-maintenance` route:

```tsx
{ path: '/sales-analysis', element: <AuthGate><MaintainGate><SalesAnalysis /></MaintainGate></AuthGate> },
```

- [ ] **Step 5: Add the sidebar link**

In `apps/pos/src/pages/Catalog.tsx`, add `BarChart3` to the existing `lucide-react` import block (the one that already imports `Package`, `Settings`, `Plus`, …):

```tsx
  BarChart3,
```

Then, inside the `{isGlobalCurator(staff?.role) && ( … )}` Maintain block, after the `/sales-order-maintenance` `<Link>`, add:

```tsx
    <Link to="/sales-analysis" className={styles.sideItem}>
      <BarChart3 size={16} strokeWidth={1.75} />
      <span className={styles.sideLabel}>Sales analysis</span>
    </Link>
```

- [ ] **Step 6: Typecheck the POS app**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/pos/src/lib/sales-analysis-queries.ts apps/pos/src/pages/SalesAnalysis.tsx apps/pos/src/pages/SalesAnalysis.module.css apps/pos/src/router.tsx apps/pos/src/pages/Catalog.tsx
git commit -m "feat(pos): Sales Analysis page — Overview KPIs + monthly trend (Maintain, curator-gated)"
```

---

### Task 5: Full gate + cross-check against live data

**Files:** none (verification only).

- [ ] **Step 1: Workspace gates**

Run: `pnpm typecheck` → PASS (all packages).
Run: `pnpm test` → PASS (includes the new `sales-analysis` core tests).
Run: `pnpm lint` → no NEW errors from the changed files (the pre-existing `apps/backend/.../authed-fetch.ts` error is unrelated).
Run: `ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos exec vite build` → PASS (POS bundles, new SalesAnalysis chunk emitted).

- [ ] **Step 2: Cross-check the aggregation against a direct SQL query**

Via Supabase MCP `execute_sql`, compute the same headline numbers directly and compare to what the endpoint's core produces (reference: AOV full ≈ RM 2,725.00, delivery avgAll ≈ RM 204.07, avgCharged ≈ RM 258.09 with the current 43 test-laden orders, includeTest implied since none are flagged yet):

```sql
with o as (
  select doc_no, total_revenue_centi, total_margin_centi, service_centi
  from mfg_sales_orders
  where status not in ('CANCELLED','ON_HOLD') and is_test = false
),
d as (
  select i.doc_no, sum(i.total_centi) as delivery_centi
  from mfg_sales_order_items i
  where i.item_code like 'SVC-DELIVERY%' and i.cancelled = false
  group by i.doc_no
)
select
  count(*) as n,
  round(avg(o.total_revenue_centi)/100.0, 2) as aov_full_rm,
  round(avg(o.total_revenue_centi - o.service_centi)/100.0, 2) as aov_product_rm,
  round((sum(o.total_margin_centi)::numeric / nullif(sum(o.total_revenue_centi),0)) * 100, 2) as gm_pct,
  round(coalesce(sum(d.delivery_centi),0)/100.0 / nullif(count(*),0), 2) as delivery_avg_all_rm,
  round(coalesce(sum(d.delivery_centi),0)/100.0 / nullif(count(d.doc_no),0), 2) as delivery_avg_charged_rm
from o left join d on d.doc_no = o.doc_no;
```
Confirm the endpoint's `overview` (call it with a curator JWT, or read the numbers off the page) matches this SQL within rounding. Note: per-purchase count needs the union-find, which SQL can't easily replicate — eyeball it against the follow-up count (`select count(*) from mfg_sales_orders where cross_category_source_doc_no is not null`).

- [ ] **Step 3: Visual smoke (dev)**

Start POS dev (`pnpm --filter @2990s/pos dev`), sign in as a `super_admin`/`admin`/`sales_director`, open the **Sales analysis** link in Maintain. Confirm: KPI cards render, the "Include test orders" toggle changes n, the period dropdown scopes the cards (and the monthly trend stays full), and a non-curator role does not see the link / is bounced from `/sales-analysis`.

- [ ] **Step 4: Note follow-on increments**

This foundation ships the Overview tab only. The remaining Part B tabs are separate plans on top of this endpoint/page: **Products** (model rank + per-category drill via `pickComboMatch` + fabric-upgrade attach from `fabric_library`), **Customers** (marketing list incl. race/age from Part A + new-vs-returning + geo-by-state), **Promotions & cross-sell** (PWP reward/trigger split, Cross Order = >2 categories, mattress→sofa), **Salespeople** (leaderboard w/ margin). See the spec for each tab's rules.

---

## Out of scope for Part B-1 (noted)

- Products / Customers / Promotions / Salespeople tabs — follow-on plans on this same endpoint.
- The `is_test` **backfill** (which existing SOs are tests) — owner-confirmed SQL, not automated here.
- Deploy — owner-gated.
- "Monthly trend scoped to period" — the trend is intentionally always full-range; the period filter scopes the Overview cards only.

---

## Self-review

- **Spec coverage (foundation slice):** gating (link+route+API all `isGlobalCurator`) → Tasks 3+4; endpoint `GET /sales-analysis?period&includeTest` → Task 3; pure core (purchase union-find, AOV both, delivery sum, GM%, monthly) → Task 1; Overview tab + period filter + n/min-sample guard → Task 4; test-data filter → Task 2; cross-check vs live → Task 5. Later tabs explicitly deferred. ✅
- **Placeholder scan:** every code step is complete; commands have expected results. The one conditional ("if `Env`/`Variables` import path differs, mirror `outstanding.ts`") is a guard, not a placeholder — the implementer opens one file to confirm. ✅
- **Type consistency:** `SaOrderRow`/`OverviewResult`/`MonthlyRow` defined in Task 1, imported by Task 3 (API) and Task 4 (POS `SalesAnalysisResponse`); `summarizeOverview`/`monthlyTrend` signatures match between core and route; `is_test` column (Task 2) used by the Task 3 query. ✅
