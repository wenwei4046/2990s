# Sales Analysis tab + customer demographics capture — Design

> Date: 2026-06-25
> Branch: `worktree-sales-analysis-marketing`
> Status: design (awaiting user review before plan)

## Goal

Give the owner (super_admin) a **Sales Analysis** surface inside the POS app that answers:

1. Which **model** sells the most.
2. Within a model, which **variant** sells the most — adapted per category:
   - **Sofa** → which **combo** vs **custom build**.
   - **Mattress** → which **size**.
   - **Bedframe** → which **size**.
   - **Accessory** → plain units (no sub-variant).
3. **Monthly** totals (units + revenue) as a trend.

Plus a **marketing customer list** (for ad targeting): one row per customer with
contact, location, purchase profile, salesperson, and two new demographic fields —
**race** and **age frame** — captured at customer entry.

This has two parts:

- **Part A — Demographics capture**: collect `race` + `age_frame` when a customer is
  keyed in during order creation. Stored on the customer; **not** shown on the SO/PDF.
- **Part B — Sales Analysis tab**: the analytics page itself.

Everything in Part B is **read-only**. No pricing recompute is touched.

---

## Locked decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Ranking metric | **Units sold**, with revenue (RM) shown alongside |
| Category coverage | **All** categories, adaptive drill-down |
| Monthly dimension | **Period filter** (All time / a month) scopes the page; a **Monthly trend** section |
| Aggregation location | **New server-side API endpoint** (`/sales-analysis`) |
| Customer list fields | Contact + Location + Purchase profile + Salesperson + race + age frame |
| Export | **On-screen only** (no CSV/xlsx) |
| Race options | **Malay / Chinese / Indian / Others** |
| Age frames (non-overlapping) | **Below 18 · 18–25 · 26–35 · 36–45 · Above 45** |
| Capture requiredness | **Required for NEW customers**; not forced for existing |
| Page permission | Same as other **Maintain** items (link `isGlobalCurator`, route `MaintainGate`); API mirrors the route role set |

---

## Part A — Demographics capture

### A.1 Data model

Add two **nullable** columns to `customers` (`packages/db/src/schema.ts`, table `customers`
at ~line 561) via a new append-only migration:

- `race text` — one of the allowed race values, or NULL.
- `age_frame text` — one of the allowed age-frame codes, or NULL.

Nullable because the entire existing customer base predates this field; we never force
backfill and never overwrite an existing non-null value with NULL.

No DB CHECK constraint — allowed values are validated at the app layer against a shared
constant, matching how other small option sets in this repo are handled. (A CHECK could
be added later if needed; keeping it app-level avoids a migration every time the list
changes.)

### A.2 Shared option constants

New file `packages/shared/src/customer-demographics.ts`, exported from the package, so the
POS capture form **and** the analysis filters use one source of truth:

```ts
export const RACE_OPTIONS = ['Malay', 'Chinese', 'Indian', 'Others'] as const;
export type Race = (typeof RACE_OPTIONS)[number];

// Stored value = the code; label = what staff sees.
export const AGE_FRAMES = [
  { code: 'below_18', label: 'Below 18' },
  { code: '18_25',    label: '18–25' },
  { code: '26_35',    label: '26–35' },
  { code: '36_45',    label: '36–45' },
  { code: 'above_45', label: 'Above 45' },
] as const;
export type AgeFrameCode = (typeof AGE_FRAMES)[number]['code'];
```

We store a stable **code** for age frame (`18_25`, …) and the **label** is derived for
display — so relabelling later doesn't migrate data. Race stores the value directly
(short, stable, human-readable).

### A.3 Capture point (POS handover → Customer step)

In the POS handover **Customer** step (the component that keys in / picks the customer),
add two dropdowns: **Race** and **Age frame**, populated from the shared constants.

Behavior:

- **New customer (not an existing pick)** → both fields are **required** to proceed past
  the Customer step / place the order. The validation gate keys off "no existing customer
  record was selected from search" — i.e. a freshly entered name+phone.
- **Existing customer pick** → optional. If the customer already has values, **prefill**
  them; staff may update.
- These fields are **never** rendered on the SO document, the printed PDF, or any
  customer-facing surface. Internal data-collection only.

### A.4 Persistence path

The fields ride the existing customer-resolve path, not a separate write:

- POS includes `race` + `ageFrame` in the order's customer payload on
  `POST /mfg-sales-orders`.
- After the server resolves/creates the customer (the `upsert_customer_by_name_phone`
  flow), it performs a **non-destructive** update of the resolved customer row:
  set `race` / `age_frame` **only when the incoming value is non-empty** — never null out
  an existing value.
- The Proceed "change customer" edit (the `recustomer` PATCH path) carries the same fields
  the same way, so editing the customer on a placed SO keeps demographics in sync.

The customer-search snapshot used for prefill is extended to return `race` + `age_frame`
so an existing pick shows current values.

---

## Part B — Sales Analysis tab

### B.1 Gating

Mirror the existing **Maintain** items exactly (verify exact predicates during
implementation):

- **Sidebar link** in `apps/pos/src/pages/Catalog.tsx` Maintain section — shown under the
  same predicate the other Maintain links use (`isGlobalCurator`).
- **Route** `/sales-analysis` in `apps/pos/src/router.tsx` — wrapped in the same
  `<MaintainGate>` used by `/products` and `/sales-order-maintenance`.
- **API** `GET /sales-analysis` — gated to the **same role set as the route guard**.
  (Implementation note: the link predicate `isGlobalCurator` and the route `MaintainGate`
  appear to allow slightly different role sets in the current code; the page's *effective*
  access is the route guard, and the API must match the route guard so the link can never
  expose data the route would block. Confirm and align during implementation.)

### B.2 API endpoint contract

`GET /sales-analysis?period=all|YYYY-MM`

- `period` defaults to `all`. `YYYY-MM` scopes by `mfg_sales_orders.soDate`.
- Auth: staff JWT (existing middleware) + the Maintain-equivalent role check; 403 otherwise.
- Aggregation runs in the Worker over the filtered SO rows (kept server-side; no raw rows
  or PII reach the browser beyond the computed result). The aggregation core is a **pure
  function** (testable with fixtures) fed by the DB query results.

Response shape (illustrative):

```jsonc
{
  "period": "all",
  "products": [
    {
      "modelId": "uuid", "modelCode": "ANNSA", "modelName": "Annsa",
      "category": "SOFA", "branding": "2990",
      "units": 12, "revenueCenti": 358800000,
      "variants": [
        // SOFA: combos + a "Custom build" bucket
        { "key": "combo:<id>", "label": "2-Seater + L combo", "units": 7, "revenueCenti": ... },
        { "key": "custom",     "label": "Custom build",        "units": 5, "revenueCenti": ... }
        // MATTRESS/BEDFRAME: { key:"size:K", label:"6FT (K)", units, revenueCenti }
        // ACCESSORY: variants omitted/empty
      ]
    }
  ],
  "monthly": [
    { "month": "2026-06", "units": 40, "revenueCenti": ...,
      "byCategory": { "SOFA": {...}, "MATTRESS": {...}, "BEDFRAME": {...}, "ACCESSORY": {...} } }
  ],
  "customers": [
    {
      "customerId": "uuid", "name": "...", "phone": "...", "email": "...",
      "customerCode": "2990S-XXXX",
      "postcode": "...", "city": "...", "state": "...",
      "race": "Chinese", "ageFrame": "26_35",
      "lastSalespersonId": "uuid", "lastSalespersonName": "...",
      "ordersCount": 3, "totalSpendCenti": ..., "lastPurchaseDate": "2026-06-20",
      "categories": ["SOFA","MATTRESS"], "brandings": ["2990","SEALY"],
      "models": ["Annsa","Posturepedic"]
    }
  ]
}
```

### B.3 Aggregation rules

- **Source rows**: non-cancelled lines on non-cancelled orders. Exclude SERVICE lines
  (delivery/lift/etc.) and PWP/free-item bookkeeping rows from product/variant counts and
  from spend where they are not real product sales. (Revenue for the *monthly* total may
  include the full order value — decide one consistent definition; default: product lines
  only, consistent with the units count.)
- **Units**: a normal line counts `qty`. A **sofa build** counts as **one** unit even
  though it is stored as multiple module rows — fold split rows by their **buildKey**
  (per SO) so one configured sofa = 1 unit; its revenue = the sum of its module lines.
- **Model identity**: line `itemCode` → `mfg_products.code` → `model_id` →
  `product_models` (modelCode, name, category, branding). For folded sofa builds, the
  model is the build's base model.
- **Sofa combo vs custom**: classify each folded sofa build by matching its module set
  against `sofa_combo_pricing` (reuse the **same** combo-resolution logic the pricing path
  uses, in `packages/shared/src/sofa-combo-pricing.ts`; extract a "which combo does this
  build match" helper if one isn't cleanly reusable). A match → that combo's label; no
  match → the **"Custom build"** bucket.
- **Mattress / bedframe size**: from the SKU's `sizeCode` / `sizeLabel`
  (`mfg_products`), group variants by size.
- **Accessory**: model-level units/revenue only; no variant sub-breakdown.
- **Money**: revenue in integer **centi** end-to-end; convert to RM only for display
  (matches repo money convention).

### B.4 POS page

`apps/pos/src/pages/SalesAnalysis.tsx` (+ CSS module), one route, internal tab state
(no extra routes). Data via a TanStack Query hook (`useSalesAnalysis(period)`) that calls
the new API through the app's `authedFetch` helper (so the JWT + role gate apply).

Top bar: **period selector** (All time / month picker). Three tabs:

1. **Products** — category filter; a ranked list of models (units desc, revenue shown).
   Expand/click a model → its variant breakdown (combo/custom, size, or plain) as a small
   ranked sub-list. Simple CSS bars for proportion; **no charting library**.
2. **Monthly** — table of months with units + revenue + per-category split, plus simple
   CSS bars for the trend. (Monthly section shows the full trend regardless of the period
   filter; the period filter scopes Products + Customers.)
3. **Customers** — the marketing list. Columns: name, phone, email, customer code,
   postcode/city/state, race, age frame, salesperson, # orders, total spend (RM),
   categories/brands/models bought, last purchase date. **Client-side segment filters**:
   category, brand, race, age frame, state, plus a free-text search on name/phone.
   The page period filter scopes which customers appear (bought within the period).
   **No export.**

### B.5 Data-fetch pattern

Mirror the existing POS fetch pattern. Where other Maintain pages hit the API with the
authed fetch + JWT, reuse that helper; `staleTime` ~30–60s. The hook lives alongside the
other POS query hooks (`apps/pos/src/lib/queries.ts`).

---

## Non-goals (YAGNI)

- No CSV/xlsx export (explicitly deferred).
- No charting library — plain CSS bars only.
- No per-showroom split (single showroom today).
- Demographics are captured in the POS order flow only; editing them in the Backend
  customer directory is **out of scope** for now (the columns exist, so it can be added
  later without rework).
- Demographics never appear on the SO document/PDF.
- No real-time refresh of the analytics; on-demand fetch with a short stale window.

---

## Files likely touched

**Part A**
- `packages/db/src/schema.ts` + new migration `packages/db/migrations/00xx_customer_demographics.sql` (add `race`, `age_frame` to `customers`).
- `packages/shared/src/customer-demographics.ts` (+ package export) — race / age-frame constants.
- POS handover Customer-step component — two dropdowns + required-for-new validation.
- `apps/api/src/routes/mfg-sales-orders.ts` — persist `race`/`age_frame` on create and on the `recustomer` PATCH.
- Customer-search snapshot — return `race`/`age_frame` for prefill.

**Part B**
- `apps/api/src/routes/sales-analysis.ts` (new) + mount in `apps/api/src/index.ts`; role gate via `apps/api/src/lib/roles.ts`.
- `packages/shared/src/sofa-combo-pricing.ts` — reuse/extract a combo-match helper; pure aggregation core (new shared module) with fixtures.
- `apps/pos/src/pages/SalesAnalysis.tsx` (+ CSS module).
- `apps/pos/src/router.tsx` — `/sales-analysis` under `<MaintainGate>`.
- `apps/pos/src/pages/Catalog.tsx` — sidebar Maintain link.
- `apps/pos/src/lib/queries.ts` — `useSalesAnalysis` hook.

---

## Testing

- **Shared (vitest)**: pure aggregation core (units folding incl. sofa builds, combo vs
  custom classification, size grouping, monthly rollups) against handcrafted fixtures;
  demographics constants sanity.
- **API**: aggregation core unit-tested directly; endpoint smoke (role gate 403/200,
  period filter).
- **POS**: component render of the three tabs with mocked data; required-for-new
  validation on the Customer step.
- **Manual on live**: read-only verification against real SOs; confirm sofa builds fold to
  1 unit and combos classify correctly; confirm demographics persist and prefill.
- Quality gates: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`.

---

## Migration & deploy notes

- New migration is **append-only**; apply to prod via the Supabase MCP per repo convention.
- **Deploy order matters**: ship the migration (adds columns) **before** the API/POS code
  that reads/writes them, per the repo's "data migration → code" lesson.
- POS + API both deploy; remind about **PWA hard-refresh** after the POS deploy.
