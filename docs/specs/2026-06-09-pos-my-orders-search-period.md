# POS "My orders" — search bar + period filter

> Spec · 2026-06-09 · branch `feat/pos-my-orders-search-period`
> Page: `apps/pos/src/pages/OrderStatus.tsx` (route `/my-orders`)

## Goal

Give sales staff two independent tools on the My-orders board:

1. **Search** — find any of *their own* orders by **SO number / customer name / phone**, across **all time** (the search ignores the period picker entirely).
2. **Period picker** — choose which period the board + the two KPI summary cards display: a **month** (◀ June 2026 ▶) or a **from–to date range**.

Default on load = **current calendar month**, live on today's date (Asia/Kuala_Lumpur).

## Decisions (locked with Loo, 2026-06-09)

- Server-side, covers **all** the salesperson's orders (not just the latest 80 the board currently loads).
- Date filter is by **order-placed date** (`created_at` / SO date), matching the monthly sales-summary semantics.
- KPI summary cards **recompute for the selected period**.
- Search is **fully decoupled** from the period: pressing search queries all time periods. The period picker only governs the browse display.

## Search ↔ period interaction

| State | Board shows | KPI cards |
|---|---|---|
| Search empty | orders in the selected period | selected period |
| Search non-empty | **all-time** matches (period ignored) | still the selected period (cards = "this period's sales", not search results) |

When a search is active, the board shows a hint line: "Showing search results across all dates."

## API changes (`apps/api`)

### `GET /mfg-sales-orders/mine` — `?q=&from=&to=`
- `from` / `to`: ISO `YYYY-MM-DD` (MY-local day bounds → UTC instants). Filter `created_at` in `[from, to)`.
- `q`: trimmed string → `ilike '%q%'` across `doc_no`, `debtor_name`, `phone`. When `q` is non-empty, the date window is **not** applied.
- `.limit(80)` → **300** so a wide range / all-time search doesn't silently truncate; `console.log` a notice if the cap is hit.
- No params → unchanged behaviour is acceptable, but the POS will always pass the current-month window.

### `GET /pos/sales-stats` — `?from=&to=`
- Recompute both cards for `[from, to)`. Derive `monthLabel` from the window (month name+year if the window is a whole calendar month, else "D MMM – D MMM").
- No params → current month (unchanged).

### Shared helper `apps/api/src/lib/my-time.ts`
- `monthBoundsMy(year, month0)` → `{ startUtc, endUtc, label }`
- `rangeBoundsMy(fromYmd, toYmd)` → `{ startUtc, endUtc, label }` (inclusive `to` → exclusive next-day bound)
- Both endpoints use this so the timezone math can't drift. Unit-tested.

## Frontend (`apps/pos/src/pages/OrderStatus.tsx`)

- State: `period: { mode: 'month' | 'range'; year; month0; from?; to?; label }` (default = current month) and `query` (debounced ~300 ms).
- New toolbar component between `<SalesKpis>` and `.lanes`:
  - Search input (left) with a clear (✕) button.
  - `Month | Range` segmented toggle (right). Month = ◀ label ▶ stepper, clamped at the current month (no future). Range = two native `<input type="date">` (matches the drawer's existing date inputs). "This month" reset link when off-default.
- `useMyOrders(period, query)` + `useSalesStats(period)` take params and fold them into their query keys; realtime invalidation unchanged.
- Lanes bucket the filtered rows as today; lane counts update for free. Add an empty state: "No orders in {label}."

## Edge cases

- Future month: stepper clamped; KPI shows 0 cleanly.
- Empty `to` or `from` in range mode: treat as open-ended (only the provided bound applies); board still renders.
- Search whitespace-only → treated as empty.
- 300-row cap hit on a wide window → log + (optional) subtle "showing first 300" note.

## Testing

- Unit: `my-time.test.ts` — month rollover (Dec→Jan), inclusive `to`, +8 offset, whole-month label vs range label.
- Manual: verify live on CF after deploy; remind PWA hard-refresh.

## Out of scope

- Backend app order views (POS only).
- Searching other salespeople's orders (board stays scoped to `salesperson_id = self`).
