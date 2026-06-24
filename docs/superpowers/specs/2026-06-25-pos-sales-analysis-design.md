# Sales Analysis tab + customer demographics capture — Design

> Date: 2026-06-25
> Branch: `worktree-sales-analysis-marketing`
> Status: design (awaiting final spec review before plan)

## Goal

Give the owner a **Sales Analysis** surface inside the POS app (same permission as the
other Maintain items) that answers, scoped by a period filter (All time / a month):

1. Which **model** sells the most (units ranked, revenue + margin shown).
2. Within a model, which **variant** sells most — adapted per category (sofa combo vs
   custom; mattress/bedframe size; accessory plain).
3. **Monthly** totals (units + revenue + margin) as a trend.
4. **Order-level analytics**: AOV, average service/delivery fee, order count, "Cross
   Order" rate, mattress→sofa cross-sell, PWP analysis, add-on/fabric-upgrade analysis.
5. A **marketing customer list** (contact, location, purchase profile, salesperson, and
   two new demographic fields — **race** + **age frame**), plus new-vs-returning and a
   by-state geographic view.

Plus **Part A** — capturing `race` + `age_frame` when a customer is keyed in (required for
new customers; not shown on the SO).

Everything in the analytics is **read-only**; no pricing recompute is touched.

---

## Locked decisions

| Decision | Choice |
|---|---|
| Ranking metric | **Units sold**, with revenue (RM) + margin shown alongside |
| Category coverage | **All** categories, adaptive drill-down |
| Monthly dimension | **Period filter** (All time / a month) scopes the page; a **Monthly trend** view |
| Aggregation location | **New server-side API endpoint** (Worker) — required, since combo/upgrade/purchase logic can't be done in plain SQL |
| Export | **On-screen only** (no CSV/xlsx) |
| Race options | **Malay / Chinese / Indian / Others** |
| Age frames (codes) | `below_18` · `18_25` · `26_35` · `36_45` · `above_45` (labels: Below 18 / 18–25 / 26–35 / 36–45 / Above 45) |
| Demographics requiredness | **Required for NEW customers**; not forced for existing (prefilled) |
| Page permission | Same as other **Maintain** items (link `isGlobalCurator`, route `MaintainGate`); API mirrors the route role set |
| **Purchase unit** | **Show BOTH** — raw per-SO numbers AND a "collapsed purchase" view (cross-category follow-up SO chains merged) |
| **Cross Order definition** | A purchase with **> 2 distinct product categories** (computed on the collapsed purchase) |
| **Mattress → Sofa cross-sell** | **Customer-level** "also bought a sofa" (sofa & mattress can never share an SO); **PWP tracked as its own metric**, not folded into this |
| **Extra metrics added** | Gross margin % (overall/category/model); Salesperson leaderboard (revenue/units/margin); New vs returning; Geographic by state |

---

## Cross-cutting data rules (the "don't get it wrong" list)

These rules were verified against the live DB and apply to **every** metric below. The plan
must encode them as shared helpers so no query re-derives them ad hoc.

1. **Sofa builds = multiple module rows** sharing `variants.buildKey`. Fold to one unit per
   `(doc_no, buildKey)` — `buildKey` alone is **not** globally unique. Live: 58 sofa lines
   → 27 builds. **Reuse `apps/api/src/lib/kpi-units.ts` (`loadKpiUnitsByDoc`)** as the
   canonical unit builder — it already folds by buildKey, excludes cancelled lines, and
   reproduces the fabric-tier Δ via the shared engine.
2. **Physical purchase** = collapse `mfg_sales_orders.cross_category_source_doc_no` chains
   into one purchase via **transitive closure / union-find** (links chain `028→016→015`
   and cycle `034↔035` exist live — naive pairing breaks). 14/43 live SOs (33%) are
   follow-ups. The page shows **both** the raw-SO and collapsed-purchase figures.
3. **Exclude `item_group='service'`** (SVC-DELIVERY*/lift/dispose) from product, unit,
   category, and Cross-Order counts — they are charges, not products.
4. **Exclude cancelled**: header `status NOT IN ('CANCELLED','ON_HOLD')` **and** line
   `cancelled = false`. Zero cancellations exist today, so an omitted filter looks correct
   now and silently corrupts later — match the HR commission route's filtering.
5. **Free-item / PWP-reward / RM0 lines** are RM0 goods. Exclude from **revenue/value**
   numerators; their inclusion in **unit** counts is a stated rule per metric (default:
   excluded from "products bought" counts).
6. **Fabric upgrade is derived, never read from the header.**
   `mfg_sales_orders.fabric_tier_addon_centi` is **0 on all 43 orders** despite 16 upgraded
   builds. Resolve via `variants.fabricId` → **`fabric_library`** (the *selling* tier,
   keyed by series id like `EZ`) → `fabricTierAddon` Δ>0 (`packages/shared/src/fabric-tier-addon.ts`),
   honoring per-Model (mig 0172) and per-compartment (mig 0184) overrides — exactly as
   `kpi-units.ts` does. **Do NOT use `fabric_trackings`** (that's the *cost* tier, keyed by
   fabric_code, and reads near-uniform PRICE_2).
7. **PWP reward ≠ trigger ≠ free-item-campaign.** Reward = `pwp_codes.status='USED'`
   (`redeemed_doc_no`). Trigger/mint = `source_doc_no` (31 live). Free-item-campaign
   (`variants.freeItem.campaignId`, 11 live) is a different mechanism — never unioned into
   PWP. A reward line is marked `variants.pwp=true`; its `item_group` is the *reward's*
   category, not the trigger's.
8. **Combo vs custom is not persisted.** Re-run the shared `pickComboMatch`
   (`packages/shared/src/sofa-combo-pricing.ts`) per folded build, `asOf = so_date`. No
   SQL-only path. PWP-reward sofa builds price via `pwpPricesByHeight` — flag separately so
   they don't muddy the combo/custom split.
9. **Mattress/bedframe size + brand are not on the line** — join `item_code` →
   `mfg_products.code` for `size_code` / `size_label` / `branding`. One-shot SKUs absent
   from `mfg_products` → fall back to `variants.summary` text.
10. **Customer identity splits on name spelling** (same phone, different name = different
    `customer_id`; live: `Teh` vs `The Wei chin`). Per-customer metrics dedup on
    **normalised phone**, with name-variant review; flag the residual risk.
11. **Test-data filter.** Current 43 orders are mostly smoke tests (junk names, 7 customers
    on one phone). Add `mfg_sales_orders.is_test boolean default false`; the analysis
    **excludes `is_test=true` by default** (toggle to include). A one-time backfill flags
    the known smoke-test SOs — **the backfill list needs owner confirmation** before any
    real order is hidden. Every rate shows its **n** and is greyed/footnoted below a
    minimum denominator.
12. **Money** is integer **centi** end-to-end; convert to RM only for display. AOV headline
    numerator = full order total incl. delivery (`total_revenue_centi`); product-only is a
    secondary line. Delivery = **sum of `item_code LIKE 'SVC-DELIVERY%'` lines**
    (base + CROSS + ADD; can stack), never the drifting header `delivery_fee_centi`.

---

## Part A — Demographics capture

### A.1 Data model
Add two **nullable** columns to `customers` (`packages/db/src/schema.ts`, ~line 561) via a
new append-only migration: `race text`, `age_frame text`. Nullable; never overwrite an
existing non-null with NULL. Validation is app-level against shared constants (no DB CHECK).

### A.2 Shared constants
`packages/shared/src/customer-demographics.ts` (exported), single source for the POS form
and the analysis filters:
```ts
export const RACE_OPTIONS = ['Malay', 'Chinese', 'Indian', 'Others'] as const;
export const AGE_FRAMES = [
  { code: 'below_18', label: 'Below 18' }, { code: '18_25', label: '18–25' },
  { code: '26_35', label: '26–35' }, { code: '36_45', label: '36–45' },
  { code: 'above_45', label: 'Above 45' },
] as const;
```
Age frame stores the **code**; label is derived for display.

### A.3 Capture point (POS handover → Customer step)
Two dropdowns (Race, Age frame) from the shared constants.
- **New customer** (no existing record selected from search) → **both required** to
  proceed / place the order.
- **Existing customer pick** → optional; **prefill** current values if present.
- **Never** rendered on the SO doc / PDF / any customer-facing surface.

### A.4 Persistence
POS sends `race` + `ageFrame` in the order's customer payload. On `POST /mfg-sales-orders`,
after the customer is resolved (`upsert_customer_by_name_phone` flow), perform a
**non-destructive** update of the resolved row: set `race`/`age_frame` **only when the
incoming value is non-empty**. The Proceed "change customer" (`recustomer`) PATCH carries
the same fields. The customer-search snapshot returns `race`/`age_frame` for prefill.

---

## Part B — Sales Analysis page

### B.1 Gating
Mirror the existing Maintain items: sidebar link in `apps/pos/src/pages/Catalog.tsx` under
the same predicate (`isGlobalCurator`); route `/sales-analysis` in
`apps/pos/src/router.tsx` under `<MaintainGate>`; **API `GET /sales-analysis` gated to the
same role set as the route guard** (verify the exact predicates align — `isGlobalCurator`
and `MaintainGate` currently list slightly different roles; the API must match the route,
not the link).

### B.2 Endpoint
`GET /sales-analysis?period=all|YYYY-MM&includeTest=false`
- Aggregation runs in the Worker over filtered rows; the core is a **pure, fixture-tested
  function** fed by DB results. Only computed aggregates (and the marketing customer list)
  reach the browser — no raw order dump.
- Reuses shared helpers: `loadKpiUnitsByDoc` (unit fold + fabric Δ), `pickComboMatch`
  (combo/custom), `fabricTierAddon`, the cross-category union-find, the PWP-code joins.

### B.3 Tabs

**1. Overview (KPIs + trend)**
Period-scoped headline cards, **each labelled with its n** and min-sample guard:
- Order count — **both** raw SO count and collapsed-purchase count.
- AOV — **both** per-SO and per-purchase; headline incl. delivery, product-only secondary.
- Average service/delivery fee — over all orders **and** over fee-charged orders (label
  both; they differ ~26% live).
- Gross margin % overall (`SUM(totalMarginCenti)/SUM(totalRevenueCenti)`).
- Monthly trend (units + revenue + margin), daily granularity until data deepens.

**2. Products**
- Models ranked by units (revenue + margin shown), category filter. Drill into a model:
  - **Sofa** → combo (named, via `pickComboMatch`) vs **Custom build**; PWP-reward builds
    flagged separately. Units + revenue + margin.
  - **Mattress / Bedframe** → by **size** (and mattress brand) via the product join.
  - **Accessory** → plain units/revenue.
- **Per-category sub-analysis** (the "of sofa orders, how many took upgrade fabric" view):
  - **Sofa**: fabric-upgrade **attach rate per build** (Δ>0 from `fabric_library`; denom =
    sofa-containing purchases; KIV & tier-unknown shown as explicit buckets); combo vs
    custom split; leg-height & seat-height mix (COALESCE the two vocabularies; explicit
    "none"/"Flat" buckets); base-model popularity; fabric-series mix.
  - **Mattress**: size mix + brand mix (brand degenerate today — only "2990s").
  - **Bedframe**: size mix (+ optional divan/leg/gap secondary mix).

**3. Customers (marketing)**
One row per customer (deduped on normalised phone): name, phone, email, customer code,
postcode/city/state, **race, age frame**, last salesperson, # orders, total spend (RM),
categories/brands/models bought, last purchase date. Client-side filters: category, brand,
race, age frame, state, free-text. **No export.** Plus:
- **New vs returning** split (cohort revenue/margin/basket) — cross-check the SO
  `customerType` snapshot against a `customerId`+`so_date` recompute.
- **Geographic by state** — revenue/margin/order-count by `customerState`; goods-margin net
  of delivery (delivery is its own bucket); demographic (race/age) mix per state.

**4. Promotions & cross-sell**
- **PWP**: reward proportion **6/43 = 14%** headline (USED codes / orders), with trigger
  (31/72%) and outstanding AVAILABLE codes (27) as companion metrics; optional
  paid-discount-only variant (exclude `type='promo'`). PWP item proportion (reward
  lines / paid units).
- **Add-on KPI item uptake** — reuse the commission `kpi-units` definition; note that with
  the current 2 active flags (fabric D/EZ) this **equals the fabric-upgrade metric**; print
  the active-flag snapshot + date beside the number.
- **Fabric upgrade** average count (per sofa-containing purchase; live ≈ 0.59) + RM-upgrade
  total.
- **Cross Order rate** — purchases with **> 2 distinct product categories** (on the
  collapsed purchase; service/free/PWP excluded).
- **Mattress → Sofa cross-sell** — customer-level: of customers who bought a mattress, the
  share who also bought a sofa (any order; "strictly later" available as a toggle using
  `created_at`, since `so_date` is DATE-only and user-editable). PWP shown separately.

**5. Salespeople**
Leaderboard by salesperson: revenue, units (buildKey-folded), **margin**, and avg margin %.
Reuse the HR route's goods-bucket logic so figures reconcile with the commission tab.

### B.4 POS page
`apps/pos/src/pages/SalesAnalysis.tsx` (+ CSS module), one route, internal tab state. Data
via a TanStack Query hook (`useSalesAnalysis(period, includeTest)`) over the app's authed
fetch. Simple CSS bars; **no charting library**.

---

## Non-goals (YAGNI)
- No CSV/xlsx export.
- No charting library — CSS bars only.
- No per-showroom split (single showroom).
- Demographics captured in the POS order flow only (Backend directory edit out of scope).
- Demographics never on the SO/PDF.
- No real-time refresh; on-demand fetch, short stale window.
- Top combos/sizes-with-margin and PWP/free-gift promo-ROI are **v2** (noted, not built now).

---

## Files likely touched

**Part A**
- `packages/db/src/schema.ts` + migration (add `race`, `age_frame` to `customers`).
- `packages/shared/src/customer-demographics.ts` (+ export).
- POS handover Customer-step component — two dropdowns + required-for-new validation.
- `apps/api/src/routes/mfg-sales-orders.ts` — persist demographics on create + `recustomer`.
- Customer-search snapshot — return the two fields.

**Part B**
- `packages/db/src/schema.ts` + migration (add `is_test` to `mfg_sales_orders`) + one-time
  backfill SQL (owner-confirmed test list).
- `apps/api/src/routes/sales-analysis.ts` (new) + mount in `index.ts`; role gate in `lib/roles.ts`.
- `packages/shared/` — the pure aggregation core (units/purchase/category/monthly/cross-sell)
  with fixtures; reuse `kpi-units.ts`, `sofa-combo-pricing.ts`, `fabric-tier-addon.ts`.
- `apps/pos/src/pages/SalesAnalysis.tsx` (+ CSS), `router.tsx`, `Catalog.tsx`, `lib/queries.ts`.

---

## Testing
- **Shared (vitest)**: pure aggregation core against fixtures — sofa buildKey fold, physical-
  purchase union-find (chains + cycles), category-count Cross Order, fabric-upgrade Δ>0,
  combo/custom, monthly + margin rollups, customer dedup. Demographics constants sanity.
- **API**: aggregation core unit-tested; endpoint smoke (role gate 403/200, period +
  includeTest filters).
- **POS**: render of the tabs with mocked data; required-for-new validation on Customer step.
- **Manual on live**: read-only verification vs real SOs (folds, combos, upgrades, PWP,
  margin); demographics persist + prefill.
- Gates: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`.

---

## Migration & deploy notes
- New migrations append-only; apply to prod via Supabase MCP.
- **Ship migrations (columns) before the code** that reads/writes them.
- The `is_test` backfill must be confirmed with the owner (don't hide a real order).
- POS + API both deploy; remind about **PWA hard-refresh** after the POS deploy.
- All numbers are **noisy at current volume (~2 weeks, 43 orders, mostly test)** — the page
  surfaces n and min-sample guards; treat early figures as directional.
```
