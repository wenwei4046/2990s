# HR tab — salesperson commission calculator

**Date:** 2026-06-14
**App:** Backend (`apps/backend`) + API (`apps/api`) + DB (`packages/db`) + shared (`packages/shared`)
**Author:** Claude (brainstormed with Loo)
**Status:** Design approved — pending written-spec review

---

## 1. Goal

Add a new **HR** section to the Backend left sidebar. Its purpose is to compute each
salesperson's **salary**, which in this business is **commission-only**, driven by each
salesperson's **goods sales figure** over a chosen period, plus per-item KPI bonuses.

There is currently **no HR / commission / payroll code anywhere** in the repo — this is
all new.

---

## 2. Salary model (confirmed with Loo)

Commission-only. Two tiers, assigned **manually** per salesperson.

### 2.1 Definitions

Over a user-selected date range `[from, to]`, filtering sales orders by `so_date`,
excluding `status IN ('CANCELLED', 'ON_HOLD')`:

- **goods(order)** = `mattress_sofa_centi + bedframe_centi + accessories_centi + others_centi`
  (the four product category columns on `mfg_sales_orders`; **excludes** `service_centi`,
  i.e. delivery / disposal / lift fees).
- **personalGoods(staff)** = Σ goods(order) where `order.salesperson_id = staff.id`.
- **showroomGoods(showroom)** = Σ `personalGoods` of that showroom's **profiled** salespeople
  (the team total, including the manager's own sales). The HR profile's `showroom_id` is the
  **single source of truth** for the showroom dimension — goods attribution, row grouping, and
  the whole-showroom total all key off the profile, so they can never diverge, and the rows
  shown under a showroom always sum to its total. (There is no order→showroom FK; attributing
  the total any other way — e.g. via `staff.showroom_id` — risks divergence from the grouping.
  Orders by a salesperson with no active HR profile, or with a null salesperson, don't count
  toward any showroom total. Still excludes service. **Confirmed by Loo (2026-06-14):** this is
  the intended behaviour ("algorithm A") — only HR-registered salespeople count toward a
  showroom total; the rule is simply "register everyone who should earn commission". A and the
  earlier "all orders" framing are identical whenever every seller is registered.)

### 2.2 Personal commission (both tiers earn this on their own sales)

```
personalRate = BASE
             + (personalGoods >= PERSONAL_KPI_THRESHOLD ? PERSONAL_KPI_BONUS : 0)
             + (showroomGoods  >= SHOWROOM_KPI_THRESHOLD ? SHOWROOM_KPI_BONUS : 0)

personalCommission = personalGoods * personalRate     (rate applied to the WHOLE personal goods, not marginal)
```

Defaults (editable in HR Settings):
- `BASE` = **1.0%** (100 bps)
- `PERSONAL_KPI_THRESHOLD` = **RM 100,000**, `PERSONAL_KPI_BONUS` = **+0.5%** (50 bps)
- `SHOWROOM_KPI_THRESHOLD` = **RM 400,000**, `SHOWROOM_KPI_BONUS` = **+0.5%** (50 bps)

So a tier-1 salesperson's rate ranges **1.0% → 2.0%**.

### 2.3 Manager override (tier 2 = manager only)

A manager **also** earns an override on the **whole showroom's** goods sales (including
the manager's own sales — it is an override on the entire showroom):

```
overrideRate = OVERRIDE_BASE
             + (showroomGoods >= SHOWROOM_KPI_THRESHOLD ? OVERRIDE_KPI_BONUS : 0)

overrideCommission = showroomGoods * overrideRate
```

Defaults:
- `OVERRIDE_BASE` = **0.5%** (50 bps)
- `OVERRIDE_KPI_BONUS` = **+0.5%** (50 bps) — same RM 400,000 showroom threshold

So override ranges **0.5% → 1.0%** on the whole showroom goods.

A manager's total commission = their own `personalCommission` (§2.2) **+** `overrideCommission`
**+** their own item-KPI bonuses (§2.4).

### 2.4 Per-item KPI bonus (both tiers)

Admin flags specific **products**, **fabrics**, or **special add-ons** with a fixed RM
bonus each (amount can differ per flagged item). When a salesperson sells a flagged item,
they earn `qty * bonus` for that item, summed over their own orders in the period.

```
itemKpi(staff) = Σ over flagged matching lines in staff's orders: line.qty * flag.bonus
```

### 2.5 Total

```
total(staff) = personalCommission + (manager ? overrideCommission : 0) + itemKpi
```

---

## 3. Item-KPI matching (line-level detection)

Iterate the salesperson's order **lines** (`mfg_sales_order_items`) for orders in the period
(same status filter). For each active flag in `hr_item_kpi`:

| `flag_type` | `ref` holds | Match rule | Qty |
|---|---|---|---|
| `product` | `mfg_products.code` (= line item_code) | `line.item_code === ref` | `line.qty` |
| `fabric`  | `fabric_library.id` (fabricId) | `line.variants.fabricId === ref` | `line.qty` |
| `special` | `special_addons.code` | `ref` present in `line.variants.specials[].code` | `line.qty` |

Notes / v1 simplifications:
- Fabric match uses `variants.fabricId` (the canonical id; `fabricCode` is a fallback only
  if needed later).
- A split sofa appears as multiple per-module lines; if a flagged fabric is on each module
  line, qty sums across them. Accepted for v1 (documented; refine later if it over-counts).
- `custom_specials` (free-text ad-hoc surcharges) is **not** matched in v1 — only the
  structured `variants.specials[].code` against the flagged `special_addons.code`.

---

## 4. Data model (3 new tables)

`packages/db/src/schema.ts` is the source of truth; generate a migration from it and apply
via the Supabase MCP. Money in **centi** (sen, integer); rates in **bps** (integer,
1% = 100 bps) — no floats anywhere.

### 4.1 `hr_salesperson_profiles`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `staff_id` | uuid FK → staff.id, unique | the salesperson |
| `tier` | enum `hr_tier` (`sales` \| `manager`) | manual |
| `showroom_id` | uuid FK → showrooms.id | which showroom they belong to |
| `active` | boolean default true | |
| `created_at` / `updated_at` | timestamptz | |

### 4.2 `hr_commission_config` (singleton, id = 1)
| column | type | default |
|---|---|---|
| `id` | int PK (always 1) | |
| `base_bps` | int | 100 |
| `personal_kpi_threshold_centi` | int | 10_000_000 (RM 100k) |
| `personal_kpi_bonus_bps` | int | 50 |
| `showroom_kpi_threshold_centi` | int | 40_000_000 (RM 400k) |
| `showroom_kpi_bonus_bps` | int | 50 |
| `override_base_bps` | int | 50 |
| `override_kpi_bonus_bps` | int | 50 |
| `updated_at` | timestamptz | |

### 4.3 `hr_item_kpi`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `flag_type` | enum `hr_item_kpi_type` (`product` \| `fabric` \| `special`) | |
| `ref` | text | sku / fabricId / special code (see §3) |
| `label` | text | snapshot of the item name for display |
| `bonus_centi` | int | bonus per unit |
| `active` | boolean default true | |
| `created_at` / `updated_at` | timestamptz | |

RLS: admin / super_admin only (mirrors existing admin-gated tables).

---

## 5. Commission engine (pure, shared)

A pure function in `packages/shared/src/hr-commission.ts`, unit-tested, so the server is
authoritative and the math is reusable:

```ts
computeShowroomCommission(input: {
  config: CommissionConfig,
  showroomGoodsCenti: number,
  salespeople: Array<{
    staffId: string,
    tier: 'sales' | 'manager',
    personalGoodsCenti: number,
    itemKpiCenti: number,
  }>,
}): Array<{
  staffId: string,
  personalRateBps: number,
  personalCommissionCenti: number,
  overrideRateBps: number,
  overrideCommissionCenti: number,
  itemKpiCenti: number,
  totalCenti: number,
}>
```

The API route gathers `showroomGoodsCenti`, each person's `personalGoodsCenti` (sum of
header goods columns) and `itemKpiCenti` (line-level §3 matching), then calls this function
per showroom. Rounding: `Math.round(goods * bps / 10000)`.

---

## 6. API (`apps/api/src/routes/hr.ts`, mounted at `/hr`, admin-gated)

- `GET  /hr/commission?from=YYYY-MM-DD&to=YYYY-MM-DD`
  → `{ showrooms: [{ showroomId, showroomName, showroomGoodsCenti, rows: [ …per-person breakdown… ] }] }`
  Server does all aggregation + the §5 computation. Each per-person row also carries the
  drill-down basis (personalGoodsCenti, matched item-KPI lines) for the UI detail view.
- `GET/POST/PATCH/DELETE /hr/profiles` — manage salesperson profiles.
- `GET/PATCH /hr/config` — read / edit the singleton rate config.
- `GET/POST/PATCH/DELETE /hr/item-kpi` — manage flagged items.
- `GET /hr/pickers` (or reuse existing `/products`, `/maintenance-config/resolved`) — to
  populate the product / fabric / special dropdowns when adding a flag.

All routes gated to admin-level roles (`admin`, `super_admin`) via the existing auth
middleware + role helpers; mounted in `apps/api/src/index.ts`.

---

## 7. Frontend (`apps/backend`)

### 7.1 Sidebar (`src/components/Sidebar.tsx`)
New **HR** section, rendered only when `isAdminLevel(staff.role)` (like the Administration
group's `canSeeAdmin` gate). Links:
- **Commission** → `/hr/commission`
- **HR Settings** → `/hr/settings`

Also register both in `src/lib/nav-items.ts` (command palette / breadcrumbs) and add routes
in `src/router.tsx` (lazy-loaded), with a Layout-level guard redirecting non-admins.

### 7.2 Commission page (`src/pages/HrCommission.tsx`)
- Date range picker (`from` / `to`), defaulting to the current calendar month.
- Per showroom: a table — one row per salesperson — columns: name, tier, goods sales,
  personal rate, personal commission, override, item KPI, **total**. Showroom subtotal row
  showing `showroomGoodsCenti` + whether the 400k threshold was hit.
- Expand a row → detail: contributing orders + matched item-KPI lines.
- **Export to Excel** button (`xlsx`, already used in Backend).

### 7.3 HR Settings page (`src/pages/HrSettings.tsx`)
Three panels (admin-editable):
1. **Salespeople** — add staff → set tier + showroom; toggle active.
2. **Commission rates** — edit the singleton config (rates shown as %, thresholds as RM;
   stored as bps / centi).
3. **Item KPIs** — add/edit flags: pick a product / fabric / special add-on from a dropdown,
   set the RM bonus per unit; toggle active.

Follow existing CSS Modules + design-system tokens; Lucide icons (stroke 1.75); brand voice
(sentence case, calm). No new stack deps.

---

## 8. Access control

Salary data is sensitive. **Admin + super_admin only** at every layer:
- Sidebar links hidden otherwise.
- Backend route guard redirects non-admins.
- API routes reject non-admin JWTs.
- RLS on the three HR tables restricts to admin-level roles.

(A dedicated `hr` role could be added later; out of scope for v1.)

---

## 9. Out of scope (YAGNI for v1)

- Persisted / immutable payroll runs (payslip snapshots). Computation is **on-the-fly**:
  pick a range, it recomputes from live orders each time.
- Netting returns / `delivery_returns` against the sales figure.
- Matching `custom_specials` free-text surcharges for item KPI.
- Cross-showroom override interactions beyond "each manager overrides their own showroom".
- Non-commission salary components (base pay, allowances, deductions).

---

## 10. Confirmed assumptions (from brainstorming)

1. KPI rate bumps apply to the **whole** personal goods, not marginal.
2. Manager override base = **whole showroom** goods (includes the manager's own sales).
3. Showroom 400k threshold / override base = the showroom's **team total** = Σ of its
   profiled salespeople's personal goods (incl. the manager's own), **excluding** service SKUs.
   (Single-source via the HR profile. Confirmed by Loo 2026-06-14: count only HR-registered
   salespeople — "algorithm A".)
4. Returns do **not** reduce the sales figure.
5. Excel export is required.

---

## 11. Build order (high level)

1. DB: schema.ts + migration (3 tables + 2 enums) → apply via Supabase MCP.
2. shared: `hr-commission.ts` pure function + vitest tests.
3. API: `/hr` routes (compute + CRUD) + mount + role gate.
4. Backend: sidebar/nav/router wiring + Commission page + HR Settings page + Excel export.
5. Typecheck / lint / test / build green; deploy API (wrangler) + Backend (CF Pages) per
   the project's deploy scripts.
</content>
</invoke>
