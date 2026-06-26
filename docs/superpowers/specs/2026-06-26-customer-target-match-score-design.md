# Customer area + Target Match Score + segment spend — design

> Design spec. Date: 2026-06-26. Owner: Loo. Builds on the just-shipped Customer Data tab
> (`2026-06-26-customer-demographics-birthday-gender-design.md`). Branch: customer-target-match-score.

## 1. Goal

Extend the POS Sales Analysis **Customer Data** tab so Loo can (a) see each customer's **area** (city/state), (b) set an ideal customer **Target profile** (avg age, race mix, gender mix, area) saved company-wide, and (c) read a **Target Match Score** — how closely the actual customer base matches that profile, as a %. Plus marketing depth: **spend power per segment**, a **gap-to-target** callout, and **avg/median age**.

## 2. Decisions (locked with Loo, 2026-06-26)

1. **Area source** — `customers.city/state` are 100% NULL on prod; area comes from each customer's **latest in-scope SO** (`city` + `customer_state`). 39/43 SOs carry it; 12 distinct cities; states seen: Kuala Lumpur, Selangor, Kelantan.
2. **Race target = full distribution summing to 100%**; gender target likewise. Scored by **distribution overlap** = Σ min(target%, actual%).
3. **Area target** = optional multi-select of **states and/or cities**; a customer is "in area" if their state ∈ selected states OR city ∈ selected cities.
4. **Age target** = avg age + a **user-set tolerance** (± years); score fades linearly to 0 at the tolerance distance.
5. **Targets stored in the DB, company-wide** (single shared row); any staff reads, curators write.
6. **Target Match Score scope** = **all customers in the selected period**, independent of the age min/max filter (the filter is an exploration tool; scoring the age dimension on an age-filtered set would be circular).
7. **Add-ons (all approved):** segment spend power, gap-to-target highlight, avg/median age headline, **gender added to the Target**.
8. **Area denominator** — customers with unknown address count as "not in area" (honest hit-rate).

## 3. Data model

### 3.1 New table `analysis_customer_targets` (singleton, company-wide) — migration 0207
```
id                 smallint primary key default 1 check (id = 1)  -- one row only
target_avg_age     integer            -- null = age dimension off
age_tolerance_years integer not null default 10
race_targets       jsonb              -- {"Malay":55,"Chinese":30,"Indian":10,"Others":5}; null/empty = off
gender_targets     jsonb              -- {"Male":50,"Female":45,"Others":5}; null/empty = off
area_states        text[]             -- e.g. {"Kuala Lumpur","Selangor"}; empty = off
area_cities        text[]             -- e.g. {"Petaling Jaya"}; empty = off
updated_at         timestamptz not null default now()
updated_by         uuid
```
RLS: enable; `SELECT` to any authenticated staff; `INSERT`/`UPDATE` to curators only — policy `current_staff_role() in ('sales_director','admin','super_admin')`. The API write path is also curator-gated in code (defense in depth). No seed row needed; the API treats "no row" as all-dimensions-off defaults.

### 3.2 `SaCustomerRow` additions (shared) — sourced from the latest in-scope SO
- `city: string | null`, `state: string | null` (from the customer's newest scoped SO; replaces the always-NULL `customers.state` the previous build read)
- `marginCenti: number` (Σ of the customer's scoped orders' `total_margin_centi`) — for segment margin

## 4. Shared pure core (`packages/shared/src/sales-analysis.ts`)

### 4.1 `summarizeCustomerDemographics` additions
- add a **`city`** distribution (`DistributionBucket[]`, 'Unknown' for blank) alongside gender/race/state.
- add **`avgAge: number | null`** and **`medianAge: number | null`** (over customers with a usable birthday in the filtered set).

### 4.2 `TargetProfile` type + `computeTargetMatch(customers, targets)`
```ts
interface TargetProfile {
  targetAvgAge: number | null;
  ageToleranceYears: number;       // >=1
  raceTargets: Record<string, number> | null;    // pct by RACE_OPTIONS
  genderTargets: Record<string, number> | null;  // pct by GENDER_OPTIONS
  areaStates: string[];
  areaCities: string[];
}
interface DimensionScore { configured: boolean; score: number; detail: ...; }
interface TargetMatchResult {
  overall: number | null;          // mean of configured dims; null if none
  age: DimensionScore;             // detail: { actualAvg, target, tolerance }
  race: DimensionScore;            // detail: per-key { target, actual }
  gender: DimensionScore;          // detail: per-key { target, actual }
  area: DimensionScore;            // detail: { matched, total }
  biggestGap: { dim: 'age'|'race'|'gender'|'area'; label: string } | null; // lowest configured sub-score
}
```
Rules (each dim contributes only when configured):
- **age** (configured = `targetAvgAge != null`): `actualAvg` = mean age of customers with a birthday; `score = clamp(1 − |actualAvg − target| / max(1, tolerance), 0, 1) × 100`. If no ages → not configured.
- **race** (configured = `raceTargets` has any value > 0): normalise target to sum 100; `actual%` per race over customers with race set; `score = Σ min(target%, actual%)`.
- **gender** (same shape as race over GENDER_OPTIONS).
- **area** (configured = `areaStates.length || areaCities.length`): `matched` = customers with `state ∈ areaStates` (case-insensitive trim) OR `city ∈ areaCities`; `score = matched / total × 100` where `total` = all customers passed in (unknown area counts against).
- **overall** = mean of configured dims' scores (null if none configured).
- **biggestGap** = the configured dimension with the lowest score, with a human label (e.g. "Race: Malay 40% vs 55% target").

### 4.3 `spendBySegment(customers, dim)` → spend power
`dim ∈ 'race' | 'gender' | 'city'`. Returns buckets sorted by revenue desc:
```ts
{ key: string; customers: number; revenueCenti: number; purchases: number;
  aovCenti: number /* revenue/purchases */; marginCenti: number; marginPct: number | null }
```
Operates on whatever set it's given (the filtered view), 'Unknown' for blank keys.

All of the above are pure and unit-tested (Vitest).

## 5. API (`apps/api/src/routes/sales-analysis.ts`)

- **Customer rows:** add `city, customer_state` to the scoped-orders SELECT; per customer, pick the **newest SO's** city/state; add `marginCenti` (Σ scoped orders' `total_margin_centi`). Populate `SaCustomerRow.city/state/marginCenti`. (The old `customers.state` read is removed.)
- **GET `/sales-analysis`:** add `targets: TargetProfile` to the response — load the singleton `analysis_customer_targets` row (or return all-off defaults if absent).
- **PUT `/sales-analysis/targets`:** curator-gated (same `CURATOR_ROLES` check); validate + upsert the singleton row (`id = 1`), stamp `updated_by`/`updated_at`; return the saved profile. Validate: ages sane, tolerance ≥ 1, race/gender values 0–100, areas are string arrays.

## 6. POS UI (`apps/pos/src/components/sales-analysis/CustomerDataTab.tsx` + CSS; `sales-analysis-queries.ts`)

Layout, top → bottom:
1. **Target profile panel** (editable, collapsible): avg age + tolerance inputs; race % inputs (4) with a live "= NN% (should be 100)" indicator; gender % inputs (3) with the same; area multi-select for states + cities (options derived from the loaded customers' distinct state/city values); **Save** button (PUT; disabled until changed; curator-only — non-curators never reach this gated page anyway). Targets live in component state → the score recomputes live as Loo edits; Save persists.
2. **Target Match Score card** (computed over **period-all** customers via `computeTargetMatch`): big overall %, the 4 sub-scores (Age/Race/Gender/Area, each "actual vs target"), and the **biggest-gap** callout. Dimensions not configured show "—".
3. **Age headline:** avg + median age (from the filtered view).
4. **Distributions** (filtered view): gender, race, **city** (new), per-year age histogram.
5. **Segment spend** (filtered view): three small tables — by race, by gender, by city — each: customers, revenue, AOV, margin%.
6. **Per-customer list:** add a **City / State** column.

`sales-analysis-queries.ts`: extend `SalesAnalysisResponse` with `targets: TargetProfile`; add a `useSaveTargets` mutation (PUT) that invalidates the sales-analysis query.

## 7. Scope split (important)
- **Target Match Score** + its panel: **period-all** customers (ignore age filter).
- **Everything else** (distributions, spend tables, age headline, per-customer list): the **age-filtered** view (existing min/max filter).

## 8. Testing
- Shared: `computeTargetMatch` (each dim configured/not, overlap math, area OR-match, age tolerance clamp, biggestGap, all-off → null), `spendBySegment` (aggregation, AOV, margin%, Unknown bucket), `summarizeCustomerDemographics` city dist + avg/median age.
- Gates: `pnpm typecheck`/`test`/`lint`/`build` green.
- No HTTP harness for the route (project norm) — typecheck + review; verify live after deploy.

## 9. Sequencing & deploy
schema+migration 0207 → shared core (+tests) → API → POS UI. Then merge to main, apply 0207 to prod (curator RLS), deploy API + POS. (Backend untouched.) PWA hard-refresh after POS deploy.

## 10. Out of scope
- Gender already added to Target (no longer out). 
- Time-trend of demographics, race×area cross-tabs, CSV export — later if wanted.
- Auto "KL Area" grouping — Loo selects states/cities explicitly.
