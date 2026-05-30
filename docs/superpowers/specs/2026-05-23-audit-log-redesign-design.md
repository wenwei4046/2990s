# Payment Audit Log — Visual Redesign + Installment Term Capture — Design

**Date:** 2026-05-23
**Author:** Claude + Loo
**Status:** Approved, ready for implementation plan

## Background

The Payment audit log page shipped on 2026-05-22 (replacing the verify-slip
workflow) as a **functionally complete but visually plain** page: a 10-column
table, two plain `Export .xlsx / .csv` buttons, and a `<select multiple>` filter
bar (`apps/backend/src/pages/AuditLog.tsx` + `AuditLogFilterBar.tsx`).

Loo provided target screenshots for a **richer design**: a hero card, two stat
cards, quick-range presets, chip-style payment-method filters, a free-text
search, a collapsible filter panel, and a redesigned table (bulk-select
checkboxes, deposit/full-payment badges, method-with-icon detail, customer
phone, salesperson avatars, per-row detail arrow).

This spec covers (a) the page redesign and (b) the **one new piece of data**
needed to support it — the installment term — captured at POS.

## Goals

- Bring the audit-log page up to the approved target design.
- Capture **installment term (6 or 12 months)** at POS and surface it in the
  audit-log "Method · details" column.
- Reuse data we already store wherever possible — no new data capture beyond the
  installment term.
- Leave the `POST /orders` server-side pricing recompute **completely untouched**.

## Non-goals

- **Card brand / last-4 digits / issuing bank** — explicitly dropped by Loo
  (2026-05-23). The screenshots' `Visa •••• 8985` sub-line is NOT built.
- **Installment bank name / interest rate** — dropped. Only the term (6/12 mo)
  is shown; no `CIMB ·` prefix, no `@ 0%` suffix.
- **Finance sign-off / read-only lock** — the hero copy in the screenshots
  mentions it, but no such feature exists. Hero copy is rewritten (see UI §).
- **Multi-payment** (deposits + balance + refund rows) — the `payments` table
  stays unused, same as the 2026-05-22 spec. Each order still has one recorded
  payment: `orders.paid` + `orders.paymentMethod`.
- **Pagination** — volume is modest; the existing `.limit(1000)` cap stands.

## Scope

### DB / schema

| Surface | Action |
|---|---|
| Migration `0034_add_installment_months.sql` | `ALTER TABLE orders ADD COLUMN installment_months integer;` + `CHECK (installment_months IS NULL OR installment_months IN (6, 12))`. Nullable; only set for installment orders. |
| `packages/db/src/schema.ts` → `orders` | Add `installmentMonths: integer('installment_months')` (nullable). |

No new tables. No change to `payments`, `slip_*`, or pricing columns.

### POS (`apps/pos`)

| Surface | Action |
|---|---|
| `lib/handover-helpers.ts` → `HandoverForm` | Add `installmentMonths: 6 \| 12 \| null` (default `null`). |
| `components/handover/AddonsPaymentStep.tsx` | When `paymentMethod === 'installment'`, render a 6 / 12 month segmented selector directly under the Installment method button. Switching to any other method resets `installmentMonths` to `null`. |
| Payment-step gating (`Handover.tsx` / helpers) | Cannot advance past the payment step if `paymentMethod === 'installment'` and `installmentMonths === null`. |
| `lib/orders.ts` → `CreateOrderInput` + payload | Include `installmentMonths` in the POST body. |
| `packages/shared` order-create schema | Add `installmentMonths` (nullable int). Zod refine: required ∈ {6,12} when `paymentMethod === 'installment'`, else `null`. |

### API (`apps/api`)

| Surface | Action |
|---|---|
| `routes/orders.ts` `POST /orders` | Accept `installmentMonths` in the request schema; persist to `orders.installment_months`. **Pricing recompute is unaffected** — the term is metadata only (0% installment, price unchanged). Server validates the same refine as POS. |
| `routes/audit-log.ts` `GET /admin/audit-log` | **Additive**: add `paid`, `customer_phone`, `installment_months` to the `.select(...)` and the response row mapping (`paid`, `customerPhone`, `installmentMonths`). Existing `staffId` / `showroomId` / `slipUploaded` query params **stay** (backward compatible — the new UI just stops sending them). |

### Backend (`apps/backend`) — the bulk of the work

| Surface | Action |
|---|---|
| `lib/audit-log-queries.ts` | `AuditLogRow` += `paid: number`, `customerPhone: string \| null`, `installmentMonths: number \| null`. `AuditLogFilters` trimmed to `{ from, to, salespersonIds, paymentMethods, amountMin, amountMax }` (drop `staffIds`, `showroomIds`, `slipUploaded`). |
| `pages/AuditLog.tsx` + `.module.css` | Full redesign (see UI §). |
| `components/AuditLogFilterBar.tsx` + `.module.css` | Rebuild (see UI §). |
| `lib/audit-export.ts` | Add `Paid (RM)` and `Installment (months)` columns. Export acts on **selected rows if any are selected, otherwise the full filtered+searched set**. |
| OrderDrawer | Reuse the existing backend OrderDrawer (same one the Orders board opens); wire the per-row arrow to open it by SO id. |

## API contract (updated response)

`GET /admin/audit-log` → each row:

```json
{
  "id": "SO-2990",
  "placedAt": "2026-05-22T10:14:00Z",
  "customerName": "Tan Wei Ming",
  "customerPhone": "+60 12 345 6789",
  "total": 6819,
  "paid": 4466,
  "paymentMethod": "installment",
  "installmentMonths": 12,
  "approvalCode": "BNK-784512",
  "slipKey": "slips/SO-2990/abc.jpg",
  "slipUploaded": true,
  "showroomId": "aaaaaaaa-...",
  "salespersonId": "...",
  "staffId": "..."
}
```

`installmentMonths` is `null` for non-installment orders. Sort, auth
(`coordinator` / `finance` / `admin`), and the 30-day default window are
unchanged.

## UI

### Filter panel — two states

The page has a `Hide filters` / `Show filters` toggle (double-chevron Lucide
icon, stroke 1.75). The **stat cards** and **QUICK RANGE chips** are always
visible; only the detailed panel collapses.

**Expanded** (button reads `Hide filters` ⌃):

```
┌ Hero card: icon · "Payment audit log" · lede · [Export & tools ▾] ───────┐
├ [ TOTAL RECORDED  RM 255,090 · last 30 days ]   [ #  28  PAYMENTS ] ─────┤
│ QUICK RANGE  (Today)(Yesterday)(Last 7)(Last 30•)(Last 90)   [Hide filters ⌃]│
├ ── detailed panel ───────────────────────────────────────────────────────┤
│ PERIOD  From [▾]  →  To [▾]      PAYMENT METHOD ▢Credit ▢Debit ▢Inst ▢Transfer│
│ SALESPERSON [ All salespeople ▾ ]            AMOUNT (RM) [min] – [max]      │
│ SEARCH [ SO#, customer, bank ref… ]                                        │
│ 28 of 28 payments match                                  [ Reset filters ] │
├ ── table ─────────────────────────────────────────────────────────────────┤
```

**Collapsed** (button reads `Show filters` ⌄): the detailed panel is removed;
the table sits directly under the QUICK RANGE row. Stat cards + chips remain.

**Default on load:** expanded (filters visible). One-line state flip if Loo
later prefers collapsed.

### Quick-range chips

`Today` / `Yesterday` / `Last 7 days` / `Last 30 days` (default) / `Last 90 days`.
Clicking sets `from`/`to`:

| Chip | from | to |
|---|---|---|
| Today | today | today |
| Yesterday | today−1 | today−1 |
| Last 7 days | today−6 | today |
| Last 30 days | today−29 | today |
| Last 90 days | today−89 | today |

Active chip highlighted (brand rust fill). Manually editing the Period dates to a
non-matching range clears the active highlight. `Reset filters` → Last 30 days +
all other filters cleared.

### Stat cards

- **TOTAL RECORDED** — `sum(paid)` over the fully filtered + searched set, in
  `fmtRM`. Subtitle echoes the active range (`last 30 days`, `today`, …).
- **PAYMENTS** — row count of that set.

Both recompute live as filters / search change.

### Filters (detailed panel)

- **Period** — `From` / `To` native date inputs (drive `from`/`to`).
- **Payment method** — four toggle chips with icons (Credit card, Debit card,
  Installment, Bank transfer). Multi-select; none selected = all. Drives
  `paymentMethods`.
- **Salesperson** — single dropdown, default "All salespeople". Drives
  `salespersonIds` (single id or empty). Options from `useStaff` (role `sales`,
  active).
- **Amount (RM)** — `min` / `max` number inputs → `amountMin` / `amountMax`.
- **Search** — free text, **client-side**, case-insensitive; matches `id`,
  `customerName`, or `approvalCode` (= bank ref). Updates the match count and
  stat cards. No API param.
- **Match count** — `{X} of {Y} payments match`, where `Y` = server-returned
  count for the active server filters and `X` = count after client search.

Dropped vs. the old bar: `Keyed by`, `Showroom`, `Slip uploaded`.

### Table

| Col | Content |
|---|---|
| ☐ | Header checkbox = select all visible rows; row checkbox = select row. |
| DATE / TIME | Two lines: `21 May` / `23:01` (Asia/Kuala_Lumpur). |
| SO# | Rounded pill (rust border/text on cream). |
| CUSTOMER | Name (bold) + phone (`customerPhone`, muted) below. |
| AMOUNT | `RM` superscript + `fmtRM(paid)`, right-aligned. Badge below: `paid >= total` → green `Full payment`; else amber `Deposit · {round(paid/total*100)}% of {total}`. |
| METHOD · DETAILS | Colored icon tile + method name. Sub-line **only for installment**: `{installmentMonths} months` (or `—` if a legacy installment row has null term). Credit/Debit/Transfer have no sub-line. |
| SALESPERSON | Initials avatar + name (resolve `salespersonId` via `useStaff`). |
| → | Arrow button; opens the existing OrderDrawer for that SO id. |

**Method icon map** (Lucide, stroke 1.75, colored tile bg):
- credit → `CreditCard`
- debit → `CreditCard`
- installment → `CalendarClock`
- transfer → `QrCode`

**Empty state:** "No payments match these filters. Try widening the date range,
clearing a filter, or changing your search."

**Loading:** skeleton rows. **Realtime:** keep the existing `orders` channel
subscription; new matching rows appear at the top.

### Bulk select + export

- Selecting rows enables "export selected".
- `Export & tools ▾` dropdown: `Export .xlsx` / `Export .csv` (existing
  `audit-export.ts`, lazy-loaded `xlsx`).
- If ≥1 row selected → export selected; else → export the full filtered+searched
  set. Filename `2990s-audit-log-YYYY-MM-DD.{xlsx,csv}`.
- Export columns add `Paid (RM)` and `Installment (months)` to the existing set.

### Hero card copy (rewritten — no verify/flag/sign-off)

> **Payment audit log** — Every recorded payment, with full audit trail. Filter,
> search, and export to .xlsx or .csv for bank-statement reconciliation.

### Per-row detail

The arrow opens the existing backend **OrderDrawer** — `<OrderDrawer orderId={id}
onClose={...} />` (props `{ orderId: string | null; onClose }`, loads via
`useOrderDetail(orderId)`). `Orders.tsx` drives it through a `?orderId=` search
param; the audit-log page does the same (or local state). No new payment-detail
panel.

## Decisions locked (2026-05-23)

1. AMOUNT headline = `paid` (actual recorded), badge compares to `total`.
2. `TOTAL RECORDED` = `sum(paid)`.
3. Search is client-side over the fetched rows (no API param).
4. Installment term is **required** (6 or 12) when method = installment, enforced
   on both POS and API.
5. `Export & tools` = `.xlsx` / `.csv` only; acts on selected-or-all.
6. Hero copy rewritten (above).
7. Card brand/last-4/bank and installment bank/rate are NOT shown.
8. Default filter state = expanded.

## Testing

- **Unit (backend):** deposit-badge logic (`paid/total` → %, full vs deposit);
  quick-range date math; client search filter (id / name / approvalCode);
  installment sub-line rendering (12 → "12 months", null → "—").
- **Unit (shared/pos):** order-create schema refine — installment requires
  term; non-installment forces null.
- **API:** `audit-log.test.ts` — response now includes `paid`,`customerPhone`,
  `installmentMonths`. `orders.test.ts` — POST persists `installmentMonths`;
  rejects installment without a term; rejects term on non-installment; pricing
  total identical with/without term.
- **Migration:** `0034` adds column + CHECK; rejects an out-of-range value.
- **E2E (Playwright):** coordinator → audit log → toggle Hide/Show filters →
  search narrows count + stat cards → select 2 rows → Export .xlsx → file
  downloaded. POS → Installment → pick 12 months → place order → row shows
  `12 months` in the audit log.

## Migration / Rollout

Single PR. Migration `0034` applied via Supabase MCP `apply_migration` before
merge (additive, nullable — safe on existing rows). Code merged → CI deploys
API + Backend + POS. No backfill (legacy installment rows show `—` for term).

## Open questions

None — all clarified 2026-05-23. (Default filter state = expanded, per Decision 8;
flip is one line if Loo changes his mind.)
