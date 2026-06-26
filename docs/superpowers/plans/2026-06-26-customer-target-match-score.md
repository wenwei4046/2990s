# Customer area + Target Match Score + segment spend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the POS Sales Analysis Customer Data tab, show each customer's area (city/state), let a curator set an ideal-customer Target profile (avg age, race mix, gender mix, area) saved company-wide, and compute a Target Match Score — plus segment spend power, a gap-to-target callout, and avg/median age.

**Architecture:** All math lives in pure, unit-tested functions in `@2990s/shared/sales-analysis`. The API loads customers (now with city/state/margin from the latest SO) + the saved targets and exposes a PUT to save them; the POS tab computes the score live client-side as the curator edits targets. Targets persist in a singleton DB table with curator-only RLS.

**Tech Stack:** Drizzle + hand-written SQL migration (Supabase MCP), Hono/CF Workers API, Vite/React 19 POS (PWA), Vitest, TS strict.

**Spec:** `docs/superpowers/specs/2026-06-26-customer-target-match-score-design.md`

## Global Constraints

- **Money** is integer **centi**; never floats.
- **Race vocab:** Malay/Chinese/Indian/Others. **Gender vocab:** Male/Female/Others. (from `@2990s/shared`: `RACE_OPTIONS`, `GENDER_OPTIONS`.)
- **Race & gender targets are full distributions** (normalised to sum 100 before scoring via overlap = Σ min(target%, actual%)).
- **Target Match Score scope = all customers in the selected period** (ignore the age min/max filter). All other views (distributions, spend, list, age headline) follow the age filter.
- **Area** comes from each customer's latest in-scope SO (`city` + `customer_state`); `customers.city/state` are NULL. Unknown area counts against the area %.
- **Targets table is a singleton** (`id = 1`); any staff reads, curators (sales_director/admin/super_admin) write.
- **Migration** = next free number **0207**; applied to prod via Supabase MCP, curator RLS, owner-gated, migrate-before-deploy.
- **POS is a PWA** — hard refresh after deploy (deploy is the deploy step, not this plan's tasks).
- Gates from worktree root: `pnpm typecheck` / `test` / `lint` / `build` (POS build needs `ALLOW_LOCAL_API_URL=1`).

---

### Task 1: Shared — SaCustomerRow city/margin + summary city dist + avg/median age (TDD)

**Files:**
- Modify: `packages/shared/src/sales-analysis.ts`
- Test: `packages/shared/src/sales-analysis.test.ts`

**Interfaces:**
- Produces: `SaCustomerRow` gains `city: string | null` and `marginCenti: number`. `CustomerDemographicsSummary` gains `city: DistributionBucket[]`, `avgAge: number | null`, `medianAge: number | null`.

- [ ] **Step 1: Write failing tests** — append to `packages/shared/src/sales-analysis.test.ts`. First extend the `cust(...)` factory's defaults (the existing helper) is not enough — add `city`/`marginCenti` to it. Replace the existing `cust` factory definition with:

```ts
const cust = (over: Partial<SaCustomerRow> = {}): SaCustomerRow => ({
  id: 'c1', name: 'Cust', race: null, birthday: null, gender: null, state: null, city: null,
  orderCount: 1, ltvCenti: 0, marginCenti: 0,
  firstOrderDate: '2026-01-01', lastOrderDate: '2026-01-01', isReturning: false, ...over,
});
```

Then append:
```ts
describe('summarizeCustomerDemographics — city + age stats', () => {
  const asOf = '2026-06-26';
  it('builds a city distribution with Unknown for blanks', () => {
    const s = summarizeCustomerDemographics([
      cust({ id: 'a', city: 'Kuala Lumpur' }),
      cust({ id: 'b', city: 'Kuala Lumpur' }),
      cust({ id: 'c', city: '' }),
    ], { asOf });
    expect(s.city).toEqual([{ key: 'Kuala Lumpur', count: 2 }, { key: 'Unknown', count: 1 }]);
  });
  it('computes avg and median age over customers with a birthday', () => {
    const s = summarizeCustomerDemographics([
      cust({ id: 'a', birthday: '2000-06-26' }), // 26
      cust({ id: 'b', birthday: '1996-06-26' }), // 30
      cust({ id: 'c', birthday: '1990-06-26' }), // 36
      cust({ id: 'd', birthday: null }),
    ], { asOf });
    expect(s.avgAge).toBeCloseTo((26 + 30 + 36) / 3, 6);
    expect(s.medianAge).toBe(30);
    expect(s.withBirthday).toBe(3);
  });
  it('avg/median age are null when no birthdays', () => {
    const s = summarizeCustomerDemographics([cust({ id: 'a' })], { asOf });
    expect(s.avgAge).toBeNull();
    expect(s.medianAge).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @2990s/shared test -- sales-analysis`
Expected: FAIL (`city`/`marginCenti` not on SaCustomerRow; `s.city`/`avgAge`/`medianAge` undefined).

- [ ] **Step 3: Update `SaCustomerRow`** — in `packages/shared/src/sales-analysis.ts`, change the interface:

```ts
export interface SaCustomerRow {
  id: string;
  name: string;
  race: string | null;
  birthday: string | null;
  gender: string | null;
  state: string | null;
  city: string | null;
  orderCount: number;     // collapsed physical purchases in scope
  ltvCenti: number;       // sum of total_revenue_centi over scoped orders
  marginCenti: number;    // sum of total_margin_centi over scoped orders
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  isReturning: boolean;
}
```

- [ ] **Step 4: Add city dist + age stats to the summary** — change `CustomerDemographicsSummary` to add the fields:

```ts
export interface CustomerDemographicsSummary {
  total: number;
  withBirthday: number;
  perCustomer: Array<SaCustomerRow & { age: number | null }>;
  gender: DistributionBucket[];
  race: DistributionBucket[];
  byState: DistributionBucket[];
  city: DistributionBucket[];
  ageHistogram: Array<{ age: number; count: number }>;
  avgAge: number | null;
  medianAge: number | null;
  newVsReturning: { newCount: number; returningCount: number };
}
```

Then inside `summarizeCustomerDemographics`, add a `city` map next to `state`, bump it in the loop, collect ages, and compute avg/median. Replace the body's aggregation block so it reads:

```ts
  const gender = new Map<string, number>();
  const race = new Map<string, number>();
  const state = new Map<string, number>();
  const city = new Map<string, number>();
  const ageCounts = new Map<number, number>();
  const ages: number[] = [];
  let withBirthday = 0; let newCount = 0; let returningCount = 0;

  for (const r of perCustomer) {
    bump(gender, r.gender);
    bump(race, r.race);
    bump(state, r.state);
    bump(city, r.city);
    if (r.age !== null) { withBirthday += 1; ages.push(r.age); ageCounts.set(r.age, (ageCounts.get(r.age) ?? 0) + 1); }
    if (r.isReturning) returningCount += 1; else newCount += 1;
  }

  const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;
  const sortedAges = [...ages].sort((a, b) => a - b);
  const medianAge = sortedAges.length
    ? (sortedAges.length % 2
        ? sortedAges[(sortedAges.length - 1) / 2]!
        : (sortedAges[sortedAges.length / 2 - 1]! + sortedAges[sortedAges.length / 2]!) / 2)
    : null;
```

and extend the returned object with `city: toBuckets(city), avgAge, medianAge,` (keep all existing fields).

- [ ] **Step 5: Run, verify pass**

Run: `pnpm --filter @2990s/shared test -- sales-analysis`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sales-analysis.ts packages/shared/src/sales-analysis.test.ts
git commit -m "feat(shared): SaCustomerRow city/margin + city distribution + avg/median age"
```

---

### Task 2: Shared — computeTargetMatch + TargetProfile (TDD)

**Files:**
- Modify: `packages/shared/src/sales-analysis.ts`
- Test: `packages/shared/src/sales-analysis.test.ts`

**Interfaces:**
- Consumes: `SaCustomerRow` (Task 1), `ageFromBirthday` (already imported), `RACE_OPTIONS`/`GENDER_OPTIONS`.
- Produces: `TargetProfile`, `TargetMatchResult`, `computeTargetMatch(customers, targets, asOf?)`.

- [ ] **Step 1: Write failing tests** — append to `sales-analysis.test.ts` (extend the import to add `computeTargetMatch`, `type TargetProfile`):

```ts
const TP = (over: Partial<TargetProfile> = {}): TargetProfile => ({
  targetAvgAge: null, ageToleranceYears: 10,
  raceTargets: null, genderTargets: null, areaStates: [], areaCities: [], ...over,
});

describe('computeTargetMatch', () => {
  const asOf = '2026-06-26';
  it('returns overall null when nothing is configured', () => {
    const r = computeTargetMatch([cust({ id: 'a', birthday: '1990-06-26' })], TP(), asOf);
    expect(r.overall).toBeNull();
    expect(r.age.configured).toBe(false);
  });
  it('age dimension fades linearly within tolerance', () => {
    const customers = [cust({ id: 'a', birthday: '1990-06-26' }), cust({ id: 'b', birthday: '1982-06-26' })]; // 36, 44 → avg 40
    const r = computeTargetMatch(customers, TP({ targetAvgAge: 45, ageToleranceYears: 10 }), asOf);
    expect(r.age.actualAvg).toBe(40);
    expect(r.age.score).toBeCloseTo(50, 6); // |40-45|/10 = .5 → 50%
    expect(r.overall).toBeCloseTo(50, 6);
  });
  it('race overlap = sum of min(target,actual)', () => {
    const customers = [
      cust({ id: 'a', race: 'Malay' }), cust({ id: 'b', race: 'Malay' }),
      cust({ id: 'c', race: 'Chinese' }), cust({ id: 'd', race: 'Chinese' }),
    ]; // actual 50/50
    const r = computeTargetMatch(customers, TP({ raceTargets: { Malay: 60, Chinese: 40, Indian: 0, Others: 0 } }), asOf);
    // overlap = min(60,50)+min(40,50) = 50+40 = 90
    expect(r.race.score).toBeCloseTo(90, 6);
  });
  it('area matches state OR city, denominator is everyone', () => {
    const customers = [
      cust({ id: 'a', state: 'Kuala Lumpur', city: 'Kuala Lumpur' }),
      cust({ id: 'b', state: 'Selangor', city: 'Petaling Jaya' }),
      cust({ id: 'c', state: 'Johor', city: 'Johor Bahru' }),
      cust({ id: 'd', state: null, city: null }),
    ];
    const r = computeTargetMatch(customers, TP({ areaStates: ['Kuala Lumpur', 'Selangor'], areaCities: [] }), asOf);
    expect(r.area.matched).toBe(2);
    expect(r.area.total).toBe(4);
    expect(r.area.score).toBeCloseTo(50, 6);
  });
  it('overall averages configured dims and flags the biggest gap', () => {
    const customers = [cust({ id: 'a', birthday: '1982-06-26', race: 'Malay', state: 'Johor', city: 'Johor Bahru' })]; // 44
    const r = computeTargetMatch(customers, TP({
      targetAvgAge: 44, ageToleranceYears: 10,                 // age 100
      raceTargets: { Malay: 100, Chinese: 0, Indian: 0, Others: 0 }, // race 100
      areaStates: ['Kuala Lumpur'], areaCities: [],            // area 0 (in Johor)
    }), asOf);
    expect(r.age.score).toBeCloseTo(100, 6);
    expect(r.race.score).toBeCloseTo(100, 6);
    expect(r.area.score).toBeCloseTo(0, 6);
    expect(r.overall).toBeCloseTo((100 + 100 + 0) / 3, 6);
    expect(r.biggestGap?.dim).toBe('area');
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @2990s/shared test -- sales-analysis`
Expected: FAIL (`computeTargetMatch` not exported).

- [ ] **Step 3: Implement** — append to `packages/shared/src/sales-analysis.ts`. Ensure the imports at top include the vocab:

Change the existing demographics import line to also pull the option lists:
```ts
import { ageFromBirthday, RACE_OPTIONS, GENDER_OPTIONS } from './customer-demographics';
```

Then append:
```ts
export interface TargetProfile {
  targetAvgAge: number | null;
  ageToleranceYears: number;
  raceTargets: Record<string, number> | null;
  genderTargets: Record<string, number> | null;
  areaStates: string[];
  areaCities: string[];
}

export interface TargetMatchResult {
  overall: number | null;
  age: { configured: boolean; score: number; actualAvg: number | null; target: number | null; tolerance: number };
  race: { configured: boolean; score: number; rows: Array<{ key: string; target: number; actual: number }> };
  gender: { configured: boolean; score: number; rows: Array<{ key: string; target: number; actual: number }> };
  area: { configured: boolean; score: number; matched: number; total: number };
  biggestGap: { dim: 'age' | 'race' | 'gender' | 'area'; label: string } | null;
}

const normShares = (m: Record<string, number> | null): Record<string, number> => {
  if (!m) return {};
  const sum = Object.values(m).reduce((a, b) => a + (Number(b) > 0 ? Number(b) : 0), 0);
  if (sum <= 0) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) out[k] = (Number(v) > 0 ? Number(v) : 0) / sum * 100;
  return out;
};

const actualShares = (
  customers: ReadonlyArray<SaCustomerRow>, field: 'race' | 'gender', options: readonly string[],
): Record<string, number> => {
  let n = 0; const counts: Record<string, number> = {};
  for (const c of customers) {
    const v = c[field];
    if (v && (options as readonly string[]).includes(v)) { counts[v] = (counts[v] ?? 0) + 1; n += 1; }
  }
  const out: Record<string, number> = {};
  for (const k of options) out[k] = n > 0 ? ((counts[k] ?? 0) / n) * 100 : 0;
  return out;
};

const distScore = (
  customers: ReadonlyArray<SaCustomerRow>, field: 'race' | 'gender',
  options: readonly string[], targets: Record<string, number> | null,
): { configured: boolean; score: number; rows: Array<{ key: string; target: number; actual: number }> } => {
  const tgt = normShares(targets);
  const configured = Object.values(tgt).some((v) => v > 0);
  const act = actualShares(customers, field, options);
  let overlap = 0;
  const rows = options.map((k) => {
    const target = tgt[k] ?? 0; const actual = act[k] ?? 0;
    overlap += Math.min(target, actual);
    return { key: k, target, actual };
  });
  return { configured, score: configured ? overlap : 0, rows };
};

const eqCI = (a: string | null, set: string[]): boolean =>
  a != null && set.some((s) => s.trim().toLowerCase() === a.trim().toLowerCase());

/** Match the actual customer set against a target profile. Age uses period-all
 *  customers (caller passes the unfiltered set). Each dim contributes to the
 *  overall only when configured. */
export function computeTargetMatch(
  customers: ReadonlyArray<SaCustomerRow>,
  targets: TargetProfile,
  asOf?: string,
): TargetMatchResult {
  // Age
  const ages = customers.map((c) => ageFromBirthday(c.birthday, asOf)).filter((a): a is number => a !== null);
  const actualAvg = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;
  const ageConfigured = targets.targetAvgAge != null && actualAvg !== null;
  const tol = Math.max(1, targets.ageToleranceYears || 1);
  const ageScore = ageConfigured
    ? Math.max(0, 1 - Math.abs(actualAvg! - targets.targetAvgAge!) / tol) * 100
    : 0;

  const race = distScore(customers, 'race', RACE_OPTIONS, targets.raceTargets);
  const gender = distScore(customers, 'gender', GENDER_OPTIONS, targets.genderTargets);

  // Area
  const areaConfigured = targets.areaStates.length > 0 || targets.areaCities.length > 0;
  const total = customers.length;
  const matched = areaConfigured
    ? customers.filter((c) => eqCI(c.state, targets.areaStates) || eqCI(c.city, targets.areaCities)).length
    : 0;
  const areaScore = areaConfigured && total > 0 ? (matched / total) * 100 : 0;

  const dims: Array<{ dim: 'age' | 'race' | 'gender' | 'area'; configured: boolean; score: number; label: string }> = [
    { dim: 'age', configured: ageConfigured, score: ageScore, label: `Avg age ${actualAvg === null ? '—' : Math.round(actualAvg)} vs ${targets.targetAvgAge}` },
    { dim: 'race', configured: race.configured, score: race.score, label: 'Race mix' },
    { dim: 'gender', configured: gender.configured, score: gender.score, label: 'Gender mix' },
    { dim: 'area', configured: areaConfigured, score: areaScore, label: `Area ${Math.round(areaScore)}%` },
  ];
  const configured = dims.filter((d) => d.configured);
  const overall = configured.length ? configured.reduce((a, d) => a + d.score, 0) / configured.length : null;
  const biggestGap = configured.length
    ? configured.reduce((lo, d) => (d.score < lo.score ? d : lo))
    : null;

  return {
    overall,
    age: { configured: ageConfigured, score: ageScore, actualAvg, target: targets.targetAvgAge, tolerance: tol },
    race, gender,
    area: { configured: areaConfigured, score: areaScore, matched, total },
    biggestGap: biggestGap ? { dim: biggestGap.dim, label: biggestGap.label } : null,
  };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @2990s/shared test -- sales-analysis`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sales-analysis.ts packages/shared/src/sales-analysis.test.ts
git commit -m "feat(shared): computeTargetMatch — age/race/gender/area scoring + biggest-gap"
```

---

### Task 3: Shared — spendBySegment (TDD)

**Files:**
- Modify: `packages/shared/src/sales-analysis.ts`
- Test: `packages/shared/src/sales-analysis.test.ts`

**Interfaces:**
- Produces: `SpendBucket`, `spendBySegment(customers, dim)`.

- [ ] **Step 1: Write failing test** — append (extend import with `spendBySegment`, `type SpendBucket`):

```ts
describe('spendBySegment', () => {
  it('aggregates revenue/AOV/margin by a dimension, Unknown for blanks, sorted by revenue', () => {
    const rows = spendBySegment([
      cust({ id: 'a', race: 'Chinese', ltvCenti: 300000, marginCenti: 150000, orderCount: 1 }),
      cust({ id: 'b', race: 'Chinese', ltvCenti: 100000, marginCenti: 40000, orderCount: 1 }),
      cust({ id: 'c', race: 'Malay', ltvCenti: 200000, marginCenti: 80000, orderCount: 2 }),
      cust({ id: 'd', race: null, ltvCenti: 50000, marginCenti: 10000, orderCount: 1 }),
    ], 'race');
    expect(rows.map((r) => r.key)).toEqual(['Chinese', 'Malay', 'Unknown']);
    const chinese = rows[0]!;
    expect(chinese.customers).toBe(2);
    expect(chinese.revenueCenti).toBe(400000);
    expect(chinese.purchases).toBe(2);
    expect(chinese.aovCenti).toBe(200000);   // 400000 / 2
    expect(chinese.marginPct).toBeCloseTo((190000 / 400000) * 100, 6);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @2990s/shared test -- sales-analysis`
Expected: FAIL (`spendBySegment` not exported).

- [ ] **Step 3: Implement** — append to `sales-analysis.ts`:

```ts
export interface SpendBucket {
  key: string;
  customers: number;
  revenueCenti: number;
  purchases: number;
  aovCenti: number;        // revenueCenti / purchases
  marginCenti: number;
  marginPct: number | null; // marginCenti / revenueCenti × 100
}

/** Spend power per categorical segment. 'Unknown' for blank keys. Sorted by
 *  revenue desc. Operates on whatever customer set it is given. */
export function spendBySegment(
  customers: ReadonlyArray<SaCustomerRow>, dim: 'race' | 'gender' | 'city',
): SpendBucket[] {
  const m = new Map<string, { customers: number; revenueCenti: number; purchases: number; marginCenti: number }>();
  for (const c of customers) {
    const raw = c[dim];
    const key = raw && raw.trim() ? raw : 'Unknown';
    const b = m.get(key) ?? { customers: 0, revenueCenti: 0, purchases: 0, marginCenti: 0 };
    b.customers += 1;
    b.revenueCenti += c.ltvCenti;
    b.purchases += c.orderCount;
    b.marginCenti += c.marginCenti;
    m.set(key, b);
  }
  return [...m.entries()]
    .map(([key, b]) => ({
      key,
      customers: b.customers,
      revenueCenti: b.revenueCenti,
      purchases: b.purchases,
      aovCenti: b.purchases > 0 ? Math.round(b.revenueCenti / b.purchases) : 0,
      marginCenti: b.marginCenti,
      marginPct: b.revenueCenti > 0 ? (b.marginCenti / b.revenueCenti) * 100 : null,
    }))
    .sort((a, b) => b.revenueCenti - a.revenueCenti || a.key.localeCompare(b.key));
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @2990s/shared test -- sales-analysis`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sales-analysis.ts packages/shared/src/sales-analysis.test.ts
git commit -m "feat(shared): spendBySegment — revenue/AOV/margin per race/gender/city"
```

---

### Task 4: DB — analysis_customer_targets table + RLS (migration 0207) + schema.ts

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/migrations/0207_analysis_customer_targets.sql`

**Interfaces:**
- Produces: table `analysis_customer_targets` (singleton id=1) with curator-write RLS; matching Drizzle `analysisCustomerTargets`.

- [ ] **Step 1: Add the Drizzle table** — in `packages/db/src/schema.ts`, append near the other analytics/customer tables (after the `customers` table is fine). The needed column helpers (`integer`, `text`, `jsonb`, `timestamp`, `uuid`, `check`, `pgTable`, `sql`) are already imported.

```ts
/* Sales Analysis "Target profile" (2026-06-26) — a single company-wide row of
   the ideal-customer targets (avg age + tolerance, race/gender distributions,
   area states/cities). Drives the Target Match Score. Singleton: id is always 1.
   RLS: any staff reads; curators (sales_director/admin/super_admin) write. */
export const analysisCustomerTargets = pgTable('analysis_customer_targets', {
  id:                integer('id').primaryKey().default(1),
  targetAvgAge:      integer('target_avg_age'),
  ageToleranceYears: integer('age_tolerance_years').notNull().default(10),
  raceTargets:       jsonb('race_targets'),
  genderTargets:     jsonb('gender_targets'),
  areaStates:        text('area_states').array(),
  areaCities:        text('area_cities').array(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:         uuid('updated_by'),
}, (t) => ({
  singleton: check('analysis_customer_targets_singleton', sql`${t.id} = 1`),
}));
```

- [ ] **Step 2: Verify the schema typechecks**

Run: `pnpm --filter @2990s/db typecheck`
Expected: PASS.

- [ ] **Step 3: Write the migration** — create `packages/db/migrations/0207_analysis_customer_targets.sql`:

```sql
-- 0207 — Sales Analysis "Target profile" singleton + curator-write RLS.
-- One company-wide row (id = 1) holding the ideal-customer targets that drive
-- the Target Match Score on the POS Customer Data tab. Any staff reads;
-- curators (sales_director / admin / super_admin) write. No seed row — the API
-- treats an absent row as all-dimensions-off defaults. Apply BEFORE deploying
-- the API/POS code (migrate-before-deploy). Re-run safe.

BEGIN;

CREATE TABLE IF NOT EXISTS analysis_customer_targets (
  id                  integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  target_avg_age      integer,
  age_tolerance_years integer NOT NULL DEFAULT 10,
  race_targets        jsonb,
  gender_targets      jsonb,
  area_states         text[],
  area_cities         text[],
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid
);

ALTER TABLE analysis_customer_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS act_select ON analysis_customer_targets;
CREATE POLICY act_select ON analysis_customer_targets
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS act_write ON analysis_customer_targets;
CREATE POLICY act_write ON analysis_customer_targets
  FOR ALL TO authenticated
  USING (current_staff_role() IN ('sales_director','admin','super_admin'))
  WITH CHECK (current_staff_role() IN ('sales_director','admin','super_admin'));

COMMIT;
```

- [ ] **Step 4: Commit** (applied to prod later via Supabase MCP)

```bash
git add packages/db/src/schema.ts packages/db/migrations/0207_analysis_customer_targets.sql
git commit -m "feat(db): analysis_customer_targets singleton + curator RLS (mig 0207)"
```

---

### Task 5: API — customer rows city/state/margin + targets GET + PUT

**Files:**
- Modify: `apps/api/src/routes/sales-analysis.ts`

**Interfaces:**
- Consumes: `SaCustomerRow` (city/state/margin), `TargetProfile` (Task 2).
- Produces: GET response gains `targets: TargetProfile`; each customer row carries `city/state/marginCenti`; new `PUT /sales-analysis/targets`.

- [ ] **Step 1: Extend shared imports** — change the import line:

```ts
import { summarizeOverview, monthlyTrend, collapseToPurchases, type SaOrderRow, type SaCustomerRow } from '@2990s/shared';
```
to:
```ts
import { summarizeOverview, monthlyTrend, collapseToPurchases, type SaOrderRow, type SaCustomerRow, type TargetProfile } from '@2990s/shared';
```

- [ ] **Step 2: Select city/state on the orders query + Raw type** — change the orders `.select(...)` to add `city, customer_state` (it already has `customer_id`):

```ts
    .select('doc_no, cross_category_source_doc_no, so_date, total_revenue_centi, total_margin_centi, service_centi, is_test, customer_id, city, customer_state')
```
and extend the `Raw` type with:
```ts
    customer_id: string | null;
    city: string | null;
    customer_state: string | null;
```

- [ ] **Step 3: Build city/state per doc + populate customer rows** — in the customers section, after `custIdByDoc` is built, add a per-doc area map and use the latest SO's area + margin. Replace the `customers = custIds.map(...)` block with:

```ts
    const areaByDoc = new Map<string, { city: string | null; state: string | null }>();
    for (const r of ((orderRows ?? []) as Raw[])) {
      areaByDoc.set(r.doc_no, { city: r.city ?? null, state: r.customer_state ?? null });
    }
    customers = custIds.map((cid) => {
      const ords = ordersByCustomer.get(cid)!;
      const purchases = collapseToPurchases(ords).length;
      const sorted = [...ords].sort((a, b) => a.soDate.localeCompare(b.soDate));
      const latest = sorted[sorted.length - 1]!;
      const area = areaByDoc.get(latest.docNo) ?? { city: null, state: null };
      const p = profile.get(cid);
      return {
        id: cid,
        name: p?.name ?? '',
        race: p?.race ?? null,
        birthday: p?.birthday ?? null,
        gender: p?.gender ?? null,
        state: area.state,
        city: area.city,
        orderCount: purchases,
        ltvCenti: ords.reduce((s, o) => s + o.totalRevenueCenti, 0),
        marginCenti: ords.reduce((s, o) => s + o.totalMarginCenti, 0),
        firstOrderDate: sorted[0]?.soDate ?? null,
        lastOrderDate: latest.soDate,
        isReturning: purchases > 1,
      };
    });
```
(Remove the old `state: p?.state ?? null` sourcing from `customers`; the `profile` select no longer needs `state` but leaving it is harmless — keep the select as-is.)

- [ ] **Step 4: Load + return targets** — before the final `return c.json(...)`, add:

```ts
  const { data: tRow } = await sb.from('analysis_customer_targets').select('*').eq('id', 1).maybeSingle();
  const targets: TargetProfile = {
    targetAvgAge: tRow?.target_avg_age ?? null,
    ageToleranceYears: tRow?.age_tolerance_years ?? 10,
    raceTargets: tRow?.race_targets ?? null,
    genderTargets: tRow?.gender_targets ?? null,
    areaStates: tRow?.area_states ?? [],
    areaCities: tRow?.area_cities ?? [],
  };
```
and change the return to:
```ts
  return c.json({ period, includeTest, overview, monthly, customers, targets });
```

- [ ] **Step 5: Add the PUT route** — after the `salesAnalysis.get('/', ...)` handler closes, add:

```ts
salesAnalysis.put('/targets', async (c) => {
  const sb = c.get('supabase');
  const userId = c.get('user').id;

  const staffRes = await sb.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (staffRes.error) return c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500);
  if (!staffRes.data || !staffRes.data.active || !CURATOR_ROLES.has(staffRes.data.role)) {
    return c.json({ error: 'forbidden', reason: 'sales_analysis_curator_only' }, 403);
  }

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const shares = (v: unknown): Record<string, number> | null => {
    if (!v || typeof v !== 'object') return null;
    const out: Record<string, number> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const n = Number(val); if (Number.isFinite(n) && n > 0) out[k] = n;
    }
    return Object.keys(out).length ? out : null;
  };
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

  const row = {
    id: 1,
    target_avg_age: num(body.targetAvgAge),
    age_tolerance_years: Math.max(1, num(body.ageToleranceYears) ?? 10),
    race_targets: shares(body.raceTargets),
    gender_targets: shares(body.genderTargets),
    area_states: strArr(body.areaStates),
    area_cities: strArr(body.areaCities),
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  const { error } = await sb.from('analysis_customer_targets').upsert(row, { onConflict: 'id' });
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);

  const targets: TargetProfile = {
    targetAvgAge: row.target_avg_age,
    ageToleranceYears: row.age_tolerance_years,
    raceTargets: row.race_targets,
    genderTargets: row.gender_targets,
    areaStates: row.area_states,
    areaCities: row.area_cities,
  };
  return c.json({ targets });
});
```

- [ ] **Step 6: Verify typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/sales-analysis.ts
git commit -m "feat(api): customer area+margin on rows; GET targets; PUT /sales-analysis/targets"
```

---

### Task 6: POS — queries type + save mutation

**Files:**
- Modify: `apps/pos/src/lib/sales-analysis-queries.ts`

**Interfaces:**
- Consumes: `TargetProfile` (shared).
- Produces: `SalesAnalysisResponse.targets`; `useSaveTargets()` mutation.

- [ ] **Step 1: Extend imports + response type + add the mutation** — in `apps/pos/src/lib/sales-analysis-queries.ts`:

Change the import:
```ts
import type { OverviewResult, MonthlyRow, SaCustomerRow } from '@2990s/shared';
```
to:
```ts
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import type { OverviewResult, MonthlyRow, SaCustomerRow, TargetProfile } from '@2990s/shared';
```
(remove the separate `import { useQuery } from '@tanstack/react-query';` line — it's now merged above).

Add `targets` to the response interface:
```ts
export interface SalesAnalysisResponse {
  period: string;
  includeTest: boolean;
  overview: OverviewResult;
  monthly: MonthlyRow[];
  customers: SaCustomerRow[];
  targets: TargetProfile;
}
```

Append the mutation at the end of the file:
```ts
export function useSaveTargets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (targets: TargetProfile): Promise<TargetProfile> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/sales-analysis/targets`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(targets),
      });
      if (!res.ok) throw new Error(`PUT /sales-analysis/targets failed (${res.status})`);
      return ((await res.json()) as { targets: TargetProfile }).targets;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['sales-analysis'] }); },
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/lib/sales-analysis-queries.ts
git commit -m "feat(pos): sales-analysis response.targets + useSaveTargets mutation"
```

---

### Task 7: POS — Customer Data tab UI (target panel + score card + city + spend + age headline)

**Files:**
- Modify: `apps/pos/src/components/sales-analysis/CustomerDataTab.tsx` (full rewrite)
- Modify: `apps/pos/src/pages/SalesAnalysis.module.css` (append styles)
- Modify: `apps/pos/src/pages/SalesAnalysis.tsx` (pass `targets` prop)

**Interfaces:**
- Consumes: `summarizeCustomerDemographics`, `computeTargetMatch`, `spendBySegment`, `TargetProfile`, `SaCustomerRow`, `fmtCenti`, `fmtQty` from `@2990s/shared`; `useSaveTargets` from queries.

- [ ] **Step 1: Pass targets into the tab** — in `apps/pos/src/pages/SalesAnalysis.tsx`, change the Customer Data render line:

```tsx
        {tab === 'customers' && data && <CustomerDataTab customers={data.customers} />}
```
to:
```tsx
        {tab === 'customers' && data && <CustomerDataTab customers={data.customers} targets={data.targets} />}
```

- [ ] **Step 2: Rewrite `CustomerDataTab.tsx`** — replace the whole file with:

```tsx
import { useMemo, useState } from 'react';
import {
  fmtCenti, fmtQty, summarizeCustomerDemographics, computeTargetMatch, spendBySegment,
  RACE_OPTIONS, GENDER_OPTIONS, type SaCustomerRow, type TargetProfile,
} from '@2990s/shared';
import { useSaveTargets } from '../../lib/sales-analysis-queries';
import styles from '../../pages/SalesAnalysis.module.css';

const MIN_SAMPLE = 10;
const TOP_N = 50;

const parseAge = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const pctStr = (v: number): string => `${Math.round(v)}%`;

export const CustomerDataTab = ({ customers, targets }: { customers: SaCustomerRow[]; targets: TargetProfile }) => {
  // ---- exploration filter (age) — drives everything EXCEPT the score ----
  const [ageMinStr, setAgeMinStr] = useState('');
  const [ageMaxStr, setAgeMaxStr] = useState('');
  const ageMin = parseAge(ageMinStr);
  const ageMax = parseAge(ageMaxStr);
  const summary = useMemo(
    () => summarizeCustomerDemographics(customers, { ageMin, ageMax }),
    [customers, ageMin, ageMax],
  );
  const view = summary.perCustomer;

  // ---- editable target profile (local state; Save persists) ----
  const [draft, setDraft] = useState<TargetProfile>(targets);
  const save = useSaveTargets();
  const setRace = (k: string, v: string) =>
    setDraft((d) => ({ ...d, raceTargets: { ...(d.raceTargets ?? {}), [k]: Number(v) || 0 } }));
  const setGender = (k: string, v: string) =>
    setDraft((d) => ({ ...d, genderTargets: { ...(d.genderTargets ?? {}), [k]: Number(v) || 0 } }));
  const raceSum = RACE_OPTIONS.reduce((s, k) => s + (draft.raceTargets?.[k] ?? 0), 0);
  const genderSum = GENDER_OPTIONS.reduce((s, k) => s + (draft.genderTargets?.[k] ?? 0), 0);

  // area option lists from the data
  const stateOpts = useMemo(
    () => [...new Set(customers.map((c) => c.state).filter((s): s is string => !!s && s.trim() !== ''))].sort(),
    [customers],
  );
  const cityOpts = useMemo(
    () => [...new Set(customers.map((c) => c.city).filter((s): s is string => !!s && s.trim() !== ''))].sort(),
    [customers],
  );
  const toggle = (arr: string[], v: string): string[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  // ---- score: ALL period customers (ignore the age filter) ----
  const match = useMemo(() => computeTargetMatch(customers, draft), [customers, draft]);

  const thin = summary.total < MIN_SAMPLE;
  const maxAgeCount = Math.max(1, ...summary.ageHistogram.map((h) => h.count));
  const ranked = useMemo(
    () => [...view].sort((a, b) => (b.lastOrderDate ?? '').localeCompare(a.lastOrderDate ?? '')),
    [view],
  );

  const pctOf = (count: number) => (summary.total > 0 ? Math.round((count / summary.total) * 100) : 0);
  const distRow = (label: string, count: number) => (
    <div key={label} className={styles.trendRow}>
      <span className={styles.cardSub}>{label}</span>
      <span className={styles.barTrack}><span className={styles.bar} style={{ width: `${pctOf(count)}%` }} /></span>
      <span className={styles.cardSub}>{fmtQty(count)} ({pctOf(count)}%)</span>
    </div>
  );
  const spendTable = (title: string, dim: 'race' | 'gender' | 'city') => (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Spend by {title}</h2>
      <div className={`${styles.spendRow} ${styles.spendHead}`}>
        <span>{title}</span><span>Customers</span><span>Revenue</span><span>AOV</span><span>Margin</span>
      </div>
      {spendBySegment(view, dim).map((b) => (
        <div key={b.key} className={styles.spendRow}>
          <span>{b.key}</span>
          <span>{fmtQty(b.customers)}</span>
          <span>{fmtCenti(b.revenueCenti)}</span>
          <span>{fmtCenti(b.aovCenti)}</span>
          <span>{b.marginPct === null ? '—' : `${b.marginPct.toFixed(1)}%`}</span>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* Target profile editor */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Target profile</h2>
        <div className={styles.targetGrid}>
          <label className={styles.toggle}>Avg age
            <input className={styles.ageInput} type="number" min={0} max={120}
              value={draft.targetAvgAge ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, targetAvgAge: e.target.value === '' ? null : Number(e.target.value) }))} />
          </label>
          <label className={styles.toggle}>± tolerance (yrs)
            <input className={styles.ageInput} type="number" min={1} max={100}
              value={draft.ageToleranceYears}
              onChange={(e) => setDraft((d) => ({ ...d, ageToleranceYears: Math.max(1, Number(e.target.value) || 1) }))} />
          </label>
        </div>

        <p className={styles.cardSub}>Race targets (sum {Math.round(raceSum)}% — aim for 100%)</p>
        <div className={styles.targetGrid}>
          {RACE_OPTIONS.map((k) => (
            <label key={k} className={styles.toggle}>{k}
              <input className={styles.ageInput} type="number" min={0} max={100}
                value={draft.raceTargets?.[k] ?? 0} onChange={(e) => setRace(k, e.target.value)} />
            </label>
          ))}
        </div>

        <p className={styles.cardSub}>Gender targets (sum {Math.round(genderSum)}% — aim for 100%)</p>
        <div className={styles.targetGrid}>
          {GENDER_OPTIONS.map((k) => (
            <label key={k} className={styles.toggle}>{k}
              <input className={styles.ageInput} type="number" min={0} max={100}
                value={draft.genderTargets?.[k] ?? 0} onChange={(e) => setGender(k, e.target.value)} />
            </label>
          ))}
        </div>

        <p className={styles.cardSub}>Area — states</p>
        <div className={styles.chipRow}>
          {stateOpts.map((s) => (
            <button key={s} type="button"
              className={`${styles.chip} ${draft.areaStates.includes(s) ? styles.chipOn : ''}`}
              onClick={() => setDraft((d) => ({ ...d, areaStates: toggle(d.areaStates, s) }))}>{s}</button>
          ))}
        </div>
        <p className={styles.cardSub}>Area — cities</p>
        <div className={styles.chipRow}>
          {cityOpts.map((s) => (
            <button key={s} type="button"
              className={`${styles.chip} ${draft.areaCities.includes(s) ? styles.chipOn : ''}`}
              onClick={() => setDraft((d) => ({ ...d, areaCities: toggle(d.areaCities, s) }))}>{s}</button>
          ))}
        </div>

        <div className={styles.controls} style={{ marginTop: 12 }}>
          <button type="button" className={styles.saveBtn} disabled={save.isPending}
            onClick={() => save.mutate(draft)}>
            {save.isPending ? 'Saving…' : 'Save targets'}
          </button>
          {save.isError && <span className={styles.note}>Save failed.</span>}
          {save.isSuccess && <span className={styles.cardSub}>Saved.</span>}
        </div>
      </div>

      {/* Target Match Score (all period customers) */}
      <div className={styles.cards}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Target Match Score</span>
          <span className={styles.cardValue}>{match.overall === null ? '—' : pctStr(match.overall)}</span>
          <span className={styles.cardSub}>over all {fmtQty(customers.length)} customers this period</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Age</span>
          <span className={styles.cardValue}>{match.age.configured ? pctStr(match.age.score) : '—'}</span>
          <span className={styles.cardSub}>{match.age.actualAvg === null ? 'no birthdays' : `avg ${Math.round(match.age.actualAvg)} vs target ${match.age.target}`}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Race / Gender</span>
          <span className={styles.cardValue}>{match.race.configured ? pctStr(match.race.score) : '—'} / {match.gender.configured ? pctStr(match.gender.score) : '—'}</span>
          <span className={styles.cardSub}>distribution overlap</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Area</span>
          <span className={styles.cardValue}>{match.area.configured ? pctStr(match.area.score) : '—'}</span>
          <span className={styles.cardSub}>{match.area.configured ? `${fmtQty(match.area.matched)} / ${fmtQty(match.area.total)} in area` : 'no area set'}</span>
        </div>
      </div>
      {match.biggestGap && (
        <p className={styles.note}>Biggest gap: {match.biggestGap.label} — focus here.</p>
      )}

      {/* Exploration filter */}
      <div className={styles.controls}>
        <label className={styles.toggle}>Min age
          <input className={styles.ageInput} type="number" min={0} max={120} value={ageMinStr} onChange={(e) => setAgeMinStr(e.target.value)} />
        </label>
        <label className={styles.toggle}>Max age
          <input className={styles.ageInput} type="number" min={0} max={120} value={ageMaxStr} onChange={(e) => setAgeMaxStr(e.target.value)} />
        </label>
        <span className={styles.cardSub}>
          {fmtQty(summary.total)} customers{(ageMin != null || ageMax != null) ? ' in range' : ''} ·
          avg age {summary.avgAge === null ? '—' : Math.round(summary.avgAge)} · median {summary.medianAge === null ? '—' : Math.round(summary.medianAge)}
        </span>
      </div>
      {thin && <p className={styles.note}>Only {summary.total} customer{summary.total === 1 ? '' : 's'} in this view — figures are directional.</p>}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Gender</h2>
        {summary.gender.map((b) => distRow(b.key, b.count))}
      </div>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Race</h2>
        {summary.race.map((b) => distRow(b.key, b.count))}
      </div>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>City</h2>
        {summary.city.map((b) => distRow(b.key, b.count))}
      </div>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Age (per year)</h2>
        {summary.ageHistogram.length === 0 && <p className={styles.muted}>No birthdays on record in range.</p>}
        {summary.ageHistogram.map((h) => (
          <div key={h.age} className={styles.trendRow}>
            <span className={styles.cardSub}>{h.age}</span>
            <span className={styles.barTrack}><span className={styles.bar} style={{ width: `${Math.round((h.count / maxAgeCount) * 100)}%` }} /></span>
            <span className={styles.cardSub}>{fmtQty(h.count)}</span>
          </div>
        ))}
      </div>

      {spendTable('Race', 'race')}
      {spendTable('Gender', 'gender')}
      {spendTable('City', 'city')}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Customers</h2>
        <div className={`${styles.custRow} ${styles.custHead}`}>
          <span>Name</span><span>Race</span><span>Birthday</span><span>Age</span><span>Gender</span><span>City / State</span><span>Orders</span><span>Last order</span>
        </div>
        {ranked.slice(0, TOP_N).map((r) => (
          <div key={r.id} className={styles.custRow}>
            <span>{r.name || '—'}</span>
            <span>{r.race ?? '—'}</span>
            <span>{r.birthday ?? '—'}</span>
            <span>{r.age ?? '—'}</span>
            <span>{r.gender ?? '—'}</span>
            <span>{[r.city, r.state].filter(Boolean).join(', ') || '—'}</span>
            <span>{fmtQty(r.orderCount)}</span>
            <span>{r.lastOrderDate ?? '—'}</span>
          </div>
        ))}
        {ranked.length > TOP_N && (
          <p className={styles.cardSub}>Showing the {TOP_N} most recent of {fmtQty(ranked.length)} customers.</p>
        )}
      </div>
    </>
  );
};
```

- [ ] **Step 3: Append CSS** — add to `apps/pos/src/pages/SalesAnalysis.module.css`:

```css
.targetGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--space-2); margin: 6px 0; }
.chipRow { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px; }
.chip { font: inherit; font-size: var(--fs-13); padding: 4px 10px; border: 1px solid var(--line); border-radius: 999px; background: #fff; color: var(--c-ink); cursor: pointer; }
.chipOn { background: var(--c-accent, #b06a3b); color: #fff; border-color: var(--c-accent, #b06a3b); }
.saveBtn { font: inherit; font-size: var(--fs-14); padding: 8px 16px; border: none; border-radius: var(--radius-sm); background: var(--c-accent, #b06a3b); color: #fff; cursor: pointer; }
.saveBtn:disabled { opacity: 0.6; cursor: default; }
.spendRow { display: grid; grid-template-columns: 1.4fr 0.8fr 1fr 1fr 0.8fr; gap: var(--space-3); align-items: center; padding: 5px 0; border-top: 1px solid #f0ebe4; font-size: var(--fs-13); color: var(--c-ink); }
.spendHead { color: #6b6b6b; text-transform: uppercase; letter-spacing: 0.03em; font-size: var(--fs-12); border-top: none; }
```

- [ ] **Step 4: Update the per-customer grid to 8 columns** — in `SalesAnalysis.module.css`, change the existing `.custRow` `grid-template-columns` to add the City/State column:

```css
.custRow {
  display: grid; grid-template-columns: 1.5fr 0.9fr 1.1fr 0.5fr 0.8fr 1.3fr 0.7fr 1.1fr;
  gap: var(--space-3); align-items: center; padding: 6px 0;
  border-top: 1px solid #f0ebe4; font-size: var(--fs-13); color: var(--c-ink);
}
```

- [ ] **Step 5: Verify typecheck + build**

Run: `pnpm --filter @2990s/pos typecheck && ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/components/sales-analysis/CustomerDataTab.tsx apps/pos/src/pages/SalesAnalysis.module.css apps/pos/src/pages/SalesAnalysis.tsx
git commit -m "feat(pos): Customer Data tab — Target profile editor, Match Score, city + segment spend"
```

---

### Task 8: Full gate sweep

- [ ] **Step 1: Run all gates**

Run: `pnpm typecheck && pnpm test && pnpm lint`
Expected: typecheck + tests green; lint shows no NEW errors in changed files (the pre-existing `authed-fetch.ts` `preserve-caught-error` error from origin/main is not ours — verify our changed files are clean via `npx eslint <changed files>`).
Then: `ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos build` and `ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/backend build` → PASS.

- [ ] **Step 2: No commit** (verification only).

---

## Deploy (owner-gated; after merge to main)

1. Apply migration **0207** to prod via Supabase MCP (table + RLS). Verify `current_staff_role()` exists first.
2. Deploy **API** (`cd apps/api && wrangler deploy`) then **POS** (build with prod `VITE_*` + `wrangler pages deploy apps/pos/dist --project-name=2990s-pos --branch=main`). Backend untouched.
3. PWA hard-refresh.

## Self-review notes
- **Spec coverage:** §3.1 → Task 4; §3.2 → Task 1; §4.1 → Task 1; §4.2 → Task 2; §4.3 → Task 3; §5 → Task 5; §6 → Tasks 6,7; §7 scope split → Task 7 (score uses `customers`, views use `summary`/`view`). All covered.
- **Type consistency:** `SaCustomerRow` (Task 1) consumed in Tasks 2/3/5/7; `TargetProfile`/`computeTargetMatch` (Task 2) in Tasks 5/6/7; `spendBySegment` (Task 3) in Task 7; `useSaveTargets` (Task 6) in Task 7.
- **Green-throughout:** additive everywhere; each task compiles on its own.
