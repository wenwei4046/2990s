# Customer demographics → birthday + gender on the Customer Database, + Sales Analysis "Customer Data" tab

> Design spec. Date: 2026-06-26. Owner: Loo. Author session: customer-demographics-birthday-gender worktree.
> Supersedes the storage half of Part A (`2026-06-25-pos-sales-analysis-design.md` demographics section).

## 1. Goal

Replace the marketing **age-group** capture with the customer's **birthday** (so age is exact, and customers needn't state an age band), **add gender**, and move all three demographics (**race, birthday, gender**) off the Sales Order and into the **`customers` table** (the "Customer Database" — the record staff look at). Then surface them in a new **Customer Data** tab in POS Sales Analysis: a per-customer list (the "CustomerInfo" view) showing birthday + exact age, plus gender / race / age distributions with a **precise-age filter**.

## 2. Decisions (locked with Loo, 2026-06-26)

1. **Storage = `customers` table**, not the SO snapshot. Race, birthday, gender are all customer-level attributes. They never appear on any SO/DO/SI or customer-facing surface (marketing-internal only).
2. **Birthday replaces age-frame.** No fixed age buckets anywhere. Age is always computed **exactly** from birthday (e.g. "Age 34"). The old `AGE_FRAMES` framework (below_18 / 18_25 / …) is **retired**.
3. **Gender options:** `Male` / `Female` / `Others`.
4. **Required for NEW customers:** race + birthday + gender (mirrors the current race+age rule). This is a **POS capture-time gate** (the handover step blocks submit until they're filled), **not** a server 400. Prefilled + optional for an existing-customer pick. The server stays lenient (format-validate + coalesce-fill, see §6/§7) — demographics are marketing data, and the customer-resolve is best-effort that must never block a paying customer at the counter (honest-pricing concerns money, not demographics).
5. **Analysis age filter is precise:** the Customer Data tab lets the user pick an exact age or age range (min/max), not predefined ranges. The age "distribution" is a per-year histogram, not coarse buckets.
6. **Scope = full slice:** capture remodel + the Customer Data analysis tab.

## 3. Base / git context

This work depends on Part A/B-1 (local-only, never pushed) **and** Wei Siang's 66-commit delivery/inventory buildout on `origin/main`. The feature branch `worktree-customer-demographics-birthday-gender` already **merged `origin/main`** (one trivial import conflict in `mfg-sales-orders.ts`, resolved by keeping both sides). Consequences:

- **Next migration number = `0205`** (origin reached 0204; 0205 verified free).
- The `mfg_sales_orders_with_payment_totals` view's current definition (mig **0200**, Wei Siang's prod hotfix) enumerates columns **explicitly** and does **not** reference `customer_race`/`customer_age_frame`. So **dropping those two columns does not require a view rebuild** — only a dependency check to confirm nothing else references them.

## 4. Data model

### 4.1 `customers` table (`packages/db/src/schema.ts`)
Add three nullable columns:
- `race text` — value from `RACE_OPTIONS`.
- `birthday date` — ISO date.
- `gender text` — value from `GENDER_OPTIONS`.

### 4.2 `mfg_sales_orders` (`packages/db/src/schema.ts`)
**Remove** `customerRace` (`customer_race`) and `customerAgeFrame` (`customer_age_frame`) and their comment block (Part A columns; never carried real data because capture never deployed).

### 4.3 Migration `0205_customer_demographics_to_customers.sql`
Single transactional file:
1. `ALTER TABLE customers ADD COLUMN race text, birthday date, gender text;` (all nullable; no backfill — table is empty on prod, verified 0 rows in mig 0146).
2. Dependency pre-check (owner-gated, run before applying — not in the file). Confirm nothing depends on the two columns; expect zero rows (the explicit-column view 0200 doesn't reference them):
   ```sql
   SELECT dependent.relname, a.attname
   FROM pg_depend d
   JOIN pg_rewrite r ON r.oid = d.objid
   JOIN pg_class dependent ON dependent.oid = r.ev_class
   JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
   WHERE d.refobjid = 'public.mfg_sales_orders'::regclass
     AND a.attname IN ('customer_race','customer_age_frame');
   ```
   If any rows return, resolve the dependency (drop/recreate that object) before the column drop.
3. `ALTER TABLE mfg_sales_orders DROP COLUMN customer_race, DROP COLUMN customer_age_frame;`
4. **Replace the RPC by dropping the old signature and creating the new one** — adding params changes the function signature, so `CREATE OR REPLACE` would leave a stale 3-arg overload behind. So: `DROP FUNCTION public.upsert_customer_by_name_phone(text, text, text);` then `CREATE FUNCTION public.upsert_customer_by_name_phone(text, text, text, text, date, text)` (the three new params `DEFAULT NULL`, so 3-arg callers resolve to it via defaults), restating `SECURITY DEFINER`, `SET search_path = 'public'`, and `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO authenticated` on the **new** signature (see §6).

Applied to prod via Supabase MCP, owner-gated (per CLAUDE.md red lines), **migrate-before-deploy**.

## 5. Shared module (`packages/shared/src/customer-demographics.ts`)

- **Keep:** `RACE_OPTIONS`, `Race`, `isValidRace`.
- **Remove (retire):** `AGE_FRAMES`, `AgeFrameCode`, `isValidAgeFrame`, `ageFrameLabel`. (Plan must grep post-merge to confirm no remaining importers besides the files this spec rewrites.)
- **Add:**
  - `GENDER_OPTIONS = ['Male','Female','Others'] as const`, `Gender` type, `isValidGender(v): v is Gender`.
  - `isValidBirthday(v, asOf?)` — strict ISO `YYYY-MM-DD`; not in the future relative to `asOf`; plausible age `0..120`; leap-year safe.
  - `ageFromBirthday(birthday, asOf?) → number | null` — exact integer age, or null for invalid input.
- `asOf` defaults to today (local). It exists so unit tests and server/client calls are deterministic.
- `packages/shared/src/index.ts` re-exports via `export *` — no edit needed (added symbols flow through; removed ones disappear).

## 6. Customer resolve — the RPC persists demographics

`upsert_customer_by_name_phone` gains `p_race text DEFAULT NULL, p_birthday date DEFAULT NULL, p_gender text DEFAULT NULL` (added as a new 6-arg signature replacing the 3-arg one — see §4.3 step 4). `DEFAULT NULL` keeps all existing callers (SO PATCH, consignment) working unchanged.
- **New customer (INSERT):** store all three in the new columns.
- **Existing customer (match):** **keep-first coalesce-fill** — `race = COALESCE(race, p_race)`, `birthday = COALESCE(birthday, p_birthday)`, `gender = COALESCE(gender, p_gender)` (`COALESCE(existing, incoming)` → fills only NULLs; never clobbers a stored value), alongside the existing `last_seen_at` bump. Correcting an already-set value is out of scope (no edit UI yet).

## 7. API changes (`apps/api/src/routes/`)

### 7.1 `mfg-sales-orders.ts`
- **Imports:** drop `isValidAgeFrame`; add `isValidBirthday`, `isValidGender` (keep `isValidRace`).
- **POST create:** delete the SO-snapshot writes for `customer_race`/`customer_age_frame`. At the `upsert_customer_by_name_phone` call, pass `p_race`/`p_birthday`/`p_gender` from the body, each coerced through its shared validator (invalid/missing → `null`, lenient — never reject the SO over demographics; the POS gate already enforced required-for-NEW per §4 Decision 4).
- **PATCH (customer re-resolve when name/phone change):** pass demographics from the body if present, else `null` (coalesce-fill keeps existing).
- **`GET /mfg-sales-orders/customer-search`:** demographics now come from the **`customers`** table. Keep the SO-history scan for name/address/emergency-contact coalescing; additionally collect each identity's `customer_id`, batch-load those customer rows, and attach `race`/`birthday`/`gender`. Update the `Row` type and the returned hit shape (`ageFrame` → `birthday` + `gender`). SOs with NULL `customer_id` simply carry null demographics.

### 7.2 `consignment-orders.ts`
No change required — its `upsert_customer_by_name_phone` call uses the new NULL defaults (consignment doesn't capture demographics). A consignment-created NEW customer therefore has NULL demographics; they get filled at that customer's next **POS** handover via coalesce-fill (§6). This is intentional — "required for NEW" is a POS capture rule (§4 Decision 4), and consignment is a backend path that must not be blocked.

## 8. POS capture (`apps/pos/src/`)

- **`lib/handover-helpers.ts`:** `HandoverForm` — replace `ageFrame: string` with `birthday: string` + `gender: string` (keep `race`). `validateCustomer`: a NEW customer requires `race` + valid `birthday` + `gender`. `customerBlockers`: replace the age-group message with "Birthday required for a new customer" and "Gender required for a new customer". Update `handover-helpers.test.ts` fixtures/cases.
- **`components/handover/CustomerStep.tsx`:** keep the Race select. Replace the age-group select with a **Birthday** `<input type="date">` (`min` ≈ 1924-01-01, `max` = today) and a read-only **exact age** caption ("Age 34") via `ageFromBirthday`. Add a **Gender** select from `GENDER_OPTIONS`. `pickCustomer` prefills race + birthday + gender. Update the marketing caption to mention birthday + gender. Required markers (`*`) follow the existing `!matched` logic. Layout: Race + Gender on one `fieldRow`, Birthday (with age caption) on the next.
- **`pages/Handover.tsx`:** empty-form init `ageFrame` → `birthday` + `gender`; payload assembly sends `customerRace` / `customerBirthday` / `customerGender`. Snapshot restore works via the existing spread (old snapshots lack the fields → empty → re-required for NEW).
- **`lib/pos-handover-so.ts`:** `PosHandoffPayload` — `customerAgeFrame` → `customerBirthday` + `customerGender`.
- **`lib/customer-search.ts`:** `CustomerSearchHit` — `ageFrame` → `birthday` + `gender`.

## 9. Sales Analysis — Customer Data tab

### 9.1 API (`apps/api/src/routes/sales-analysis.ts`)
Add a `customers` section to the `GET /sales-analysis` response (same `isGlobalCurator` gate; `customers` RLS `SELECT` = any staff, so curators can read). For the period/`includeTest`-filtered in-scope SOs: collect distinct `customer_id`s, load those `customers` rows (id, name, race, birthday, gender, state) plus per-customer order stats (order count, LTV, first/last order date → new-vs-returning). Return a **raw per-customer list** (including `birthday`); ages and distributions are computed client-side so the precise-age filter stays fully flexible.

### 9.2 Shared (`packages/shared/src/sales-analysis.ts`)
Add pure, unit-tested helpers:
- type `SaCustomerRow` (raw per-customer, the API response shape):
  ```ts
  export interface SaCustomerRow {
    id: string; name: string;
    race: string | null; birthday: string | null; gender: string | null;
    state: string | null;
    orderCount: number; ltvCenti: number;
    firstOrderDate: string | null; lastOrderDate: string | null;
    isReturning: boolean;            // >1 distinct purchase in scope
  }
  ```
  The API returns `{ customers: SaCustomerRow[] }` under the response's `customers` key.
- `summarizeCustomerDemographics(rows, { ageMin?, ageMax?, asOf? })` → `CustomerDemographicsSummary`: filtered per-customer list (each with computed exact `age: number | null`), `gender` distribution (Male/Female/Others/Unknown), `race` distribution, an **age histogram by exact year**, `newVsReturning`, and `byState`. Pure → testable.
- **NULL-birthday handling:** customers with a null/invalid birthday are **excluded from age-range filtering and the age histogram** (so histogram totals can be less than the sample size), but **remain in the per-customer list** (age shown blank) and **still count in the gender/race/state distributions** when those fields are set.
- **Age-range filter is inclusive on both ends:** a customer matches when `age != null && age >= (ageMin ?? -∞) && age <= (ageMax ?? +∞)`. Both bounds optional.

### 9.3 POS (`apps/pos/src/pages/SalesAnalysis.tsx` + `.module.css` + `lib/sales-analysis-queries.ts`)
- Introduce a minimal **tab bar** (`Overview` | `Customer Data`); the planned Products tab (B-2a) slots in alongside later.
- **Customer Data view:**
  - **Precise-age filter:** two numeric inputs (min age / max age, both optional, inclusive bounds per §9.2). Drives `summarizeCustomerDemographics` client-side; everything below recomputes for the selected range.
  - **Distributions:** gender (Male/Female/Others) and race as CSS bars; age as a **per-year histogram**. `MIN_SAMPLE` guard for thin views.
  - **Per-customer list (CustomerInfo):** name, race, **birthday + exact age**, gender, order count, last order; top-N with the total-unique count shown.
- `sales-analysis-queries.ts`: extend the response type with the `customers` section.

## 10. Testing

- **Shared:** `customer-demographics.test.ts` — `GENDER_OPTIONS`/`isValidGender`; `isValidBirthday` (bad format, future date, boundary ages 0/120/121, Feb-29); `ageFromBirthday` (known dates, leap-year, on-birthday boundary) with fixed `asOf`. `sales-analysis.test.ts` — `summarizeCustomerDemographics` (age-range filter inclusivity, distributions, null-birthday handling, new-vs-returning).
- **POS:** `handover-helpers.test.ts` — NEW requires race+birthday+gender; blockers list.
- **Gates:** `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build` all green. No HTTP harness exists for the SO/analysis routes — server-side correctness relies on the shared pure functions' tests + careful review (project norm).

## 11. Sequencing, deploy, risks

- **Build order:** schema + migration 0205 → shared module (+tests) → RPC/API → POS capture → customer-search → Sales Analysis (shared core + API + page). Commit atomically per step.
- **Deploy:** migrate-before-deploy; owner-gated; POS is a PWA → remind Loo to hard-refresh after the POS deploy.
- **Risks / mitigations:**
  - *Dropping SO demographic columns:* the current explicit-column payment-totals view (0200) doesn't reference them → no rebuild; plan still runs a `pg_depend` check before the drop.
  - *Migration numbering* (CLAUDE.md duplicate-number caveat): 0205 verified free on disk; verify actual DB objects before assuming prior migrations ran.
  - *RLS:* curator can `SELECT customers`; demographic writes go only through the `SECURITY DEFINER` RPC (sales staff can't direct-`UPDATE` customers).
  - *Retiring AGE_FRAMES exports:* grep post-merge to confirm no importer survives outside the rewritten files.

## 12. Out of scope

- Editing an existing customer's demographics after first capture (no customer-edit UI yet — future "CustomerInfo edit").
- Storing point-in-time demographic snapshots on the SO (demographics are now customer-level only).
- The Products tab (B-2a/B-2b) — separate, already planned, separate worktree.
- Backend (admin) surfacing of demographics — this slice is POS Sales Analysis only.
