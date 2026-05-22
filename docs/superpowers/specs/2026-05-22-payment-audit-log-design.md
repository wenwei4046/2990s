# Payment Audit Log + Verify-Slip Removal — Design

**Date:** 2026-05-22
**Author:** Claude + Loo
**Status:** Approved, ready for implementation plan

## Background

Today's Backend has a `/verify-slips` page where the Order Coordinator manually marks each uploaded bank-transfer slip as Verified or Flagged. Once verified, the slip "disappears" — there is no historical view, no export, and no reporting surface for Finance to cross-check payments against the bank statement.

Loo's call (2026-05-22): **delete the Verify step entirely**. Finance will cross-check payments manually against the bank statement using an exported Excel. The Backend's job is to give them a clean, filterable, exportable log of every recorded order payment.

Same conversation also confirmed: **bump `order_seq` from 2050 → 2990** so production sales orders start at `SO-2990` (brand alignment with "2990's Home"). The 6 existing test orders (`SO-2059`…`SO-2065`) stay as-is.

## Goals

- Finance can pull a filtered Excel/CSV of every order's payment record, any time.
- Coordinator no longer has to manually verify slips — POS upload alone is the recorded event.
- Auditable view inside the Backend with a clickable slip thumbnail for spot checks.
- New SOs from now on start at `SO-2990`.

## Non-goals

- Multi-payment support (deposits + balance + refunds). The `payments` table exists in schema but is unused; we will not start writing to it as part of this change. If multi-payment support is needed later, that is a separate spec.
- Automated bank-statement reconciliation. Finance does the cross-check manually in Excel.
- Backfilling the `slip_verified_by` / `slip_verified_at` columns on historical rows. They stay as snapshot data on the 6 test orders, NULL for future ones.

## Scope

### Things being removed

| Surface | Action |
|---|---|
| `apps/backend/src/pages/VerifySlips.tsx` + `.module.css` | Delete file |
| Route `/verify-slips` in `apps/backend/src/router.tsx` | Remove |
| Sidebar nav item "Verify slips" + its badge logic in `apps/backend/src/components/Sidebar.tsx` | Remove |
| `useSlipQueue` / `useSlipQueueRealtime` exports in `apps/backend/src/lib/queries.ts` | Remove (only consumed by the two files above) |
| Verify / Flag buttons + flag-form UI in `apps/backend/src/components/SlipSection.tsx` | Remove. Slip thumbnail + "View larger" preview stay — OrderDrawer still needs to show the slip image. |
| `verifySlip` / `flagSlip` helpers in `apps/backend/src/lib/slip.ts` | Remove |
| `PATCH /orders/:id/slip` route in `apps/api/src/routes/orders.ts` — **only the verify/flag state-change handler**, NOT the slip upload init path. POS still uploads slips through its existing endpoint; the `slip_state` column will simply stay at `'pending'` forever on new orders. | Remove |
| The slip-queue API endpoint (whatever feeds `useSlipQueue`) | Remove |

### Things being added

| Surface | Action |
|---|---|
| Sidebar nav item "Payment audit log" with `FileSpreadsheet` Lucide icon | Add (under Workspace group, in the slot vacated by Verify slips) |
| Route `/audit-log` in `router.tsx` | Add |
| `apps/backend/src/pages/AuditLog.tsx` + `.module.css` | New file. Table view with filter bar + export buttons + slip preview modal. |
| `GET /admin/audit-log` endpoint in `apps/api/src/routes/admin.ts` | New. Returns filtered rows as JSON. |
| `useAuditLog` query hook in `apps/backend/src/lib/queries.ts` | New |
| `apps/backend/src/lib/audit-export.ts` | New. Two functions: `exportXlsx(rows)` and `exportCsv(rows)`. Uses lazy-imported `xlsx` package so the bundle cost only hits the audit-log page. |
| `xlsx` package added to `apps/backend/package.json` | New dependency (~80KB gzipped, lazy-loaded) |

### Schema / DB

- New migration `0033_bump_order_seq_to_2990.sql`:
  ```sql
  ALTER SEQUENCE order_seq RESTART WITH 2990;
  ```
  Idempotent — re-running on an already-bumped seq leaves it at 2990 unless intervening orders pushed it higher. Migration adds an assertion so it errors loudly if `(SELECT last_value FROM order_seq) > 2990` (someone placed an order between deploy and migration).

- **No new tables.** Audit log reads existing `orders` columns joined to `staff` (twice: for `salespersonId` and `staffId`) and `showrooms`.

- `slip_state` column / enum, `slip_verified_by`, `slip_verified_at`, `slip_flag_reason`: **keep**. POS still writes `slip_state = 'pending'` on upload — that's fine, the state just no longer transitions to `'verified'` or `'flagged'`. Future cleanup can drop the columns if we want; not blocking.

### Docs

- `CLAUDE.md` "Order IDs" section: change "sequence starting at 2050" → "starting at 2990". Add a note that 2050 was the pre-pilot test range.

## API contract

### `GET /admin/audit-log`

**Auth**: staff role ∈ {owner, admin, coordinator, finance}. Sales / showroom-lead get 403.

**Query params** (all optional):
- `from=YYYY-MM-DD` — `orders.placedAt >= from`
- `to=YYYY-MM-DD` — `orders.placedAt < to + 1 day`
- `salespersonId=uuid` — repeatable (`?salespersonId=a&salespersonId=b`) for multi-select
- `staffId=uuid` — repeatable (who keyed)
- `paymentMethod=credit|debit|installment|transfer` — repeatable
- `showroomId=uuid` — repeatable
- `amountMin=integer` — `total >= amountMin` (whole RM)
- `amountMax=integer` — `total <= amountMax`
- `slipUploaded=true|false` — `true` → `slip_key IS NOT NULL`, `false` → `slip_key IS NULL`

**Defaults** (when no query params): rows where `placedAt >= today − 30 days`. Avoids accidentally returning the entire history every page load.

**Response** (`200 OK`):
```json
{
  "rows": [
    {
      "id": "SO-2990",
      "placedAt": "2026-05-22T10:14:00Z",
      "customerName": "Tan Wei Ming",
      "total": 5980,
      "paymentMethod": "transfer",
      "approvalCode": "BNK-784512",
      "slipKey":      "slips/SO-2990/abc.jpg",
      "slipUploaded": true,
      "showroomId":     "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "salespersonId":  "...",
      "staffId":        "..."
    }
  ],
  "count": 1
}
```

`slipKey` is the R2 key. Frontend calls existing `fetchSlipUrl` helper to get a presigned URL when the user clicks the thumbnail.

**Why IDs not names**: the endpoint returns FK IDs (`showroomId` / `salespersonId` / `staffId`) rather than nested `{id, name}` objects. The Backend already caches the full staff and showroom lists via TanStack Query (`useStaffList`, `useShowrooms`), so resolving ID → name on the client costs nothing and keeps the API flat. Avoids server-side joins on every audit-log request.

**Sort**: `placedAt DESC` always. Pagination not in scope — 2990's volume is modest and the default 30-day window will rarely exceed a few hundred rows. If it ever does we add `?limit=&offset=`.

## UI

### Sidebar

```
Workspace
  Dashboard
  Orders
  Payment audit log          ← was "Verify slips"
Catalog
  ...
```

Icon: `FileSpreadsheet` (Lucide), 20px / stroke 1.75 — consistent with the existing icon set. No badge (the audit log is a passive report, no urgent count to draw attention to).

**Role gating**: sidebar item only renders for staff with role ∈ {owner, admin, coordinator, finance}. Sales / showroom-lead don't see it, so they don't click into a 403. Same role set as the API route's `requireRole` middleware — single source of truth lives in `apps/backend/src/lib/auth.tsx`.

### Page `/audit-log`

```
┌─ Header ──────────────────────────────────────────────────────────┐
│ Eyebrow:   Finance reports                                         │
│ Title:     Payment audit log                                       │
│ Lede:      Every recorded payment. Filter, then export to .xlsx or │
│            .csv for bank-statement reconciliation.                 │
│                                       [Export .xlsx] [Export .csv] │
├─ Filter bar (collapsible card) ──────────────────────────────────┤
│ [Date range: this month ▾] [Salesperson: all ▾] [Keyed by: all ▾] │
│ [Method: all ▾] [Showroom: all ▾] [Amount: __ – __] [Slip: any ▾] │
│ [Reset filters]                                                    │
├─ Table ──────────────────────────────────────────────────────────┤
│ SO#       Date       Showroom    Customer       Amount  Method ...│
│ SO-2990   22 May     KL          Tan Wei Ming   RM 5,980 transfer │
│ SO-2989   ...                                                      │
└────────────────────────────────────────────────────────────────────┘
```

**Columns** (left to right):
1. `SO#` — monospaced
2. `Date` — `DD MMM YYYY HH:mm` (Asia/Kuala_Lumpur)
3. `Showroom`
4. `Customer`
5. `Amount` — `RM 5,980` right-aligned, `fmtRM` from `@2990s/shared`
6. `Method`
7. `Approval code` — monospaced, `—` if NULL
8. `Salesperson`
9. `Keyed by`
10. `Slip` — clickable thumbnail (40×40px) or `—` if no slip. Click opens existing slip preview modal (lazy-loaded R2 presigned URL).

**Filter behavior**:
- Filters apply live (no separate "Apply" button). Each change triggers a TanStack Query refetch with the new params.
- Date range presets: This month (default), Last month, Last 30 days, Last 90 days, Custom. Custom shows two date pickers.
- Salesperson / Keyed by / Method / Showroom: multi-select dropdowns. Empty selection = "all".
- Amount: two number inputs (`min`, `max`), both optional.
- Slip: tri-state select — Any (default) / Uploaded / Not uploaded.
- "Reset filters" resets everything to defaults (date = this month, others = all).

**Empty state**: "No payments match these filters. Try widening the date range or clearing a filter."

**Loading state**: skeleton rows.

**Realtime**: page subscribes to existing `orders` Realtime channel; new rows appear at the top automatically (if they match active filters).

### Slip preview modal

Same `SlipSection` modal already used by `OrderDrawer`, with Verify / Flag buttons stripped. Just shows the image + "Close".

### Export

Both buttons act on the **currently filtered** result set, not the raw 30-day default. So if the user narrows to "May 2026 + Aw Wei Lin only", the export contains exactly those rows.

**Filename pattern**: `2990s-audit-log-YYYY-MM-DD.xlsx` (today's date, in browser TZ).

**.xlsx schema** (single sheet "Payments"):
| Column header | Excel type |
|---|---|
| `SO#` | text |
| `Date` | datetime |
| `Showroom` | text |
| `Customer` | text |
| `Amount (RM)` | number (integer) |
| `Method` | text |
| `Approval code` | text |
| `Salesperson` | text |
| `Keyed by` | text |
| `Slip uploaded` | text ("Yes" / "No") |

Frozen header row, column widths auto-sized via SheetJS `!cols`.

**.csv format**: UTF-8 with BOM (so Excel opens Chinese characters in customer names correctly), `,` separator, `"` quote-wrap with `""` escape. Same columns as .xlsx in same order.

## Implementation notes

### Bundle cost of `xlsx`

`xlsx` (SheetJS Community Edition) ships ~280KB raw / ~80KB gzipped. Lazy-import it inside `audit-export.ts`:

```ts
export const exportXlsx = async (rows: AuditRow[]) => {
  const XLSX = await import('xlsx');
  // ...
};
```

This keeps the audit-log page's incremental cost out of the main bundle. The first export click triggers the chunk download (typically <1s on broadband, cached thereafter).

### Sequence bump idempotency

```sql
DO $$
DECLARE
  current_value BIGINT;
BEGIN
  SELECT last_value INTO current_value FROM order_seq;
  IF current_value > 2990 THEN
    RAISE EXCEPTION 'order_seq is already at %, cannot RESTART backwards. Manual intervention required.', current_value;
  END IF;
  ALTER SEQUENCE order_seq RESTART WITH 2990;
END $$;
```

This protects against a race where a real order lands between deploy and migration. If that happens, the migration loudly errors and we resolve manually.

### RLS on `/admin/audit-log`

The Hono route uses the existing `requireRole(['owner', 'admin', 'coordinator', 'finance'])` middleware (same pattern as other admin routes). The route itself runs against the service-role Supabase client, so RLS on `orders` doesn't gate it — role check is the only gate.

### Realtime channel

Reuse the channel already subscribed by `useOrders` / `OrdersBoard`. No new channel needed.

## Testing

- **Unit**: `audit-export.test.ts` — feed 3 representative rows through `exportXlsx` + `exportCsv`, assert sheet structure / CSV bytes. Use SheetJS to read back the .xlsx in the test and verify cell types.
- **API**: `admin.audit-log.test.ts` — date filter, multi-select filter, role check (sales → 403, coordinator → 200), empty result, slip-uploaded tri-state.
- **Migration**: `0033_bump_order_seq.test.sql` — run twice, assert sequence at 2990 both times. Simulate "already past 2990" by inserting a higher value first, assert raises.
- **E2E** (Playwright): from `coordinator` login → navigate to audit log → apply filter → click Export .xlsx → assert file downloaded → click slip thumbnail → assert modal opens with image.

## Migration / Rollout

Single PR. Order of operations matters because the sequence bump should land in the same deploy as the UI changes:

1. Migration `0033` applied via Supabase MCP `apply_migration` before merging.
2. Code changes merged to main → GitHub Actions deploys API + Backend.
3. Sidebar "Verify slips" disappears, "Payment audit log" appears.
4. Old `/verify-slips` URL 404s — acceptable, internal users only.

No data backfill, no flag-gating, no parallel-run. The Verify step is gone the moment this ships.

## Open questions

None — all clarified in the brainstorming conversation on 2026-05-22.
